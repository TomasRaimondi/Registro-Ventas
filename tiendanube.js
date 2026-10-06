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

// La ciudad de envío no viene en un solo lugar: shipping_address es un objeto (para
// pedidos con envío), pero los datos de facturación vienen sueltos en campos planos
// (billing_city, no billing_address.city) — así que se prueban los dos, en ese orden.
// En pedidos de retiro en el local puede no haber ninguno de los dos.
function ciudadDeOrden(o) {
  const ciudad = (o.shipping_address && o.shipping_address.city) || o.billing_city || "";
  return ciudad.trim();
}

// Sin tildes y en minúscula, para no depender de cómo esté tipeado el nombre.
function normalizarTexto(s) {
  return (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Reglas de recompra por producto: cada una se dispara cuando pasaron "dias" días
// desde la última compra de un producto que matchee "match" (sin tildes, minúscula,
// comparado por substring contra el nombre del producto), sin que haya una compra más
// nueva de ese mismo producto. El umbral sale de cuánto rinde cada pote/frasco.
const REGLAS_RECOMPRA_PRODUCTO = [
  // "protein" matchea tanto "Proteína"/"proteina" (es, sin acentos) como "Whey Protein"
  // (nombres en inglés que también se usan en el catálogo), en una sola pasada.
  { id: "proteina", etiqueta: "Proteína", match: "protein", dias: 30 },
  { id: "creatina_star_300", etiqueta: "Creatina Star Nutrition 300g", match: "creatina star nutrition 300g", dias: 50 },
  { id: "creatina_onefit_500", etiqueta: "Creatina One Fit 500g", match: "creatina one fit 500g", dias: 60 },
];

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
    // El email agrupa mejor que el id de cliente: una misma persona puede comprar una
    // vez como invitado (sin customer.id) y otra vez logueada (con customer.id), y con
    // el id como clave esas dos compras quedaban como "dos clientes" distintos en vez de
    // sumarse al historial de uno solo. El id solo se usa si el pedido no trae email.
    const key = (o.contact_email || cust.email || "").trim().toLowerCase() || (cust.id && String(cust.id)) || `pedido-${o.id}`;

    if (!porCliente.has(key)) {
      porCliente.set(key, {
        id: cust.id || null,
        nombre: cust.name || o.contact_name || "Cliente sin nombre",
        email: cust.email || o.contact_email || "",
        telefono: cust.phone || o.contact_phone || "",
        compras: 0,
        totalGastado: 0,
        ultimaCompra: null,
        ultimaCompraPorRegla: new Map(),
        productos: new Map(),
        pedidos: [],
        ciudades: new Set(),
      });
    }

    const c = porCliente.get(key);
    c.compras += 1;
    c.totalGastado += Number(o.total) || 0;
    if (!c.telefono && (cust.phone || o.contact_phone)) c.telefono = cust.phone || o.contact_phone;
    if (!c.email && (cust.email || o.contact_email)) c.email = cust.email || o.contact_email;

    const ciudadOrden = ciudadDeOrden(o);
    if (ciudadOrden) c.ciudades.add(ciudadOrden);

    const fechaOrden = fechaOrdenISO(o);
    if (fechaOrden && (!c.ultimaCompra || fechaOrden > c.ultimaCompra)) c.ultimaCompra = fechaOrden;

    const items = (o.products || []).map((p) => ({
      nombre: nombreProducto(p),
      cantidad: Number(p.quantity) || 1,
      precio: Number(p.price) || 0,
      productId: p.product_id || null,
    }));
    for (const it of items) {
      c.productos.set(it.nombre, (c.productos.get(it.nombre) || 0) + it.cantidad);
    }

    // Última vez que este cliente compró cada producto con regla de recompra.
    if (fechaOrden) {
      for (const regla of REGLAS_RECOMPRA_PRODUCTO) {
        const compro = items.some((it) => normalizarTexto(it.nombre).includes(regla.match));
        if (!compro) continue;
        const actual = c.ultimaCompraPorRegla.get(regla.id);
        if (!actual || fechaOrden > actual) c.ultimaCompraPorRegla.set(regla.id, fechaOrden);
      }
    }

    c.pedidos.push({
      id: o.id,
      numero: o.number,
      fecha: fechaOrden,
      total: Number(o.total) || 0,
      productos: items,
      ciudad: ciudadOrden || null,
    });
  }

  const ahora = Date.now();
  const clientes = [...porCliente.values()].map((c) => {
    const ultimaCompraMs = c.ultimaCompra ? new Date(c.ultimaCompra).getTime() : null;
    const diasSinComprar = Number.isFinite(ultimaCompraMs) ? Math.floor((ahora - ultimaCompraMs) / 86400000) : null;

    const alertasRecompra = REGLAS_RECOMPRA_PRODUCTO.map((regla) => {
      const ultima = c.ultimaCompraPorRegla.get(regla.id) || null;
      const ultimaMs = ultima ? new Date(ultima).getTime() : null;
      const dias = Number.isFinite(ultimaMs) ? Math.floor((ahora - ultimaMs) / 86400000) : null;
      return { id: regla.id, etiqueta: regla.etiqueta, diasUmbral: regla.dias, ultimaCompra: ultima, dias, activa: dias !== null && dias >= regla.dias };
    }).filter((a) => a.ultimaCompra !== null);

    return {
      id: c.id,
      nombre: c.nombre,
      email: c.email,
      telefono: c.telefono || null,
      whatsapp: waLink(c.telefono, `Hola ${(c.nombre || "").split(" ")[0] || ""}! Somos de Platense Fit`),
      compras: c.compras,
      totalGastado: Math.round(c.totalGastado * 100) / 100,
      ultimaCompra: c.ultimaCompra,
      diasSinComprar,
      alertasRecompra,
      segmento: c.compras >= 2 ? "recompro" : "unico",
      productos: [...c.productos.entries()]
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
      pedidos: c.pedidos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")),
      ciudades: [...c.ciudades],
    };
  });

  clientes.sort((a, b) => (b.ultimaCompra || "").localeCompare(a.ultimaCompra || ""));

  cache = { data: clientes, fetchedAt: ahora };
  return { clientes, sincronizadoEn: ahora, deCache: false };
}

