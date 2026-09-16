const TIMEZONE = "America/Argentina/Buenos_Aires";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function getHoyFechaArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

function formatFechaLarga(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatFechaCorta(fechaStr) {
  const [, m, d] = fechaStr.split("-");
  return `${d}/${m}`;
}

function money(n) {
  return "$" + Math.round(n || 0).toLocaleString("es-AR");
}

function fechaHaceNDias(fechaStr, n) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function getWeekStart(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day; // retrocede hasta el lunes
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
  return fechaStr.slice(0, 7); // YYYY-MM
}

function getMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
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
  cargarResumen();
  setInterval(cargarResumen, 10000);
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

// ---------- Datos ----------

let todasComisiones = [];
let resumenPeriodo = "dia";

async function cargarResumen() {
  try {
    todasComisiones = await api("/api/comisiones-minoristas");
    renderStatsHeadline();
    renderResumen();
    renderDetalle();
  } catch (err) {
    document.getElementById("resumen-body").innerHTML =
      `<tr class="empty-row"><td colspan="3">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderStatsHeadline() {
  const hoy = getHoyFechaArgentina();
  const inicioSemana = getWeekStart(hoy);
  const inicioMes = getMonthKey(hoy);

  const deHoy = todasComisiones.filter((c) => c.fecha === hoy);
  const deSemana = todasComisiones.filter((c) => c.fecha >= inicioSemana);
  const deMes = todasComisiones.filter((c) => getMonthKey(c.fecha) === inicioMes);

  document.getElementById("stat-hoy").textContent = money(deHoy.reduce((a, c) => a + c.comision, 0));
  document.getElementById("stat-hoy-cant").textContent = `${deHoy.length} venta${deHoy.length === 1 ? "" : "s"}`;

  document.getElementById("stat-semana").textContent = money(deSemana.reduce((a, c) => a + c.comision, 0));
  document.getElementById("stat-semana-cant").textContent = `${deSemana.length} venta${deSemana.length === 1 ? "" : "s"}`;

  document.getElementById("stat-mes").textContent = money(deMes.reduce((a, c) => a + c.comision, 0));
  document.getElementById("stat-mes-cant").textContent = `${deMes.length} venta${deMes.length === 1 ? "" : "s"}`;
}

// "Día" se arma como los últimos 30 días de corrido (con 0 en los que no hubo
// comisión): en una ventana corta, ver los días en cero también es información útil.
function entradasPorDia(dias) {
  const porFecha = new Map();
  todasComisiones.forEach((c) => {
    if (!porFecha.has(c.fecha)) porFecha.set(c.fecha, []);
    porFecha.get(c.fecha).push(c);
  });

  const [y, m, d] = getHoyFechaArgentina().split("-").map(Number);
  const lista = [];
  for (let i = dias - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() - i);
    const fecha = date.toISOString().slice(0, 10);
    const rows = porFecha.get(fecha) || [];
    lista.push({
      key: fecha,
      label: formatFechaLarga(fecha),
      cantidad: rows.length,
      comision: rows.reduce((a, r) => a + r.comision, 0),
    });
  }
  return lista;
}

function renderResumen() {
  let entradas, etiquetaCortaDe, cantidadEnGrafico;

  if (resumenPeriodo === "dia") {
    entradas = entradasPorDia(30);
    etiquetaCortaDe = (e) => formatFechaCorta(e.key);
    cantidadEnGrafico = 30;
  } else {
    const grupos = new Map(); // clave del período -> comisiones de ese período
    todasComisiones.forEach((c) => {
      const key = resumenPeriodo === "semana" ? getWeekStart(c.fecha) : getMonthKey(c.fecha);
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(c);
    });
    entradas = [...grupos.keys()].sort().map((key) => {
      const rows = grupos.get(key);
      const label = resumenPeriodo === "semana"
        ? `${formatFechaCorta(key)} al ${formatFechaCorta(getWeekEnd(key))}`
        : getMonthLabel(key);
      return {
        key,
        label,
        cantidad: rows.length,
        comision: rows.reduce((a, r) => a + r.comision, 0),
      };
    });
    etiquetaCortaDe = (e) => (resumenPeriodo === "semana" ? formatFechaCorta(e.key) : e.key.slice(5));
    cantidadEnGrafico = 12;
  }

  // Gráfico: las últimas N, de más vieja a más nueva.
  const ultimas = entradas.slice(-cantidadEnGrafico);
  const chart = document.getElementById("comisiones-chart");
  chart.innerHTML = "";
  const maxVal = Math.max(...ultimas.map((e) => e.comision), 1);
  ultimas.forEach((e) => {
    const heightPct = e.comision > 0 ? Math.max((e.comision / maxVal) * 100, 4) : 2;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    wrap.innerHTML = `
      <span class="chart-bar-value">${e.comision > 0 ? money(e.comision) : ""}</span>
      <div class="chart-bar" style="height:${heightPct}%" title="${escapeHtml(e.label)}: ${e.cantidad} ventas, ${money(e.comision)}"></div>
      <span class="chart-bar-label">${escapeHtml(etiquetaCortaDe(e))}</span>
    `;
    chart.appendChild(wrap);
  });

  // Tabla: más reciente primero.
  const tbody = document.getElementById("resumen-body");
  if (!entradas.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Todavía no se registró ninguna comisión.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...entradas].reverse().map((e) => `
    <tr>
      <td>${escapeHtml(e.label)}</td>
      <td>${e.cantidad}</td>
      <td>${money(e.comision)}</td>
    </tr>
  `).join("");
}

function renderDetalle() {
  const tbody = document.getElementById("detalle-body");
  if (!todasComisiones.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no se registró ninguna comisión.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...todasComisiones]
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .slice(0, 100)
    .map((c) => `
      <tr>
        <td>${formatFechaCorta(c.fecha)}</td>
        <td>${escapeHtml((c.horaLabel || "").slice(0, 5))}</td>
        <td>${money(c.montoVenta)}</td>
        <td>${money(c.excedente)}</td>
        <td style="color:var(--green); font-weight:700;">${money(c.comision)}</td>
      </tr>
    `).join("");
}

document.getElementById("resumen-periodo-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".periodo-tab");
  if (!btn) return;
  document.querySelectorAll("#resumen-periodo-tabs .periodo-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  resumenPeriodo = btn.dataset.periodo;

  const TITULOS = { dia: "Comisión por día (últimos 30 días)", semana: "Comisión por semana", mes: "Comisión por mes" };
  const ENCABEZADOS = { dia: "Día", semana: "Semana", mes: "Mes" };
  document.getElementById("resumen-titulo").textContent = TITULOS[resumenPeriodo];
  document.getElementById("th-periodo").textContent = ENCABEZADOS[resumenPeriodo];
  renderResumen();
});

checkAuth();
