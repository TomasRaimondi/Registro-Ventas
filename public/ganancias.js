function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cuentadni: "Cuenta DNI",
  mayorista: "Mayorista",
  web: "Web",
};

async function api(url, options) {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `Error de red (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
}

function formatFechaLarga(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
}

// ---------- Login ----------

const loginCard = document.getElementById("login-card");
const appContent = document.getElementById("app-content");
const logoutBtn = document.getElementById("logout-btn");

function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "inline-block";
  const fechaInput = document.getElementById("salario-fecha");
  if (fechaInput && !fechaInput.value) {
    const now = new Date();
    fechaInput.value = now.toISOString().slice(0, 10);
  }
  renderAll();
}

function showLogin() {
  loginCard.style.display = "block";
  appContent.style.display = "none";
  logoutBtn.style.display = "none";
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("password").value;
  const errorHint = document.getElementById("login-error");
  errorHint.style.display = "none";

  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    document.getElementById("password").value = "";
    showApp();
  } catch (err) {
    errorHint.textContent = err.message || "Contraseña incorrecta.";
    errorHint.style.display = "block";
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

async function checkAuth() {
  const { authenticated } = await api("/api/auth-check");
  if (authenticated) showApp();
  else showLogin();
}

// ---------- Ver los datos de otro día ----------

let fechaSeleccionada = null; // null = sigue mostrando "hoy" automáticamente
let hoyFechaCache = null;
const fechaSelectorInput = document.getElementById("fecha-selector-input");
const fechaSelectorHoyBtn = document.getElementById("fecha-selector-hoy-btn");

fechaSelectorInput.addEventListener("change", () => {
  if (!fechaSelectorInput.value) return;
  fechaSeleccionada = fechaSelectorInput.value;
  pedidoExpandidoId = null;
  renderAll();
});

fechaSelectorHoyBtn.addEventListener("click", () => {
  fechaSeleccionada = null;
  if (hoyFechaCache) fechaSelectorInput.value = hoyFechaCache;
  pedidoExpandidoId = null;
  renderAll();
});

// ---------- Detalle de ventas: tabla desplegable ----------
const detalleVentasHeader = document.getElementById("detalle-ventas-header");
const detalleVentasWrap = document.getElementById("detalle-ventas-wrap");
detalleVentasHeader.addEventListener("click", () => {
  const abierto = detalleVentasWrap.style.display !== "none";
  detalleVentasWrap.style.display = abierto ? "none" : "block";
  detalleVentasHeader.classList.toggle("expanded", !abierto);
});

// ---------- Costos ----------

document.getElementById("costo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const producto = document.getElementById("costo-producto").value.trim();
  const costo = parseFloat(document.getElementById("costo-valor").value);
  if (!producto || isNaN(costo) || costo < 0) return;

  try {
    await api("/api/costos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto, costo }),
    });
    e.target.reset();
    renderAll();
  } catch (err) {
    alert("No se pudo guardar el costo.\n" + err.message);
  }
});

async function deleteCosto(producto) {
  try {
    await api("/api/costos/" + encodeURIComponent(producto), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el costo.\n" + err.message);
  }
}

// ---------- Gastos ----------

document.getElementById("gasto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const concepto = document.getElementById("gasto-concepto").value.trim();
  const monto = parseFloat(document.getElementById("gasto-monto").value);
  if (!concepto || isNaN(monto) || monto <= 0) return;

  try {
    await api("/api/gastos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concepto, monto }),
    });
    e.target.reset();
    renderAll();
  } catch (err) {
    alert("No se pudo registrar el gasto.\n" + err.message);
  }
});

async function deleteGasto(id) {
  try {
    await api("/api/gastos/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el gasto.\n" + err.message);
  }
}

// ---------- Salario del empleado ----------

document.getElementById("salario-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fecha = document.getElementById("salario-fecha").value;
  const sueldo = parseFloat(document.getElementById("salario-sueldo").value) || 0;
  const comision = parseFloat(document.getElementById("salario-comision").value) || 0;
  const nota = document.getElementById("salario-nota").value.trim();

  if (!fecha) return;
  if (sueldo <= 0 && comision <= 0) {
    alert("Ingresá un sueldo o una comisión mayor a 0.");
    return;
  }

  try {
    await api("/api/salario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, sueldo, comision, nota }),
    });
    document.getElementById("salario-sueldo").value = "";
    document.getElementById("salario-comision").value = "";
    document.getElementById("salario-nota").value = "";
    renderAll();
  } catch (err) {
    alert("No se pudo registrar el salario.\n" + err.message);
  }
});

async function deleteSalario(id) {
  try {
    await api("/api/salario/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el registro.\n" + err.message);
  }
}

// ---------- Render ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function renderAll() {
  let items, costos, gastos, salarios;
  try {
    const hora = await api("/api/hora");
    hoyFechaCache = hora.fecha;
    const fechaActiva = fechaSeleccionada || hoyFechaCache;
    [items, costos, gastos, salarios] = await Promise.all([
      api("/api/venta-items?fecha=" + encodeURIComponent(fechaActiva)),
      api("/api/costos"),
      api("/api/gastos?fecha=" + encodeURIComponent(fechaActiva)),
      api("/api/salario"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const fechaActiva = fechaSeleccionada || hoyFechaCache;
  const esHoy = fechaActiva === hoyFechaCache;
  const fechaLabel = esHoy ? "hoy" : formatFechaLarga(fechaActiva);
  document.querySelectorAll(".fecha-dinamica").forEach(el => { el.textContent = fechaLabel; });
  if (!fechaSelectorInput.value) fechaSelectorInput.value = fechaActiva;
  fechaSelectorHoyBtn.style.display = esHoy ? "none" : "inline-block";

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  let gananciaBruta = 0;
  let itemsConsiderados = 0;
  const sinCostoSet = new Set();

  items.forEach(it => {
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      gananciaBruta += it.precio - costoPorProducto[key];
      itemsConsiderados++;
    } else {
      sinCostoSet.add(it.producto);
    }
  });

  const gastoTotal = gastos.reduce((acc, g) => acc + g.monto, 0);
  const gananciaNeta = gananciaBruta - gastoTotal;

  document.getElementById("ganancia-bruta").textContent = money(gananciaBruta);
  document.getElementById("ventas-consideradas").textContent =
    `${itemsConsiderados} de ${items.length} productos con costo cargado`;
  document.getElementById("gasto-total").textContent = money(gastoTotal);
  const gananciaNetaEl = document.getElementById("ganancia-neta");
  gananciaNetaEl.textContent = money(gananciaNeta);
  gananciaNetaEl.classList.toggle("value-positive", gananciaNeta > 0);
  gananciaNetaEl.classList.toggle("value-negative", gananciaNeta < 0);

  const sinCostoCard = document.getElementById("sin-costo-card");
  const sinCostoList = document.getElementById("sin-costo-list");
  if (sinCostoSet.size > 0) {
    sinCostoCard.style.display = "block";
    sinCostoList.innerHTML = [...sinCostoSet].map(p => `<li>${escapeHtml(p)}</li>`).join("");
  } else {
    sinCostoCard.style.display = "none";
  }

  // Tabla de costos
  const costosBody = document.getElementById("costos-body");
  costosBody.innerHTML = "";
  if (costos.length === 0) {
    costosBody.innerHTML = `<tr class="empty-row"><td colspan="3">Todavía no cargaste ningún costo.</td></tr>`;
  } else {
    costos.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(c.producto)}</td>
        <td>${money(c.costo)}</td>
        <td><button class="del-btn" title="Eliminar" data-producto="${escapeHtml(c.producto)}">✕</button></td>
      `;
      costosBody.appendChild(tr);
    });
    costosBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteCosto(btn.dataset.producto));
    });
  }

  // Detalle de ventas de hoy (precio, costo y ganancia por producto)
  const detalleBody = document.getElementById("detalle-ventas-body");
  detalleBody.innerHTML = "";
  if (items.length === 0) {
    detalleBody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no hay ventas ${esHoy ? "hoy" : "ese día"}.</td></tr>`;
  } else {
    [...items].reverse().forEach(it => {
      const key = normalizeNombre(it.producto);
      const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorProducto, key);
      const costo = tieneCosto ? costoPorProducto[key] : null;
      const ganancia = tieneCosto ? it.precio - costo : null;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${it.horaLabel}</td>
        <td>${escapeHtml(it.producto)}</td>
        <td>${money(it.precio)}</td>
        <td>${tieneCosto ? money(costo) : "—"}</td>
        <td style="${ganancia !== null && ganancia < 0 ? 'color:#e15b5b;' : ''}">${ganancia !== null ? money(ganancia) : "—"}</td>
      `;
      detalleBody.appendChild(tr);
    });
  }

  renderPedidos(items, costoPorProducto, esHoy);

  // Tabla de gastos
  const gastosBody = document.getElementById("gastos-body");
  gastosBody.innerHTML = "";
  if (gastos.length === 0) {
    gastosBody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no cargaste ningún gasto ${esHoy ? "hoy" : "ese día"}.</td></tr>`;
  } else {
    [...gastos].reverse().forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${g.horaLabel}</td>
        <td>${escapeHtml(g.concepto)}</td>
        <td>${money(g.monto)}</td>
        <td><button class="del-btn" title="Eliminar" data-id="${g.id}">✕</button></td>
      `;
      gastosBody.appendChild(tr);
    });
    gastosBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteGasto(btn.dataset.id));
    });
  }

  // Tabla de salario
  const salarioBody = document.getElementById("salario-body");
  salarioBody.innerHTML = "";
  if (salarios.length === 0) {
    salarioBody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no cargaste ningún día.</td></tr>`;
  } else {
    [...salarios].reverse().forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.fecha}</td>
        <td>${s.sueldo > 0 ? money(s.sueldo) : "—"}</td>
        <td>${s.comision > 0 ? money(s.comision) : "—"}</td>
        <td>${s.nota ? escapeHtml(s.nota) : ""}</td>
        <td><button class="del-btn" title="Eliminar" data-id="${s.id}">✕</button></td>
      `;
      salarioBody.appendChild(tr);
    });
    salarioBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteSalario(btn.dataset.id));
    });
  }
}

