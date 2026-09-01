// Arma la pestaña "Recompra Mayoristas" a partir de la base local: junta los pedidos
// guardados con metodo "mayorista" (tabla ventas + venta_items), los agrupa por el nombre
// de cliente que se tipeó en cada pedido, y calcula métricas para saber a quién conviene
// ofrecerle una promo para que recompre.

const { waLink } = require("./tiendanube");

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
}

function diasEntre(fechaA, fechaB) {
  // fechaA, fechaB en formato "YYYY-MM-DD"
  const a = new Date(fechaA + "T00:00:00");
  const b = new Date(fechaB + "T00:00:00");
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function agregarClientesMayoristas({ ventas, items, clientesGuardados, hoyFecha }) {
  const ventasMayoristas = ventas.filter((v) => v.metodo === "mayorista" && (v.cliente || "").trim());
  const ventaIds = new Set(ventasMayoristas.map((v) => v.id));

  const itemsPorVenta = new Map();
  for (const it of items) {
    if (!ventaIds.has(it.ventaId)) continue;
    if (!itemsPorVenta.has(it.ventaId)) itemsPorVenta.set(it.ventaId, []);
    itemsPorVenta.get(it.ventaId).push(it);
  }

  const guardadosPorNombre = new Map();
  for (const c of clientesGuardados) guardadosPorNombre.set(c.nombreNormalizado, c);

  const porCliente = new Map();

  for (const v of ventasMayoristas) {
    const key = normalizeNombre(v.cliente);
    if (!porCliente.has(key)) {
      porCliente.set(key, {
        nombreNormalizado: key,
        nombre: v.cliente,
        ultimoCreadoEn: null,
        pedidos: [],
        productos: new Map(),
        totalVolumen: 0,
      });
    }
    const c = porCliente.get(key);

    const itemsDeVenta = itemsPorVenta.get(v.id) || [{ producto: v.producto, precio: v.precio }];
    const totalVenta = itemsDeVenta.reduce((a, it) => a + (Number(it.precio) || 0), 0);

    c.totalVolumen += totalVenta;
    c.pedidos.push({
      id: v.id,
      fecha: v.fecha,
      total: totalVenta,
      productos: (() => {
        const m = new Map();
        for (const it of itemsDeVenta) m.set(it.producto, (m.get(it.producto) || 0) + 1);
        return [...m.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad }));
      })(),
    });

    for (const it of itemsDeVenta) {
      c.productos.set(it.producto, (c.productos.get(it.producto) || 0) + 1);
    }

    // El nombre que se muestra es el de la venta con el creadoEn más reciente, por si
    // el mismo cliente se tipeó con mayúsculas o espacios distintos entre pedidos.
    if (!c.ultimoCreadoEn || (v.creadoEn || "") > c.ultimoCreadoEn) {
      c.ultimoCreadoEn = v.creadoEn || "";
      c.nombre = v.cliente;
    }
  }

  const clientes = [...porCliente.values()].map((c) => {
    const fechasOrdenadas = c.pedidos.map((p) => p.fecha).filter(Boolean).sort();
    const primeraCompra = fechasOrdenadas[0] || null;
    const ultimaCompra = fechasOrdenadas[fechasOrdenadas.length - 1] || null;
    const diasSinComprar = ultimaCompra != null ? diasEntre(ultimaCompra, hoyFecha) : null;

    const cantidadPedidos = c.pedidos.length;
    const rangoDias = primeraCompra && ultimaCompra ? diasEntre(primeraCompra, ultimaCompra) : 0;
    const cadenciaDiasPromedio = cantidadPedidos >= 2 && rangoDias > 0
      ? Math.round(rangoDias / (cantidadPedidos - 1))
      : null;

    const hace90 = (() => {
      const d = new Date(hoyFecha + "T00:00:00");
      d.setDate(d.getDate() - 90);
      return d.toISOString().slice(0, 10);
    })();
    const volumenUltimos90Dias = c.pedidos
      .filter((p) => p.fecha && p.fecha >= hace90)
      .reduce((a, p) => a + p.total, 0);

    const mesesActivos = new Set(c.pedidos.map((p) => (p.fecha || "").slice(0, 7)).filter(Boolean)).size || 1;

    const guardado = guardadosPorNombre.get(c.nombreNormalizado);
    const telefono = guardado ? guardado.telefono : null;

    const productoTop = [...c.productos.entries()].sort((a, b) => b[1] - a[1]);

    const atrasadoSegunRitmo = cadenciaDiasPromedio != null && diasSinComprar != null
      ? diasSinComprar > cadenciaDiasPromedio * 1.4
      : null;

    return {
      nombre: c.nombre,
      nombreNormalizado: c.nombreNormalizado,
      telefono: telefono || null,
      whatsapp: telefono ? waLink(telefono, `Hola! Te escribimos de Platense Fit Mayorista.`) : null,
      cantidadPedidos,
      totalVolumen: Math.round(c.totalVolumen * 100) / 100,
      ticketPromedio: Math.round((c.totalVolumen / cantidadPedidos) * 100) / 100,
      primeraCompra,
      ultimaCompra,
      diasSinComprar,
      cadenciaDiasPromedio,
      atrasadoSegunRitmo,
      volumenMensualPromedio3m: Math.round((volumenUltimos90Dias / 3) * 100) / 100,
      volumenMensualHistorico: Math.round((c.totalVolumen / mesesActivos) * 100) / 100,
      productos: productoTop.map(([nombre, cantidad]) => ({ nombre, cantidad })),
      segmento: cantidadPedidos >= 2 ? "recurrente" : "unico",
      pedidos: c.pedidos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")),
    };
  });

  clientes.sort((a, b) => (b.ultimaCompra || "").localeCompare(a.ultimaCompra || ""));
  return clientes;
}

module.exports = { agregarClientesMayoristas, normalizeNombre };
