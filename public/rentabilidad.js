function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
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

function renderBarChart(container, entries, { formatValue = (v) => String(v), unitLabel = "unidades" } = {}) {
  container.innerHTML = "";
  if (entries.length === 0) {
    container.innerHTML = `<span class="hint">Elegí un producto para ver su evolución.</span>`;
    return;
  }
  // Math.abs porque la ganancia puede dar negativa (se vendió bajo costo).
  const maxVal = Math.max(...entries.map(e => Math.abs(e.value)), 1);
  entries.forEach(({ label, value, subLabel }) => {
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    const valLabel = document.createElement("span");
    valLabel.className = "chart-bar-value";
    valLabel.textContent = value !== 0 ? formatValue(value) : "";
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = Math.max((Math.abs(value) / maxVal) * 100, value !== 0 ? 4 : 2) + "%";
    if (value < 0) bar.style.background = "linear-gradient(180deg, #e15b5b, #b83f3f)";
    bar.title = `${label}: ${formatValue(value)} ${unitLabel}`;
    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = label;
    wrap.appendChild(valLabel);
    if (subLabel) {
      const subEl = document.createElement("span");
      subEl.className = "chart-bar-sub-label";
      subEl.textContent = subLabel;
      wrap.appendChild(subEl);
    }
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
  const crecimientoSelect = document.getElementById("producto-crecimiento-select");

  comboSelect.innerHTML = `<option value="" disabled selected>Elegí el combo</option>` + opciones;
  componenteSelect.innerHTML = `<option value="" disabled selected>Elegí el componente</option>` + opciones;

  const valorPrevioCrecimiento = crecimientoSelect.value;
  crecimientoSelect.innerHTML = opciones;
  if (productos.includes(valorPrevioCrecimiento)) crecimientoSelect.value = valorPrevioCrecimiento;

  if (!productoCrecimientoSeleccionado && productos.length) {
    productoCrecimientoSeleccionado = productos[0];
  }
  if (productoCrecimientoSeleccionado) crecimientoSelect.value = productoCrecimientoSeleccionado;

  renderVerComboSelect();
}

function renderVerComboSelect() {
  const verComboSelect = document.getElementById("ver-combo-select");
  const valorPrevio = verComboSelect.value;
  const combos = [...new Set(composicionGlobal.map(c => c.comboProducto))].sort((a, b) => a.localeCompare(b));
  verComboSelect.innerHTML = `<option value="">Elegí un combo para ver su contenido</option>` +
    combos.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (combos.includes(valorPrevio)) verComboSelect.value = valorPrevio;
}

document.getElementById("ver-combo-select").addEventListener("change", renderComposicion);

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
    document.getElementById("combo-select").selectedIndex = 0;
    document.getElementById("componente-select").selectedIndex = 0;
    document.getElementById("componente-cantidad").value = "1";
    composicionGlobal = await api("/api/composicion");
    renderVerComboSelect();
    document.getElementById("ver-combo-select").value = comboProducto;
    renderComposicion();
    renderCrecimiento();
  } catch (err) {
    alert("No se pudo vincular el combo.\n" + err.message);
  }
});

async function deleteComponente(id) {
  try {
    await api("/api/composicion/" + encodeURIComponent(id), { method: "DELETE" });
    composicionGlobal = await api("/api/composicion");
    renderVerComboSelect();
    renderComposicion();
    renderCrecimiento();
  } catch (err) {
    alert("No se pudo desvincular.\n" + err.message);
  }
}