// ---------- Ganancias por pedido (desglose, en vez de listar todo unitariamente) ----------

// Agrupa los venta_items (que ya vienen con ventaId) en pedidos, conservando
// el orden de aparición de cada pedido según la primera vez que aparece un item suyo.
function agruparPorPedido(items) {
  const orden = [];
  const porPedido = new Map();
  items.forEach(it => {
    if (!porPedido.has(it.ventaId)) {
      porPedido.set(it.ventaId, []);
      orden.push(it.ventaId);
    }
    porPedido.get(it.ventaId).push(it);
  });
  return orden.map(ventaId => porPedido.get(ventaId));
}

// Agrupa las unidades de un pedido por producto (ej: 3 renglones de "Pancake" -> un grupo
// con cantidad 3), y las ordena alfabéticamente para que no salgan salteadas ni repetidas.
function agruparProductosPedido(itemsDelPedido) {
  const mapa = new Map();
  itemsDelPedido.forEach(it => {
    const key = normalizeNombre(it.producto);
    if (!mapa.has(key)) mapa.set(key, { producto: it.producto, cantidad: 0, items: [] });
    const grupo = mapa.get(key);
    grupo.cantidad += 1;
    grupo.items.push(it);
  });
  return [...mapa.values()].sort((a, b) => a.producto.localeCompare(b.producto, "es"));
}

