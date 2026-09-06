const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cuentadni: "Cuenta DNI",
  mayorista: "Mayorista",
  web: "Web",
};

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
  logoutBtn.style.display = "flex";
  const fechaInput = document.getElementById("salario-fecha");
  if (fechaInput && !fechaInput.value) fechaInput.value = new Date().toISOString().slice(0, 10);
  renderAll();
}

function showLogin() {
  loginCard.style.display = "flex";
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

let fechaSeleccionada = null;
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

// ---------- Detalle de ventas: lista plegable ----------

const detalleToggle = document.getElementById("detalle-ventas-toggle");
const detalleList = document.getElementById("detalle-ventas-list");
detalleToggle.addEventListener("click", () => {
  const abierto = detalleList.style.display !== "none";
  detalleList.style.display = abierto ? "none" : "block";
  detalleToggle.textContent = abierto ? "Ver detalle de ventas por producto ▾" : "Ocultar detalle de ventas por producto ▴";
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
    buzz(10);
    toast("Costo guardado");
    renderAll();
  } catch (err) {
    toast(err.message || "No se pudo guardar el costo", false);
  }
});

async function deleteCosto(producto) {
  try {
    await api("/api/costos/" + encodeURIComponent(producto), { method: "DELETE" });
    renderAll();
  } catch (err) {
    toast(err.message || "No se pudo borrar el costo", false);
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
    buzz(10);
    toast("Gasto registrado");
    renderAll();
  } catch (err) {
    toast(err.message || "No se pudo registrar el gasto", false);
  }
});

async function deleteGasto(id) {
  try {
    await api("/api/gastos/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    toast(err.message || "No se pudo borrar el gasto", false);
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
  if (sueldo <= 0 && comision <= 0) { toast("Ingresá un sueldo o una comisión mayor a 0", false); return; }

  try {
    await api("/api/salario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, sueldo, comision, nota }),
    });
    document.getElementById("salario-sueldo").value = "";
    document.getElementById("salario-comision").value = "";
    document.getElementById("salario-nota").value = "";
    buzz(10);
    toast("Día agregado");
    renderAll();
  } catch (err) {
    toast(err.message || "No se pudo registrar el salario", false);
  }
});

