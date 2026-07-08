const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const TIMEZONE = "America/Argentina/Buenos_Aires";
const PUBLIC_DIR = path.join(__dirname, "public");
const METODOS_VALIDOS = new Set(["efectivo", "transferencia", "debito", "credito", "cuentadni", "mayorista"]);
const CUENTA_DNI_COMISION = 0.006;
const SESSION_MAX_AGE = 60 * 60 * 12; // 12 horas

// ---------- Contraseña del panel de ganancias ----------

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
try {
  const localConfigPath = path.join(__dirname, "admin-config.json");
  if (fs.existsSync(localConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
    if (cfg.adminPassword) ADMIN_PASSWORD = cfg.adminPassword;
  }
} catch (e) {
  console.error("No se pudo leer admin-config.json:", e.message);
}

const sessions = new Set();

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

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return !!(cookies.session && sessions.has(cookies.session));
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

// ---------- Utilidades HTTP ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
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

      const total = itemsProcessed.reduce((acc, it) => acc + it.precio, 0);

      // Agrupa productos repetidos en el resumen (ej: "Pancake x10" en vez de repetirlo 10 veces)
      const conteoPorProducto = new Map();
      for (const it of itemsProcessed) {
        conteoPorProducto.set(it.producto, (conteoPorProducto.get(it.producto) || 0) + 1);
      }
      const productoResumen = [...conteoPorProducto.entries()]
        .map(([producto, cantidad]) => (cantidad > 1 ? `${producto} x${cantidad}` : producto))
        .join(", ");

      // Solo el dueño (con sesión) puede elegir una fecha pasada, para cargar ventas
      // que no se registraron en el momento (ej: las que ya tenía anotadas en un Excel).
      let fecha, hora, horaLabel;
      if (isAuthenticated(req) && body.fecha) {
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

      const row = {
        id: crypto.randomUUID(),
        producto: productoResumen,
        precio: Math.round(total * 100) / 100,
        metodo,
        fecha,
        hora,
        horaLabel,
        creadoEn: new Date().toISOString(),
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
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
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
            resultado.push({ ventaId: venta.id, producto: it.producto, precio: it.precio, horaLabel: venta.horaLabel });
          }
        } else {
          // Venta antigua sin items propios: se usa el producto/precio original como único item
          resultado.push({ ventaId: venta.id, producto: venta.producto, precio: venta.precio, horaLabel: venta.horaLabel });
        }
      }

      return sendJson(res, 200, resultado);
    }

    if (pathname === "/api/reportes" && req.method === "GET") {
      // Protegido: historial completo (todos los días) para el panel de reportes.
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
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
      if (password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "Contraseña incorrecta" });
      }

      const token = crypto.randomUUID();
      sessions.add(token);
      res.setHeader(
        "Set-Cookie",
        `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax`
      );
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      const cookies = parseCookies(req);
      if (cookies.session) sessions.delete(cookies.session);
      res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/auth-check" && req.method === "GET") {
      return sendJson(res, 200, { authenticated: isAuthenticated(req) });
    }

    // ---------- Costos y gastos (protegidos, requieren sesión) ----------

    if (pathname === "/api/costos" && req.method === "GET") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getCostos();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/costos" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const producto = String(body.producto || "").trim();
      const costo = Number(body.costo);

      if (!producto) return sendJson(res, 400, { error: "Falta el producto" });
      if (!Number.isFinite(costo) || costo < 0) return sendJson(res, 400, { error: "Costo inválido" });

      await db.upsertCosto(producto, costo);
      return sendJson(res, 200, { ok: true, producto, costo });
    }

    if (pathname.startsWith("/api/costos/") && req.method === "DELETE") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const producto = decodeURIComponent(pathname.slice("/api/costos/".length));
      await db.deleteCosto(producto);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/costos/stock" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const producto = String(body.producto || "").trim();
      const stock = Number(body.stock);

      if (!producto) return sendJson(res, 400, { error: "Falta el producto" });
      if (!Number.isFinite(stock) || stock < 0) return sendJson(res, 400, { error: "Stock inválido" });

      await db.updateStock(producto, stock);
      return sendJson(res, 200, { ok: true, producto, stock });
    }

    // ---------- Composición de combos (para no duplicar stock entre combo y componentes) ----------

    if (pathname === "/api/composicion" && req.method === "GET") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const rows = await db.getComposicion();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/composicion" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const body = await readJsonBody(req);
      const comboProducto = String(body.comboProducto || "").trim();
      const componenteProducto = String(body.componenteProducto || "").trim();
      const cantidad = Number.isInteger(body.cantidad) ? body.cantidad : parseInt(body.cantidad, 10);

      if (!comboProducto || !componenteProducto) return sendJson(res, 400, { error: "Falta el combo o el componente" });
      if (comboProducto === componenteProducto) return sendJson(res, 400, { error: "Un producto no puede ser componente de sí mismo" });
      if (!Number.isInteger(cantidad) || cantidad <= 0) return sendJson(res, 400, { error: "Cantidad inválida" });

      const row = { id: crypto.randomUUID(), comboProducto, componenteProducto, cantidad };
      await db.insertComponente(row);
      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/composicion/") && req.method === "DELETE") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/composicion/".length));
      await db.deleteComponente(id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/gastos" && req.method === "GET") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
      const rows = await db.getGastosByFecha(fecha);
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/gastos" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
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
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/gastos/".length));
      await db.deleteGasto(id);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- Salario del empleado ----------
    // Lectura pública (el empleado la ve sin contraseña), escritura solo del dueño.

    if (pathname === "/api/salario" && req.method === "GET") {
      const rows = await db.getAllSalario();
      return sendJson(res, 200, rows);
    }

    if (pathname === "/api/salario" && req.method === "POST") {
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
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
      if (!isAuthenticated(req)) return sendJson(res, 401, { error: "No autenticado" });
      const id = decodeURIComponent(pathname.slice("/api/salario/".length));
      await db.deleteSalario(id);
      return sendJson(res, 200, { ok: true });
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
  });
});
