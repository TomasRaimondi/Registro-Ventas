const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const db = require("./db");
const tiendanube = require("./tiendanube");
const mayoristas = require("./mayoristas");
const mercadopago = require("./mercadopago");
const redlinkEmail = require("./redlink-email");

const PORT = process.env.PORT || 3000;
const TIMEZONE = "America/Argentina/Buenos_Aires";
const PUBLIC_DIR = path.join(__dirname, "public");
const METODOS_VALIDOS = new Set(["efectivo", "transferencia", "debito", "credito", "cuentadni", "mayorista", "web"]);
const CUENTA_DNI_COMISION = 0.006;
const SESSION_MAX_AGE = 60 * 60 * 12; // 12 horas

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
}

// Busca un producto existente por nombre sin importar mayúsculas/tildes/espacios.
// Devuelve el nombre EXACTO ya guardado (para no crear duplicados por una tilde de diferencia).
function resolverProductoExistente(costosActuales, productoIngresado) {
  const match = costosActuales.find((c) => normalizeNombre(c.producto) === normalizeNombre(productoIngresado));
  return match ? match.producto : productoIngresado;
}

// El costo de un combo se recalcula solo, sumando (costo x cantidad) de cada componente:
// si cambia el precio de un producto que integra un combo, el costo del combo se actualiza
// con él. Se llama después de cualquier cambio en costos o en la composición de combos.
// Si algún componente todavía no tiene costo cargado, ese combo se deja como está (no se
// pisa con un número incompleto). Corre varias pasadas para que un combo que a su vez es
// componente de otro combo más grande también se actualice en cadena.
async function recalcularCostosCombos() {
  const [costos, composicion] = await Promise.all([db.getCostos(), db.getComposicion()]);
  const costoPorProducto = {};
  costos.forEach((c) => { costoPorProducto[c.producto] = c.costo; });

  const componentesPorCombo = {};
  composicion.forEach((c) => {
    if (!componentesPorCombo[c.comboProducto]) componentesPorCombo[c.comboProducto] = [];
    componentesPorCombo[c.comboProducto].push({ componente: c.componenteProducto, cantidad: c.cantidad });
  });

  for (let pasada = 0; pasada < 5; pasada++) {
    for (const [comboProducto, componentes] of Object.entries(componentesPorCombo)) {
      let total = 0;
      let completo = true;
      for (const { componente, cantidad } of componentes) {
        const costoComponente = costoPorProducto[componente];
        if (costoComponente === undefined || costoComponente === null) { completo = false; break; }
        total += costoComponente * cantidad;
      }
      if (completo && costoPorProducto[comboProducto] !== total) {
        costoPorProducto[comboProducto] = total;
        await db.upsertCosto(comboProducto, total);
      }
    }
  }
}

// ---------- Contraseñas del panel (dueño y empleado) ----------

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
let EMPLOYEE_PASSWORD = process.env.EMPLOYEE_PASSWORD || null;
try {
  const localConfigPath = path.join(__dirname, "admin-config.json");
  if (fs.existsSync(localConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
    if (cfg.adminPassword) ADMIN_PASSWORD = cfg.adminPassword;
    if (cfg.employeePassword) EMPLOYEE_PASSWORD = cfg.employeePassword;
  }
} catch (e) {
  console.error("No se pudo leer admin-config.json:", e.message);
}

// token -> "owner" | "empleado". El empleado solo puede usar los endpoints que
// explícitamente chequean isAuthenticated (no isOwner) más abajo.
const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function getRole(req) {
  const cookies = parseCookies(req);
  return (cookies.session && sessions.get(cookies.session)) || null;
}

// Cualquier sesión válida (dueño o empleado).
function isAuthenticated(req) {
  return !!getRole(req);
}

// Solo el dueño. Todo lo sensible (costos, ganancias, gastos, compras, salario,
// balance, reportes) tiene que usar esto, no isAuthenticated.
function isOwner(req) {
  return getRole(req) === "owner";
}

// ---------- Hora oficial (Argentina), calculada en el servidor ----------

function getArgentinaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const map = {};
  parts.forEach(p => (map[p.type] = p.value));
  const hour = parseInt(map.hour, 10) % 24;

  return {
    fecha: `${map.year}-${map.month}-${map.day}`,
    hora: hour,
    horaLabel: `${String(hour).padStart(2, "0")}:${map.minute}:${map.second}`,
  };
}

// Lo mismo pero para un momento cualquiera (los pagos de Mercado Pago vienen con
// timestamp en UTC/offset y hay que mostrarlos en hora de acá).
function argentinaDesdeISO(iso) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = {};
  parts.forEach(p => (map[p.type] = p.value));
  return {
    fecha: `${map.year}-${map.month}-${map.day}`,
    horaLabel: `${map.hour}:${map.minute}`,
  };
}

// ---------- Utilidades HTTP ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".json": "application/manifest+json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, reqPath));

  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Prohibido");
    return;
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("No encontrado");
      return;
    }
    const ext = path.extname(full);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error("Body demasiado grande")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

// ---------- Stock: descuenta/restaura, resolviendo combos a sus componentes ----------

async function ajustarStockPorItems(items, direccion) {
  // direccion: -1 al vender (descuenta), +1 al borrar una venta (restaura)
  try {
    const composicion = await db.getComposicion();
    const composicionPorCombo = new Map();
    for (const c of composicion) {
      if (!composicionPorCombo.has(c.comboProducto)) composicionPorCombo.set(c.comboProducto, []);
      composicionPorCombo.get(c.comboProducto).push(c);
    }

    for (const it of items) {
      const componentes = composicionPorCombo.get(it.producto);
      if (componentes && componentes.length) {
        for (const c of componentes) {
          if (direccion < 0) await db.decrementStock(c.componenteProducto, c.cantidad);
          else await db.incrementStock(c.componenteProducto, c.cantidad);
        }
      } else {
        if (direccion < 0) await db.decrementStock(it.producto, 1);
        else await db.incrementStock(it.producto, 1);
      }
    }
  } catch (e) {
    console.error("No se pudo ajustar el stock:", e);
  }
}

// Revierte un movimiento de compras_stock: resta su cantidad del stock actual, lo borra
// y recalcula el costo promedio ponderado del producto a partir de las compras restantes.
async function revertirCompra(compra) {
  const costosActuales = await db.getCostos();
  const costoRow = costosActuales.find((c) => c.producto === compra.producto);
  const stockActual = costoRow ? costoRow.stock || 0 : 0;
  const stockRevertido = Math.max(0, stockActual - compra.cantidad);
  await db.updateStock(compra.producto, stockRevertido);
  await db.deleteCompra(compra.id);

  if (compra.tipo === "compra") {
    const historial = (await db.getComprasByProducto(compra.producto)).filter((h) => h.tipo === "compra");
    const totalUnidades = historial.reduce((a, h) => a + h.cantidad, 0);
    if (totalUnidades > 0) {
      const totalCosto = historial.reduce((a, h) => a + h.cantidad * h.precioUnitario, 0);
      await db.upsertCosto(compra.producto, Math.round((totalCosto / totalUnidades) * 100) / 100);
    }
  }
}