async function deleteSalario(id) {
  try {
    await api("/api/salario/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    toast(err.message || "No se pudo borrar el registro", false);
  }
}

// ---------- Render ----------

async function renderAll() {
  let items, costos, gastos, salarios, composicion;
  try {
    const hora = await api("/api/hora");
    hoyFechaCache = hora.fecha;
    const fechaActiva = fechaSeleccionada || hoyFechaCache;
    [items, costos, gastos, salarios, composicion] = await Promise.all([
      api("/api/venta-items?fecha=" + encodeURIComponent(fechaActiva)),
      api("/api/costos"),
      api("/api/gastos?fecha=" + encodeURIComponent(fechaActiva)),
      api("/api/salario"),
      api("/api/composicion"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const fechaActiva = fechaSeleccionada || hoyFechaCache;
  const esHoy = fechaActiva === hoyFechaCache;
  const fechaLabel = esHoy ? "hoy" : formatFechaLarga(fechaActiva);
  document.querySelectorAll(".fecha-dinamica").forEach((el) => { el.textContent = fechaLabel; });
  if (!fechaSelectorInput.value) fechaSelectorInput.value = fechaActiva;
  fechaSelectorHoyBtn.style.display = esHoy ? "none" : "inline-block";

  const costoPorProducto = {};
  costos.forEach((c) => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  let gananciaBruta = 0;
  let itemsConsiderados = 0;
  const sinCostoSet = new Set();

  items.forEach((it) => {
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
    sinCostoList.innerHTML = [...sinCostoSet].map((p) => `<div class="list-row"><span class="list-row-titulo">${escapeHtml(p)}</span></div>`).join("");
  } else {
    sinCostoCard.style.display = "none";
  }

  // Planilla de costos
  const combosConComponentes = new Set(composicion.map((c) => c.comboProducto));
  const costosList = document.getElementById("costos-list");
  if (costos.length === 0) {
    costosList.innerHTML = `<p class="empty">Todavía no cargaste ningún costo.</p>`;
  } else {
    costosList.innerHTML = costos.map((c) => {
      const esCombo = combosConComponentes.has(c.producto);
      return `
        <div class="list-row">
          <div class="list-row-info">
            <span class="list-row-titulo">${escapeHtml(c.producto)}</span>
            ${esCombo ? '<span class="list-row-sub">calculado según sus componentes</span>' : ""}
          </div>
          <span class="list-row-valor">${money(c.costo)}</span>
          <button type="button" class="list-row-del" data-producto="${escapeHtml(c.producto)}">✕</button>
        </div>
      `;
    }).join("");
    costosList.querySelectorAll(".list-row-del").forEach((btn) => {
      btn.onclick = () => deleteCosto(btn.dataset.producto);
    });
  }

  // Detalle de ventas por producto
  const detalleListEl = document.getElementById("detalle-ventas-list");
  if (items.length === 0) {
    detalleListEl.innerHTML = `<p class="empty">Todavía no hay ventas ${esHoy ? "hoy" : "ese día"}.</p>`;
  } else {
    detalleListEl.innerHTML = [...items].reverse().map((it) => {
      const key = normalizeNombre(it.producto);
      const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorProducto, key);
      const costo = tieneCosto ? costoPorProducto[key] : null;
      const ganancia = tieneCosto ? it.precio - costo : null;
      return `
        <div class="list-row">
          <div class="list-row-info">
            <span class="list-row-titulo">${escapeHtml(it.producto)}</span>
            <span class="list-row-sub">${it.horaLabel} · ${money(it.precio)}${tieneCosto ? " · costo " + money(costo) : ""}</span>
          </div>
          <span class="list-row-valor" style="${ganancia !== null && ganancia < 0 ? "color:var(--coral);" : ""}">${ganancia !== null ? money(ganancia) : "—"}</span>
        </div>
      `;
    }).join("");
  }

  renderPedidos(items, costoPorProducto, esHoy);

  // Gastos
  const gastosList = document.getElementById("gastos-list");
  if (gastos.length === 0) {
    gastosList.innerHTML = `<p class="empty">Todavía no cargaste ningún gasto ${esHoy ? "hoy" : "ese día"}.</p>`;
  } else {
    gastosList.innerHTML = [...gastos].reverse().map((g) => `
      <div class="list-row">
        <div class="list-row-info">
          <span class="list-row-titulo">${escapeHtml(g.concepto)}</span>
          <span class="list-row-sub">${g.horaLabel}</span>
        </div>
        <span class="list-row-valor">${money(g.monto)}</span>
        <button type="button" class="list-row-del" data-id="${g.id}">✕</button>
      </div>
    `).join("");
    gastosList.querySelectorAll(".list-row-del").forEach((btn) => { btn.onclick = () => deleteGasto(btn.dataset.id); });
  }

  // Salario
  const salarioList = document.getElementById("salario-list");
  if (salarios.length === 0) {
    salarioList.innerHTML = `<p class="empty">Todavía no cargaste ningún día.</p>`;
  } else {
    salarioList.innerHTML = [...salarios].reverse().map((s) => `
      <div class="list-row">
        <div class="list-row-info">
          <span class="list-row-titulo">${s.fecha}</span>
          <span class="list-row-sub">${s.sueldo > 0 ? "Sueldo " + money(s.sueldo) : ""}${s.comision > 0 ? " · Comisión " + money(s.comision) : ""}${s.nota ? " · " + escapeHtml(s.nota) : ""}</span>
        </div>
        <button type="button" class="list-row-del" data-id="${s.id}">✕</button>
      </div>
    `).join("");
    salarioList.querySelectorAll(".list-row-del").forEach((btn) => { btn.onclick = () => deleteSalario(btn.dataset.id); });
  }
}

// ---------- Ganancias por pedido ----------

function agruparPorPedido(items) {
  const orden = [];
  const porPedido = new Map();
  items.forEach((it) => {
    if (!porPedido.has(it.ventaId)) {
      porPedido.set(it.ventaId, []);
      orden.push(it.ventaId);
    }
    porPedido.get(it.ventaId).push(it);
  });
  return orden.map((ventaId) => porPedido.get(ventaId));
}

function agruparProductosPedido(itemsDelPedido) {
  const mapa = new Map();
  itemsDelPedido.forEach((it) => {
    const key = normalizeNombre(it.producto);
    if (!mapa.has(key)) mapa.set(key, { producto: it.producto, cantidad: 0, items: [] });
    const grupo = mapa.get(key);
    grupo.cantidad += 1;
    grupo.items.push(it);
  });
  return [...mapa.values()].sort((a, b) => a.producto.localeCompare(b.producto, "es"));
}

function resumenProductos(itemsDelPedido) {
  return agruparProductosPedido(itemsDelPedido)
    .map((g) => (g.cantidad > 1 ? `${g.producto} x${g.cantidad}` : g.producto))
    .join(", ");
}

let pedidoExpandidoId = null;

function detalleAcordeonHtml(itemsDelPedido, costoPorProducto) {
  return agruparProductosPedido(itemsDelPedido).map((g) => {
    const key = normalizeNombre(g.producto);
    const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorProducto, key);
    const costoUnit = tieneCosto ? costoPorProducto[key] : null;
    const precioTotal = g.items.reduce((acc, it) => acc + it.precio, 0);
    const costoTotal = tieneCosto ? costoUnit * g.cantidad : null;
    const ganancia = tieneCosto ? precioTotal - costoTotal : null;
    const etiqueta = g.cantidad > 1 ? `x${g.cantidad} ${g.producto}` : g.producto;
    return `
      <div class="acc-detail-item">
        <span class="n">${escapeHtml(etiqueta)}</span>
        <span class="v">${money(precioTotal)}${tieneCosto ? " − " + money(costoTotal) + " = " : ""}${ganancia !== null ? money(ganancia) : ""}</span>
      </div>
    `;
  }).join("");
}

function renderPedidos(items, costoPorProducto, esHoy) {
  const list = document.getElementById("pedidos-list");
  const pedidos = agruparPorPedido(items);

  let minGanancia = 0, minVenta = 0, mayGanancia = 0, mayVenta = 0;

  if (pedidos.length === 0) {
    list.innerHTML = `<p class="empty">Todavía no hay ventas ${esHoy ? "hoy" : "ese día"}.</p>`;
  } else {
    list.innerHTML = "";
    [...pedidos].reverse().forEach((itemsDelPedido) => {
      const ventaId = itemsDelPedido[0].ventaId;
      const horaLabel = itemsDelPedido[0].horaLabel;
      const metodo = itemsDelPedido[0].metodo;

      const precioTotal = itemsDelPedido.reduce((acc, it) => acc + it.precio, 0);
      const itemsConCosto = itemsDelPedido.filter((it) => Object.prototype.hasOwnProperty.call(costoPorProducto, normalizeNombre(it.producto)));
      const gananciaTotal = itemsConCosto.reduce((acc, it) => acc + (it.precio - costoPorProducto[normalizeNombre(it.producto)]), 0);
      const completo = itemsConCosto.length === itemsDelPedido.length;
      const rentabilidadPct = precioTotal > 0 ? (gananciaTotal / precioTotal) * 100 : null;

      if (metodo === "mayorista") { mayGanancia += gananciaTotal; mayVenta += precioTotal; }
      else { minGanancia += gananciaTotal; minVenta += precioTotal; }

      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <button type="button" class="acc-row" data-venta-id="${ventaId}">
          <span class="acc-caret">▸</span>
          <span class="acc-info">
            <span class="acc-titulo">${escapeHtml(resumenProductos(itemsDelPedido))}</span>
            <span class="acc-sub">${horaLabel}${metodo ? " · " + (PAYMENT_LABELS[metodo] || metodo) : ""}${!completo ? ` · ${itemsConCosto.length}/${itemsDelPedido.length} con costo` : ""}</span>
          </span>
          <span class="acc-valor">
            <b style="${gananciaTotal < 0 ? "color:var(--coral);" : ""}">${money(gananciaTotal)}</b>
            <small>${rentabilidadPct !== null ? rentabilidadPct.toFixed(1) + "%" : "—"}</small>
          </span>
        </button>
        <div class="acc-detail" style="display:none;"></div>
      `;
      const row = wrap.querySelector(".acc-row");
      const detail = wrap.querySelector(".acc-detail");
      row.onclick = () => {
        const abierto = row.classList.contains("open");
        list.querySelectorAll(".acc-row.open").forEach((r) => { r.classList.remove("open"); r.nextElementSibling.style.display = "none"; });
        if (!abierto) {
          row.classList.add("open");
          detail.innerHTML = detalleAcordeonHtml(itemsDelPedido, costoPorProducto);
          detail.style.display = "flex";
          pedidoExpandidoId = ventaId;
        } else {
          pedidoExpandidoId = null;
        }
        buzz(6);
      };
      list.appendChild(wrap);

      if (pedidoExpandidoId === ventaId) {
        row.classList.add("open");
        detail.innerHTML = detalleAcordeonHtml(itemsDelPedido, costoPorProducto);
        detail.style.display = "flex";
      }
    });
  }

  const minPct = minVenta > 0 ? (minGanancia / minVenta) * 100 : null;
  const mayPct = mayVenta > 0 ? (mayGanancia / mayVenta) * 100 : null;
  document.getElementById("rentabilidad-minorista").textContent = minPct !== null ? minPct.toFixed(1) + "%" : "—";
  document.getElementById("rentabilidad-mayorista").textContent = mayPct !== null ? mayPct.toFixed(1) + "%" : "—";
}

checkAuth();
setInterval(() => { if (appContent.style.display !== "none") renderAll(); }, 8000);
