// Integración con la API de Tiendanube para armar la pestaña "Recompra de Clientes".
// Junta los pedidos pagados de la tienda, los agrupa por cliente y calcula cuántas veces
// compró cada uno, cuándo fue su última compra y qué productos llevó. No hay una tabla de
// "clientes" propia: todo se arma en el momento a partir de /orders (con cache corta para
// no golpear la API en cada click).

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(__dirname, "tiendanube-config.json");

// En Render (y cualquier hosting) el token vive en variables de entorno, igual que
// ADMIN_PASSWORD y TURSO_*. En esta PC, si no hay variables de entorno, se lee del
// archivo local (que está en .gitignore y nunca se sube).
let cfg = null;
if (process.env.TIENDANUBE_STORE_ID && process.env.TIENDANUBE_ACCESS_TOKEN) {
  cfg = {
    storeId: process.env.TIENDANUBE_STORE_ID,
    accessToken: process.env.TIENDANUBE_ACCESS_TOKEN,
  };
} else {
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error("No se encontró TIENDANUBE_STORE_ID/TIENDANUBE_ACCESS_TOKEN ni tiendanube-config.json: la pestaña de Recompra de Clientes no va a funcionar hasta conectar la tienda.");
  }
}

const API_BASE = cfg ? `https://api.tiendanube.com/v1/${cfg.storeId}` : null;

function headers() {
  return {
    "Authentication": `bearer ${cfg.accessToken}`,
    "User-Agent": "Panel Platense Fit (contacto@platensefit.com)",
    "Content-Type": "application/json",
  };
}

function isConfigured() {
  return !!cfg;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tnFetch(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Tiendanube API ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Trae todas las páginas de un listado (pedidos, clientes, etc.), con una pausa chica
// entre página y página para no pisar el límite de pedidos por segundo de la API.
async function fetchAllPages(endpoint, perPage = 200) {
  let pagina = 1;
  const todos = [];
  while (true) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const lote = await tnFetch(`${endpoint}${sep}per_page=${perPage}&page=${pagina}`);
    if (!Array.isArray(lote) || lote.length === 0) break;
    todos.push(...lote);
    if (lote.length < perPage) break;
    pagina++;
    if (pagina > 100) break; // salvaguarda ante un loop infinito
    await sleep(300);
  }
  return todos;
}

// completed_at viene como { date: "2026-09-01 01:23:18.000000", timezone: "UTC", ... } en vez
// de un string ISO normal como created_at. Lo normalizamos para poder compararlo como fecha.
function fechaOrdenISO(o) {
  let raw = (o.completed_at && o.completed_at.date) || o.created_at;
  if (!raw) return null;
  if (!raw.includes("T")) {
    raw = raw.replace(" ", "T").replace(/(\.\d{3})\d*$/, "$1") + "Z";
  }
  return raw;
}

function nombreProducto(p) {
  if (typeof p.name === "string") return p.name;
  if (p.name && typeof p.name === "object") {
    return p.name.es || p.name.pt || p.name.en || Object.values(p.name)[0] || "Producto";
  }
  return "Producto";
}

// Convierte un teléfono tal cual lo guarda Tiendanube (ej "+543624083498", sin el "9" de
// celular) al formato que espera wa.me. Para celulares argentinos hay que insertar un "9"
// después del "54"; si no lo tiene ya, se lo agregamos.
function normalizarTelefono(raw) {
  if (!raw) return null;
  let digitos = String(raw).replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.startsWith("549")) {
    // ya viene con el 9 de celular
  } else if (digitos.startsWith("54")) {
    digitos = "549" + digitos.slice(2);
  } else {
    digitos = digitos.replace(/^0/, "").replace(/^15/, "");
    digitos = "549" + digitos;
  }
  return digitos;
}

function waLink(telefonoRaw, mensaje) {
  const numero = normalizarTelefono(telefonoRaw);
  if (!numero) return null;
  const texto = encodeURIComponent(mensaje || "");
  return `https://wa.me/${numero}${texto ? `?text=${texto}` : ""}`;
}

let cache = { data: null, fetchedAt: 0 };
const CACHE_MS = 3 * 60 * 1000;