// Junta los nombres de los productos de un pedido en un resumen legible,
// agrupando repetidos y ordenados (ej: "Café, Pancake x3").
function resumenProductos(itemsDelPedido) {
  return agruparProductosPedido(itemsDelPedido)
    .map(g => (g.cantidad > 1 ? `${g.producto} x${g.cantidad}` : g.producto))
    .join(", ");
}

// Guarda qué pedido está desplegado para que sobreviva al auto-refresh de renderAll()
// (que reconstruye toda la tabla cada 8s) en vez de cerrarse solo.
let pedidoExpandidoId = null;

function renderPedidos(items, costoPorProducto, esHoy) {
  const body = document.getElementById("pedidos-body");
  body.innerHTML = "";

  const pedidos = agruparPorPedido(items);

  let minGanancia = 0, minVenta = 0, mayGanancia = 0, mayVenta = 0;

  if (pedidos.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">Todavía no hay ventas ${esHoy ? "hoy" : "ese día"}.</td></tr>`;
  } else {
    [...pedidos].reverse().forEach(itemsDelPedido => {
      const ventaId = itemsDelPedido[0].ventaId;
      const horaLabel = itemsDelPedido[0].horaLabel;
      const metodo = itemsDelPedido[0].metodo;

      const precioTotal = itemsDelPedido.reduce((acc, it) => acc + it.precio, 0);
      const itemsConCosto = itemsDelPedido.filter(it => Object.prototype.hasOwnProperty.call(costoPorProducto, normalizeNombre(it.producto)));
      const costoTotal = itemsConCosto.reduce((acc, it) => acc + costoPorProducto[normalizeNombre(it.producto)], 0);
      const gananciaTotal = itemsConCosto.reduce((acc, it) => acc + (it.precio - costoPorProducto[normalizeNombre(it.producto)]), 0);
      const completo = itemsConCosto.length === itemsDelPedido.length;
      const rentabilidadPct = precioTotal > 0 ? (gananciaTotal / precioTotal) * 100 : null;

      if (metodo === "mayorista") {
        mayGanancia += gananciaTotal;
        mayVenta += precioTotal;
      } else {
        minGanancia += gananciaTotal;
        minVenta += precioTotal;
      }

      const tr = document.createElement("tr");
      tr.className = "sale-row";
      tr.dataset.ventaId = ventaId;
      tr.innerHTML = `
        <td>${horaLabel}</td>
        <td><span class="expand-caret">▸</span>${escapeHtml(resumenProductos(itemsDelPedido))}</td>
        <td>${metodo ? `<span class="pm-tag ${metodo}">${PAYMENT_LABELS[metodo] || metodo}</span>` : "—"}</td>
        <td>${money(precioTotal)}</td>
        <td>${completo ? money(costoTotal) : `${money(costoTotal)} <span class="hint" style="margin:0;">(parcial)</span>`}</td>
        <td style="${gananciaTotal < 0 ? 'color:var(--red);' : ''}">${money(gananciaTotal)}</td>
        <td>
          ${rentabilidadPct !== null ? rentabilidadPct.toFixed(1) + "%" : "—"}
          ${!completo ? `<span class="hint" style="margin:0;">(${itemsConCosto.length}/${itemsDelPedido.length} con costo)</span>` : ""}
        </td>
      `;
      tr.addEventListener("click", () => togglePedidoDetail(ventaId, tr, itemsDelPedido, costoPorProducto));
      body.appendChild(tr);

      if (pedidoExpandidoId === ventaId) {
        expandirPedidoDetail(ventaId, tr, itemsDelPedido, costoPorProducto);
      }
    });
  }

  const minPct = minVenta > 0 ? (minGanancia / minVenta) * 100 : null;
  const mayPct = mayVenta > 0 ? (mayGanancia / mayVenta) * 100 : null;
  document.getElementById("rentabilidad-minorista").textContent = minPct !== null ? minPct.toFixed(1) + "%" : "—";
  document.getElementById("rentabilidad-mayorista").textContent = mayPct !== null ? mayPct.toFixed(1) + "%" : "—";
}

