// Integración de solo lectura con la API de Mercado Pago.
//
// Sirve para que el empleado pueda VERIFICAR los cobros sin entrar a la cuenta de
// Mercado Pago: el servidor consulta la API con el access token (que nunca sale de acá),
// guarda cada pago en la base y el panel /pagos.html muestra únicamente monto, hora,
// medio y estado. Desde el panel no se puede mover un peso: la API se usa solo para leer.
//
// Hay dos vías de entrada, y conviene tener las dos:
//   1. Webhook (tiempo real): Mercado Pago avisa apenas entra un pago.
//   2. Sincronización periódica (red de seguridad): cada pocos minutos se re-consultan
//      los últimos días por si un webhook se perdió (en Render el servicio se duerme).
// Las dos terminan en el mismo upsert, así que un pago que llega por las dos vías no
// se duplica.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONFIG_PATH = path.join(__dirname, "mercadopago-config.json");
const API_BASE = "https://api.mercadopago.com";

// En Render el token vive en variables de entorno, igual que TIENDANUBE_* y TURSO_*.
// En esta PC, si no hay variables, se lee del archivo local (está en .gitignore).
let cfg = null;
if (process.env.MP_ACCESS_TOKEN) {
  cfg = {
    accessToken: process.env.MP_ACCESS_TOKEN,
    webhookSecret: process.env.MP_WEBHOOK_SECRET || null,
  };
} else {
  try {
    const local = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (local.accessToken) cfg = { accessToken: local.accessToken, webhookSecret: local.webhookSecret || null };
  } catch (e) {
    // Sin configurar: el panel de pagos avisa y el resto del sistema sigue funcionando.
  }
}

function isConfigured() {
  return !!(cfg && cfg.accessToken);
}

function tieneSecretoWebhook() {
  return !!(cfg && cfg.webhookSecret);
}

