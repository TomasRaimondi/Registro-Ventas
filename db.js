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
  );
  CREATE TABLE IF NOT EXISTS costos (
    producto TEXT PRIMARY KEY,
    costo REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gastos (
    id TEXT PRIMARY KEY,
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha TEXT NOT NULL,
    horaLabel TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gastos_fijos (
    id TEXT PRIMARY KEY,
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS anuncios (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    producto TEXT,
    fechaInicio TEXT NOT NULL,
    fechaFin TEXT NOT NULL,
    montoInvertido REAL NOT NULL,
    notas TEXT,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS salario (
    id TEXT PRIMARY KEY,
    fecha TEXT NOT NULL,
    sueldo REAL NOT NULL DEFAULT 0,
    comision REAL NOT NULL DEFAULT 0,
    nota TEXT,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS venta_items (
    id TEXT PRIMARY KEY,
    ventaId TEXT NOT NULL,
    producto TEXT NOT NULL,
    precio REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS producto_composicion (
    id TEXT PRIMARY KEY,
    comboProducto TEXT NOT NULL,
    componenteProducto TEXT NOT NULL,
    cantidad INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS compras_stock (
    id TEXT PRIMARY KEY,
    loteId TEXT,
    tipo TEXT NOT NULL DEFAULT 'compra',
    producto TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    precioUnitario REAL,
    costoTotal REAL,
    stockAntes INTEGER NOT NULL,
    stockDespues INTEGER NOT NULL,
    proveedor TEXT,
    vencimiento TEXT,
    nota TEXT,
    fecha TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS balance_manual (
    fecha TEXT PRIMARY KEY,
    capitalTransferencia REAL NOT NULL DEFAULT 0,
    capitalEfectivo REAL NOT NULL DEFAULT 0,
    capitalEnProceso REAL NOT NULL DEFAULT 0,
    deudas REAL NOT NULL DEFAULT 0,
    inversionInicial REAL NOT NULL DEFAULT 0,
    nota TEXT,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tablero_tareas (
    id TEXT PRIMARY KEY,
    texto TEXT NOT NULL,
    hecho INTEGER NOT NULL DEFAULT 0,
    fecha TEXT,
    hora TEXT,
    notas TEXT,
    duracionMin INTEGER,
    boardX REAL,
    boardY REAL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tablero_conexiones (
    id TEXT PRIMARY KEY,
    desdeId TEXT NOT NULL,
    haciaId TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ventas_perdidas (
    id TEXT PRIMARY KEY,
    motivo TEXT NOT NULL,
    fecha TEXT NOT NULL,
    horaLabel TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clientes_mayoristas (
    id TEXT PRIMARY KEY,
    nombreNormalizado TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    telefono TEXT,
    notas TEXT,
    creadoEn TEXT NOT NULL,
    actualizadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pagos_recibidos (
    id TEXT PRIMARY KEY,
    origen TEXT NOT NULL,
    externoId TEXT,
    monto REAL NOT NULL,
    montoNeto REAL,
    estado TEXT NOT NULL,
    metodo TEXT,
    descripcion TEXT,
    pagador TEXT,
    referencia TEXT,
    fecha TEXT NOT NULL,
    horaLabel TEXT NOT NULL,
    fechaISO TEXT NOT NULL,
    verificado INTEGER NOT NULL DEFAULT 0,
    verificadoPor TEXT,
    nota TEXT,
    creadoEn TEXT NOT NULL,
    actualizadoEn TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos_recibidos (fecha);
`;

// Migración aditiva: agrega la columna "stock" a costos si todavía no existe
// (las instalaciones viejas no la tienen; ALTER TABLE falla si ya está, por eso el try/catch).
async function migrarStock(execFn) {
  try {
    await execFn("ALTER TABLE costos ADD COLUMN stock INTEGER DEFAULT 0");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: agrega "loteId" a compras_stock para poder agrupar varios productos
// cargados en una misma compra. Las filas viejas quedan con loteId NULL (se agrupan solas).
async function migrarLoteId(execFn) {
  try {
    await execFn("ALTER TABLE compras_stock ADD COLUMN loteId TEXT");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: agrega "cliente" a ventas para poder anotar a quién se le vendió
// un pedido mayorista. Las ventas viejas quedan con cliente NULL.
async function migrarCliente(execFn) {
  try {
    await execFn("ALTER TABLE ventas ADD COLUMN cliente TEXT");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

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
      for (const stmt of SCHEMA.split(";").map(s => s.trim()).filter(Boolean)) {
        await client.execute(stmt);
      }
      await migrarStock((sql) => client.execute(sql));
      await migrarLoteId((sql) => client.execute(sql));
      await migrarCliente((sql) => client.execute(sql));
    },
    async getByFecha(fecha) {
      const res = await client.execute({
        sql: "SELECT * FROM ventas WHERE fecha = ? ORDER BY creadoEn ASC",
        args: [fecha],
      });
      return res.rows;
    },
    async getAllVentas() {
      const res = await client.execute("SELECT * FROM ventas ORDER BY creadoEn ASC");
      return res.rows;
    },
    async getAllItems() {
      const res = await client.execute(`
        SELECT vi.*, v.fecha as fecha, v.horaLabel as horaLabel, v.metodo as metodo
        FROM venta_items vi JOIN ventas v ON v.id = vi.ventaId
        ORDER BY v.creadoEn ASC
      `);
      return res.rows;
    },
    async getAllGastos() {
      const res = await client.execute("SELECT * FROM gastos ORDER BY creadoEn ASC");
      return res.rows;
    },
    async insert(row) {
      await client.execute({
        sql: `INSERT INTO ventas (id, producto, precio, metodo, fecha, hora, horaLabel, creadoEn, cliente)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.producto, row.precio, row.metodo, row.fecha, row.hora, row.horaLabel, row.creadoEn, row.cliente || null],
      });
    },
    async deleteById(id) {
      await client.execute({ sql: "DELETE FROM ventas WHERE id = ?", args: [id] });
    },
    async deleteByFecha(fecha) {
      await client.execute({
        sql: "DELETE FROM venta_items WHERE ventaId IN (SELECT id FROM ventas WHERE fecha = ?)",
        args: [fecha],
      });
      await client.execute({ sql: "DELETE FROM ventas WHERE fecha = ?", args: [fecha] });
    },

    async getCostos() {
      const res = await client.execute("SELECT * FROM costos ORDER BY producto ASC");
      return res.rows;
    },
    async upsertCosto(producto, costo) {
      await client.execute({
        sql: `INSERT INTO costos (producto, costo) VALUES (?, ?)
              ON CONFLICT(producto) DO UPDATE SET costo = excluded.costo`,
        args: [producto, costo],
      });
    },
    async deleteCosto(producto) {
      await client.execute({ sql: "DELETE FROM costos WHERE producto = ?", args: [producto] });
    },
    async updateStock(producto, stock) {
      await client.execute({ sql: "UPDATE costos SET stock = ? WHERE producto = ?", args: [stock, producto] });
    },
    async decrementStock(producto, cantidad) {
      await client.execute({
        sql: "UPDATE costos SET stock = MAX(0, stock - ?) WHERE producto = ?",
        args: [cantidad, producto],
      });
    },
    async incrementStock(producto, cantidad) {
      await client.execute({
        sql: "UPDATE costos SET stock = stock + ? WHERE producto = ?",
        args: [cantidad, producto],
      });
    },

    async getComposicion() {
      const res = await client.execute("SELECT * FROM producto_composicion ORDER BY comboProducto ASC");
      return res.rows;
    },
    async insertComponente(row) {
      await client.execute({
        sql: `INSERT INTO producto_composicion (id, comboProducto, componenteProducto, cantidad) VALUES (?, ?, ?, ?)`,
        args: [row.id, row.comboProducto, row.componenteProducto, row.cantidad],
      });
    },
    async deleteComponente(id) {
      await client.execute({ sql: "DELETE FROM producto_composicion WHERE id = ?", args: [id] });
    },

    async getGastosByFecha(fecha) {
      const res = await client.execute({
        sql: "SELECT * FROM gastos WHERE fecha = ? ORDER BY creadoEn ASC",
        args: [fecha],
      });
      return res.rows;
    },
    async insertGasto(row) {
      await client.execute({
        sql: `INSERT INTO gastos (id, concepto, monto, fecha, horaLabel, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.concepto, row.monto, row.fecha, row.horaLabel, row.creadoEn],
      });
    },
    async deleteGasto(id) {
      await client.execute({ sql: "DELETE FROM gastos WHERE id = ?", args: [id] });
    },

    async getAllGastosFijos() {
      const res = await client.execute("SELECT * FROM gastos_fijos ORDER BY creadoEn ASC");
      return res.rows;
    },
    async insertGastoFijo(row) {
      await client.execute({
        sql: `INSERT INTO gastos_fijos (id, concepto, monto, creadoEn) VALUES (?, ?, ?, ?)`,
        args: [row.id, row.concepto, row.monto, row.creadoEn],
      });
    },
    async deleteGastoFijo(id) {
      await client.execute({ sql: "DELETE FROM gastos_fijos WHERE id = ?", args: [id] });
    },

    async getAllAnuncios() {
      const res = await client.execute("SELECT * FROM anuncios ORDER BY fechaInicio DESC, creadoEn DESC");
      return res.rows;
    },
    async insertAnuncio(row) {
      await client.execute({
        sql: `INSERT INTO anuncios (id, nombre, producto, fechaInicio, fechaFin, montoInvertido, notas, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.nombre, row.producto, row.fechaInicio, row.fechaFin, row.montoInvertido, row.notas, row.creadoEn],
      });
    },
    async deleteAnuncio(id) {
      await client.execute({ sql: "DELETE FROM anuncios WHERE id = ?", args: [id] });
    },

    async getAllSalario() {
      const res = await client.execute("SELECT * FROM salario ORDER BY fecha ASC, creadoEn ASC");
      return res.rows;
    },
    async insertSalario(row) {
      await client.execute({
        sql: `INSERT INTO salario (id, fecha, sueldo, comision, nota, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.fecha, row.sueldo, row.comision, row.nota || null, row.creadoEn],
      });
    },
    async deleteSalario(id) {
      await client.execute({ sql: "DELETE FROM salario WHERE id = ?", args: [id] });
    },

    async getAllTableroTareas() {
      const res = await client.execute("SELECT * FROM tablero_tareas ORDER BY creadoEn ASC");
      return res.rows;
    },
    async insertTableroTarea(row) {
      await client.execute({
        sql: `INSERT INTO tablero_tareas (id, texto, hecho, fecha, hora, notas, duracionMin, boardX, boardY, creadoEn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.texto, row.hecho ? 1 : 0, row.fecha || null, row.hora || null, row.notas || null, row.duracionMin || null, row.boardX ?? null, row.boardY ?? null, row.creadoEn],
      });
    },
    async updateTableroTarea(id, fields) {
      const sets = [];
      const args = [];
      if (fields.texto !== undefined) { sets.push("texto = ?"); args.push(fields.texto); }
      if (fields.hecho !== undefined) { sets.push("hecho = ?"); args.push(fields.hecho ? 1 : 0); }
      if (fields.fecha !== undefined) { sets.push("fecha = ?"); args.push(fields.fecha); }
      if (fields.hora !== undefined) { sets.push("hora = ?"); args.push(fields.hora); }
      if (fields.notas !== undefined) { sets.push("notas = ?"); args.push(fields.notas); }
      if (fields.duracionMin !== undefined) { sets.push("duracionMin = ?"); args.push(fields.duracionMin); }
      if (fields.boardX !== undefined) { sets.push("boardX = ?"); args.push(fields.boardX); }
      if (fields.boardY !== undefined) { sets.push("boardY = ?"); args.push(fields.boardY); }
      if (!sets.length) return;
      args.push(id);
      await client.execute({ sql: `UPDATE tablero_tareas SET ${sets.join(", ")} WHERE id = ?`, args });
    },
    async deleteTableroTarea(id) {
      await client.execute({ sql: "DELETE FROM tablero_tareas WHERE id = ?", args: [id] });
      await client.execute({ sql: "DELETE FROM tablero_conexiones WHERE desdeId = ? OR haciaId = ?", args: [id, id] });
    },

    async getAllTableroConexiones() {
      const res = await client.execute("SELECT * FROM tablero_conexiones ORDER BY creadoEn ASC");
      return res.rows;
    },
    async insertTableroConexion(row) {
      await client.execute({
        sql: `INSERT INTO tablero_conexiones (id, desdeId, haciaId, creadoEn) VALUES (?, ?, ?, ?)`,
        args: [row.id, row.desdeId, row.haciaId, row.creadoEn],
      });
    },
    async deleteTableroConexion(id) {
      await client.execute({ sql: "DELETE FROM tablero_conexiones WHERE id = ?", args: [id] });
    },

    async getVentasPerdidasByFecha(fecha) {
      const res = await client.execute({ sql: "SELECT * FROM ventas_perdidas WHERE fecha = ? ORDER BY creadoEn ASC", args: [fecha] });
      return res.rows;
    },
    async insertVentaPerdida(row) {
      await client.execute({
        sql: `INSERT INTO ventas_perdidas (id, motivo, fecha, horaLabel, creadoEn) VALUES (?, ?, ?, ?, ?)`,
        args: [row.id, row.motivo, row.fecha, row.horaLabel, row.creadoEn],
      });
    },
    async deleteVentaPerdida(id) {
      await client.execute({ sql: "DELETE FROM ventas_perdidas WHERE id = ?", args: [id] });
    },

    async getAllClientesMayoristas() {
      const res = await client.execute("SELECT * FROM clientes_mayoristas ORDER BY nombre ASC");
      return res.rows;
    },
    async getClienteMayoristaPorNombre(nombreNormalizado) {
      const res = await client.execute({ sql: "SELECT * FROM clientes_mayoristas WHERE nombreNormalizado = ?", args: [nombreNormalizado] });
      return res.rows[0] || null;
    },
    async upsertClienteMayorista(row) {
      await client.execute({
        sql: `INSERT INTO clientes_mayoristas (id, nombreNormalizado, nombre, telefono, notas, creadoEn, actualizadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(nombreNormalizado) DO UPDATE SET
                nombre = excluded.nombre,
                telefono = COALESCE(NULLIF(excluded.telefono, ''), clientes_mayoristas.telefono),
                notas = COALESCE(excluded.notas, clientes_mayoristas.notas),
                actualizadoEn = excluded.actualizadoEn`,
        args: [row.id, row.nombreNormalizado, row.nombre, row.telefono || null, row.notas || null, row.creadoEn, row.actualizadoEn],
      });
    },

    async getAllBalanceManual() {
      const res = await client.execute("SELECT * FROM balance_manual ORDER BY fecha ASC");
      return res.rows;
    },
    async upsertBalanceManual(row) {
      await client.execute({
        sql: `INSERT INTO balance_manual
              (fecha, capitalTransferencia, capitalEfectivo, capitalEnProceso, deudas, inversionInicial, nota, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(fecha) DO UPDATE SET
                capitalTransferencia = excluded.capitalTransferencia,
                capitalEfectivo = excluded.capitalEfectivo,
                capitalEnProceso = excluded.capitalEnProceso,
                deudas = excluded.deudas,
                inversionInicial = excluded.inversionInicial,
                nota = excluded.nota`,
        args: [row.fecha, row.capitalTransferencia, row.capitalEfectivo, row.capitalEnProceso, row.deudas, row.inversionInicial, row.nota || null, row.creadoEn],
      });
    },
    async deleteBalanceManual(fecha) {
      await client.execute({ sql: "DELETE FROM balance_manual WHERE fecha = ?", args: [fecha] });
    },

    async insertItem(row) {
      await client.execute({
        sql: `INSERT INTO venta_items (id, ventaId, producto, precio) VALUES (?, ?, ?, ?)`,
        args: [row.id, row.ventaId, row.producto, row.precio],
      });
    },
    async getItemsByFecha(fecha) {
      const res = await client.execute({
        sql: `SELECT vi.* FROM venta_items vi
              JOIN ventas v ON v.id = vi.ventaId
              WHERE v.fecha = ?
              ORDER BY vi.id ASC`,
        args: [fecha],
      });
      return res.rows;
    },
    async deleteItemsByVentaId(ventaId) {
      await client.execute({ sql: "DELETE FROM venta_items WHERE ventaId = ?", args: [ventaId] });
    },
    async getItemsByVentaId(ventaId) {
      const res = await client.execute({ sql: "SELECT * FROM venta_items WHERE ventaId = ? ORDER BY id ASC", args: [ventaId] });
      return res.rows;
    },
    async getVentaById(id) {
      const res = await client.execute({ sql: "SELECT * FROM ventas WHERE id = ?", args: [id] });
      return res.rows[0] || null;
    },

    async getComprasByProducto(producto) {
      const res = await client.execute({
        sql: "SELECT * FROM compras_stock WHERE producto = ? ORDER BY fecha ASC, creadoEn ASC",
        args: [producto],
      });
      return res.rows;
    },
    async getAllCompras() {
      const res = await client.execute("SELECT * FROM compras_stock ORDER BY fecha DESC, creadoEn DESC");
      return res.rows;
    },
    async insertCompra(row) {
      await client.execute({
        sql: `INSERT INTO compras_stock
              (id, loteId, tipo, producto, cantidad, precioUnitario, costoTotal, stockAntes, stockDespues, proveedor, vencimiento, nota, fecha, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.loteId || null, row.tipo, row.producto, row.cantidad, row.precioUnitario, row.costoTotal, row.stockAntes, row.stockDespues, row.proveedor || null, row.vencimiento || null, row.nota || null, row.fecha, row.creadoEn],
      });
    },
    async deleteCompra(id) {
      await client.execute({ sql: "DELETE FROM compras_stock WHERE id = ?", args: [id] });
    },
    async getCompraById(id) {
      const res = await client.execute({ sql: "SELECT * FROM compras_stock WHERE id = ?", args: [id] });
      return res.rows[0] || null;
    },
    async updateFechaLote(loteId, fecha) {
      const res = await client.execute({ sql: "UPDATE compras_stock SET fecha = ? WHERE loteId = ?", args: [fecha, loteId] });
      return res.rowsAffected;
    },

    // Pagos recibidos (Mercado Pago + carga manual de Cuenta DNI).
    // El upsert pisa los datos que vienen de la API pero NO toca verificado/nota:
    // eso lo carga una persona y no lo puede borrar una re-sincronización.
    async upsertPago(row) {
      await client.execute({
        sql: `INSERT INTO pagos_recibidos
                (id, origen, externoId, monto, montoNeto, estado, metodo, descripcion, pagador,
                 referencia, fecha, horaLabel, fechaISO, verificado, verificadoPor, nota, creadoEn, actualizadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                monto = excluded.monto, montoNeto = excluded.montoNeto, estado = excluded.estado,
                metodo = excluded.metodo, descripcion = excluded.descripcion, pagador = excluded.pagador,
                referencia = excluded.referencia, fecha = excluded.fecha, horaLabel = excluded.horaLabel,
                fechaISO = excluded.fechaISO, actualizadoEn = excluded.actualizadoEn`,
        args: [row.id, row.origen, row.externoId || null, row.monto, row.montoNeto ?? null, row.estado,
               row.metodo || null, row.descripcion || null, row.pagador || null, row.referencia || null,
               row.fecha, row.horaLabel, row.fechaISO, row.verificado ? 1 : 0, row.verificadoPor || null,
               row.nota || null, row.creadoEn, row.actualizadoEn],
      });
    },
    async getPagosByFecha(fecha) {
      const res = await client.execute({
        sql: "SELECT * FROM pagos_recibidos WHERE fecha = ? ORDER BY fechaISO DESC",
        args: [fecha],
      });
      return res.rows;
    },
    async getPagoById(id) {
      const res = await client.execute({ sql: "SELECT * FROM pagos_recibidos WHERE id = ?", args: [id] });
      return res.rows[0] || null;
    },
    async marcarPagoVerificado(id, verificado, verificadoPor, nota, actualizadoEn) {
      const res = await client.execute({
        sql: `UPDATE pagos_recibidos SET verificado = ?, verificadoPor = ?, nota = ?, actualizadoEn = ? WHERE id = ?`,
        args: [verificado ? 1 : 0, verificadoPor || null, nota || null, actualizadoEn, id],
      });
      return res.rowsAffected;
    },
    async deletePago(id) {
      const res = await client.execute({ sql: "DELETE FROM pagos_recibidos WHERE id = ?", args: [id] });
      return res.rowsAffected;
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
      await migrarStock(async (sql) => db.exec(sql));
      await migrarLoteId(async (sql) => db.exec(sql));
      await migrarCliente(async (sql) => db.exec(sql));
    },
    async getByFecha(fecha) {
      return db.prepare("SELECT * FROM ventas WHERE fecha = ? ORDER BY creadoEn ASC").all(fecha);
    },
    async getAllVentas() {
      return db.prepare("SELECT * FROM ventas ORDER BY creadoEn ASC").all();
    },
    async getAllItems() {
      return db.prepare(`
        SELECT vi.*, v.fecha as fecha, v.horaLabel as horaLabel, v.metodo as metodo
        FROM venta_items vi JOIN ventas v ON v.id = vi.ventaId
        ORDER BY v.creadoEn ASC
      `).all();
    },
    async getAllGastos() {
      return db.prepare("SELECT * FROM gastos ORDER BY creadoEn ASC").all();
    },
    async insert(row) {
      db.prepare(
        `INSERT INTO ventas (id, producto, precio, metodo, fecha, hora, horaLabel, creadoEn, cliente)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.producto, row.precio, row.metodo, row.fecha, row.hora, row.horaLabel, row.creadoEn, row.cliente || null);
    },
    async deleteById(id) {
      db.prepare("DELETE FROM ventas WHERE id = ?").run(id);
    },
    async deleteByFecha(fecha) {
      db.prepare(
        "DELETE FROM venta_items WHERE ventaId IN (SELECT id FROM ventas WHERE fecha = ?)"
      ).run(fecha);
      db.prepare("DELETE FROM ventas WHERE fecha = ?").run(fecha);
    },

    async getCostos() {
      return db.prepare("SELECT * FROM costos ORDER BY producto ASC").all();
    },
    async upsertCosto(producto, costo) {
      db.prepare(
        `INSERT INTO costos (producto, costo) VALUES (?, ?)
         ON CONFLICT(producto) DO UPDATE SET costo = excluded.costo`
      ).run(producto, costo);
    },
    async deleteCosto(producto) {
      db.prepare("DELETE FROM costos WHERE producto = ?").run(producto);
    },
    async updateStock(producto, stock) {
      db.prepare("UPDATE costos SET stock = ? WHERE producto = ?").run(stock, producto);
    },
    async decrementStock(producto, cantidad) {
      db.prepare("UPDATE costos SET stock = MAX(0, stock - ?) WHERE producto = ?").run(cantidad, producto);
    },
    async incrementStock(producto, cantidad) {
      db.prepare("UPDATE costos SET stock = stock + ? WHERE producto = ?").run(cantidad, producto);
    },

    async getComposicion() {
      return db.prepare("SELECT * FROM producto_composicion ORDER BY comboProducto ASC").all();
    },
    async insertComponente(row) {
      db.prepare(
        `INSERT INTO producto_composicion (id, comboProducto, componenteProducto, cantidad) VALUES (?, ?, ?, ?)`
      ).run(row.id, row.comboProducto, row.componenteProducto, row.cantidad);
    },
    async deleteComponente(id) {
      db.prepare("DELETE FROM producto_composicion WHERE id = ?").run(id);
    },

    async getGastosByFecha(fecha) {
      return db.prepare("SELECT * FROM gastos WHERE fecha = ? ORDER BY creadoEn ASC").all(fecha);
    },
    async insertGasto(row) {
      db.prepare(
        `INSERT INTO gastos (id, concepto, monto, fecha, horaLabel, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.concepto, row.monto, row.fecha, row.horaLabel, row.creadoEn);
    },
    async deleteGasto(id) {
      db.prepare("DELETE FROM gastos WHERE id = ?").run(id);
    },

    async getAllGastosFijos() {
      return db.prepare("SELECT * FROM gastos_fijos ORDER BY creadoEn ASC").all();
    },
    async insertGastoFijo(row) {
      db.prepare(
        `INSERT INTO gastos_fijos (id, concepto, monto, creadoEn) VALUES (?, ?, ?, ?)`
      ).run(row.id, row.concepto, row.monto, row.creadoEn);
    },
    async deleteGastoFijo(id) {
      db.prepare("DELETE FROM gastos_fijos WHERE id = ?").run(id);
    },

    async getAllAnuncios() {
      return db.prepare("SELECT * FROM anuncios ORDER BY fechaInicio DESC, creadoEn DESC").all();
    },
    async insertAnuncio(row) {
      db.prepare(
        `INSERT INTO anuncios (id, nombre, producto, fechaInicio, fechaFin, montoInvertido, notas, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.nombre, row.producto, row.fechaInicio, row.fechaFin, row.montoInvertido, row.notas, row.creadoEn);
    },
    async deleteAnuncio(id) {
      db.prepare("DELETE FROM anuncios WHERE id = ?").run(id);
    },

    async getAllSalario() {
      return db.prepare("SELECT * FROM salario ORDER BY fecha ASC, creadoEn ASC").all();
    },
    async insertSalario(row) {
      db.prepare(
        `INSERT INTO salario (id, fecha, sueldo, comision, nota, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.fecha, row.sueldo, row.comision, row.nota || null, row.creadoEn);
    },
    async deleteSalario(id) {
      db.prepare("DELETE FROM salario WHERE id = ?").run(id);
    },

    async getAllTableroTareas() {
      return db.prepare("SELECT * FROM tablero_tareas ORDER BY creadoEn ASC").all();
    },
    async insertTableroTarea(row) {
      db.prepare(`INSERT INTO tablero_tareas (id, texto, hecho, fecha, hora, notas, duracionMin, boardX, boardY, creadoEn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.texto, row.hecho ? 1 : 0, row.fecha || null, row.hora || null, row.notas || null, row.duracionMin || null, row.boardX ?? null, row.boardY ?? null, row.creadoEn);
    },
    async updateTableroTarea(id, fields) {
      const sets = [];
      const args = [];
      if (fields.texto !== undefined) { sets.push("texto = ?"); args.push(fields.texto); }
      if (fields.hecho !== undefined) { sets.push("hecho = ?"); args.push(fields.hecho ? 1 : 0); }
      if (fields.fecha !== undefined) { sets.push("fecha = ?"); args.push(fields.fecha); }
      if (fields.hora !== undefined) { sets.push("hora = ?"); args.push(fields.hora); }
      if (fields.notas !== undefined) { sets.push("notas = ?"); args.push(fields.notas); }
      if (fields.duracionMin !== undefined) { sets.push("duracionMin = ?"); args.push(fields.duracionMin); }
      if (fields.boardX !== undefined) { sets.push("boardX = ?"); args.push(fields.boardX); }
      if (fields.boardY !== undefined) { sets.push("boardY = ?"); args.push(fields.boardY); }
      if (!sets.length) return;
      args.push(id);
      db.prepare(`UPDATE tablero_tareas SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    },
    async deleteTableroTarea(id) {
      db.prepare("DELETE FROM tablero_tareas WHERE id = ?").run(id);
      db.prepare("DELETE FROM tablero_conexiones WHERE desdeId = ? OR haciaId = ?").run(id, id);
    },

    async getAllTableroConexiones() {
      return db.prepare("SELECT * FROM tablero_conexiones ORDER BY creadoEn ASC").all();
    },
    async insertTableroConexion(row) {
      db.prepare(`INSERT INTO tablero_conexiones (id, desdeId, haciaId, creadoEn) VALUES (?, ?, ?, ?)`)
        .run(row.id, row.desdeId, row.haciaId, row.creadoEn);
    },
    async deleteTableroConexion(id) {
      db.prepare("DELETE FROM tablero_conexiones WHERE id = ?").run(id);
    },

    async getVentasPerdidasByFecha(fecha) {
      return db.prepare("SELECT * FROM ventas_perdidas WHERE fecha = ? ORDER BY creadoEn ASC").all(fecha);
    },
    async insertVentaPerdida(row) {
      db.prepare(
        `INSERT INTO ventas_perdidas (id, motivo, fecha, horaLabel, creadoEn) VALUES (?, ?, ?, ?, ?)`
      ).run(row.id, row.motivo, row.fecha, row.horaLabel, row.creadoEn);
    },
    async deleteVentaPerdida(id) {
      db.prepare("DELETE FROM ventas_perdidas WHERE id = ?").run(id);
    },

    async getAllClientesMayoristas() {
      return db.prepare("SELECT * FROM clientes_mayoristas ORDER BY nombre ASC").all();
    },
    async getClienteMayoristaPorNombre(nombreNormalizado) {
      return db.prepare("SELECT * FROM clientes_mayoristas WHERE nombreNormalizado = ?").get(nombreNormalizado) || null;
    },
    async upsertClienteMayorista(row) {
      db.prepare(
        `INSERT INTO clientes_mayoristas (id, nombreNormalizado, nombre, telefono, notas, creadoEn, actualizadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(nombreNormalizado) DO UPDATE SET
           nombre = excluded.nombre,
           telefono = COALESCE(NULLIF(excluded.telefono, ''), clientes_mayoristas.telefono),
           notas = COALESCE(excluded.notas, clientes_mayoristas.notas),
           actualizadoEn = excluded.actualizadoEn`
      ).run(row.id, row.nombreNormalizado, row.nombre, row.telefono || null, row.notas || null, row.creadoEn, row.actualizadoEn);
    },

    async getAllBalanceManual() {
      return db.prepare("SELECT * FROM balance_manual ORDER BY fecha ASC").all();
    },
    async upsertBalanceManual(row) {
      db.prepare(
        `INSERT INTO balance_manual
         (fecha, capitalTransferencia, capitalEfectivo, capitalEnProceso, deudas, inversionInicial, nota, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fecha) DO UPDATE SET
           capitalTransferencia = excluded.capitalTransferencia,
           capitalEfectivo = excluded.capitalEfectivo,
           capitalEnProceso = excluded.capitalEnProceso,
           deudas = excluded.deudas,
           inversionInicial = excluded.inversionInicial,
           nota = excluded.nota`
      ).run(row.fecha, row.capitalTransferencia, row.capitalEfectivo, row.capitalEnProceso, row.deudas, row.inversionInicial, row.nota || null, row.creadoEn);
    },
    async deleteBalanceManual(fecha) {
      db.prepare("DELETE FROM balance_manual WHERE fecha = ?").run(fecha);
    },

    async insertItem(row) {
      db.prepare(
        `INSERT INTO venta_items (id, ventaId, producto, precio) VALUES (?, ?, ?, ?)`
      ).run(row.id, row.ventaId, row.producto, row.precio);
    },
    async getItemsByFecha(fecha) {
      return db.prepare(
        `SELECT vi.* FROM venta_items vi
         JOIN ventas v ON v.id = vi.ventaId
         WHERE v.fecha = ?
         ORDER BY vi.id ASC`
      ).all(fecha);
    },
    async deleteItemsByVentaId(ventaId) {
      db.prepare("DELETE FROM venta_items WHERE ventaId = ?").run(ventaId);
    },
    async getItemsByVentaId(ventaId) {
      return db.prepare("SELECT * FROM venta_items WHERE ventaId = ? ORDER BY id ASC").all(ventaId);
    },
    async getVentaById(id) {
      return db.prepare("SELECT * FROM ventas WHERE id = ?").get(id) || null;
    },

    async getComprasByProducto(producto) {
      return db.prepare("SELECT * FROM compras_stock WHERE producto = ? ORDER BY fecha ASC, creadoEn ASC").all(producto);
    },
    async getAllCompras() {
      return db.prepare("SELECT * FROM compras_stock ORDER BY fecha DESC, creadoEn DESC").all();
    },
    async insertCompra(row) {
      db.prepare(
        `INSERT INTO compras_stock
         (id, loteId, tipo, producto, cantidad, precioUnitario, costoTotal, stockAntes, stockDespues, proveedor, vencimiento, nota, fecha, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.loteId || null, row.tipo, row.producto, row.cantidad, row.precioUnitario, row.costoTotal, row.stockAntes, row.stockDespues, row.proveedor || null, row.vencimiento || null, row.nota || null, row.fecha, row.creadoEn);
    },
    async deleteCompra(id) {
      db.prepare("DELETE FROM compras_stock WHERE id = ?").run(id);
    },
    async getCompraById(id) {
      return db.prepare("SELECT * FROM compras_stock WHERE id = ?").get(id) || null;
    },
    async updateFechaLote(loteId, fecha) {
      const info = db.prepare("UPDATE compras_stock SET fecha = ? WHERE loteId = ?").run(fecha, loteId);
      return info.changes;
    },

    // Pagos recibidos (Mercado Pago + carga manual de Cuenta DNI).
    // El upsert pisa los datos que vienen de la API pero NO toca verificado/nota:
    // eso lo carga una persona y no lo puede borrar una re-sincronización.
    async upsertPago(row) {
      db.prepare(
        `INSERT INTO pagos_recibidos
           (id, origen, externoId, monto, montoNeto, estado, metodo, descripcion, pagador,
            referencia, fecha, horaLabel, fechaISO, verificado, verificadoPor, nota, creadoEn, actualizadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           monto = excluded.monto, montoNeto = excluded.montoNeto, estado = excluded.estado,
           metodo = excluded.metodo, descripcion = excluded.descripcion, pagador = excluded.pagador,
           referencia = excluded.referencia, fecha = excluded.fecha, horaLabel = excluded.horaLabel,
           fechaISO = excluded.fechaISO, actualizadoEn = excluded.actualizadoEn`
      ).run(row.id, row.origen, row.externoId || null, row.monto, row.montoNeto ?? null, row.estado,
            row.metodo || null, row.descripcion || null, row.pagador || null, row.referencia || null,
            row.fecha, row.horaLabel, row.fechaISO, row.verificado ? 1 : 0, row.verificadoPor || null,
            row.nota || null, row.creadoEn, row.actualizadoEn);
    },
    async getPagosByFecha(fecha) {
      return db.prepare("SELECT * FROM pagos_recibidos WHERE fecha = ? ORDER BY fechaISO DESC").all(fecha);
    },
    async getPagoById(id) {
      return db.prepare("SELECT * FROM pagos_recibidos WHERE id = ?").get(id) || null;
    },
    async marcarPagoVerificado(id, verificado, verificadoPor, nota, actualizadoEn) {
      const info = db.prepare(
        "UPDATE pagos_recibidos SET verificado = ?, verificadoPor = ?, nota = ?, actualizadoEn = ? WHERE id = ?"
      ).run(verificado ? 1 : 0, verificadoPor || null, nota || null, actualizadoEn, id);
      return info.changes;
    },
    async deletePago(id) {
      const info = db.prepare("DELETE FROM pagos_recibidos WHERE id = ?").run(id);
      return info.changes;
    },
  };
}

module.exports = { ...impl, usingTurso: USE_TURSO };
