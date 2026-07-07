const path = require("node:path");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ventas (
    id TEXT PRIMARY KEY,
    producto TEXT NOT NULL,
    precio REAL NOT NULL,
    metodo TEXT NOT NULL,
    fecha TEXT NOT NULL,
    hora INTEGER NOT NULL,
    horaLabel TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  )
`;

const USE_TURSO = !!process.env.TURSO_DATABASE_URL;

let impl;

if (USE_TURSO) {
  // ---------- Modo nube: Turso (SQLite alojado) ----------
  const { createClient } = require("@libsql/client");
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  impl = {
    async init() {
      await client.execute(SCHEMA);
    },
    async getByFecha(fecha) {
      const res = await client.execute({
        sql: "SELECT * FROM ventas WHERE fecha = ? ORDER BY creadoEn ASC",
        args: [fecha],
      });
      return res.rows;
    },
    async insert(row) {
      await client.execute({
        sql: `INSERT INTO ventas (id, producto, precio, metodo, fecha, hora, horaLabel, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.producto, row.precio, row.metodo, row.fecha, row.hora, row.horaLabel, row.creadoEn],
      });
    },
    async deleteById(id) {
      await client.execute({ sql: "DELETE FROM ventas WHERE id = ?", args: [id] });
    },
    async deleteByFecha(fecha) {
      await client.execute({ sql: "DELETE FROM ventas WHERE fecha = ?", args: [fecha] });
    },
  };
} else {
  // ---------- Modo local: archivo SQLite en esta PC ----------
  const { DatabaseSync } = require("node:sqlite");
  const DB_PATH = path.join(__dirname, "ventas.db");
  const db = new DatabaseSync(DB_PATH);

  impl = {
    async init() {
      db.exec(SCHEMA);
    },
    async getByFecha(fecha) {
      return db.prepare("SELECT * FROM ventas WHERE fecha = ? ORDER BY creadoEn ASC").all(fecha);
    },
    async insert(row) {
      db.prepare(
        `INSERT INTO ventas (id, producto, precio, metodo, fecha, hora, horaLabel, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.producto, row.precio, row.metodo, row.fecha, row.hora, row.horaLabel, row.creadoEn);
    },
    async deleteById(id) {
      db.prepare("DELETE FROM ventas WHERE id = ?").run(id);
    },
    async deleteByFecha(fecha) {
      db.prepare("DELETE FROM ventas WHERE fecha = ?").run(fecha);
    },
  };
}

module.exports = { ...impl, usingTurso: USE_TURSO };