function renderComposicion() {
  const body = document.getElementById("composicion-body");
  const comboElegido = document.getElementById("ver-combo-select").value;

  if (!comboElegido) {
    body.innerHTML = `<tr class="empty-row"><td colspan="3">Elegí un combo arriba para ver de qué está compuesto.</td></tr>`;
    return;
  }

  const componentes = composicionGlobal.filter(c => c.comboProducto === comboElegido);
  if (componentes.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="3">Este combo todavía no tiene componentes vinculados.</td></tr>`;
    return;
  }

  body.innerHTML = componentes.map(c => `
    <tr>
      <td>${escapeHtml(c.componenteProducto)}</td>
      <td>${c.cantidad}</td>
      <td><button class="del-btn" title="Desvincular" data-id="${c.id}">✕</button></td>
    </tr>
  `).join("");
  body.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteComponente(btn.dataset.id));
  });
}

// ---------- Editar costo de un producto ----------

const editarCostoInput = document.getElementById("editar-costo-producto-input");
const editarCostoSuggestions = document.getElementById("editar-costo-producto-suggestions");
const editarCostoValor = document.getElementById("editar-costo-valor");
const editarCostoGuardarBtn = document.getElementById("editar-costo-guardar-btn");
const editarCostoComboHint = document.getElementById("editar-costo-combo-hint");
const editarCostoGuardadoMsg = document.getElementById("editar-costo-guardado");
let editarCostoProductoSeleccionado = null;

function editarCostoRenderSuggestions(matches) {
  if (!matches.length) {
    editarCostoSuggestions.innerHTML = "";
    editarCostoSuggestions.classList.remove("open");
    return;
  }
  editarCostoSuggestions.innerHTML = matches.map(p => `<div class="suggestion-item">${escapeHtml(p)}</div>`).join("");
  editarCostoSuggestions.classList.add("open");
}

function editarCostoSeleccionarProducto(nombre) {
  const fila = costosGlobal.find(c => c.producto === nombre);
  if (!fila) return;
  editarCostoProductoSeleccionado = fila.producto;
  editarCostoInput.value = fila.producto;
  editarCostoValor.value = fila.costo ?? 0;
  editarCostoValor.disabled = false;
  editarCostoGuardarBtn.disabled = false;
  editarCostoGuardadoMsg.style.display = "none";
  const esCombo = composicionGlobal.some(c => c.comboProducto === fila.producto);
  editarCostoComboHint.style.display = esCombo ? "block" : "none";
}

editarCostoInput.addEventListener("input", () => {
  editarCostoProductoSeleccionado = null;
  editarCostoValor.disabled = true;
  editarCostoGuardarBtn.disabled = true;
  editarCostoComboHint.style.display = "none";
  const q = normalizeNombre(editarCostoInput.value);
  if (!q) { editarCostoRenderSuggestions([]); return; }
  const matches = costosGlobal.map(c => c.producto).filter(p => p.toLowerCase().includes(q)).slice(0, 8);
  editarCostoRenderSuggestions(matches);
});
editarCostoInput.addEventListener("blur", () => setTimeout(() => editarCostoRenderSuggestions([]), 150));
editarCostoSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  editarCostoSeleccionarProducto(item.textContent);
  editarCostoRenderSuggestions([]);
  editarCostoValor.focus();
});

editarCostoGuardarBtn.addEventListener("click", async () => {
  if (!editarCostoProductoSeleccionado) return;
  const costo = parseFloat(editarCostoValor.value);
  if (!Number.isFinite(costo) || costo < 0) return;

  editarCostoGuardarBtn.disabled = true;
  try {
    await api("/api/costos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto: editarCostoProductoSeleccionado, costo }),
    });
    [costosGlobal, composicionGlobal] = await Promise.all([api("/api/costos"), api("/api/composicion")]);
    // Si es un combo con componentes completos, el servidor puede haber recalculado el
    // costo justo despues de guardarlo: se vuelve a leer para mostrar el valor real.
    const filaActual = costosGlobal.find(c => c.producto === editarCostoProductoSeleccionado);
    if (filaActual) editarCostoValor.value = filaActual.costo;
    editarCostoGuardadoMsg.style.display = "inline";
    renderCrecimiento();
  } catch (err) {
    alert("No se pudo guardar el costo.\n" + err.message);
  } finally {
    editarCostoGuardarBtn.disabled = false;
  }
});

// ---------- Calculadora de rentabilidad ----------

const calcProductoInput = document.getElementById("calc-producto-input");
const calcProductoSuggestions = document.getElementById("calc-producto-suggestions");
const calcPrecioCosto = document.getElementById("calc-precio-costo");
const calcPrecioVenta = document.getElementById("calc-precio-venta");
let comparacionRentabilidad = [];

function calcRenderSuggestions(matches) {
  if (!matches.length) {
    calcProductoSuggestions.innerHTML = "";
    calcProductoSuggestions.classList.remove("open");
    return;
  }
  calcProductoSuggestions.innerHTML = matches.map(p => `<div class="suggestion-item">${escapeHtml(p)}</div>`).join("");
  calcProductoSuggestions.classList.add("open");
}

function calcCargarCostoDe(nombre) {
  const fila = costosGlobal.find(c => normalizeNombre(c.producto) === normalizeNombre(nombre));
  if (fila) calcPrecioCosto.value = fila.costo || 0;
}

calcProductoInput.addEventListener("input", () => {
  const q = normalizeNombre(calcProductoInput.value);
  if (!q) { calcRenderSuggestions([]); return; }
  const matches = costosGlobal.map(c => c.producto).filter(p => p.toLowerCase().includes(q)).slice(0, 8);
  calcRenderSuggestions(matches);
  calcCargarCostoDe(calcProductoInput.value);
});
calcProductoInput.addEventListener("blur", () => setTimeout(() => calcRenderSuggestions([]), 150));
calcProductoSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  calcProductoInput.value = item.textContent;
  calcRenderSuggestions([]);
  calcCargarCostoDe(item.textContent);
  calcPrecioVenta.focus();
});

function calcActualizarResultado() {
  const costo = parseFloat(calcPrecioCosto.value);
  const venta = parseFloat(calcPrecioVenta.value);
  const gananciaEl = document.getElementById("calc-ganancia");
  const pctEl = document.getElementById("calc-pct");

  if (!Number.isFinite(venta) || venta <= 0) {
    gananciaEl.textContent = "$0";
    pctEl.textContent = "—";
    return null;
  }
  const costoUsado = Number.isFinite(costo) ? costo : 0;
  const ganancia = venta - costoUsado;
  const pct = (ganancia / venta) * 100;
  gananciaEl.textContent = money(ganancia);
  gananciaEl.style.color = ganancia < 0 ? "var(--red)" : "";
  pctEl.textContent = pct.toFixed(1) + "%";
  pctEl.style.color = ganancia < 0 ? "var(--red)" : "";
  return { costo: costoUsado, venta, ganancia, pct };
}

[calcPrecioCosto, calcPrecioVenta].forEach(input => {
  input.addEventListener("input", calcActualizarResultado);
});

function calcRenderComparacion() {
  const body = document.getElementById("calc-comparacion-body");
  if (comparacionRentabilidad.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">Probá un precio de venta y agregalo acá para comparar.</td></tr>`;
    return;
  }
  body.innerHTML = comparacionRentabilidad.map((f, idx) => `
    <tr>
      <td>${f.producto ? escapeHtml(f.producto) : "—"}</td>
      <td>${money(f.costo)}</td>
      <td>${money(f.venta)}</td>
      <td style="${f.ganancia < 0 ? 'color:var(--red);' : ''}">${money(f.ganancia)}</td>
      <td style="${f.ganancia < 0 ? 'color:var(--red);' : ''}">${f.pct.toFixed(1)}%</td>
      <td><button class="del-btn" title="Quitar" data-idx="${idx}">✕</button></td>
    </tr>
  `).join("");
  body.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      comparacionRentabilidad.splice(Number(btn.dataset.idx), 1);
      calcRenderComparacion();
    });
  });
}