// ---------- Pagos recibidos (Mercado Pago) ----------

// Cada cuánto se re-consultan los pagos por las dudas, y cuánto para atrás se mira.
// La sincronización es la red de seguridad del webhook: si Render estaba dormido o
// Mercado Pago no pudo avisar, el pago igual entra en la próxima pasada.
const MP_SYNC_MINUTOS = Number(process.env.MP_SYNC_MINUTOS || 5);
const MP_SYNC_HORAS_ATRAS = Number(process.env.MP_SYNC_HORAS_ATRAS || 48);

const mpEstado = { ultimaSync: null, ultimoError: null, sincronizando: false };

// Guarda un pago crudo de la API en pagos_recibidos. Es idempotente: el mismo pago
// que llega por webhook y después por sincronización se pisa a sí mismo, no se duplica.
async function guardarPagoMP(pagoCrudo) {
  const norm = mercadopago.normalizarPago(pagoCrudo);
  if (!norm.fechaISO) return null;
  const local = argentinaDesdeISO(norm.fechaISO);
  if (!local) return null;
  const ahora = new Date().toISOString();

  // Mercado Pago manda la fecha con su propio offset (ej. "-04:00"), no en UTC. Si se
  // guarda tal cual, ordenar por fechaISO como texto queda mal apenas se mezcla con los
  // pagos de Cuenta DNI (que sí se normalizan a UTC antes de guardar). Se normaliza acá
  // para que el ORDER BY fechaISO sea comparable entre los dos orígenes.
  const fechaISO = new Date(norm.fechaISO).toISOString();

  await db.upsertPago({
    ...norm,
    fechaISO,
    id: `mp-${norm.externoId}`,
    fecha: local.fecha,
    horaLabel: local.horaLabel,
    creadoEn: ahora,
    actualizadoEn: ahora,
  });
  return norm;
}

async function sincronizarPagosMP({ horasAtras = MP_SYNC_HORAS_ATRAS } = {}) {
  if (!mercadopago.isConfigured()) {
    return { ok: false, error: "Mercado Pago no está configurado" };
  }
  if (mpEstado.sincronizando) {
    return { ok: false, error: "Ya hay una sincronización en curso" };
  }

  mpEstado.sincronizando = true;
  try {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - horasAtras * 60 * 60 * 1000);
    const pagos = await mercadopago.buscarPagos({
      desdeISO: desde.toISOString(),
      hastaISO: hasta.toISOString(),
    });

    let guardados = 0;
    for (const pago of pagos) {
      if (await guardarPagoMP(pago)) guardados++;
    }

    mpEstado.ultimaSync = new Date().toISOString();
    mpEstado.ultimoError = null;
    return { ok: true, encontrados: pagos.length, guardados, ultimaSync: mpEstado.ultimaSync };
  } catch (e) {
    mpEstado.ultimoError = e.message;
    console.error("Error sincronizando pagos de Mercado Pago:", e.message);
    return { ok: false, error: e.message };
  } finally {
    mpEstado.sincronizando = false;
  }
}

// ---------- Pagos recibidos (Cuenta DNI, vía mail de Red Link) ----------

// Igual que con Mercado Pago: se busca seguido con ventana corta (rápido, para que se
// sienta "en el momento") y de vez en cuando con ventana ancha como red de seguridad.
const REDLINK_POLL_SEGUNDOS = Number(process.env.REDLINK_POLL_SEGUNDOS || 25);
const REDLINK_BARRIDO_MINUTOS = Number(process.env.REDLINK_BARRIDO_MINUTOS || 15);

const redlinkEstado = { ultimaSync: null, ultimoError: null, sincronizando: false };

// Cooldown del botón "Actualizar" manual (compartido entre Pagos recibidos y Registro
// de Ventas): evita golpear la API de Mercado Pago o el IMAP de Gmail si alguien lo
// aprieta varias veces seguidas.
const SYNC_MANUAL_COOLDOWN_MS = 4000;
let ultimoSyncManual = 0;

