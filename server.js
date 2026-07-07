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