function expandirPedidoDetail(ventaId, row, itemsDelPedido, costoPorProducto) {
  row.classList.add("expanded");
  pedidoExpandidoId = ventaId;

  const detailRow = document.createElement("tr");
  detailRow.className = "sale-detail-row";
  const td = document.createElement("td");
  td.colSpan = 7;
  td.innerHTML = agruparProductosPedido(itemsDelPedido).map(g => {
    const key = normalizeNombre(g.producto);
    const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorProducto, key);
    const costoUnit = tieneCosto ? costoPorProducto[key] : null;
    const precioTotal = g.items.reduce((acc, it) => acc + it.precio, 0);
    const precioVentaUnit = precioTotal / g.cantidad;
    const costoTotal = tieneCosto ? costoUnit * g.cantidad : null;
    const ganancia = tieneCosto ? precioTotal - costoTotal : null;
    const etiqueta = g.cantidad > 1 ? `x${g.cantidad} ${g.producto}` : g.producto;
    const costoUnitTag = tieneCosto ? ` <span class="hint" style="margin:0;">(costo c/u: ${money(costoUnit)})</span>` : "";
    return `
      <div class="lote-detail-item" style="grid-template-columns: 2fr 1fr 1fr 1fr 1fr;">
        <span>${escapeHtml(etiqueta)}${costoUnitTag}</span>
        <span>${money(precioVentaUnit)} c/u</span>
        <span>${money(precioTotal)}</span>
        <span>${tieneCosto ? money(costoTotal) : "—"}</span>
        <span style="${ganancia !== null && ganancia < 0 ? 'color:var(--red);' : ''}">${ganancia !== null ? money(ganancia) : "—"}</span>
      </div>
    `;
  }).join("");
  detailRow.appendChild(td);
  row.after(detailRow);
}

function togglePedidoDetail(ventaId, row, itemsDelPedido, costoPorProducto) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("sale-detail-row")) {
    existing.remove();
    row.classList.remove("expanded");
    pedidoExpandidoId = null;
    return;
  }

  const tbody = document.getElementById("pedidos-body");
  tbody.querySelectorAll(".sale-detail-row").forEach(r => r.remove());
  tbody.querySelectorAll(".sale-row.expanded").forEach(r => r.classList.remove("expanded"));

  expandirPedidoDetail(ventaId, row, itemsDelPedido, costoPorProducto);
}

checkAuth();
setInterval(() => { if (appContent.style.display !== "none") renderAll(); }, 8000);
