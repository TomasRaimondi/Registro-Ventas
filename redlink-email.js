// Cuenta DNI no tiene API ni acceso para terceros, así que esto reemplaza al webhook:
// Red Link (la red que procesa los cobros QR de Cuenta DNI Comercios) manda un mail de
// "Comprobante de pago" por cada operación acreditada. Ese mail ES la confirmación real
// del banco — no hace falta que nadie mire la cuenta a mano.
//
// El servidor se conecta por IMAP a la casilla donde llegan esos avisos, busca los que
// todavía no se marcaron como leídos, los parsea y los guarda ya como pago confirmado
// (a diferencia de la carga manual, que queda "a confirmar").

const fs = require("node:fs");
const path = require("node:path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const CONFIG_PATH = path.join(__dirname, "email-config.json");
const REMITENTE_REDLINK = "noreply@avisos.redlink.com.ar";

// Mismo patrón que tiendanube.js/mercadopago.js: en Render, variables de entorno;
// en esta PC, el archivo local (que está en .gitignore).
let cfg = null;
if (process.env.EMAIL_IMAP_USER && process.env.EMAIL_IMAP_APP_PASSWORD) {
  cfg = {
    user: process.env.EMAIL_IMAP_USER,
    pass: process.env.EMAIL_IMAP_APP_PASSWORD,
    host: process.env.EMAIL_IMAP_HOST || "imap.gmail.com",
  };
} else {
  try {
    const local = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (local.user && local.pass) cfg = { user: local.user, pass: local.pass, host: local.host || "imap.gmail.com" };
  } catch (e) {
    // Sin configurar: el panel de pagos avisa y el resto del sistema sigue funcionando.
  }
}

function isConfigured() {
  return !!cfg;
}

// ---------- Parseo del comprobante ----------

// "$ 71.380,00" -> 71380 (formato argentino: punto de miles, coma decimal)
function parseMontoArg(s) {
  if (!s) return null;
  const limpio = s.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// El mail es una tabla de "etiqueta" seguida de "valor" en líneas separadas una vez que
// se le saca todo el HTML. Busca la etiqueta y devuelve el resto del renglón siguiente.
function extraerCampo(texto, etiqueta) {
  const escapada = etiqueta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escapada + "\\s*\\n+\\s*([^\\n]+)", "i");
  const m = texto.match(re);
  return m ? m[1].trim() : null;
}

function htmlATexto(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

// Devuelve null si no se pudo leer el número de operación o el monto con confianza:
// mejor no guardar nada a guardar un pago con datos inventados.
function parsearComprobante(html, asunto) {
  const texto = htmlATexto(html);

  const dni = (texto.match(/DNI:\s*(\d+)/i) || [])[1] || null;
  const pagadorMatch = texto.match(/registrado una operaci[oó]n de\s+(.+?)\s+el\s/i);
  const pagador = pagadorMatch ? pagadorMatch[1].trim() : null;

  const numeroOperacion = extraerCampo(texto, "N° de operación") || extraerCampo(texto, "N° de operación");
  const fechaHora = extraerCampo(texto, "Fecha"); // "04/09/2026 - 09:51:57", ya en hora Argentina
  const puntoDeVenta = extraerCampo(texto, "Punto de venta");
  const codigoAutorizacion = extraerCampo(texto, "Código de autorización");
  const movimiento = extraerCampo(texto, "Movimiento");
  const importeNetoStr = extraerCampo(texto, "Importe neto");
  const tipoCobro = extraerCampo(texto, "Tipo de cobro");
  const billetera = extraerCampo(texto, "Billetera");

  // El monto bruto es el primer "$ ..." grande que aparece, antes de la tabla de datos.
  const montoMatch = texto.match(/\$\s*[\d.,]+/);
  const monto = montoMatch ? parseMontoArg(montoMatch[0]) : null;
  const montoNeto = importeNetoStr ? parseMontoArg(importeNetoStr) : null;

  const exito = /ACEPTADA/i.test(texto) && /ACREDITAD/i.test(texto);
  const rechazado = /RECHAZAD/i.test(asunto || "") || /RECHAZAD/i.test(texto);

  if (!numeroOperacion || monto == null) return null;

  return {
    numeroOperacion,
    fechaHora,
    monto,
    montoNeto,
    pagador: pagador ? (dni ? `${pagador} (DNI ${dni})` : pagador) : null,
    puntoDeVenta,
    codigoAutorizacion,
    movimiento,
    tipoCobro,
    billetera,
    estado: exito ? "approved" : rechazado ? "rejected" : "unknown",
  };
}

// ---------- IMAP ----------

async function conectar() {
  if (!isConfigured()) throw new Error("Correo IMAP no configurado (falta EMAIL_IMAP_USER/EMAIL_IMAP_APP_PASSWORD)");
  const client = new ImapFlow({
    host: cfg.host,
    port: 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  return client;
}

// Busca en la bandeja de entrada los mails de Red Link todavía no leídos (más los de
// los últimos `diasAtras` como red de seguridad, por si algún mail quedó marcado leído
// sin procesarse), los parsea y los marca como leídos. El guardado en la base es
// idempotente por N° de operación, así que reprocesar un mail no duplica el pago.
async function buscarComprobantesNuevos({ diasAtras = 2 } = {}) {
  const client = await conectar();
  const resultados = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const desde = new Date(Date.now() - diasAtras * 86400000);
      for await (const msg of client.fetch(
        { from: REMITENTE_REDLINK, since: desde },
        { source: true, envelope: true }
      )) {
        try {
          const parsed = await simpleParser(msg.source);
          const comprobante = parsearComprobante(parsed.html || "", parsed.subject || "");
          if (comprobante) resultados.push(comprobante);
          else console.error("No se pudo leer un mail de Red Link (formato inesperado), uid:", msg.uid);
        } catch (e) {
          console.error("Error parseando un mail de Red Link:", e.message);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return resultados;
}

module.exports = { isConfigured, buscarComprobantesNuevos, parsearComprobante, htmlATexto };
