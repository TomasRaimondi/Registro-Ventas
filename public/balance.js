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

function formatFechaCorta(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

function formatFechaLarga(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
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

// ---------- Estado global ----------

let hoyFecha = null;
let fechaSeleccionada = null; // null = sigue "hoy"
let costosGlobal = [];
let comprasGlobal = [];
let composicionGlobal = [];
let itemsGlobal = [];
let gastosGlobal = [];
let salarioGlobal = [];
let balanceManualGlobal = [];

const fechaInput = document.getElementById("fecha-evaluacion");
const hoyBtn = document.getElementById("hoy-btn");

// ---------- Carga de datos ----------

async function renderAll() {
  let reportes, costos, compras, composicion, salario, balance, hora;
  try {
    [reportes, costos, compras, composicion, salario, balance, hora] = await Promise.all([
      api("/api/reportes"),
      api("/api/costos"),
      api("/api/compras"),
      api("/api/composicion"),
      api("/api/salario"),
      api("/api/balance"),
      api("/api/hora"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  hoyFecha = hora.fecha;
  itemsGlobal = reportes.items;
  gastosGlobal = reportes.gastos;
  costosGlobal = costos;
  comprasGlobal = compras;
  composicionGlobal = composicion;
  salarioGlobal = salario;
  balanceManualGlobal = balance;

  if (!fechaInput.value) fechaInput.value = hoyFecha;
  fechaInput.max = hoyFecha;

  renderTodo();
}

fechaInput.addEventListener("change", () => {
  if (!fechaInput.value) return;
  fechaSeleccionada = fechaInput.value;
  renderTodo();
});

hoyBtn.addEventListener("click", () => {
  fechaSeleccionada = null;
  fechaInput.value = hoyFecha;
  renderTodo();
});

// ---------- Cálculo: stock y costo promedio ponderado, reconstruidos a una fecha ----------

function calcularStockYCostoAsOf(fechaCorte) {
  const composicionPorCombo = {};
  composicionGlobal.forEach(c => {
    if (!composicionPorCombo[c.comboProducto]) composicionPorCombo[c.comboProducto] = [];
    composicionPorCombo[c.comboProducto].push({ componente: c.componenteProducto, cantidad: c.cantidad });
  });

  // Se parte del stock ACTUAL (el único valor que conocemos con certeza) y se deshacen
  // solo los movimientos posteriores a la fecha elegida. Reconstruir "desde cero" hacia
  // adelante asumiría erróneamente que el stock era 0 antes del primer movimiento cargado.
  const entradasDespues = {};
  comprasGlobal.forEach(c => {
    if (c.fecha > fechaCorte) {
      entradasDespues[c.producto] = (entradasDespues[c.producto] || 0) + c.cantidad;
    }
  });

  const consumidoDespues = {};
  function sumarConsumo(producto, cantidad) {
    consumidoDespues[producto] = (consumidoDespues[producto] || 0) + cantidad;
  }
  itemsGlobal.forEach(it => {
    if (it.fecha <= fechaCorte) return;
    sumarConsumo(it.producto, 1);
    const comps = composicionPorCombo[it.producto];
    if (comps) comps.forEach(c => sumarConsumo(c.componente, c.cantidad));
  });

  const combosSet = new Set(composicionGlobal.map(c => c.comboProducto));
  const productos = new Set(costosGlobal.map(c => c.producto));

  let capitalStock = 0;
  const detalle = [];

  productos.forEach(producto => {
    if (combosSet.has(producto)) return; // los combos no tienen stock propio

    const costoRow = costosGlobal.find(c => c.producto === producto);
    const stockActual = costoRow ? (costoRow.stock || 0) : 0;

    const entrado = entradasDespues[producto] || 0;
    const vendido = consumidoDespues[producto] || 0;
    const stockAsOf = Math.max(0, stockActual - entrado + vendido);

    // Valuación al costo actual del producto (no promedio histórico de compras).
    const costoActual = costoRow ? costoRow.costo : 0;

    const capital = stockAsOf * costoActual;
    capitalStock += capital;
    if (stockAsOf > 0) detalle.push({ producto, stock: stockAsOf, costoActual, capital });
  });

  detalle.sort((a, b) => b.capital - a.capital);
  return { capitalStock, detalle };
}

// ---------- Cálculo: ganancia acumulada a una fecha ----------

function calcularGananciaAcumulada(fechaCorte) {
  const costoPorProducto = {};
  costosGlobal.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  let gananciaBruta = 0;
  itemsGlobal.forEach(it => {
    if (it.fecha > fechaCorte) return;
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      gananciaBruta += it.precio - costoPorProducto[key];
    }
  });

  const gastoTotal = gastosGlobal.filter(g => g.fecha <= fechaCorte).reduce((a, g) => a + g.monto, 0);
  const sueldoTotal = salarioGlobal.filter(s => s.fecha <= fechaCorte).reduce((a, s) => a + s.sueldo + s.comision, 0);
  const gananciaNeta = gananciaBruta - gastoTotal - sueldoTotal;

  return { gananciaBruta, gastoTotal, sueldoTotal, gananciaNeta };
}

// ---------- Datos manuales: buscar el snapshot correspondiente a una fecha ----------

function buscarSnapshot(fecha) {
  return balanceManualGlobal.find(b => b.fecha === fecha) || null;
}

function buscarUltimoSnapshotHasta(fecha) {
  const candidatos = balanceManualGlobal.filter(b => b.fecha <= fecha);
  if (!candidatos.length) return null;
  return candidatos.reduce((a, b) => (a.fecha > b.fecha ? a : b));
}

function poblarFormulario(fecha) {
  const exacto = buscarSnapshot(fecha);
  const sinSnapshotHint = document.getElementById("sin-snapshot-hint");

  let base = exacto;
  if (!base) {
    base = buscarUltimoSnapshotHasta(fecha);
    if (base) {
      sinSnapshotHint.style.display = "block";
      document.getElementById("sin-snapshot-fecha").textContent = formatFechaLarga(base.fecha);
    } else {
      sinSnapshotHint.style.display = "none";
    }
  } else {
    sinSnapshotHint.style.display = "none";
  }

  document.getElementById("capital-transferencia").value = base ? base.capitalTransferencia : "";
  document.getElementById("capital-efectivo").value = base ? base.capitalEfectivo : "";
  document.getElementById("capital-proceso").value = base ? base.capitalEnProceso : "";
  document.getElementById("deudas").value = base ? base.deudas : "";
  document.getElementById("inversion-inicial").value = base ? base.inversionInicial : "";
  document.getElementById("balance-nota").value = exacto && exacto.nota ? exacto.nota : "";
}

// ---------- Guardar datos manuales ----------

const balanceForm = document.getElementById("balance-form");
const balanceSubmitBtn = document.getElementById("balance-submit-btn");

balanceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fecha = fechaSeleccionada || hoyFecha;

  const body = {
    fecha,
    capitalTransferencia: parseFloat(document.getElementById("capital-transferencia").value) || 0,
    capitalEfectivo: parseFloat(document.getElementById("capital-efectivo").value) || 0,
    capitalEnProceso: parseFloat(document.getElementById("capital-proceso").value) || 0,
    deudas: parseFloat(document.getElementById("deudas").value) || 0,
    inversionInicial: parseFloat(document.getElementById("inversion-inicial").value) || 0,
    nota: document.getElementById("balance-nota").value.trim(),
  };

  balanceSubmitBtn.disabled = true;
  balanceSubmitBtn.textContent = "Guardando...";
  try {
    await api("/api/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await renderAll();
  } catch (err) {
    alert("No se pudieron guardar los datos.\n" + err.message);
  } finally {
    balanceSubmitBtn.disabled = false;
    balanceSubmitBtn.textContent = "Guardar datos de esta fecha";
  }
});

// ---------- Borrar un snapshot del historial ----------

async function deleteSnapshot(fecha) {
  if (!confirm(`¿Borrar los datos cargados para el ${formatFechaLarga(fecha)}?`)) return;
  try {
    await api("/api/balance/" + encodeURIComponent(fecha), { method: "DELETE" });
    await renderAll();
  } catch (err) {
    alert("No se pudo borrar.\n" + err.message);
  }
}

// ---------- Gráfico de evolución del patrimonio ----------

function renderBarChart(container, entries) {
  container.innerHTML = "";
  if (entries.length === 0) {
    container.innerHTML = `<span class="hint">Guardá datos en más de una fecha para ver la evolución.</span>`;
    return;
  }
  const maxVal = Math.max(...entries.map(e => Math.abs(e.value)), 1);
  entries.forEach(({ label, value }) => {
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    const valLabel = document.createElement("span");
    valLabel.className = "chart-bar-value";
    valLabel.textContent = money(value);
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = Math.max((Math.abs(value) / maxVal) * 100, 4) + "%";
    if (value < 0) bar.style.background = "linear-gradient(180deg, var(--red), #b83f3f)";
    bar.title = `${label}: ${money(value)}`;
    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = label;
    wrap.appendChild(valLabel);
    wrap.appendChild(bar);
    wrap.appendChild(hLabel);
    container.appendChild(wrap);
  });
}

// Capital total = todo lo que tiene el negocio neto de deudas. Patrimonio neto = eso
// menos lo que el dueño puso al principio, así el número principal muestra la ganancia
// real generada, no la plata que el dueño ya había puesto de su bolsillo.
function calcularPatrimonio(fecha) {
  const { capitalStock, detalle } = calcularStockYCostoAsOf(fecha);
  const snapshot = buscarSnapshot(fecha) || buscarUltimoSnapshotHasta(fecha) || {
    capitalTransferencia: 0, capitalEfectivo: 0, capitalEnProceso: 0, deudas: 0, inversionInicial: 0,
  };
  const capitalTotal = capitalStock + snapshot.capitalTransferencia + snapshot.capitalEfectivo + snapshot.capitalEnProceso - snapshot.deudas;
  const patrimonio = capitalTotal - snapshot.inversionInicial;
  return { capitalStock, detalle, snapshot, capitalTotal, patrimonio };
}

// ---------- Render principal ----------

function renderTodo() {
  const fecha = fechaSeleccionada || hoyFecha;
  const esHoy = fecha === hoyFecha;

  document.getElementById("fecha-label").textContent = esHoy ? "hoy" : formatFechaLarga(fecha);
  document.getElementById("patrimonio-fecha-label").textContent = esHoy ? "hoy" : formatFechaCorta(fecha);
  hoyBtn.style.display = esHoy ? "none" : "inline-block";

  poblarFormulario(fecha);

  const { capitalStock, detalle, snapshot, capitalTotal, patrimonio } = calcularPatrimonio(fecha);

  const patrimonioEl = document.getElementById("stat-patrimonio");
  patrimonioEl.textContent = money(patrimonio);
  patrimonioEl.classList.toggle("value-positive", patrimonio > 0);
  patrimonioEl.classList.toggle("value-negative", patrimonio < 0);
  document.getElementById("stat-capital-total").textContent = money(capitalTotal);
  document.getElementById("stat-capital-stock").textContent = money(capitalStock);
  document.getElementById("stat-capital-transferencia").textContent = money(snapshot.capitalTransferencia);
  document.getElementById("stat-capital-efectivo").textContent = money(snapshot.capitalEfectivo);
  document.getElementById("stat-capital-proceso").textContent = money(snapshot.capitalEnProceso);
  document.getElementById("stat-deudas").textContent = money(snapshot.deudas);

  const ganancia = calcularGananciaAcumulada(fecha);
  document.getElementById("stat-ganancia-bruta").textContent = money(ganancia.gananciaBruta);
  document.getElementById("stat-gastos-acum").textContent = money(ganancia.gastoTotal);
  document.getElementById("stat-sueldos-acum").textContent = money(ganancia.sueldoTotal);
  const gananciaNetaEl = document.getElementById("stat-ganancia-neta-acum");
  gananciaNetaEl.innerHTML = `<strong>${money(ganancia.gananciaNeta)}</strong>`;
  gananciaNetaEl.style.color = ganancia.gananciaNeta >= 0 ? "var(--green)" : "var(--red)";

  // El patrimonio ya es "capital total - inversión inicial", así que retorno == patrimonio.
  const retornoPct = snapshot.inversionInicial > 0 ? (patrimonio / snapshot.inversionInicial) * 100 : null;
  document.getElementById("stat-retorno-pct").textContent = retornoPct !== null ? retornoPct.toFixed(1) + "%" : "— (cargá la inversión inicial)";

  const activosLiquidos = snapshot.capitalEfectivo + snapshot.capitalTransferencia + snapshot.capitalEnProceso;
  document.getElementById("stat-liquidez").textContent = snapshot.deudas > 0
    ? (activosLiquidos / snapshot.deudas).toFixed(2) + "x"
    : "Sin deudas cargadas";

  const anterior = balanceManualGlobal.filter(b => b.fecha < fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  const variacionEl = document.getElementById("stat-variacion");
  if (anterior) {
    const { patrimonio: patrimonioAnterior } = calcularPatrimonio(anterior.fecha);
    const variacion = patrimonio - patrimonioAnterior;
    variacionEl.textContent = `${money(variacion)} desde el ${formatFechaCorta(anterior.fecha)}`;
    variacionEl.style.color = variacion >= 0 ? "var(--green)" : "var(--red)";
  } else {
    variacionEl.textContent = "Sin datos anteriores para comparar";
    variacionEl.style.color = "var(--text-dim)";
  }

  const detalleBody = document.getElementById("stock-detalle-body");
  detalleBody.innerHTML = detalle.length === 0
    ? `<tr class="empty-row"><td colspan="4">Sin stock cargado.</td></tr>`
    : detalle.slice(0, 30).map(d => `
        <tr>
          <td>${escapeHtml(d.producto)}</td>
          <td>${d.stock}</td>
          <td>${money(d.costoActual)}</td>
          <td>${money(d.capital)}</td>
        </tr>
      `).join("");

  renderHistorialBalance();
  renderChartPatrimonio();
}

function renderHistorialBalance() {
  const body = document.getElementById("historial-balance-body");
  const filas = [...balanceManualGlobal].sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (filas.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">Todavía no cargaste datos.</td></tr>`;
    return;
  }

  body.innerHTML = filas.map(b => `
    <tr>
      <td>${formatFechaCorta(b.fecha)}</td>
      <td>${money(b.capitalTransferencia)}</td>
      <td>${money(b.capitalEfectivo)}</td>
      <td>${money(b.capitalEnProceso)}</td>
      <td>${money(b.deudas)}</td>
      <td>${money(b.inversionInicial)}</td>
      <td>${b.nota ? escapeHtml(b.nota) : "—"}</td>
      <td><button class="del-btn" title="Borrar" data-fecha="${b.fecha}">✕</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteSnapshot(btn.dataset.fecha));
  });
}

function renderChartPatrimonio() {
  const fechas = [...balanceManualGlobal].map(b => b.fecha).sort();
  const entries = fechas.slice(-24).map(fecha => {
    const { patrimonio } = calcularPatrimonio(fecha);
    return { label: formatFechaCorta(fecha), value: patrimonio };
  });
  renderBarChart(document.getElementById("chart-patrimonio"), entries);
}

checkAuth();
