function money(n) {
  return "$" + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatFecha(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function getWeekStart(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function getWeekEnd(weekStartStr) {
  const [y, m, d] = weekStartStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function getMonthKey(fechaStr) {
  return fechaStr.slice(0, 7);
}

function getMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}

function diasEntre(fechaA, fechaB) {
  const a = new Date(fechaA + "T00:00:00Z");
  const b = new Date(fechaB + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

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

// ---------- Login ----------

const loginCard = document.getElementById("login-card");
const appContent = document.getElementById("app-content");
const logoutBtn = document.getElementById("logout-btn");

function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "inline-block";
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

// ---------- Gráfico de barras (reutilizado, una sola serie) ----------

function renderBarChart(container, entries) {
  container.innerHTML = "";
  if (entries.length === 0) {
    container.innerHTML = `<span class="hint">Elegí un producto para ver su evolución.</span>`;
    return;
  }
  const maxVal = Math.max(...entries.map(e => e.value), 1);
  entries.forEach(({ label, value }) => {
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    const valLabel = document.createElement("span");
    valLabel.className = "chart-bar-value";
    valLabel.textContent = value > 0 ? String(value) : "";
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = Math.max((value / maxVal) * 100, value > 0 ? 4 : 2) + "%";
    bar.title = `${label}: ${value} unidades`;
    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = label;
    wrap.appendChild(valLabel);
    wrap.appendChild(bar);
    wrap.appendChild(hLabel);
    container.appendChild(wrap);
  });
}

// ---------- Estado global ----------

let hoyFecha = null;
let itemsGlobal = [];
let costosGlobal = [];
let composicionGlobal = [];
let productoCrecimientoSeleccionado = null;
let periodoCrecimiento = "semana";

// ---------- Carga y render principal ----------

async function renderAll() {
  let reportes, costos, composicion, hora;
  try {
    [reportes, costos, composicion, hora] = await Promise.all([
      api("/api/reportes"),
      api("/api/costos"),
      api("/api/composicion"),
      api("/api/hora"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  hoyFecha = hora.fecha;
  itemsGlobal = reportes.items;
  costosGlobal = costos;
  composicionGlobal = composicion;

  renderComposicion();
  renderSelectoresProducto();
  renderRentabilidad();
  renderCrecimiento();
}

// ---------- Composición de combos ----------

function listaDeProductos() {
  return costosGlobal.map(c => c.producto).sort((a, b) => a.localeCompare(b));
}

function renderSelectoresProducto() {
  const productos = listaDeProductos();
  const opciones = productos.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  const comboSelect = document.getElementById("combo-select");
  const componenteSelect = document.getElementById("componente-select");
  const stockSelect = document.getElementById("stock-producto-select");
  const crecimientoSelect = document.getElementById("producto-crecimiento-select");

  [comboSelect, componenteSelect, stockSelect, crecimientoSelect].forEach(sel => {
    const valorPrevio = sel.value;
    sel.innerHTML = opciones;
    if (productos.includes(valorPrevio)) sel.value = valorPrevio;
  });

  if (!productoCrecimientoSeleccionado && productos.length) {
    productoCrecimientoSeleccionado = productos[0];
  }
  if (productoCrecimientoSeleccionado) crecimientoSelect.value = productoCrecimientoSeleccionado;
}

document.getElementById("composicion-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const comboProducto = document.getElementById("combo-select").value;
  const componenteProducto = document.getElementById("componente-select").value;
  const cantidad = parseInt(document.getElementById("componente-cantidad").value, 10) || 1;

  if (!comboProducto || !componenteProducto) return;
  if (comboProducto === componenteProducto) {
    alert("Un producto no puede ser componente de sí mismo.");
    return;
  }

  try {
    await api("/api/composicion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboProducto, componenteProducto, cantidad }),
    });
    document.getElementById("componente-cantidad").value = "1";
    composicionGlobal = await api("/api/composicion");
    renderComposicion();
    renderRentabilidad();
  } catch (err) {
    alert("No se pudo vincular el combo.\n" + err.message);
  }
});

async function deleteComponente(id) {
  try {
    await api("/api/composicion/" + encodeURIComponent(id), { method: "DELETE" });
    composicionGlobal = await api("/api/composicion");
    renderComposicion();
    renderRentabilidad();
  } catch (err) {
    alert("No se pudo desvincular.\n" + err.message);
  }
}

function renderComposicion() {
  const body = document.getElementById("composicion-body");
  if (composicionGlobal.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no vinculaste ningún combo.</td></tr>`;
    return;
  }
  const ordenado = [...composicionGlobal].sort((a, b) => a.comboProducto.localeCompare(b.comboProducto));
  body.innerHTML = ordenado.map(c => `
    <tr>
      <td>${escapeHtml(c.comboProducto)}</td>
      <td>${escapeHtml(c.componenteProducto)}</td>
      <td>${c.cantidad}</td>
      <td><button class="del-btn" title="Desvincular" data-id="${c.id}">✕</button></td>
    </tr>
  `).join("");
  body.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteComponente(btn.dataset.id));
  });
}

// ---------- Stock ----------

document.getElementById("stock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const producto = document.getElementById("stock-producto-select").value;
  const stock = parseInt(document.getElementById("stock-cantidad").value, 10);
  if (!producto || isNaN(stock) || stock < 0) return;

  try {
    await api("/api/costos/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto, stock }),
    });
    document.getElementById("stock-cantidad").value = "";
    costosGlobal = await api("/api/costos");
    renderRentabilidad();
  } catch (err) {
    alert("No se pudo guardar el stock.\n" + err.message);
  }
});

// ---------- Rentabilidad por producto ----------

function calcularUnidadesConsumidas(items, composicion) {
  const composicionPorCombo = {};
  composicion.forEach(c => {
    if (!composicionPorCombo[c.comboProducto]) composicionPorCombo[c.comboProducto] = [];
    composicionPorCombo[c.comboProducto].push({ componente: c.componenteProducto, cantidad: c.cantidad });
  });

  const unidades = {};
  function sumar(producto, cant) {
    unidades[producto] = (unidades[producto] || 0) + cant;
  }

  items.forEach(it => {
    sumar(it.producto, 1);
    const componentes = composicionPorCombo[it.producto];
    if (componentes) componentes.forEach(c => sumar(c.componente, c.cantidad));
  });

  return unidades;
}

function renderRentabilidad() {
  if (!hoyFecha) return;

  const itemsUltimos30 = itemsGlobal.filter(it => diasEntre(it.fecha, hoyFecha) <= 30 && diasEntre(it.fecha, hoyFecha) >= 0);
  const unidades30d = calcularUnidadesConsumidas(itemsUltimos30, composicionGlobal);

  // Margen histórico (todas las ventas), a partir del precio de venta real vs el costo cargado
  const ventaPorProducto = {}; // producto -> { totalVenta, cantidad }
  itemsGlobal.forEach(it => {
    if (!ventaPorProducto[it.producto]) ventaPorProducto[it.producto] = { totalVenta: 0, cantidad: 0 };
    ventaPorProducto[it.producto].totalVenta += it.precio;
    ventaPorProducto[it.producto].cantidad += 1;
  });

  const combosSet = new Set(composicionGlobal.map(c => c.comboProducto));

  const filas = costosGlobal.map(c => {
    const venta = ventaPorProducto[c.producto];
    const margenPct = venta && venta.totalVenta > 0
      ? ((venta.totalVenta - c.costo * venta.cantidad) / venta.totalVenta) * 100
      : null;

    const unidades = unidades30d[c.producto] || 0;
    const stock = c.stock || 0;
    const esCombo = combosSet.has(c.producto);
    const capitalParado = !esCombo ? stock * c.costo : null;
    const diasStock = unidades > 0 ? (stock / (unidades / 30)) : null;

    return { producto: c.producto, margenPct, unidades, stock, esCombo, capitalParado, diasStock };
  });

  filas.sort((a, b) => (b.capitalParado || 0) - (a.capitalParado || 0));

  const body = document.getElementById("rentabilidad-body");
  body.innerHTML = filas.length === 0
    ? `<tr class="empty-row"><td colspan="6">Sin datos todavía.</td></tr>`
    : filas.map(f => `
        <tr>
          <td>${escapeHtml(f.producto)}${f.esCombo ? ' <span class="hint" style="margin:0;">(combo)</span>' : ''}</td>
          <td>${f.margenPct !== null ? f.margenPct.toFixed(1) + "%" : "—"}</td>
          <td>${f.unidades}</td>
          <td>${f.esCombo ? "—" : f.stock}</td>
          <td style="${f.capitalParado && f.unidades === 0 && f.stock > 0 ? 'color:#e15b5b;' : ''}">${f.capitalParado !== null ? money(f.capitalParado) : "—"}</td>
          <td>${f.esCombo ? "—" : (f.diasStock !== null ? Math.round(f.diasStock) + " días" : (f.stock > 0 ? "Sin ventas en 30 días" : "—"))}</td>
        </tr>
      `).join("");
}

// ---------- Crecimiento por producto ----------

document.getElementById("producto-crecimiento-select").addEventListener("change", (e) => {
  productoCrecimientoSeleccionado = e.target.value;
  renderCrecimiento();
});

document.querySelectorAll("#crecimiento-tabs .periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#crecimiento-tabs .periodo-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    periodoCrecimiento = btn.dataset.periodo;
    renderCrecimiento();
  });
});
document.querySelector('#crecimiento-tabs .periodo-tab[data-periodo="semana"]').classList.add("active");

function renderCrecimiento() {
  const container = document.getElementById("chart-crecimiento");
  if (!productoCrecimientoSeleccionado) { renderBarChart(container, []); return; }

  const itemsDelProducto = itemsGlobal.filter(it => it.producto === productoCrecimientoSeleccionado);

  const porPeriodo = {};
  itemsDelProducto.forEach(it => {
    const key = periodoCrecimiento === "semana" ? getWeekStart(it.fecha) : getMonthKey(it.fecha);
    porPeriodo[key] = (porPeriodo[key] || 0) + 1;
  });

  const claves = Object.keys(porPeriodo).sort().slice(-24);
  const entries = claves.map(key => ({
    label: periodoCrecimiento === "semana" ? formatFecha(key) : getMonthLabel(key).slice(0, 3),
    value: porPeriodo[key],
  }));

  renderBarChart(container, entries);
}

checkAuth();
