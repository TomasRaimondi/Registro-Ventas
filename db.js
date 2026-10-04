const path = require("node:path");
const crypto = require("node:crypto");

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
  CREATE TABLE IF NOT EXISTS costos_historial (
    producto TEXT NOT NULL,
    vigenteDesde TEXT NOT NULL,
    costo REAL NOT NULL,
    creadoEn TEXT NOT NULL,
    PRIMARY KEY (producto, vigenteDesde)
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
  CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    nombreNormalizado TEXT NOT NULL UNIQUE,
    marca TEXT,
    categoria TEXT,
    subcategoria TEXT,
    variante TEXT,
    sabor TEXT,
    tamano TEXT,
    sku TEXT,
    codigoBarra TEXT,
    proveedorId TEXT,
    stockMinimo INTEGER,
    stockIdeal INTEGER,
    precioMinoristaActual REAL,
    precioMayoristaActual REAL,
    imagenUrl TEXT,
    estado TEXT NOT NULL DEFAULT 'activo',
    notas TEXT,
    creadoEn TEXT NOT NULL,
    actualizadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS proveedores (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    nombreNormalizado TEXT NOT NULL UNIQUE,
    telefono TEXT,
    email TEXT,
    notas TEXT,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS precios_historial (
    id TEXT PRIMARY KEY,
    productoId TEXT NOT NULL,
    tipo TEXT NOT NULL,
    precio REAL NOT NULL,
    vigenteDesde TEXT NOT NULL,
    creadoEn TEXT NOT NULL
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
  CREATE TABLE IF NOT EXISTS seguimientos (
    id TEXT PRIMARY KEY,
    orden TEXT NOT NULL,
    cliente TEXT,
    telefono TEXT,
    estado TEXT NOT NULL,
    hitos TEXT,
    etaISO TEXT,
    salidaISO TEXT,
    uberUrl TEXT,
    creadoEn TEXT NOT NULL,
    actualizadoEn TEXT NOT NULL
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
  CREATE TABLE IF NOT EXISTS comisiones_minoristas (
    id TEXT PRIMARY KEY,
    ventaId TEXT NOT NULL,
    vendedor TEXT NOT NULL,
    montoVenta REAL NOT NULL,
    excedente REAL NOT NULL,
    comision REAL NOT NULL,
    fecha TEXT NOT NULL,
    hora INTEGER NOT NULL,
    horaLabel TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bonos_mayoristas (
    id TEXT PRIMARY KEY,
    ventaId TEXT NOT NULL,
    vendedor TEXT NOT NULL,
    gananciaNeta REAL NOT NULL,
    bono REAL NOT NULL,
    fecha TEXT NOT NULL,
    hora INTEGER NOT NULL,
    horaLabel TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendario_contenido (
    id TEXT PRIMARY KEY,
    fecha TEXT,
    tipo TEXT NOT NULL,
    tema TEXT NOT NULL,
    estado TEXT NOT NULL,
    notas TEXT,
    creadoEn TEXT NOT NULL,
    actualizadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS costos_fijos (
    id TEXT PRIMARY KEY,
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    notas TEXT,
    creadoEn TEXT NOT NULL,
    actualizadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inversiones_activos (
    id TEXT PRIMARY KEY,
    simbolo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL,
    tipoFuente TEXT NOT NULL,
    fuenteId TEXT,
    precioManual REAL,
    actualizadoManualEn TEXT,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inversiones_portafolio (
    id TEXT PRIMARY KEY,
    activoId TEXT NOT NULL,
    cantidad REAL NOT NULL,
    precioCompra REAL NOT NULL,
    fecha TEXT NOT NULL,
    nota TEXT,
    creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inversiones_notas (
    id TEXT PRIMARY KEY,
    fecha TEXT NOT NULL,
    activoId TEXT,
    texto TEXT NOT NULL,
    creadoEn TEXT NOT NULL
  );
`;

// Semilla inicial de activos seguidos (cripto, acciones, IA, energía para IA). Se
// inserta una sola vez, solo si la tabla está vacía (no pisa lo que el usuario haya
// agregado o borrado después).
const INVERSIONES_ACTIVOS_SEED = [
  { simbolo: "BTC", nombre: "Bitcoin", categoria: "cripto", tipoFuente: "coinbase", fuenteId: "BTC-USD" },
  { simbolo: "SOL", nombre: "Solana", categoria: "cripto", tipoFuente: "coinbase", fuenteId: "SOL-USD" },
  { simbolo: "XRP", nombre: "XRP", categoria: "cripto", tipoFuente: "coinbase", fuenteId: "XRP-USD" },
  { simbolo: "YPF", nombre: "YPF S.A.", categoria: "accion", tipoFuente: "yahoo", fuenteId: "YPF" },
  { simbolo: "AAPL", nombre: "Apple Inc.", categoria: "accion", tipoFuente: "yahoo", fuenteId: "AAPL" },
  { simbolo: "TSLA", nombre: "Tesla Inc.", categoria: "accion", tipoFuente: "yahoo", fuenteId: "TSLA" },
  { simbolo: "NVDA", nombre: "NVIDIA Corp.", categoria: "ia", tipoFuente: "yahoo", fuenteId: "NVDA" },
  { simbolo: "MSFT", nombre: "Microsoft Corp.", categoria: "ia", tipoFuente: "yahoo", fuenteId: "MSFT" },
  { simbolo: "GOOGL", nombre: "Alphabet Inc.", categoria: "ia", tipoFuente: "yahoo", fuenteId: "GOOGL" },
  { simbolo: "CEG", nombre: "Constellation Energy", categoria: "energia-ia", tipoFuente: "yahoo", fuenteId: "CEG" },
  { simbolo: "VST", nombre: "Vistra Corp.", categoria: "energia-ia", tipoFuente: "yahoo", fuenteId: "VST" },
  { simbolo: "NEE", nombre: "NextEra Energy", categoria: "energia-ia", tipoFuente: "yahoo", fuenteId: "NEE" },
];

async function sembrarInversionesActivos(getAllFn, insertFn) {
  try {
    const existentes = await getAllFn();
    if (existentes.length > 0) return;
    const ahora = new Date().toISOString();
    for (const a of INVERSIONES_ACTIVOS_SEED) {
      await insertFn({
        id: crypto.randomUUID(),
        simbolo: a.simbolo,
        nombre: a.nombre,
        categoria: a.categoria,
        tipoFuente: a.tipoFuente,
        fuenteId: a.fuenteId,
        precioManual: null,
        actualizadoManualEn: null,
        creadoEn: ahora,
      });
    }
  } catch (e) {
    console.error("Error sembrando activos de inversiones:", e);
  }
}

function normalizarNombreProducto(s) {
  return (s || "").toString().trim().toLowerCase();
}

// Crea una fila en "productos" para cada producto de "costos" que todavía no la tenga,
// así el módulo de Inventario arranca con todo lo que ya existe en el sistema en vez de
// con una lista vacía. Los combos quedan afuera (no tienen stock propio). Es idempotente:
// se fija por nombreNormalizado antes de insertar, así que correr esto en cada arranque
// no duplica nada, y un producto nuevo cargado desde cualquier pantalla vieja (Pedidos
// Mayoristas, Compras de Stock) aparece solo la próxima vez que arranca el servidor.
async function backfillProductosDesdeCostos(getCostosFn, getComposicionFn, getProductosFn, insertProductoFn) {
  try {
    const [costos, composicion, productosExistentes] = await Promise.all([getCostosFn(), getComposicionFn(), getProductosFn()]);
    const combos = new Set(composicion.map((c) => normalizarNombreProducto(c.comboProducto)));
    const yaExisten = new Set(productosExistentes.map((p) => p.nombreNormalizado));
    const ahora = new Date().toISOString();
    for (const c of costos) {
      const nombreNormalizado = normalizarNombreProducto(c.producto);
      if (!nombreNormalizado || combos.has(nombreNormalizado) || yaExisten.has(nombreNormalizado)) continue;
      try {
        await insertProductoFn({
          id: crypto.randomUUID(),
          nombre: c.producto,
          nombreNormalizado,
          marca: null, categoria: null, subcategoria: null, variante: null, sabor: null, tamano: null,
          sku: null, codigoBarra: null, proveedorId: null,
          stockMinimo: null, stockIdeal: null,
          precioMinoristaActual: null, precioMayoristaActual: null,
          imagenUrl: null, estado: "activo", notas: null,
          creadoEn: ahora, actualizadoEn: ahora,
        });
        yaExisten.add(nombreNormalizado); // por si "costos" tiene dos filas que normalizan igual
      } catch (e) {
        // Choque de UNIQUE (ya lo insertó otra fila que normaliza igual) u otro error puntual:
        // se saltea esa fila y se sigue con el resto, no se corta el arranque del servidor.
        console.error(`No se pudo crear "productos" para "${c.producto}":`, e.message);
      }
    }
  } catch (e) {
    console.error("Error en backfillProductosDesdeCostos:", e);
  }
}

// Se probaron CoinGecko (bloquea IPs de hosting compartido) y Binance (devuelve 451,
// bloqueado por region para IPs de EE.UU. como las de Render) antes de asentarse en
// Coinbase, que sí responde bien desde ahí. Esto corrige las filas que ya se habían
// sembrado con alguna fuente vieja, para no dejarlas sin precio.
const INVERSIONES_FUENTE_VIEJA_A_COINBASE = {
  coingecko: { bitcoin: "BTC-USD", solana: "SOL-USD", ripple: "XRP-USD" },
  binance: { BTCUSDT: "BTC-USD", SOLUSDT: "SOL-USD", XRPUSDT: "XRP-USD" },
};

async function migrarInversionesCoinGeckoABinance(getAllFn, updateFuenteFn) {
  try {
    const existentes = await getAllFn();
    for (const a of existentes) {
      const mapa = INVERSIONES_FUENTE_VIEJA_A_COINBASE[a.tipoFuente];
      if (mapa && mapa[a.fuenteId]) {
        await updateFuenteFn(a.id, "coinbase", mapa[a.fuenteId]);
      }
    }
  } catch (e) {
    console.error("Error migrando activos a Coinbase:", e);
  }
}

// Migración aditiva: agrega la columna "stock" a costos si todavía no existe
// (las instalaciones viejas no la tienen; ALTER TABLE falla si ya está, por eso el try/catch).
async function migrarStock(execFn) {
  try {
    await execFn("ALTER TABLE costos ADD COLUMN stock INTEGER DEFAULT 0");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: separa el stock en "local" (la columna "stock" de siempre, que hasta
// ahora representaba todo lo que había) y "depósito" (nueva columna, arranca en 0 porque
// antes no se trackeaba nada ahí — todo lo cargado hasta hoy estaba físicamente en el local).
async function migrarStockDeposito(execFn) {
  try {
    await execFn("ALTER TABLE costos ADD COLUMN stockDeposito INTEGER DEFAULT 0");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: la tabla "balance_manual" ya existía (de la vieja Situación
// Financiera, borrada) pero con otras columnas (capital en un solo monto, deudas sin
// separar a favor/en contra, sin valor de stock). Se agregan las columnas que necesita
// el balance nuevo; las columnas viejas quedan sin usar (no hay filas viejas que migrar,
// se vaciaron antes de rehacer esta pantalla).
async function migrarBalanceCamposNuevos(execFn) {
  const columnas = [
    "ALTER TABLE balance_manual ADD COLUMN capitalCuenta1 REAL DEFAULT 0",
    "ALTER TABLE balance_manual ADD COLUMN capitalCuenta2 REAL DEFAULT 0",
    "ALTER TABLE balance_manual ADD COLUMN deudasPagar REAL DEFAULT 0",
    "ALTER TABLE balance_manual ADD COLUMN deudasCobrar REAL DEFAULT 0",
    "ALTER TABLE balance_manual ADD COLUMN valorStock REAL DEFAULT 0",
    "ALTER TABLE balance_manual ADD COLUMN patrimonioNeto REAL DEFAULT 0",
  ];
  for (const sql of columnas) {
    try {
      await execFn(sql);
    } catch (e) {
      // La columna ya existe: no hacer nada.
    }
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

// Migración aditiva: agrega el envío (por ahora solo "uber_moto") y su costo a ventas,
// para poder medir cuántos envíos a domicilio se hacen por día y descontar ese costo
// del monto neto de la venta, igual que se hace con la comisión de Cuenta DNI.
async function migrarEnvio(execFn) {
  try {
    await execFn("ALTER TABLE ventas ADD COLUMN envioMetodo TEXT");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
  try {
    await execFn("ALTER TABLE ventas ADD COLUMN envioCosto REAL");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: agrega quién registró la venta ("tomas" | "chino"), para poder
// calcular la comisión minorista del empleado sobre lo que él mismo carga.
async function migrarVendedor(execFn) {
  try {
    await execFn("ALTER TABLE ventas ADD COLUMN vendedor TEXT");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: permite sobreescribir a mano, por día, el Bono Minorista que
// normalmente se calcula solo (suma de comisiones_minoristas de ese día). Si es
// NULL, se sigue usando el valor calculado; si tiene un número, ese pisa al cálculo.
async function migrarBonoMinoristaManual(execFn) {
  try {
    await execFn("ALTER TABLE salario ADD COLUMN bonoMinoristaManual REAL");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Migración aditiva: igual que bonoMinoristaManual, pero para el Bono Mayorista
// automático (20% de la ganancia neta en ventas mayoristas de Chino). Si es NULL,
// se sigue usando el total calculado ese día; si tiene un número, ese pisa al cálculo.
async function migrarBonoMayoristaAutoManual(execFn) {
  try {
    await execFn("ALTER TABLE salario ADD COLUMN bonoMayoristaAutoManual REAL");
  } catch (e) {
    // La columna ya existe: no hacer nada.
  }
}

// Guarda el mes (YYYY-MM) en el que se marcó como pagado un costo fijo. Al llegar un
// mes nuevo, ese valor ya no coincide con "el mes actual" y el check se ve destildado
// solo, sin necesidad de ningún proceso que lo resetee.
async function migrarCostosFijosPago(execFn) {
  try {
    await execFn("ALTER TABLE costos_fijos ADD COLUMN pagadoMes TEXT");
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
      await migrarStockDeposito((sql) => client.execute(sql));
      await migrarBalanceCamposNuevos((sql) => client.execute(sql));
      await migrarLoteId((sql) => client.execute(sql));
      await migrarCliente((sql) => client.execute(sql));
      await migrarEnvio((sql) => client.execute(sql));
      await migrarVendedor((sql) => client.execute(sql));
      await migrarBonoMinoristaManual((sql) => client.execute(sql));
      await migrarBonoMayoristaAutoManual((sql) => client.execute(sql));
      await migrarCostosFijosPago((sql) => client.execute(sql));
      await backfillProductosDesdeCostos(() => impl.getCostos(), () => impl.getComposicion(), () => impl.getProductos(), (row) => impl.insertProducto(row));
      await sembrarInversionesActivos(() => impl.getAllInversionesActivos(), (row) => impl.insertInversionActivo(row));
      await migrarInversionesCoinGeckoABinance(() => impl.getAllInversionesActivos(), (id, tf, fid) => impl.updateInversionActivoFuente(id, tf, fid));
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
        SELECT vi.*, v.fecha as fecha, v.horaLabel as horaLabel, v.metodo as metodo, v.envioMetodo as envioMetodo
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
        sql: `INSERT INTO ventas (id, producto, precio, metodo, fecha, hora, horaLabel, creadoEn, cliente, envioMetodo, envioCosto, vendedor)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.producto, row.precio, row.metodo, row.fecha, row.hora, row.horaLabel, row.creadoEn, row.cliente || null, row.envioMetodo || null, row.envioCosto ?? null, row.vendedor || null],
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

    // Historial de costos: para que la ganancia de una venta vieja se calcule con el
    // costo que el producto tenía en ese momento, no con el costo actual.
    async getCostosHistorial() {
      const res = await client.execute("SELECT * FROM costos_historial ORDER BY producto ASC, vigenteDesde ASC");
      return res.rows;
    },
    async upsertCostoHistorial(row) {
      await client.execute({
        sql: `INSERT INTO costos_historial (producto, vigenteDesde, costo, creadoEn) VALUES (?, ?, ?, ?)
              ON CONFLICT(producto, vigenteDesde) DO UPDATE SET costo = excluded.costo`,
        args: [row.producto, row.vigenteDesde, row.costo, row.creadoEn],
      });
    },
    async updateStock(producto, stock) {
      await client.execute({ sql: "UPDATE costos SET stock = ? WHERE producto = ?", args: [stock, producto] });
    },
    async updateStockDeposito(producto, stockDeposito) {
      await client.execute({ sql: "UPDATE costos SET stockDeposito = ? WHERE producto = ?", args: [stockDeposito, producto] });
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

    // ---------- Inventario: productos enriquecidos, proveedores, historial de precio de lista ----------
    async getProductos() {
      const res = await client.execute("SELECT * FROM productos ORDER BY nombre ASC");
      return res.rows;
    },
    async getProductoById(id) {
      const res = await client.execute({ sql: "SELECT * FROM productos WHERE id = ?", args: [id] });
      return res.rows[0] || null;
    },
    async getProductoByNombreNormalizado(nombreNormalizado) {
      const res = await client.execute({ sql: "SELECT * FROM productos WHERE nombreNormalizado = ?", args: [nombreNormalizado] });
      return res.rows[0] || null;
    },
    async insertProducto(row) {
      await client.execute({
        sql: `INSERT INTO productos (id, nombre, nombreNormalizado, marca, categoria, subcategoria, variante, sabor, tamano, sku, codigoBarra, proveedorId, stockMinimo, stockIdeal, precioMinoristaActual, precioMayoristaActual, imagenUrl, estado, notas, creadoEn, actualizadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.nombre, row.nombreNormalizado, row.marca, row.categoria, row.subcategoria, row.variante, row.sabor, row.tamano, row.sku, row.codigoBarra, row.proveedorId, row.stockMinimo, row.stockIdeal, row.precioMinoristaActual, row.precioMayoristaActual, row.imagenUrl, row.estado, row.notas, row.creadoEn, row.actualizadoEn],
      });
    },
    async updateProducto(id, campos) {
      const permitidos = ["nombre", "nombreNormalizado", "marca", "categoria", "subcategoria", "variante", "sabor", "tamano", "sku", "codigoBarra", "proveedorId", "stockMinimo", "stockIdeal", "precioMinoristaActual", "precioMayoristaActual", "imagenUrl", "estado", "notas"];
      const sets = [];
      const args = [];
      for (const campo of permitidos) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      sets.push("actualizadoEn = ?");
      args.push(campos.actualizadoEn);
      args.push(id);
      await client.execute({ sql: `UPDATE productos SET ${sets.join(", ")} WHERE id = ?`, args });
    },
    async deleteProducto(id) {
      await client.execute({ sql: "DELETE FROM productos WHERE id = ?", args: [id] });
    },

    async getProveedores() {
      const res = await client.execute("SELECT * FROM proveedores ORDER BY nombre ASC");
      return res.rows;
    },
    async getProveedorByNombreNormalizado(nombreNormalizado) {
      const res = await client.execute({ sql: "SELECT * FROM proveedores WHERE nombreNormalizado = ?", args: [nombreNormalizado] });
      return res.rows[0] || null;
    },
    async insertProveedor(row) {
      await client.execute({
        sql: `INSERT INTO proveedores (id, nombre, nombreNormalizado, telefono, email, notas, creadoEn) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.nombre, row.nombreNormalizado, row.telefono, row.email, row.notas, row.creadoEn],
      });
    },
    async updateProveedor(id, campos) {
      const permitidos = ["nombre", "nombreNormalizado", "telefono", "email", "notas"];
      const sets = [];
      const args = [];
      for (const campo of permitidos) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      args.push(id);
      await client.execute({ sql: `UPDATE proveedores SET ${sets.join(", ")} WHERE id = ?`, args });
    },

    async getPreciosHistorial(productoId) {
      const res = await client.execute({ sql: "SELECT * FROM precios_historial WHERE productoId = ? ORDER BY tipo ASC, vigenteDesde ASC", args: [productoId] });
      return res.rows;
    },
    async upsertPrecioHistorial(row) {
      await client.execute({
        sql: `INSERT INTO precios_historial (id, productoId, tipo, precio, vigenteDesde, creadoEn) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.productoId, row.tipo, row.precio, row.vigenteDesde, row.creadoEn],
      });
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

    async getAllCostosFijos() {
      const res = await client.execute("SELECT * FROM costos_fijos ORDER BY concepto ASC");
      return res.rows;
    },
    async insertCostoFijo(row) {
      await client.execute({
        sql: `INSERT INTO costos_fijos (id, concepto, monto, notas, creadoEn, actualizadoEn) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.concepto, row.monto, row.notas, row.creadoEn, row.actualizadoEn],
      });
    },
    async updateCostoFijo(id, campos) {
      const sets = [];
      const args = [];
      for (const campo of ["concepto", "monto", "notas", "pagadoMes"]) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      sets.push("actualizadoEn = ?");
      args.push(campos.actualizadoEn);
      args.push(id);
      await client.execute({ sql: `UPDATE costos_fijos SET ${sets.join(", ")} WHERE id = ?`, args });
    },
    async deleteCostoFijo(id) {
      await client.execute({ sql: "DELETE FROM costos_fijos WHERE id = ?", args: [id] });
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
    async updateSalario(id, campos) {
      const sets = [];
      const args = [];
      for (const campo of ["sueldo", "comision", "bonoMinoristaManual", "bonoMayoristaAutoManual"]) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      args.push(id);
      await client.execute({ sql: `UPDATE salario SET ${sets.join(", ")} WHERE id = ?`, args });
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
    async getAllVentasPerdidas() {
      const res = await client.execute("SELECT * FROM ventas_perdidas ORDER BY fecha ASC, creadoEn ASC");
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

    async getSeguimientosRecientes(desdeISO) {
      const res = await client.execute({ sql: "SELECT * FROM seguimientos WHERE creadoEn >= ? ORDER BY creadoEn DESC", args: [desdeISO] });
      return res.rows;
    },
    async getSeguimiento(id) {
      const res = await client.execute({ sql: "SELECT * FROM seguimientos WHERE id = ?", args: [id] });
      return res.rows[0] || null;
    },
    async getSeguimientoPorOrden(orden) {
      const res = await client.execute({ sql: "SELECT * FROM seguimientos WHERE orden = ? ORDER BY creadoEn DESC LIMIT 1", args: [orden] });
      return res.rows[0] || null;
    },
    async insertSeguimiento(row) {
      await client.execute({
        sql: `INSERT INTO seguimientos (id, orden, cliente, telefono, estado, hitos, etaISO, salidaISO, uberUrl, creadoEn, actualizadoEn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.orden, row.cliente, row.telefono, row.estado, row.hitos, row.etaISO, row.salidaISO, row.uberUrl, row.creadoEn, row.actualizadoEn],
      });
    },
    async updateSeguimiento(row) {
      await client.execute({
        sql: `UPDATE seguimientos SET cliente = ?, telefono = ?, estado = ?, hitos = ?, etaISO = ?, salidaISO = ?, uberUrl = ?, actualizadoEn = ? WHERE id = ?`,
        args: [row.cliente, row.telefono, row.estado, row.hitos, row.etaISO, row.salidaISO, row.uberUrl, row.actualizadoEn, row.id],
      });
    },
    async deleteSeguimiento(id) {
      await client.execute({ sql: "DELETE FROM seguimientos WHERE id = ?", args: [id] });
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
              (fecha, capitalCuenta1, capitalCuenta2, capitalEfectivo, deudasPagar, deudasCobrar, inversionInicial, valorStock, patrimonioNeto, nota, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(fecha) DO UPDATE SET
                capitalCuenta1 = excluded.capitalCuenta1,
                capitalCuenta2 = excluded.capitalCuenta2,
                capitalEfectivo = excluded.capitalEfectivo,
                deudasPagar = excluded.deudasPagar,
                deudasCobrar = excluded.deudasCobrar,
                inversionInicial = excluded.inversionInicial,
                valorStock = excluded.valorStock,
                patrimonioNeto = excluded.patrimonioNeto,
                nota = excluded.nota`,
        args: [row.fecha, row.capitalCuenta1, row.capitalCuenta2, row.capitalEfectivo, row.deudasPagar, row.deudasCobrar, row.inversionInicial, row.valorStock, row.patrimonioNeto, row.nota || null, row.creadoEn],
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

    // Comisión minorista del empleado (5% del excedente sobre $45.000 por venta).
    async insertComisionMinorista(row) {
      await client.execute({
        sql: `INSERT INTO comisiones_minoristas (id, ventaId, vendedor, montoVenta, excedente, comision, fecha, hora, horaLabel, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.ventaId, row.vendedor, row.montoVenta, row.excedente, row.comision, row.fecha, row.hora, row.horaLabel, row.creadoEn],
      });
    },
    async getAllComisionesMinoristas() {
      const res = await client.execute("SELECT * FROM comisiones_minoristas ORDER BY creadoEn ASC");
      return res.rows;
    },
    async deleteComisionesByVentaId(ventaId) {
      await client.execute({ sql: "DELETE FROM comisiones_minoristas WHERE ventaId = ?", args: [ventaId] });
    },

    // Bono mayorista del empleado (20% de la ganancia neta de la venta mayorista).
    async insertBonoMayorista(row) {
      await client.execute({
        sql: `INSERT INTO bonos_mayoristas (id, ventaId, vendedor, gananciaNeta, bono, fecha, hora, horaLabel, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.ventaId, row.vendedor, row.gananciaNeta, row.bono, row.fecha, row.hora, row.horaLabel, row.creadoEn],
      });
    },
    async getAllBonosMayoristas() {
      const res = await client.execute("SELECT * FROM bonos_mayoristas ORDER BY creadoEn ASC");
      return res.rows;
    },
    async deleteBonosMayoristasByVentaId(ventaId) {
      await client.execute({ sql: "DELETE FROM bonos_mayoristas WHERE ventaId = ?", args: [ventaId] });
    },
    async updateBonoMayorista(id, gananciaNeta, bono) {
      await client.execute({ sql: "UPDATE bonos_mayoristas SET gananciaNeta = ?, bono = ? WHERE id = ?", args: [gananciaNeta, bono, id] });
    },

    async getAllCalendarioContenido() {
      const res = await client.execute("SELECT * FROM calendario_contenido ORDER BY (fecha IS NULL), fecha ASC, creadoEn ASC");
      return res.rows;
    },
    async upsertCalendarioContenido(row) {
      await client.execute({
        sql: `INSERT INTO calendario_contenido (id, fecha, tipo, tema, estado, notas, creadoEn, actualizadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                fecha = excluded.fecha, tipo = excluded.tipo, tema = excluded.tema,
                estado = excluded.estado, notas = excluded.notas, actualizadoEn = excluded.actualizadoEn`,
        args: [row.id, row.fecha || null, row.tipo, row.tema, row.estado, row.notas || null, row.creadoEn, row.actualizadoEn],
      });
    },
    async deleteCalendarioContenido(id) {
      await client.execute({ sql: "DELETE FROM calendario_contenido WHERE id = ?", args: [id] });
    },

    // ---------- Inversiones ----------
    async getAllInversionesActivos() {
      const res = await client.execute("SELECT * FROM inversiones_activos ORDER BY categoria ASC, simbolo ASC");
      return res.rows;
    },
    async insertInversionActivo(row) {
      await client.execute({
        sql: `INSERT INTO inversiones_activos (id, simbolo, nombre, categoria, tipoFuente, fuenteId, precioManual, actualizadoManualEn, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.simbolo, row.nombre, row.categoria, row.tipoFuente, row.fuenteId || null, row.precioManual ?? null, row.actualizadoManualEn || null, row.creadoEn],
      });
    },
    async updateInversionActivoPrecioManual(id, precio, actualizadoEn) {
      await client.execute({
        sql: "UPDATE inversiones_activos SET precioManual = ?, actualizadoManualEn = ? WHERE id = ?",
        args: [precio, actualizadoEn, id],
      });
    },
    async updateInversionActivoFuente(id, tipoFuente, fuenteId) {
      await client.execute({
        sql: "UPDATE inversiones_activos SET tipoFuente = ?, fuenteId = ? WHERE id = ?",
        args: [tipoFuente, fuenteId, id],
      });
    },
    async deleteInversionActivo(id) {
      await client.execute({ sql: "DELETE FROM inversiones_activos WHERE id = ?", args: [id] });
    },

    async getAllInversionesPortafolio() {
      const res = await client.execute("SELECT * FROM inversiones_portafolio ORDER BY fecha DESC, creadoEn DESC");
      return res.rows;
    },
    async insertInversionPortafolio(row) {
      await client.execute({
        sql: `INSERT INTO inversiones_portafolio (id, activoId, cantidad, precioCompra, fecha, nota, creadoEn)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.activoId, row.cantidad, row.precioCompra, row.fecha, row.nota || null, row.creadoEn],
      });
    },
    async deleteInversionPortafolio(id) {
      await client.execute({ sql: "DELETE FROM inversiones_portafolio WHERE id = ?", args: [id] });
    },

    async getAllInversionesNotas() {
      const res = await client.execute("SELECT * FROM inversiones_notas ORDER BY fecha DESC, creadoEn DESC");
      return res.rows;
    },
    async insertInversionNota(row) {
      await client.execute({
        sql: `INSERT INTO inversiones_notas (id, fecha, activoId, texto, creadoEn)
              VALUES (?, ?, ?, ?, ?)`,
        args: [row.id, row.fecha, row.activoId || null, row.texto, row.creadoEn],
      });
    },
    async deleteInversionNota(id) {
      await client.execute({ sql: "DELETE FROM inversiones_notas WHERE id = ?", args: [id] });
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
      await migrarStockDeposito(async (sql) => db.exec(sql));
      await migrarBalanceCamposNuevos(async (sql) => db.exec(sql));
      await migrarLoteId(async (sql) => db.exec(sql));
      await migrarCliente(async (sql) => db.exec(sql));
      await migrarEnvio(async (sql) => db.exec(sql));
      await migrarVendedor(async (sql) => db.exec(sql));
      await migrarBonoMinoristaManual(async (sql) => db.exec(sql));
      await migrarBonoMayoristaAutoManual(async (sql) => db.exec(sql));
      await migrarCostosFijosPago(async (sql) => db.exec(sql));
      await backfillProductosDesdeCostos(() => impl.getCostos(), () => impl.getComposicion(), () => impl.getProductos(), (row) => impl.insertProducto(row));
      await sembrarInversionesActivos(() => impl.getAllInversionesActivos(), (row) => impl.insertInversionActivo(row));
      await migrarInversionesCoinGeckoABinance(() => impl.getAllInversionesActivos(), (id, tf, fid) => impl.updateInversionActivoFuente(id, tf, fid));
    },
    async getByFecha(fecha) {
      return db.prepare("SELECT * FROM ventas WHERE fecha = ? ORDER BY creadoEn ASC").all(fecha);
    },
    async getAllVentas() {
      return db.prepare("SELECT * FROM ventas ORDER BY creadoEn ASC").all();
    },
    async getAllItems() {
      return db.prepare(`
        SELECT vi.*, v.fecha as fecha, v.horaLabel as horaLabel, v.metodo as metodo, v.envioMetodo as envioMetodo
        FROM venta_items vi JOIN ventas v ON v.id = vi.ventaId
        ORDER BY v.creadoEn ASC
      `).all();
    },
    async getAllGastos() {
      return db.prepare("SELECT * FROM gastos ORDER BY creadoEn ASC").all();
    },
    async insert(row) {
      db.prepare(
        `INSERT INTO ventas (id, producto, precio, metodo, fecha, hora, horaLabel, creadoEn, cliente, envioMetodo, envioCosto, vendedor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.producto, row.precio, row.metodo, row.fecha, row.hora, row.horaLabel, row.creadoEn, row.cliente || null, row.envioMetodo || null, row.envioCosto ?? null, row.vendedor || null);
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

    // Historial de costos: para que la ganancia de una venta vieja se calcule con el
    // costo que el producto tenía en ese momento, no con el costo actual.
    async getCostosHistorial() {
      return db.prepare("SELECT * FROM costos_historial ORDER BY producto ASC, vigenteDesde ASC").all();
    },
    async upsertCostoHistorial(row) {
      db.prepare(
        `INSERT INTO costos_historial (producto, vigenteDesde, costo, creadoEn) VALUES (?, ?, ?, ?)
         ON CONFLICT(producto, vigenteDesde) DO UPDATE SET costo = excluded.costo`
      ).run(row.producto, row.vigenteDesde, row.costo, row.creadoEn);
    },
    async updateStock(producto, stock) {
      db.prepare("UPDATE costos SET stock = ? WHERE producto = ?").run(stock, producto);
    },
    async updateStockDeposito(producto, stockDeposito) {
      db.prepare("UPDATE costos SET stockDeposito = ? WHERE producto = ?").run(stockDeposito, producto);
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

    // ---------- Inventario: productos enriquecidos, proveedores, historial de precio de lista ----------
    async getProductos() {
      return db.prepare("SELECT * FROM productos ORDER BY nombre ASC").all();
    },
    async getProductoById(id) {
      return db.prepare("SELECT * FROM productos WHERE id = ?").get(id) || null;
    },
    async getProductoByNombreNormalizado(nombreNormalizado) {
      return db.prepare("SELECT * FROM productos WHERE nombreNormalizado = ?").get(nombreNormalizado) || null;
    },
    async insertProducto(row) {
      db.prepare(
        `INSERT INTO productos (id, nombre, nombreNormalizado, marca, categoria, subcategoria, variante, sabor, tamano, sku, codigoBarra, proveedorId, stockMinimo, stockIdeal, precioMinoristaActual, precioMayoristaActual, imagenUrl, estado, notas, creadoEn, actualizadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.nombre, row.nombreNormalizado, row.marca, row.categoria, row.subcategoria, row.variante, row.sabor, row.tamano, row.sku, row.codigoBarra, row.proveedorId, row.stockMinimo, row.stockIdeal, row.precioMinoristaActual, row.precioMayoristaActual, row.imagenUrl, row.estado, row.notas, row.creadoEn, row.actualizadoEn);
    },
    async updateProducto(id, campos) {
      const permitidos = ["nombre", "nombreNormalizado", "marca", "categoria", "subcategoria", "variante", "sabor", "tamano", "sku", "codigoBarra", "proveedorId", "stockMinimo", "stockIdeal", "precioMinoristaActual", "precioMayoristaActual", "imagenUrl", "estado", "notas"];
      const sets = [];
      const args = [];
      for (const campo of permitidos) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      sets.push("actualizadoEn = ?");
      args.push(campos.actualizadoEn);
      args.push(id);
      db.prepare(`UPDATE productos SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    },
    async deleteProducto(id) {
      db.prepare("DELETE FROM productos WHERE id = ?").run(id);
    },

    async getProveedores() {
      return db.prepare("SELECT * FROM proveedores ORDER BY nombre ASC").all();
    },
    async getProveedorByNombreNormalizado(nombreNormalizado) {
      return db.prepare("SELECT * FROM proveedores WHERE nombreNormalizado = ?").get(nombreNormalizado) || null;
    },
    async insertProveedor(row) {
      db.prepare(
        `INSERT INTO proveedores (id, nombre, nombreNormalizado, telefono, email, notas, creadoEn) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.nombre, row.nombreNormalizado, row.telefono, row.email, row.notas, row.creadoEn);
    },
    async updateProveedor(id, campos) {
      const permitidos = ["nombre", "nombreNormalizado", "telefono", "email", "notas"];
      const sets = [];
      const args = [];
      for (const campo of permitidos) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      args.push(id);
      db.prepare(`UPDATE proveedores SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    },

    async getPreciosHistorial(productoId) {
      return db.prepare("SELECT * FROM precios_historial WHERE productoId = ? ORDER BY tipo ASC, vigenteDesde ASC").all(productoId);
    },
    async upsertPrecioHistorial(row) {
      db.prepare(
        `INSERT INTO precios_historial (id, productoId, tipo, precio, vigenteDesde, creadoEn) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.productoId, row.tipo, row.precio, row.vigenteDesde, row.creadoEn);
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

    async getAllCostosFijos() {
      return db.prepare("SELECT * FROM costos_fijos ORDER BY concepto ASC").all();
    },
    async insertCostoFijo(row) {
      db.prepare(
        `INSERT INTO costos_fijos (id, concepto, monto, notas, creadoEn, actualizadoEn) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.concepto, row.monto, row.notas, row.creadoEn, row.actualizadoEn);
    },
    async updateCostoFijo(id, campos) {
      const sets = [];
      const args = [];
      for (const campo of ["concepto", "monto", "notas", "pagadoMes"]) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      sets.push("actualizadoEn = ?");
      args.push(campos.actualizadoEn);
      args.push(id);
      db.prepare(`UPDATE costos_fijos SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    },
    async deleteCostoFijo(id) {
      db.prepare("DELETE FROM costos_fijos WHERE id = ?").run(id);
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
    async updateSalario(id, campos) {
      const sets = [];
      const args = [];
      for (const campo of ["sueldo", "comision", "bonoMinoristaManual", "bonoMayoristaAutoManual"]) {
        if (Object.prototype.hasOwnProperty.call(campos, campo)) {
          sets.push(`${campo} = ?`);
          args.push(campos[campo]);
        }
      }
      if (!sets.length) return;
      args.push(id);
      db.prepare(`UPDATE salario SET ${sets.join(", ")} WHERE id = ?`).run(...args);
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
    async getAllVentasPerdidas() {
      return db.prepare("SELECT * FROM ventas_perdidas ORDER BY fecha ASC, creadoEn ASC").all();
    },
    async insertVentaPerdida(row) {
      db.prepare(
        `INSERT INTO ventas_perdidas (id, motivo, fecha, horaLabel, creadoEn) VALUES (?, ?, ?, ?, ?)`
      ).run(row.id, row.motivo, row.fecha, row.horaLabel, row.creadoEn);
    },
    async deleteVentaPerdida(id) {
      db.prepare("DELETE FROM ventas_perdidas WHERE id = ?").run(id);
    },

    async getSeguimientosRecientes(desdeISO) {
      return db.prepare("SELECT * FROM seguimientos WHERE creadoEn >= ? ORDER BY creadoEn DESC").all(desdeISO);
    },
    async getSeguimiento(id) {
      return db.prepare("SELECT * FROM seguimientos WHERE id = ?").get(id) || null;
    },
    async getSeguimientoPorOrden(orden) {
      return db.prepare("SELECT * FROM seguimientos WHERE orden = ? ORDER BY creadoEn DESC LIMIT 1").get(orden) || null;
    },
    async insertSeguimiento(row) {
      db.prepare(
        `INSERT INTO seguimientos (id, orden, cliente, telefono, estado, hitos, etaISO, salidaISO, uberUrl, creadoEn, actualizadoEn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.orden, row.cliente, row.telefono, row.estado, row.hitos, row.etaISO, row.salidaISO, row.uberUrl, row.creadoEn, row.actualizadoEn);
    },
    async updateSeguimiento(row) {
      db.prepare(
        `UPDATE seguimientos SET cliente = ?, telefono = ?, estado = ?, hitos = ?, etaISO = ?, salidaISO = ?, uberUrl = ?, actualizadoEn = ? WHERE id = ?`
      ).run(row.cliente, row.telefono, row.estado, row.hitos, row.etaISO, row.salidaISO, row.uberUrl, row.actualizadoEn, row.id);
    },
    async deleteSeguimiento(id) {
      db.prepare("DELETE FROM seguimientos WHERE id = ?").run(id);
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
         (fecha, capitalCuenta1, capitalCuenta2, capitalEfectivo, deudasPagar, deudasCobrar, inversionInicial, valorStock, patrimonioNeto, nota, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fecha) DO UPDATE SET
           capitalCuenta1 = excluded.capitalCuenta1,
           capitalCuenta2 = excluded.capitalCuenta2,
           capitalEfectivo = excluded.capitalEfectivo,
           deudasPagar = excluded.deudasPagar,
           deudasCobrar = excluded.deudasCobrar,
           inversionInicial = excluded.inversionInicial,
           valorStock = excluded.valorStock,
           patrimonioNeto = excluded.patrimonioNeto,
           nota = excluded.nota`
      ).run(row.fecha, row.capitalCuenta1, row.capitalCuenta2, row.capitalEfectivo, row.deudasPagar, row.deudasCobrar, row.inversionInicial, row.valorStock, row.patrimonioNeto, row.nota || null, row.creadoEn);
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

    // Comisión minorista del empleado (5% del excedente sobre $45.000 por venta).
    async insertComisionMinorista(row) {
      db.prepare(
        `INSERT INTO comisiones_minoristas (id, ventaId, vendedor, montoVenta, excedente, comision, fecha, hora, horaLabel, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.ventaId, row.vendedor, row.montoVenta, row.excedente, row.comision, row.fecha, row.hora, row.horaLabel, row.creadoEn);
    },
    async getAllComisionesMinoristas() {
      return db.prepare("SELECT * FROM comisiones_minoristas ORDER BY creadoEn ASC").all();
    },
    async deleteComisionesByVentaId(ventaId) {
      db.prepare("DELETE FROM comisiones_minoristas WHERE ventaId = ?").run(ventaId);
    },

    // Bono mayorista del empleado (20% de la ganancia neta de la venta mayorista).
    async insertBonoMayorista(row) {
      db.prepare(
        `INSERT INTO bonos_mayoristas (id, ventaId, vendedor, gananciaNeta, bono, fecha, hora, horaLabel, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.ventaId, row.vendedor, row.gananciaNeta, row.bono, row.fecha, row.hora, row.horaLabel, row.creadoEn);
    },
    async getAllBonosMayoristas() {
      return db.prepare("SELECT * FROM bonos_mayoristas ORDER BY creadoEn ASC").all();
    },
    async deleteBonosMayoristasByVentaId(ventaId) {
      db.prepare("DELETE FROM bonos_mayoristas WHERE ventaId = ?").run(ventaId);
    },
    async updateBonoMayorista(id, gananciaNeta, bono) {
      db.prepare("UPDATE bonos_mayoristas SET gananciaNeta = ?, bono = ? WHERE id = ?").run(gananciaNeta, bono, id);
    },

    async getAllCalendarioContenido() {
      return db.prepare("SELECT * FROM calendario_contenido ORDER BY (fecha IS NULL), fecha ASC, creadoEn ASC").all();
    },
    async upsertCalendarioContenido(row) {
      db.prepare(
        `INSERT INTO calendario_contenido (id, fecha, tipo, tema, estado, notas, creadoEn, actualizadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           fecha = excluded.fecha, tipo = excluded.tipo, tema = excluded.tema,
           estado = excluded.estado, notas = excluded.notas, actualizadoEn = excluded.actualizadoEn`
      ).run(row.id, row.fecha || null, row.tipo, row.tema, row.estado, row.notas || null, row.creadoEn, row.actualizadoEn);
    },
    async deleteCalendarioContenido(id) {
      db.prepare("DELETE FROM calendario_contenido WHERE id = ?").run(id);
    },

    // ---------- Inversiones ----------
    async getAllInversionesActivos() {
      return db.prepare("SELECT * FROM inversiones_activos ORDER BY categoria ASC, simbolo ASC").all();
    },
    async insertInversionActivo(row) {
      db.prepare(
        `INSERT INTO inversiones_activos (id, simbolo, nombre, categoria, tipoFuente, fuenteId, precioManual, actualizadoManualEn, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.simbolo, row.nombre, row.categoria, row.tipoFuente, row.fuenteId || null, row.precioManual ?? null, row.actualizadoManualEn || null, row.creadoEn);
    },
    async updateInversionActivoPrecioManual(id, precio, actualizadoEn) {
      db.prepare("UPDATE inversiones_activos SET precioManual = ?, actualizadoManualEn = ? WHERE id = ?").run(precio, actualizadoEn, id);
    },
    async updateInversionActivoFuente(id, tipoFuente, fuenteId) {
      db.prepare("UPDATE inversiones_activos SET tipoFuente = ?, fuenteId = ? WHERE id = ?").run(tipoFuente, fuenteId, id);
    },
    async deleteInversionActivo(id) {
      db.prepare("DELETE FROM inversiones_activos WHERE id = ?").run(id);
    },

    async getAllInversionesPortafolio() {
      return db.prepare("SELECT * FROM inversiones_portafolio ORDER BY fecha DESC, creadoEn DESC").all();
    },
    async insertInversionPortafolio(row) {
      db.prepare(
        `INSERT INTO inversiones_portafolio (id, activoId, cantidad, precioCompra, fecha, nota, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.activoId, row.cantidad, row.precioCompra, row.fecha, row.nota || null, row.creadoEn);
    },
    async deleteInversionPortafolio(id) {
      db.prepare("DELETE FROM inversiones_portafolio WHERE id = ?").run(id);
    },

    async getAllInversionesNotas() {
      return db.prepare("SELECT * FROM inversiones_notas ORDER BY fecha DESC, creadoEn DESC").all();
    },
    async insertInversionNota(row) {
      db.prepare(
        `INSERT INTO inversiones_notas (id, fecha, activoId, texto, creadoEn)
         VALUES (?, ?, ?, ?, ?)`
      ).run(row.id, row.fecha, row.activoId || null, row.texto, row.creadoEn);
    },
    async deleteInversionNota(id) {
      db.prepare("DELETE FROM inversiones_notas WHERE id = ?").run(id);
    },
  };
}

module.exports = { ...impl, usingTurso: USE_TURSO };