document.getElementById("calc-agregar-btn").addEventListener("click", () => {
  const resultado = calcActualizarResultado();
  if (!resultado) {
    alert("Ingresá un precio de venta para poder agregarlo a la comparación.");
    return;
  }
  comparacionRentabilidad.push({ producto: calcProductoInput.value.trim(), ...resultado });
  calcRenderComparacion();
});

document.getElementById("calc-limpiar-btn").addEventListener("click", () => {
  if (comparacionRentabilidad.length > 0 && !confirm("¿Limpiar toda la comparación?")) return;
  comparacionRentabilidad = [];
  calcRenderComparacion();
});

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

function unidadesConsumidasPorPeriodo(productoObjetivo, composicion, periodo) {
  // Igual que calcularUnidadesConsumidas de la tabla de arriba, pero agrupado por semana/mes:
  // si el producto elegido es componente de un combo, esas ventas también suman acá.
  const composicionPorCombo = {};
  composicion.forEach(c => {
    if (!composicionPorCombo[c.comboProducto]) composicionPorCombo[c.comboProducto] = [];
    composicionPorCombo[c.comboProducto].push({ componente: c.componenteProducto, cantidad: c.cantidad });
  });

  const porPeriodo = {};
  function sumar(fecha, cant) {
    const key = periodo === "semana" ? getWeekStart(fecha) : getMonthKey(fecha);
    porPeriodo[key] = (porPeriodo[key] || 0) + cant;
  }

  itemsGlobal.forEach(it => {
    if (it.producto === productoObjetivo) sumar(it.fecha, 1);
    const componentes = composicionPorCombo[it.producto];
    if (componentes) {
      const match = componentes.find(c => c.componente === productoObjetivo);
      if (match) sumar(it.fecha, match.cantidad);
    }
  });

  return porPeriodo;
}