async function mpFetch(endpoint, options = {}) {
  if (!isConfigured()) throw new Error("Mercado Pago no está configurado (falta MP_ACCESS_TOKEN)");
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Mercado Pago API ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Lectura de pagos ----------

async function getPago(paymentId) {
  return mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

// Busca los pagos creados entre dos fechas. Pagina de a 50 hasta traer todo el rango.
// Cubre cobros por QR, link de pago, checkout y Point.
async function buscarPagos({ desdeISO, hastaISO, maxPaginas = 20 }) {
  const encontrados = [];
  let offset = 0;
  const limit = 50;

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const params = new URLSearchParams({
      sort: "date_created",
      criteria: "desc",
      range: "date_created",
      begin_date: desdeISO,
      end_date: hastaISO,
      limit: String(limit),
      offset: String(offset),
    });
    const data = await mpFetch(`/v1/payments/search?${params.toString()}`);
    const lote = Array.isArray(data.results) ? data.results : [];
    encontrados.push(...lote);
    if (lote.length < limit) break;
    offset += limit;
  }

  return encontrados;
}

// Movimientos de la cuenta (transferencias que entran al CVU y que no siempre aparecen
// como "payment"). Este endpoint no está habilitado en todas las cuentas: si responde
// 401/403/404 devolvemos null en vez de romper la sincronización. Se activa con
// MP_INCLUIR_MOVIMIENTOS=1 para no consultarlo si la cuenta no lo soporta.
async function buscarMovimientos({ desdeISO, hastaISO }) {
  if (process.env.MP_INCLUIR_MOVIMIENTOS !== "1") return null;
  try {
    const params = new URLSearchParams({
      begin_date: desdeISO,
      end_date: hastaISO,
      limit: "100",
      offset: "0",
    });
    const data = await mpFetch(`/v1/account/movements/search?${params.toString()}`);
    return Array.isArray(data.results) ? data.results : [];
  } catch (e) {
    console.error("Movimientos de cuenta no disponibles en esta cuenta:", e.message);
    return null;
  }
}

// ---------- Normalización ----------

const TIPOS_LEGIBLES = {
  account_money: "Dinero en cuenta",
  bank_transfer: "Transferencia",
  credit_card: "Crédito",
  debit_card: "Débito",
  prepaid_card: "Prepaga",
  ticket: "Efectivo (Rapipago/Pago Fácil)",
  digital_wallet: "Billetera digital",
  digital_currency: "Dinero digital",
  voucher_card: "Voucher",
  crypto_transfer: "Cripto",
};

const ESTADOS_LEGIBLES = {
  approved: "Acreditado",
  pending: "Pendiente",
  in_process: "En revisión",
  in_mediation: "En mediación",
  authorized: "Autorizado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  refunded: "Devuelto",
  charged_back: "Contracargo",
};

function etiquetaTipo(pago) {
  const esQr = pago.point_of_interaction && /QR|OPENPLATFORM/i.test(pago.point_of_interaction.type || "");
  const base = TIPOS_LEGIBLES[pago.payment_type_id] || pago.payment_type_id || "Otro";
  return esQr ? `${base} (QR)` : base;
}

function etiquetaEstado(estado) {
  return ESTADOS_LEGIBLES[estado] || estado || "?";
}

function nombrePagador(pago) {
  const p = pago.payer || {};
  const nombre = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  if (nombre) return nombre;
  if (p.email) return p.email;
  if (p.identification && p.identification.number) {
    return `${p.identification.type || "DNI"} ${p.identification.number}`;
  }
  return null;
}

// Pasa un pago crudo de la API al formato de la tabla pagos_recibidos. La fecha y la hora
// locales las calcula server.js (que ya tiene el huso de Argentina), así que acá solo se
// deja el timestamp original.
function normalizarPago(pago) {
  const detalle = pago.transaction_details || {};
  return {
    externoId: String(pago.id),
    origen: "mercadopago",
    monto: Number(pago.transaction_amount) || 0,
    montoNeto: detalle.net_received_amount != null ? Number(detalle.net_received_amount) : null,
    estado: pago.status || "unknown",
    metodo: etiquetaTipo(pago),
    descripcion: pago.description || null,
    pagador: nombrePagador(pago),
    referencia: pago.external_reference || null,
    fechaISO: pago.date_approved || pago.date_created,
  };
}

// ---------- Cobro con QR (Checkout Pro) ----------

// Crea una preferencia de pago por el monto exacto y devuelve el link de Checkout Pro
// (init_point). El QR que se le muestra al cliente es ese link convertido a imagen; al
// escanearlo abre esa página de Mercado Pago para pagar. El pago que resulte de esto
// entra por el mismo webhook/sincronización que cualquier otro cobro de la cuenta.
async function crearPreferenciaCobro({ monto, descripcion }) {
  const body = {
    items: [
      {
        title: (descripcion || "Platense Fit").slice(0, 200),
        quantity: 1,
        unit_price: Math.round(Number(monto) * 100) / 100,
        currency_id: "ARS",
      },
    ],
    external_reference: crypto.randomUUID(),
  };
  const data = await mpFetch("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: data.id, initPoint: data.init_point };
}

// ---------- Firma del webhook ----------

// Mercado Pago firma cada aviso con HMAC-SHA256 sobre el "manifest"
//   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// usando la clave secreta que se genera en el panel de notificaciones. Si algún dato no
// viene, ese pedazo se omite entero. Si no configuraste el secreto devolvemos
// { verificada: false } y el aviso se acepta igual (pero el monto siempre se re-consulta
// contra la API, así que un aviso falso no puede inventar un cobro).
function validarFirma({ xSignature, xRequestId, dataId }) {
  if (!tieneSecretoWebhook()) return { valida: true, verificada: false };
  if (!xSignature) return { valida: false, verificada: true, motivo: "falta x-signature" };

  const partes = {};
  String(xSignature).split(",").forEach((p) => {
    const idx = p.indexOf("=");
    if (idx === -1) return;
    partes[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
  });

  const ts = partes.ts;
  const firmaRecibida = partes.v1;
  if (!ts || !firmaRecibida) return { valida: false, verificada: true, motivo: "x-signature mal formado" };

  const id = dataId == null ? "" : String(dataId).toLowerCase();
  let manifest = "";
  if (id) manifest += `id:${id};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const esperada = crypto.createHmac("sha256", cfg.webhookSecret).update(manifest).digest("hex");

  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(firmaRecibida, "utf8");
  const valida = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { valida, verificada: true, motivo: valida ? null : "firma no coincide" };
}

module.exports = {
  isConfigured,
  tieneSecretoWebhook,
  getPago,
  buscarPagos,
  buscarMovimientos,
  normalizarPago,
  etiquetaEstado,
  validarFirma,
  crearPreferenciaCobro,
};