async function getClientesRecompra({ forzar = false } = {}) {
  if (!isConfigured()) throw new Error("Tienda no conectada: falta tiendanube-config.json");
  if (!forzar && cache.data && Date.now() - cache.fetchedAt < CACHE_MS) {
    return { clientes: cache.data, sincronizadoEn: cache.fetchedAt, deCache: true };
  }

  const pedidos = await fetchAllPages("/orders?status=any");
  const porCliente = new Map();

  for (const o of pedidos) {
    // Solo cuenta como "compra" un pedido efectivamente pagado (no cancelado, no pendiente).
    if (o.cancelled_at || o.payment_status !== "paid") continue;

    const cust = o.customer || {};
    const key = (cust.id && String(cust.id)) || (o.contact_email || cust.email || "").toLowerCase() || `pedido-${o.id}`;

    if (!porCliente.has(key)) {
      porCliente.set(key, {
        id: cust.id || null,
        nombre: cust.name || o.contact_name || "Cliente sin nombre",
        email: cust.email || o.contact_email || "",
        telefono: cust.phone || o.contact_phone || "",
        compras: 0,
        totalGastado: 0,
        ultimaCompra: null,
        productos: new Map(),
        pedidos: [],
      });
    }

    const c = porCliente.get(key);
    c.compras += 1;
    c.totalGastado += Number(o.total) || 0;
    if (!c.telefono && (cust.phone || o.contact_phone)) c.telefono = cust.phone || o.contact_phone;
    if (!c.email && (cust.email || o.contact_email)) c.email = cust.email || o.contact_email;

    const fechaOrden = fechaOrdenISO(o);
    if (fechaOrden && (!c.ultimaCompra || fechaOrden > c.ultimaCompra)) c.ultimaCompra = fechaOrden;

    const items = (o.products || []).map((p) => ({
      nombre: nombreProducto(p),
      cantidad: Number(p.quantity) || 1,
      precio: Number(p.price) || 0,
    }));
    for (const it of items) {
      c.productos.set(it.nombre, (c.productos.get(it.nombre) || 0) + it.cantidad);
    }

    c.pedidos.push({
      id: o.id,
      numero: o.number,
      fecha: fechaOrden,
      total: Number(o.total) || 0,
      productos: items,
    });
  }

  const ahora = Date.now();
  const clientes = [...porCliente.values()].map((c) => {
    const ultimaCompraMs = c.ultimaCompra ? new Date(c.ultimaCompra).getTime() : null;
    const diasSinComprar = Number.isFinite(ultimaCompraMs) ? Math.floor((ahora - ultimaCompraMs) / 86400000) : null;
    return {
      id: c.id,
      nombre: c.nombre,
      email: c.email,
      telefono: c.telefono || null,
      whatsapp: waLink(c.telefono, `Hola ${(c.nombre || "").split(" ")[0] || ""}! Somos de Platense Fit 💪`),
      compras: c.compras,
      totalGastado: Math.round(c.totalGastado * 100) / 100,
      ultimaCompra: c.ultimaCompra,
      diasSinComprar,
      segmento: c.compras >= 2 ? "recompro" : "unico",
      productos: [...c.productos.entries()]
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
      pedidos: c.pedidos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")),
    };
  });

  clientes.sort((a, b) => (b.ultimaCompra || "").localeCompare(a.ultimaCompra || ""));

  cache = { data: clientes, fetchedAt: ahora };
  return { clientes, sincronizadoEn: ahora, deCache: false };
}

// Crea un cupón de descuento de un solo uso en Tiendanube para reenganchar a un cliente puntual.
async function generarCupon({ porcentaje, nota }) {
  if (!isConfigured()) throw new Error("Tienda no conectada");
  const pct = Number(porcentaje);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 90) throw new Error("Porcentaje inválido");

  const codigo = `VOLVE${pct}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const body = {
    code: codigo,
    type: "percentage",
    value: String(pct),
    valid: true,
    max_uses: 1,
  };
  const cupon = await tnFetch("/coupons", { method: "POST", body: JSON.stringify(body) });
  return { code: cupon.code || codigo, id: cupon.id, porcentaje: pct, nota: nota || null };
}

module.exports = { isConfigured, getClientesRecompra, generarCupon, waLink, normalizarTelefono };