// A diferencia de unidadesConsumidasPorPeriodo, esto NO reparte ingresos/ganancia entre
// los componentes de un combo (no hay forma de saber qué parte del precio del combo le
// corresponde a cada componente): solo cuenta las ventas donde el producto elegido se
// vendió directamente con su propio precio registrado.
function metricasPorPeriodo(productoObjetivo, periodo) {
  const costoRow = costosGlobal.find(c => normalizeNombre(c.producto) === normalizeNombre(productoObjetivo));
  const costo = costoRow ? costoRow.costo : null;

  const porPeriodo = {};
  function entradaDe(fecha) {
    const key = periodo === "semana" ? getWeekStart(fecha) : getMonthKey(fecha);
    if (!porPeriodo[key]) porPeriodo[key] = { unidades: 0, ingresos: 0, ganancia: 0 };
    return porPeriodo[key];
  }

  itemsGlobal.forEach(it => {
    if (it.producto !== productoObjetivo) return;
    const entrada = entradaDe(it.fecha);
    entrada.unidades += 1;
    entrada.ingresos += it.precio;
    if (costo !== null) entrada.ganancia += it.precio - costo;
  });

  return { porPeriodo, tieneCosto: costo !== null };
}

function renderCrecimiento() {
  const containerUnidades = document.getElementById("chart-crecimiento");
  const containerIngresos = document.getElementById("chart-crecimiento-ingresos");
  const containerGanancia = document.getElementById("chart-crecimiento-ganancia");

  if (!productoCrecimientoSeleccionado) {
    renderBarChart(containerUnidades, []);
    renderBarChart(containerIngresos, []);
    renderBarChart(containerGanancia, []);
    return;
  }

  const porPeriodoUnidades = unidadesConsumidasPorPeriodo(productoCrecimientoSeleccionado, composicionGlobal, periodoCrecimiento);
  const clavesUnidades = Object.keys(porPeriodoUnidades).sort().slice(-24);
  const entriesUnidades = clavesUnidades.map(key => ({
    label: periodoCrecimiento === "semana" ? formatFecha(key) : getMonthLabel(key).slice(0, 3),
    value: porPeriodoUnidades[key],
  }));
  renderBarChart(containerUnidades, entriesUnidades);

  const { porPeriodo: porPeriodoMetricas, tieneCosto } = metricasPorPeriodo(productoCrecimientoSeleccionado, periodoCrecimiento);
  const clavesMetricas = Object.keys(porPeriodoMetricas).sort().slice(-24);

  const entriesIngresos = clavesMetricas.map(key => {
    const m = porPeriodoMetricas[key];
    const precioProm = m.unidades > 0 ? m.ingresos / m.unidades : 0;
    return {
      label: periodoCrecimiento === "semana" ? formatFecha(key) : getMonthLabel(key).slice(0, 3),
      value: m.ingresos,
      subLabel: m.unidades > 0 ? `Prom: ${money(precioProm)}` : "",
    };
  });
  renderBarChart(containerIngresos, entriesIngresos, { formatValue: money, unitLabel: "de ingresos" });

  if (!tieneCosto) {
    containerGanancia.innerHTML = `<span class="hint">Este producto no tiene costo cargado, así que no se puede calcular la ganancia.</span>`;
  } else {
    const entriesGanancia = clavesMetricas.map(key => ({
      label: periodoCrecimiento === "semana" ? formatFecha(key) : getMonthLabel(key).slice(0, 3),
      value: porPeriodoMetricas[key].ganancia,
    }));
    renderBarChart(containerGanancia, entriesGanancia, { formatValue: money, unitLabel: "de ganancia" });
  }
}

checkAuth();