// Multi-idioma como "name": {es:"...", ...} o directamente un string, según el campo.
function valorMultiIdioma(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return v.es || v.pt || v.en || Object.values(v)[0] || null;
  return null;
}

// Resuelve el link a la tienda y el precio actual de un producto puntual, para armar
// el mensaje de recompra con el link directo y el precio vigente (no el que pagó la
// última vez, que puede estar desactualizado). Si algo falla, se devuelve null y el
// mensaje de WhatsApp simplemente sale sin esa parte, no se corta el flujo del cupón.
async function resolverProducto(productId) {
  if (!productId) return null;
  try {
    const p = await tnFetch(`/products/${productId}`);
    const handle = valorMultiIdioma(p.handle);
    const variante = (p.variants && p.variants[0]) || {};
    const promo = Number(variante.promotional_price);
    const precio = promo > 0 ? promo : (Number(variante.price) || null);
    return {
      nombre: nombreProducto(p),
      url: handle ? `https://platensefit.com/productos/${handle}/` : null,
      precio,
    };
  } catch (e) {
    console.error(`No se pudo resolver el producto ${productId}:`, e.message);
    return null;
  }
}

// Crea un cupón de descuento de un solo uso en Tiendanube para reenganchar a un cliente
// puntual (prefijo "VOLVE") o, con prefijo propio, para un lote genérico (ver
// generarCuponesEnLote más abajo).
async function generarCupon({ porcentaje, nota, prefijo, maxUses = 1 }) {
  if (!isConfigured()) throw new Error("Tienda no conectada");
  const pct = Number(porcentaje);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 90) throw new Error("Porcentaje inválido");

  const base = prefijo || `VOLVE${pct}`;
  const codigo = `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const body = {
    code: codigo,
    type: "percentage",
    value: String(pct),
    valid: true,
    max_uses: maxUses,
  };
  const cupon = await tnFetch("/coupons", { method: "POST", body: JSON.stringify(body) });
  return { code: cupon.code || codigo, id: cupon.id, porcentaje: pct, nota: nota || null };
}

// ---------- Cupones aplicados a ventas del local (Registro de Ventas) ----------
//
// Tiendanube no tiene un filtro de "buscar por código" que funcione (?code= se probó y
// devuelve la lista entera sin filtrar), así que se trae la lista completa una vez y se
// cachea un rato corto — en una tienda con un par de cientos de cupones esto es liviano y
// evita pegarle a la API en cada venta.
let cacheCupones = { data: null, fetchedAt: 0 };
const CACHE_CUPONES_MS = 2 * 60 * 1000;

async function getCupones({ forzar = false } = {}) {
  if (!isConfigured()) throw new Error("Tienda no conectada");
  if (!forzar && cacheCupones.data && Date.now() - cacheCupones.fetchedAt < CACHE_CUPONES_MS) {
    return cacheCupones.data;
  }
  const cupones = await fetchAllPages("/coupons");
  cacheCupones = { data: cupones, fetchedAt: Date.now() };
  return cupones;
}

function invalidarCacheCupones() {
  cacheCupones = { data: null, fetchedAt: 0 };
}

// Busca un cupón por código exacto, sin importar mayúsculas ni espacios de más (así el
// empleado lo puede tipear como le resulte más cómodo).
async function buscarCuponPorCodigo(codigo, { forzar = false } = {}) {
  const normalizado = String(codigo || "").trim().toUpperCase();
  if (!normalizado) return null;
  const cupones = await getCupones({ forzar });
  return cupones.find((c) => String(c.code || "").trim().toUpperCase() === normalizado) || null;
}

// Chequea si un cupón ya encontrado todavía se puede usar: activo, de tipo porcentaje (es
// lo único que esta pantalla sabe aplicar), sin pasarse de sus usos máximos, y dentro de su
// ventana de vigencia si tiene una cargada.
function cuponUtilizable(cupon) {
  if (!cupon) return { ok: false, motivo: "No existe un cupón con ese código" };
  if (cupon.is_deleted) return { ok: false, motivo: "El cupón fue eliminado" };
  if (!cupon.valid) return { ok: false, motivo: "El cupón ya no está activo (puede que ya se haya usado)" };
  if (cupon.type !== "percentage") return { ok: false, motivo: "Este cupón no es de porcentaje: no se puede aplicar acá" };
  const pct = Number(cupon.value);
  if (!Number.isFinite(pct) || pct <= 0) return { ok: false, motivo: "El cupón tiene un porcentaje inválido" };
  if (cupon.max_uses != null && Number(cupon.used || 0) >= Number(cupon.max_uses)) {
    return { ok: false, motivo: "El cupón ya alcanzó su límite de usos" };
  }
  const ahora = Date.now();
  if (cupon.end_date) {
    const fin = new Date(cupon.end_date).getTime();
    if (Number.isFinite(fin) && fin < ahora) return { ok: false, motivo: "El cupón venció" };
  }
  if (cupon.start_date) {
    const inicio = new Date(cupon.start_date).getTime();
    if (Number.isFinite(inicio) && inicio > ahora) return { ok: false, motivo: "El cupón todavía no empieza a regir" };
  }
  return { ok: true, porcentaje: pct };
}

// Desactiva un cupón después de usarlo en una venta del local: esa venta no pasa por el
// checkout de la tienda, así que Tiendanube nunca se entera sola de que se usó. Desactivarlo
// (valid:false) es lo que impide que se reuse, tanto acá como en la tienda online.
async function marcarCuponUsado(cuponId) {
  await tnFetch(`/coupons/${cuponId}`, { method: "PUT", body: JSON.stringify({ valid: false }) });
  invalidarCacheCupones();
}

// Crea "cantidad" cupones de un solo uso, mismo porcentaje para todos, códigos únicos tipo
// "PREFIJO-XXXXX". No hay alta en lote en la API: se crean uno por uno con una pausa chica
// entre cada uno para no pisar el límite de pedidos/segundo. Si alguno falla (código
// repetido por mala suerte, error de red puntual) se sigue con el resto; onCreado(code, id)
// se llama después de cada éxito para que quien llama pueda ir guardando el progreso.
async function generarCuponesEnLote({ cantidad, porcentaje, prefijo = "PROMO", onCreado } = {}) {
  if (!isConfigured()) throw new Error("Tienda no conectada");
  const n = Number(cantidad);
  if (!Number.isInteger(n) || n <= 0 || n > 500) throw new Error("Cantidad inválida (máximo 500 por lote)");

  const creados = [];
  const errores = [];
  for (let i = 0; i < n; i++) {
    try {
      const cupon = await generarCupon({ porcentaje, prefijo, maxUses: 1 });
      creados.push(cupon);
      if (onCreado) await onCreado(cupon);
    } catch (e) {
      errores.push(e.message);
    }
    await sleep(350);
  }
  invalidarCacheCupones();
  return { creados, errores };
}

// Busca un pedido por su número visible (el "#1234" que ve el cliente) para precargar
// nombre, teléfono y ciudad al crear un seguimiento de envío.
async function buscarOrdenPorNumero(numero) {
  if (!isConfigured()) throw new Error("Tienda no conectada");
  const n = String(numero).replace(/\D/g, "");
  if (!n) return null;
  const lote = await tnFetch(`/orders?q=${encodeURIComponent(n)}&per_page=10`);
  const o = Array.isArray(lote) ? lote.find((x) => String(x.number) === n) : null;
  if (!o) return null;
  const cust = o.customer || {};
  const dir = o.shipping_address || {};
  return {
    orden: String(o.number),
    cliente: cust.name || o.contact_name || "",
    telefono: cust.phone || o.contact_phone || "",
    ciudad: ciudadDeOrden(o),
    direccion: [dir.address, dir.number, dir.floor].filter(Boolean).join(" "),
    productos: (o.products || []).map((p) => `${Number(p.quantity) || 1}x ${nombreProducto(p)}`),
    pagado: o.payment_status === "paid",
  };
}

module.exports = {
  isConfigured, getClientesRecompra, generarCupon, resolverProducto, waLink, normalizarTelefono, buscarOrdenPorNumero,
  buscarCuponPorCodigo, cuponUtilizable, marcarCuponUsado, generarCuponesEnLote,
};
