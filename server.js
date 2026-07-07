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

    if (pathname === "/api/ventas" && req.method === "POST") {
      const body = await readJsonBody(req);
      const producto = String(body.producto || "").trim();
      const precio = Number(body.precio);
      const metodo = String(body.metodo || "");

      if (!producto) return sendJson(res, 400, { error: "Falta el producto" });
      if (!Number.isFinite(precio) || precio <= 0) return sendJson(res, 400, { error: "Precio inválido" });
      if (!METODOS_VALIDOS.has(metodo)) return sendJson(res, 400, { error: "Método de pago inválido" });

      const precioNeto = metodo === "cuentadni"
        ? Math.round(precio * (1 - CUENTA_DNI_COMISION) * 100) / 100
        : precio;

      const now = getArgentinaNow();
      const row = {
        id: crypto.randomUUID(),
        producto,
        precio: precioNeto,
        metodo,
        fecha: now.fecha,
        hora: now.hora,
        horaLabel: now.horaLabel,
        creadoEn: new Date().toISOString(),
      };

      await db.insert(row);

      return sendJson(res, 201, row);
    }

    if (pathname.startsWith("/api/ventas/") && req.method === "DELETE") {
      const id = decodeURIComponent(pathname.slice("/api/ventas/".length));
      await db.deleteById(id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/ventas" && req.method === "DELETE") {
      const fecha = query.get("fecha") || getArgentinaNow().fecha;
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

      const now = getArgentinaNow();
      const row = {
        id: crypto.randomUUID(),
        concepto,
        monto,
        fecha: now.fecha,
        horaLabel: now.horaLabel,
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