// "04/09/2026 - 09:51:57" (ya en hora Argentina, tal cual la manda Red Link) -> fecha +
// horaLabel para la tabla, y un ISO con el offset -03:00 para poder ordenar junto a los
// pagos de Mercado Pago.
function partirFechaHoraRedlink(fechaHora) {
  const m = String(fechaHora || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const fechaISO = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
  const fecha = `${yyyy}-${mm}-${dd}`;
  return { fecha, horaLabel: `${hh}:${mi}`, fechaISO: new Date(fechaISO).toISOString() };
}

// Idempotente por N° de operación, igual que con Mercado Pago: un mail reprocesado (por
// la ventana de respaldo) pisa el mismo registro en vez de duplicarlo.
async function guardarComprobanteRedlink(c) {
  const partido = partirFechaHoraRedlink(c.fechaHora);
  if (!partido) return null;
  const ahora = new Date().toISOString();

  await db.upsertPago({
    id: `cuentadni-${c.numeroOperacion}`,
    origen: "cuentadni",
    externoId: c.numeroOperacion,
    monto: c.monto,
    montoNeto: c.montoNeto,
    estado: c.estado === "approved" ? "approved" : c.estado,
    metodo: [c.tipoCobro, c.movimiento].filter(Boolean).join(" · ") || "Cuenta DNI",
    descripcion: c.codigoAutorizacion ? `Cód. autorización ${c.codigoAutorizacion}` : null,
    pagador: c.pagador,
    referencia: c.numeroOperacion,
    fecha: partido.fecha,
    horaLabel: partido.horaLabel,
    fechaISO: partido.fechaISO,
    // El mail de Red Link ES la confirmación del banco: no necesita que nadie lo
    // marque a mano, a diferencia de un pago cargado manual.
    verificado: c.estado === "approved" ? 1 : 0,
    verificadoPor: c.estado === "approved" ? "mail-redlink" : null,
    nota: null,
    creadoEn: ahora,
    actualizadoEn: ahora,
  });
  return c;
}

async function sincronizarRedlink({ diasAtras = 2 } = {}) {
  if (!redlinkEmail.isConfigured()) {
    return { ok: false, error: "El correo de Cuenta DNI no está configurado" };
  }
  if (redlinkEstado.sincronizando) {
    return { ok: false, error: "Ya hay una sincronización en curso" };
  }

  redlinkEstado.sincronizando = true;
  try {
    const comprobantes = await redlinkEmail.buscarComprobantesNuevos({ diasAtras });

    let guardados = 0;
    for (const c of comprobantes) {
      if (await guardarComprobanteRedlink(c)) guardados++;
    }

    redlinkEstado.ultimaSync = new Date().toISOString();
    redlinkEstado.ultimoError = null;
    return { ok: true, encontrados: comprobantes.length, guardados, ultimaSync: redlinkEstado.ultimaSync };
  } catch (e) {
    redlinkEstado.ultimoError = e.message;
    console.error("Error sincronizando correo de Cuenta DNI (Red Link):", e.message);
    return { ok: false, error: e.message };
  } finally {
    redlinkEstado.sincronizando = false;
  }
}

// ---------- Servidor ----------

const server = http.createServer(async (req, res) => {
  const [pathname, queryString] = req.url.split("?");
  const query = new URLSearchParams(queryString || "");

  try {
    if (pathname === "/api/ventas" && req.method === "GET") {
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
      const rows = await db.getByFecha(fecha);
      return sendJson(res, 200, rows);
    }

    if (pathname.startsWith("/api/ventas/") && pathname.endsWith("/items") && req.method === "GET") {
      // Público: el precio de cada producto ya se ve en el total, no es información privada (el costo sí lo es)
      const ventaId = decodeURIComponent(pathname.slice("/api/ventas/".length, -"/items".length));
      let items = await db.getItemsByVentaId(ventaId);
      if (!items.length) {
        const venta = await db.getVentaById(ventaId);
        if (venta) items = [{ producto: venta.producto, precio: venta.precio }];
      }
      return sendJson(res, 200, items);
    }

    if (pathname === "/api/ventas" && req.method === "POST") {
      const body = await readJsonBody(req);
      const metodo = String(body.metodo || "");

      // Acepta una lista de productos (carrito) o, por compatibilidad, un solo producto suelto
      const itemsInput = Array.isArray(body.items) && body.items.length
        ? body.items
        : (body.producto ? [{ producto: body.producto, precio: body.precio }] : []);

      if (!itemsInput.length) return sendJson(res, 400, { error: "No hay productos cargados en la venta" });
      if (!METODOS_VALIDOS.has(metodo)) return sendJson(res, 400, { error: "Método de pago inválido" });

      const itemsProcessed = [];
      for (const it of itemsInput) {
        const producto = String(it.producto || "").trim();
        const precio = Number(it.precio);
        if (!producto) return sendJson(res, 400, { error: "Falta el nombre de un producto" });
        if (!Number.isFinite(precio) || precio <= 0) return sendJson(res, 400, { error: `Precio inválido para "${producto}"` });

        const precioNeto = metodo === "cuentadni"
          ? Math.round(precio * (1 - CUENTA_DNI_COMISION) * 100) / 100
          : precio;

        itemsProcessed.push({ producto, precio: precioNeto });
      }

      const totalBruto = itemsProcessed.reduce((acc, it) => acc + it.precio, 0);

      // Envío por Uber Moto: se descuenta del total, igual que la comisión de Cuenta DNI,
      // pero como un monto fijo (el costo real del viaje) en vez de un porcentaje.
      let envioMetodo = null;
      let envioCosto = null;
      if (body.envioMetodo === "uber_moto") {
        const costo = Number(body.envioCosto);
        if (!Number.isFinite(costo) || costo <= 0) {
          return sendJson(res, 400, { error: "Falta el costo del envío por Uber Moto" });
        }
        envioMetodo = "uber_moto";
        envioCosto = Math.round(costo * 100) / 100;
      }

      const total = envioCosto ? totalBruto - envioCosto : totalBruto;

      // Agrupa productos repetidos en el resumen (ej: "Pancake x10" en vez de repetirlo 10 veces)
      const conteoPorProducto = new Map();
      for (const it of itemsProcessed) {
        conteoPorProducto.set(it.producto, (conteoPorProducto.get(it.producto) || 0) + 1);
      }
      const productoResumen = [...conteoPorProducto.entries()]
        .map(([producto, cantidad]) => (cantidad > 1 ? `${producto} x${cantidad}` : producto))
        .join(", ");

      // Solo el dueño puede elegir una fecha pasada, para cargar ventas que no se
      // registraron en el momento (ej: las que ya tenía anotadas en un Excel). El
      // empleado (Pedidos Mayoristas) siempre registra con la fecha/hora de ahora.
      let fecha, hora, horaLabel;
      if (isOwner(req) && body.fecha) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) return sendJson(res, 400, { error: "Fecha inválida" });
        fecha = body.fecha;
        hora = Number.isInteger(body.hora) && body.hora >= 0 && body.hora <= 23 ? body.hora : 12;
        horaLabel = typeof body.horaLabel === "string" && body.horaLabel ? body.horaLabel : `${String(hora).padStart(2, "0")}:00:00`;
      } else {
        const now = getArgentinaNow();
        fecha = now.fecha;
        hora = now.hora;
        horaLabel = now.horaLabel;
      }

      const cliente = body.cliente ? String(body.cliente).trim().slice(0, 200) : null;

      const row = {
        id: crypto.randomUUID(),
        producto: productoResumen,
        precio: Math.round(total * 100) / 100,
        metodo,
        fecha,
        hora,
        horaLabel,
        creadoEn: new Date().toISOString(),
        cliente,
        envioMetodo,
        envioCosto,
      };

      await db.insert(row);
      for (const it of itemsProcessed) {
        await db.insertItem({ id: crypto.randomUUID(), ventaId: row.id, producto: it.producto, precio: it.precio });
      }
      await ajustarStockPorItems(itemsProcessed, -1);

      return sendJson(res, 201, { ...row, items: itemsProcessed });
    }

    if (pathname.startsWith("/api/ventas/") && req.method === "DELETE") {
      const id = decodeURIComponent(pathname.slice("/api/ventas/".length));
      let itemsDeLaVenta = await db.getItemsByVentaId(id);
      if (!itemsDeLaVenta.length) {
        const venta = await db.getVentaById(id);
        if (venta) itemsDeLaVenta = [{ producto: venta.producto, precio: venta.precio }];
      }
      await ajustarStockPorItems(itemsDeLaVenta, +1);
      await db.deleteItemsByVentaId(id);
      await db.deleteById(id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/ventas" && req.method === "DELETE") {
      const fecha = query.get("fecha") || getArgentinaNow().fecha;

      const [ventasDelDia, itemsDelDia] = await Promise.all([db.getByFecha(fecha), db.getItemsByFecha(fecha)]);
      const ventaIdsConItems = new Set(itemsDelDia.map((it) => it.ventaId));
      const itemsCompletos = itemsDelDia.slice();
      for (const venta of ventasDelDia) {
        if (!ventaIdsConItems.has(venta.id)) {
          itemsCompletos.push({ producto: venta.producto, precio: venta.precio });
        }
      }
      await ajustarStockPorItems(itemsCompletos, +1);

      await db.deleteByFecha(fecha);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/ventas-perdidas" && req.method === "GET") {
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
      const rows = await db.getVentasPerdidasByFecha(fecha);
      return sendJson(res, 200, rows);
    }

    // Historial completo, para el resumen por semana/mes. Protegido: es para el dueño,
    // igual que el resto de la pestaña Ventas Perdidas.
    if (pathname === "/api/ventas-perdidas-todas" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getAllVentasPerdidas();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/ventas-perdidas" && req.method === "POST") {
      const body = await readJsonBody(req);
      const motivo = String(body.motivo || "").trim().slice(0, 500);
      if (!motivo) return sendJson(res, 400, { error: "Falta el motivo" });

      const { fecha, horaLabel } = getArgentinaNow();
      const row = { id: crypto.randomUUID(), motivo, fecha, horaLabel, creadoEn: new Date().toISOString() };
      await db.insertVentaPerdida(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/ventas-perdidas/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/ventas-perdidas/".length));
      await db.deleteVentaPerdida(id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/hora" && req.method === "GET") {
      return sendJson(res, 200, getArgentinaNow());
    }

    if (pathname === "/api/productos" && req.method === "GET") {
      // Público: solo nombres, nunca el costo (eso es privado del panel de ganancias)
      const costos = await db.getCostos();
      return sendJson(res, 200, costos.map((c) => c.producto));
    }

    if (pathname === "/api/venta-items" && req.method === "GET") {
      // Protegido: detalle por producto (precio, no el costo) para calcular ganancia en el panel.
      // Las ventas viejas (de antes del carrito) no tienen items propios: se reconstruye
      // un item único a partir de la venta original para que sigan apareciendo acá.
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
      const [ventasDelDia, items] = await Promise.all([db.getByFecha(fecha), db.getItemsByFecha(fecha)]);

      const itemsPorVenta = new Map();
      for (const it of items) {
        if (!itemsPorVenta.has(it.ventaId)) itemsPorVenta.set(it.ventaId, []);
        itemsPorVenta.get(it.ventaId).push(it);
      }

      const resultado = [];
      for (const venta of ventasDelDia) {
        const itemsDeEstaVenta = itemsPorVenta.get(venta.id);
        if (itemsDeEstaVenta && itemsDeEstaVenta.length) {
          for (const it of itemsDeEstaVenta) {
            resultado.push({ ventaId: venta.id, producto: it.producto, precio: it.precio, horaLabel: venta.horaLabel, metodo: venta.metodo });
          }
        } else {
          // Venta antigua sin items propios: se usa el producto/precio original como único item
          resultado.push({ ventaId: venta.id, producto: venta.producto, precio: venta.precio, horaLabel: venta.horaLabel, metodo: venta.metodo });
        }
      }

      return sendJson(res, 200, resultado);
    }

    if (pathname === "/api/reportes" && req.method === "GET") {
      // Protegido: historial completo (todos los días) para el panel de reportes.
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const [ventas, items, gastos] = await Promise.all([
        db.getAllVentas(),
        db.getAllItems(),
        db.getAllGastos(),
      ]);

      // Ventas de antes del carrito no tienen fila en venta_items: se reconstruye
      // un item único a partir de la venta original para que su ganancia no se pierda.
      const ventaIdsConItems = new Set(items.map((it) => it.ventaId));
      const itemsCompletos = items.slice();
      for (const venta of ventas) {
        if (!ventaIdsConItems.has(venta.id)) {
          itemsCompletos.push({
            ventaId: venta.id,
            producto: venta.producto,
            precio: venta.precio,
            fecha: venta.fecha,
            horaLabel: venta.horaLabel,
            metodo: venta.metodo,
          });
        }
      }

      return sendJson(res, 200, { ventas, items: itemsCompletos, gastos });
    }

    // ---------- Autenticación del panel de ganancias ----------

    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const password = String(body.password || "");

      if (!ADMIN_PASSWORD) {
        return sendJson(res, 500, { error: "No hay contraseña configurada en el servidor" });
      }

      let role = null;
      if (password === ADMIN_PASSWORD) role = "owner";
      else if (EMPLOYEE_PASSWORD && password === EMPLOYEE_PASSWORD) role = "empleado";

      if (!role) {
        return sendJson(res, 401, { error: "Contraseña incorrecta" });
      }

      const token = crypto.randomUUID();
      sessions.set(token, role);
      res.setHeader(
        "Set-Cookie",
        `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax`
      );
      return sendJson(res, 200, { ok: true, role });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      const cookies = parseCookies(req);
      if (cookies.session) sessions.delete(cookies.session);
      res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/auth-check" && req.method === "GET") {
      return sendJson(res, 200, { authenticated: isAuthenticated(req), role: getRole(req) });
    }

    // ---------- Costos y gastos (protegidos, requieren sesión) ----------

    if (pathname === "/api/costos" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getCostos();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/costos" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const productoIngresado = String(body.producto || "").trim();
      const costo = Number(body.costo);

      if (!productoIngresado) return sendJson(res, 400, { error: "Falta el producto" });
      if (!Number.isFinite(costo) || costo < 0) return sendJson(res, 400, { error: "Costo inválido" });

      const producto = resolverProductoExistente(await db.getCostos(), productoIngresado);
      await db.upsertCosto(producto, costo);
      await recalcularCostosCombos();
      return sendJson(res, 200, { ok: true, producto, costo });
    }

    if (pathname.startsWith("/api/costos/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const producto = decodeURIComponent(pathname.slice("/api/costos/".length));
      await db.deleteCosto(producto);
      await recalcularCostosCombos();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/costos/stock" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const productoIngresado = String(body.producto || "").trim();
      const stock = Number(body.stock);

      if (!productoIngresado) return sendJson(res, 400, { error: "Falta el producto" });
      if (!Number.isFinite(stock) || stock < 0) return sendJson(res, 400, { error: "Stock inválido" });

      const costosActuales = await db.getCostos();
      const producto = resolverProductoExistente(costosActuales, productoIngresado);
      const costoRow = costosActuales.find((c) => c.producto === producto);
      const stockAntes = costoRow ? costoRow.stock || 0 : 0;

      await db.updateStock(producto, stock);

      // Deja constancia en el historial de movimientos: este endpoint pisa el stock
      // directamente (lo usa el campo "Stock actual" de Rentabilidad), y antes no
      // quedaba ningún rastro de estos cambios.
      if (stock !== stockAntes) {
        const { fecha } = getArgentinaNow();
        await db.insertCompra({
          id: crypto.randomUUID(),
          loteId: null,
          tipo: "ajuste",
          producto,
          cantidad: stock - stockAntes,
          precioUnitario: null,
          costoTotal: null,
          stockAntes,
          stockDespues: stock,
          proveedor: null,
          vencimiento: null,
          nota: "Ajuste manual desde Rentabilidad (\"Stock actual\")",
          fecha,
          creadoEn: new Date().toISOString(),
        });
      }

      return sendJson(res, 200, { ok: true, producto, stock });
    }

    // ---------- Composición de combos (para no duplicar stock entre combo y componentes) ----------

    if (pathname === "/api/composicion" && req.method === "GET") {
      // El empleado también puede leer esto (sin ver costos): lo necesita para saber
      // qué productos son combos y excluirlos del selector de Pedidos Mayoristas.
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getComposicion();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/composicion" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const costosActuales = await db.getCostos();
      const comboProducto = resolverProductoExistente(costosActuales, String(body.comboProducto || "").trim());
      const componenteProducto = resolverProductoExistente(costosActuales, String(body.componenteProducto || "").trim());
      const cantidad = Number.isInteger(body.cantidad) ? body.cantidad : parseInt(body.cantidad, 10);

      if (!comboProducto || !componenteProducto) return sendJson(res, 400, { error: "Falta el combo o el componente" });
      if (comboProducto === componenteProducto) return sendJson(res, 400, { error: "Un producto no puede ser componente de sí mismo" });
      if (!Number.isInteger(cantidad) || cantidad <= 0) return sendJson(res, 400, { error: "Cantidad inválida" });

      const row = { id: crypto.randomUUID(), comboProducto, componenteProducto, cantidad };
      await db.insertComponente(row);
      await recalcularCostosCombos();
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/composicion/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/composicion/".length));
      await db.deleteComponente(id);
      await recalcularCostosCombos();
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Compras de stock (entradas de mercadería) y ajustes manuales ----------

    if (pathname === "/api/compras" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const producto = query.get("producto");
      const rows = producto ? await db.getComprasByProducto(producto) : await db.getAllCompras();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/compras" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const tipo = body.tipo === "ajuste" ? "ajuste" : "compra";
      const fecha = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)
        ? body.fecha
        : getArgentinaNow().fecha;

      // Acepta una lista de productos (una compra puede traer varios) o, por compatibilidad,
      // un solo producto suelto como antes.
      const itemsInput = Array.isArray(body.items) && body.items.length
        ? body.items
        : (body.producto ? [{ producto: body.producto, cantidad: body.cantidad, precioUnitario: body.precioUnitario }] : []);

      if (!itemsInput.length) return sendJson(res, 400, { error: "No hay productos cargados en esta compra" });

      const proveedor = body.proveedor ? String(body.proveedor).trim() : null;
      const vencimiento = typeof body.vencimiento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.vencimiento) ? body.vencimiento : null;
      const nota = body.nota ? String(body.nota).trim() : null;
      // Todos los productos cargados en esta misma tanda comparten loteId, así se pueden
      // agrupar y borrar juntos aunque sean varios productos de una sola compra.
      const loteId = crypto.randomUUID();

      const costosActuales = await db.getCostos();
      const filasInsertadas = [];

      for (const itemInput of itemsInput) {
        const productoIngresado = String(itemInput.producto || "").trim();
        if (!productoIngresado) return sendJson(res, 400, { error: "Falta el nombre de un producto" });

        // Resuelve al nombre exacto ya existente (sin importar mayúsculas/tildes) para no duplicar productos
        const producto = resolverProductoExistente(costosActuales, productoIngresado);
        let costoRow = costosActuales.find((c) => c.producto === producto);
        const stockAntes = costoRow ? costoRow.stock || 0 : 0;

        let cantidad, precioUnitario, costoTotal;
        const cantidadInput = parseInt(itemInput.cantidad, 10);

        if (tipo === "compra") {
          cantidad = cantidadInput;
          precioUnitario = Number(itemInput.precioUnitario);
          if (!Number.isInteger(cantidad) || cantidad <= 0) return sendJson(res, 400, { error: `Cantidad inválida para "${producto}"` });
          if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) return sendJson(res, 400, { error: `Precio inválido para "${producto}"` });
          costoTotal = Math.round(cantidad * precioUnitario * 100) / 100;
        } else {
          cantidad = cantidadInput;
          if (!Number.isInteger(cantidad) || cantidad === 0) return sendJson(res, 400, { error: `Cantidad inválida para "${producto}" (no puede ser 0)` });
          precioUnitario = null;
          costoTotal = null;
        }

        const stockDespues = Math.max(0, stockAntes + cantidad);

        const row = {
          id: crypto.randomUUID(),
          loteId,
          tipo,
          producto,
          cantidad,
          precioUnitario,
          costoTotal,
          stockAntes,
          stockDespues,
          proveedor,
          vencimiento,
          nota,
          fecha,
          creadoEn: new Date().toISOString(),
        };

        await db.insertCompra(row);

        if (!costoRow) {
          await db.upsertCosto(producto, tipo === "compra" ? precioUnitario : 0);
        }
        await db.updateStock(producto, stockDespues);

        // Costo promedio ponderado móvil: se combina el stock y costo YA vigentes con lo
        // recién comprado. Promediar contra todo el historial de compras (como antes) inflaba
        // o desinflaba el costo cuando ese stock viejo ya se había vendido y se volvía a
        // comprar a otro precio: ese stock vendido no debe seguir pesando en el promedio.
        let costoDespues = costoRow ? (costoRow.costo || 0) : 0;
        if (tipo === "compra") {
          costoDespues = stockDespues > 0
            ? Math.round(((stockAntes * costoDespues + cantidad * precioUnitario) / stockDespues) * 100) / 100
            : precioUnitario;
          await db.upsertCosto(producto, costoDespues);
        }

        // Mantiene costosActuales al día en memoria por si el mismo producto aparece
        // más de una vez en esta misma tanda (el próximo item debe ver el stock y costo ya actualizados).
        const idx = costosActuales.findIndex((c) => c.producto === producto);
        if (idx >= 0) costosActuales[idx] = { ...costosActuales[idx], stock: stockDespues, costo: costoDespues };
        else costosActuales.push({ producto, costo: costoDespues, stock: stockDespues });

        filasInsertadas.push(row);
      }

      return sendJson(res, 201, { loteId, items: filasInsertadas });
    }

    // Inserta filas de compras_stock puramente como registro historico (auditoria),
    // SIN tocar el stock ni el costo actual del producto. Sirve para reconstruir
    // movimientos que ocurrieron pero no quedaron asentados (ej: un ajuste manual de
    // stock hecho fuera de esta pantalla), para que "Situacion Financiera" pueda
    // reconstruir el stock de fechas pasadas correctamente.
    if (pathname === "/api/compras/registro-historico" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const itemsInput = Array.isArray(body.items) ? body.items : [];
      if (!itemsInput.length) return sendJson(res, 400, { error: "No hay items" });

      const loteId = crypto.randomUUID();
      const insertadas = [];
      for (const it of itemsInput) {
        const producto = String(it.producto || "").trim();
        const cantidad = parseInt(it.cantidad, 10);
        const fecha = typeof it.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha) ? it.fecha : null;
        if (!producto || !Number.isInteger(cantidad) || cantidad === 0 || !fecha) {
          return sendJson(res, 400, { error: `Item inválido para "${producto || "?"}"` });
        }
        const row = {
          id: crypto.randomUUID(),
          loteId,
          tipo: "ajuste",
          producto,
          cantidad,
          precioUnitario: null,
          costoTotal: null,
          stockAntes: Number.isFinite(it.stockAntes) ? it.stockAntes : 0,
          stockDespues: Number.isFinite(it.stockDespues) ? it.stockDespues : 0,
          proveedor: null,
          vencimiento: null,
          nota: it.nota ? String(it.nota).trim() : "Registro histórico (no modifica el stock actual)",
          fecha,
          creadoEn: new Date().toISOString(),
        };
        await db.insertCompra(row);
        insertadas.push(row);
      }
      return sendJson(res, 201, { loteId, insertadas: insertadas.length });
    }

    if (pathname.startsWith("/api/compras/lote/") && pathname.endsWith("/fecha") && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const loteId = decodeURIComponent(pathname.slice("/api/compras/lote/".length, -"/fecha".length));
      const body = await readJsonBody(req);
      const fecha = String(body.fecha || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return sendJson(res, 400, { error: "Fecha inválida" });
      const filas = await db.updateFechaLote(loteId, fecha);
      return sendJson(res, 200, { ok: true, actualizadas: filas });
    }

    if (pathname.startsWith("/api/compras/lote/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const loteId = decodeURIComponent(pathname.slice("/api/compras/lote/".length));
      const filas = (await db.getAllCompras()).filter((c) => c.loteId === loteId);
      for (const compra of filas) {
        await revertirCompra(compra);
      }
      return sendJson(res, 200, { ok: true, borradas: filas.length });
    }

    if (pathname.startsWith("/api/compras/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/compras/".length));
      const compra = await db.getCompraById(id);
      if (compra) await revertirCompra(compra);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/gastos" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
      const rows = await db.getGastosByFecha(fecha);
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/gastos" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const concepto = String(body.concepto || "").trim();
      const monto = Number(body.monto);

      if (!concepto) return sendJson(res, 400, { error: "Falta el concepto" });
      if (!Number.isFinite(monto) || monto <= 0) return sendJson(res, 400, { error: "Monto inválido" });

      // El dueño puede elegir una fecha pasada (para completar gastos de días que no se cargaron a tiempo)
      let fecha, horaLabel;
      if (body.fecha) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) return sendJson(res, 400, { error: "Fecha inválida" });
        fecha = body.fecha;
        horaLabel = typeof body.horaLabel === "string" && body.horaLabel ? body.horaLabel : "12:00:00";
      } else {
        const now = getArgentinaNow();
        fecha = now.fecha;
        horaLabel = now.horaLabel;
      }

      const row = {
        id: crypto.randomUUID(),
        concepto,
        monto,
        fecha,
        horaLabel,
        creadoEn: new Date().toISOString(),
      };
      await db.insertGasto(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/gastos/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/gastos/".length));
      await db.deleteGasto(id);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Gastos fijos mensuales (estimados a mano, no son gastos reales cargados) ----------

    if (pathname === "/api/gastos-fijos" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getAllGastosFijos();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/gastos-fijos" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const concepto = String(body.concepto || "").trim();
      const monto = Number(body.monto);
      if (!concepto) return sendJson(res, 400, { error: "Falta el concepto" });
      if (!Number.isFinite(monto) || monto <= 0) return sendJson(res, 400, { error: "Monto inválido" });

      const row = {
        id: crypto.randomUUID(),
        concepto,
        monto,
        creadoEn: new Date().toISOString(),
      };
      await db.insertGastoFijo(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/gastos-fijos/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/gastos-fijos/".length));
      await db.deleteGastoFijo(id);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Anuncios (Meta): medir si una campaña fue rentable ----------

    if (pathname === "/api/anuncios" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getAllAnuncios();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/anuncios" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const nombre = String(body.nombre || "").trim();
      const producto = body.producto ? String(body.producto).trim() : null;
      const fechaInicio = String(body.fechaInicio || "");
      const fechaFin = String(body.fechaFin || "");
      const montoInvertido = Number(body.montoInvertido);
      const notas = body.notas ? String(body.notas).trim() : null;

      if (!nombre) return sendJson(res, 400, { error: "Falta el nombre del anuncio" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)) {
        return sendJson(res, 400, { error: "Fechas inválidas" });
      }
      if (fechaFin < fechaInicio) return sendJson(res, 400, { error: "La fecha de fin no puede ser anterior a la de inicio" });
      if (!Number.isFinite(montoInvertido) || montoInvertido < 0) return sendJson(res, 400, { error: "Monto invertido inválido" });

      const row = {
        id: crypto.randomUUID(),
        nombre,
        producto,
        fechaInicio,
        fechaFin,
        montoInvertido,
        notas,
        creadoEn: new Date().toISOString(),
      };
      await db.insertAnuncio(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/anuncios/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/anuncios/".length));
      await db.deleteAnuncio(id);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Salario del empleado ----------
    // Lectura pública (el empleado la ve sin contraseña), escritura solo del dueño.

    if (pathname === "/api/salario" && req.method === "GET") {
      const rows = await db.getAllSalario();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/salario" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const fecha = String(body.fecha || "").trim() || getArgentinaNow().fecha;
      const sueldo = Number(body.sueldo || 0);
      const comision = Number(body.comision || 0);
      const nota = body.nota ? String(body.nota).trim() : null;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return sendJson(res, 400, { error: "Fecha inválida" });
      if (!Number.isFinite(sueldo) || sueldo < 0) return sendJson(res, 400, { error: "Sueldo inválido" });
      if (!Number.isFinite(comision) || comision < 0) return sendJson(res, 400, { error: "Comisión inválida" });
      if (sueldo === 0 && comision === 0) return sendJson(res, 400, { error: "Ingresá al menos un sueldo o una comisión" });

      const row = {
        id: crypto.randomUUID(),
        fecha,
        sueldo,
        comision,
        nota,
        creadoEn: new Date().toISOString(),
      };
      await db.insertSalario(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/salario/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/salario/".length));
      await db.deleteSalario(id);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Tablero de tareas ----------
    // Sin contraseña, igual que /api/ventas y la lectura de /api/salario: es un
    // pizarrón compartido en el local, lo usa tanto el dueño como el empleado.

    if (pathname === "/api/tablero-tareas" && req.method === "GET") {
      return sendJson(res, 200, await db.getAllTableroTareas());
    }

    if (pathname === "/api/tablero-tareas" && req.method === "POST") {
      const body = await readJsonBody(req);
      const texto = String(body.texto || "").trim();
      if (!texto) return sendJson(res, 400, { error: "Falta el texto de la tarea" });
      const row = {
        id: crypto.randomUUID(),
        texto,
        hecho: false,
        fecha: body.fecha || null,
        hora: body.fecha ? (body.hora || null) : null,
        notas: body.notas || null,
        duracionMin: body.hora ? (Number.isFinite(Number(body.duracionMin)) ? Number(body.duracionMin) : null) : null,
        boardX: Number.isFinite(Number(body.boardX)) ? Number(body.boardX) : null,
        boardY: Number.isFinite(Number(body.boardY)) ? Number(body.boardY) : null,
        creadoEn: new Date().toISOString(),
      };
      await db.insertTableroTarea(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/tablero-tareas/") && req.method === "PATCH") {
      const id = decodeURIComponent(pathname.slice("/api/tablero-tareas/".length));
      const body = await readJsonBody(req);
      const fields = {};
      if (body.texto !== undefined) fields.texto = String(body.texto);
      if (body.hecho !== undefined) fields.hecho = !!body.hecho;
      if (body.fecha !== undefined) fields.fecha = body.fecha;
      if (body.hora !== undefined) fields.hora = body.hora;
      if (body.notas !== undefined) fields.notas = body.notas;
      if (body.duracionMin !== undefined) fields.duracionMin = body.duracionMin === null ? null : Number(body.duracionMin);
      if (body.boardX !== undefined) fields.boardX = Number(body.boardX);
      if (body.boardY !== undefined) fields.boardY = Number(body.boardY);
      await db.updateTableroTarea(id, fields);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith("/api/tablero-tareas/") && req.method === "DELETE") {
      const id = decodeURIComponent(pathname.slice("/api/tablero-tareas/".length));
      await db.deleteTableroTarea(id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/tablero-conexiones" && req.method === "GET") {
      return sendJson(res, 200, await db.getAllTableroConexiones());
    }

    if (pathname === "/api/tablero-conexiones" && req.method === "POST") {
      const body = await readJsonBody(req);
      const desdeId = String(body.desdeId || "").trim();
      const haciaId = String(body.haciaId || "").trim();
      if (!desdeId || !haciaId || desdeId === haciaId) return sendJson(res, 400, { error: "Conexión inválida" });
      const row = { id: crypto.randomUUID(), desdeId, haciaId, creadoEn: new Date().toISOString() };
      await db.insertTableroConexion(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/tablero-conexiones/") && req.method === "DELETE") {
      const id = decodeURIComponent(pathname.slice("/api/tablero-conexiones/".length));
      await db.deleteTableroConexion(id);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Situación financiera (capital manual: transferencias, efectivo, deudas, etc.) ----------

    if (pathname === "/api/balance" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getAllBalanceManual();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/balance" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const fecha = String(body.fecha || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return sendJson(res, 400, { error: "Fecha inválida" });

      const campos = ["capitalTransferencia", "capitalEfectivo", "capitalEnProceso", "deudas", "inversionInicial"];
      const valores = {};
      for (const campo of campos) {
        const v = Number(body[campo] || 0);
        if (!Number.isFinite(v) || v < 0) return sendJson(res, 400, { error: `Valor inválido en "${campo}"` });
        valores[campo] = v;
      }

      const row = {
        fecha,
        ...valores,
        nota: body.nota ? String(body.nota).trim() : null,
        creadoEn: new Date().toISOString(),
      };
      await db.upsertBalanceManual(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/balance/") && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const fecha = decodeURIComponent(pathname.slice("/api/balance/".length));
      await db.deleteBalanceManual(fecha);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Recompra de clientes (vive de la API de Tiendanube, no de la DB local) ----------

    if (pathname === "/api/clientes-recompra" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      if (!tiendanube.isConfigured()) {
        return sendJson(res, 503, { error: "La tienda no está conectada (falta tiendanube-config.json)." });
      }
      try {
        const forzar = query.get("forzar") === "1";
        const resultado = await tiendanube.getClientesRecompra({ forzar });
        return sendJson(res, 200, resultado);
      } catch (e) {
        console.error("Error consultando Tiendanube:", e);
        return sendJson(res, 502, { error: "No se pudo consultar Tiendanube: " + e.message });
      }
    }

    if (pathname === "/api/clientes-recompra/cupon" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      if (!tiendanube.isConfigured()) {
        return sendJson(res, 503, { error: "La tienda no está conectada (falta tiendanube-config.json)." });
      }
      try {
        const body = await readJsonBody(req);
        const cupon = await tiendanube.generarCupon({ porcentaje: body.porcentaje, nota: body.nota });
        return sendJson(res, 201, cupon);
      } catch (e) {
        console.error("Error creando cupón en Tiendanube:", e);
        return sendJson(res, 502, { error: "No se pudo crear el cupón: " + e.message });
      }
    }

    // ---------- Recompra de clientes mayoristas (se arma a partir de la base local) ----------

    if (pathname === "/api/clientes-mayoristas" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getAllClientesMayoristas();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/clientes-mayoristas" && req.method === "POST") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const nombre = String(body.nombre || "").trim();
      if (!nombre) return sendJson(res, 400, { error: "Falta el nombre del cliente" });
      const nombreNormalizado = normalizeNombre(nombre);
      const ahora = new Date().toISOString();
      await db.upsertClienteMayorista({
        id: crypto.randomUUID(),
        nombreNormalizado,
        nombre,
        telefono: body.telefono ? String(body.telefono).trim() : null,
        notas: body.notas ? String(body.notas).trim() : null,
        creadoEn: ahora,
        actualizadoEn: ahora,
      });
      const row = await db.getClienteMayoristaPorNombre(nombreNormalizado);
      return sendJson(res, 200, row);
    }

    if (pathname === "/api/recompra-mayoristas" && req.method === "GET") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const [ventas, items, clientesGuardados] = await Promise.all([
        db.getAllVentas(),
        db.getAllItems(),
        db.getAllClientesMayoristas(),
      ]);
      const clientes = mayoristas.agregarClientesMayoristas({
        ventas,
        items,
        clientesGuardados,
        hoyFecha: getArgentinaNow().fecha,
      });
      return sendJson(res, 200, { clientes });
    }

    // ---------- Pagos recibidos ----------

    // Webhook: lo llama Mercado Pago, no un navegador, así que no hay sesión ni cookie.
    // Se valida con la firma HMAC (si configuraste MP_WEBHOOK_SECRET) y, sobre todo, el
    // pago se vuelve a pedir a la API con nuestro token: el cuerpo del aviso nunca se usa
    // como fuente del monto, así que un aviso falso no puede inventar un cobro.
    if (pathname === "/api/mp/webhook" && req.method === "POST") {
      const body = await readJsonBody(req).catch(() => ({}));
      const tipo = query.get("type") || query.get("topic") || body.type || body.topic || null;
      const dataId = query.get("data.id") || query.get("id") || (body.data && body.data.id) || null;

      const firma = mercadopago.validarFirma({
        xSignature: req.headers["x-signature"],
        xRequestId: req.headers["x-request-id"],
        dataId,
      });
      if (!firma.valida) {
        console.error("Webhook de Mercado Pago rechazado:", firma.motivo);
        return sendJson(res, 401, { error: "Firma inválida" });
      }

      // Mercado Pago también manda avisos de merchant_order y pruebas: se contestan 200
      // para que no queden reintentando, pero no se guarda nada.
      if (tipo !== "payment" || !dataId || !mercadopago.isConfigured()) {
        return sendJson(res, 200, { ok: true, ignorado: true });
      }

      // Si esto falla se devuelve 500 (lo maneja el catch de abajo) y Mercado Pago reintenta.
      const pago = await mercadopago.getPago(dataId);
      await guardarPagoMP(pago);
      return sendJson(res, 200, { ok: true });
    }

    // Público a propósito: lo consume el panel lateral de Registro de Ventas (sin login,
    // lo usa el empleado en el mostrador) para saber qué transferencias entraron y poder
    // cargar la venta al toque. Manda solo lo necesario para eso, nunca el listado
    // completo con verificado/nota/borrado, que sigue con contraseña en /api/pagos.
    if (pathname === "/api/pagos-recientes" && req.method === "GET") {
      const pagos = await db.getPagosByFecha(getArgentinaNow().fecha);
      const recientes = pagos
        .filter((p) => p.estado === "approved")
        .sort((a, b) => (b.fechaISO || "").localeCompare(a.fechaISO || ""))
        .slice(0, 30)
        .map((p) => ({
          id: p.id,
          horaLabel: p.horaLabel,
          monto: p.monto,
          pagador: p.pagador,
          origen: p.origen,
        }));
      return sendJson(res, 200, { pagos: recientes });
    }

    // Listado del día: lo puede ver el empleado (monto, hora, medio y estado). No expone
    // costos ni ganancias, solo la plata que entró.
    if (pathname === "/api/pagos" && req.method === "GET") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
      const pagos = await db.getPagosByFecha(fecha);
      return sendJson(res, 200, {
        pagos,
        rol: getRole(req),
        mp: {
          configurado: mercadopago.isConfigured(),
          firmaActiva: mercadopago.tieneSecretoWebhook(),
          ultimaSync: mpEstado.ultimaSync,
          ultimoError: mpEstado.ultimoError,
        },
        cuentaDni: {
          configurado: redlinkEmail.isConfigured(),
          ultimaSync: redlinkEstado.ultimaSync,
          ultimoError: redlinkEstado.ultimoError,
        },
      });
    }

    // Fuerza una re-consulta contra la API y el correo (botón "Actualizar"). Público a
    // propósito: el de Registro de Ventas lo usa el empleado sin login, para no hacer
    // esperar al cliente en el mostrador. No devuelve nada sensible, solo un resumen.
    // El cooldown evita que alguien lo deje apretado y sature la API de Mercado Pago o
    // el IMAP de Gmail.
    if (pathname === "/api/pagos/sincronizar" && req.method === "POST") {
      const ahora = Date.now();
      if (ahora - ultimoSyncManual < SYNC_MANUAL_COOLDOWN_MS) {
        return sendJson(res, 200, {
          mp: { ok: true, cooldown: true },
          cuentaDni: { ok: true, cooldown: true },
        });
      }
      ultimoSyncManual = ahora;
      const [resultadoMp, resultadoRedlink] = await Promise.all([
        sincronizarPagosMP({ horasAtras: 24 }),
        sincronizarRedlink({ diasAtras: 2 }),
      ]);
      return sendJson(res, 200, { mp: resultadoMp, cuentaDni: resultadoRedlink });
    }

    // Marca un pago como cotejado contra la venta (o lo desmarca).
    if (pathname === "/api/pagos/verificar" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const id = String(body.id || "");
      if (!id) return sendJson(res, 400, { error: "Falta el id del pago" });

      const pago = await db.getPagoById(id);
      if (!pago) return sendJson(res, 404, { error: "Ese pago no existe" });

      const verificado = body.verificado === false ? 0 : 1;
      // Si el pedido no trae nota, se conserva la que ya estaba (marcar el check no
      // tiene por qué borrar lo que anotó el empleado al cargar el pago).
      const nota = body.nota === undefined ? pago.nota : (String(body.nota).trim().slice(0, 300) || null);
      await db.marcarPagoVerificado(id, verificado, verificado ? getRole(req) : null, nota, new Date().toISOString());
      return sendJson(res, 200, await db.getPagoById(id));
    }

    // Carga manual: para Cuenta DNI, que no tiene API ni usuarios adicionales. Lo carga
    // el empleado cuando el cliente dice que transfirió, queda como "a confirmar" y el
    // dueño lo valida mirando la app del banco.
    if (pathname === "/api/pagos/manual" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const monto = Number(body.monto);
      if (!Number.isFinite(monto) || monto <= 0) {
        return sendJson(res, 400, { error: "El monto tiene que ser un número mayor a cero" });
      }

      const ahoraArg = getArgentinaNow();
      const ahora = new Date().toISOString();
      const id = `manual-${crypto.randomUUID()}`;
      await db.upsertPago({
        id,
        origen: "cuentadni",
        externoId: null,
        monto,
        montoNeto: null,
        estado: "a_confirmar",
        metodo: "Cuenta DNI",
        descripcion: body.descripcion ? String(body.descripcion).trim().slice(0, 200) : null,
        pagador: body.pagador ? String(body.pagador).trim().slice(0, 120) : null,
        referencia: null,
        fecha: ahoraArg.fecha,
        horaLabel: ahoraArg.horaLabel.slice(0, 5),
        fechaISO: ahora,
        verificado: 0,
        verificadoPor: null,
        nota: body.nota ? String(body.nota).trim().slice(0, 300) : null,
        creadoEn: ahora,
        actualizadoEn: ahora,
      });
      return sendJson(res, 200, await db.getPagoById(id));
    }

    // Borrar: solo el dueño. Un pago de Mercado Pago borrado vuelve a aparecer en la
    // próxima sincronización (la fuente de verdad es la API, no esta tabla).
    if (pathname === "/api/pagos" && req.method === "DELETE") {
      if (!isOwner(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = query.get("id");
      if (!id) return sendJson(res, 400, { error: "Falta el id del pago" });
      const borrados = await db.deletePago(id);
      return sendJson(res, 200, { ok: true, borrados });
    }

    if (req.method === "GET") {
      return serveStatic(req, res);
    }

    res.writeHead(404);
    res.end("No encontrado");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Error interno del servidor" });
  }
});

function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

db.init().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log("========================================");
    console.log(" Registro de Ventas - servidor iniciado");
    console.log("========================================");
    console.log(`En esta PC:                        http://localhost:${PORT}`);
    const ips = getLocalIps();
    if (ips.length) {
      ips.forEach((ip) => console.log(`Desde otros dispositivos (mismo WiFi): http://${ip}:${PORT}`));
    }
    console.log("");
    console.log("Base de datos: " + (db.usingTurso ? "Turso (nube)" : "archivo local ventas.db"));

    if (mercadopago.isConfigured()) {
      console.log(
        "Mercado Pago: conectado" +
          (mercadopago.tieneSecretoWebhook() ? " (webhook firmado)" : " (webhook SIN firma: falta MP_WEBHOOK_SECRET)")
      );
      // Una pasada al arrancar (por si el servicio estuvo dormido) y después cada
      // MP_SYNC_MINUTOS como red de seguridad del webhook.
      sincronizarPagosMP();
      setInterval(() => sincronizarPagosMP({ horasAtras: 6 }), MP_SYNC_MINUTOS * 60 * 1000).unref();
    } else {
      console.log("Mercado Pago: sin configurar (falta MP_ACCESS_TOKEN), la pestaña de Pagos va a estar vacía");
    }

    if (redlinkEmail.isConfigured()) {
      console.log("Cuenta DNI (mail de Red Link): conectado");
      // Ventana ancha al arrancar (por si el servicio estuvo dormido) y después una
      // ventana corta cada REDLINK_POLL_SEGUNDOS para que se sienta "en el momento",
      // con un barrido más amplio cada tanto como red de seguridad.
      sincronizarRedlink({ diasAtras: 2 });
      let vueltas = 0;
      setInterval(() => {
        vueltas++;
        const esBarrido = vueltas % Math.max(1, Math.round((REDLINK_BARRIDO_MINUTOS * 60) / REDLINK_POLL_SEGUNDOS)) === 0;
        sincronizarRedlink({ diasAtras: esBarrido ? 2 : 0.05 });
      }, REDLINK_POLL_SEGUNDOS * 1000).unref();
    } else {
      console.log("Cuenta DNI (mail de Red Link): sin configurar (falta EMAIL_IMAP_USER/EMAIL_IMAP_APP_PASSWORD), se sigue anotando a mano");
    }
  });
});
