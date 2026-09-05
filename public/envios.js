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

let todosEnvios = []; // ventas con envioMetodo === "uber_moto"
let resumenPeriodo = "7dias";

async function cargarResumen() {
  try {
    const { ventas } = await api("/api/reportes");
    todosEnvios = ventas.filter((v) => v.envioMetodo === "uber_moto");
    renderStatsHeadline();
    renderResumen();
  } catch (err) {
    document.getElementById("resumen-body").innerHTML =
      `<tr class="empty-row"><td colspan="4">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderStatsHeadline() {
  const hoy = getHoyFechaArgentina();
  const hace7 = fechaHaceNDias(hoy, 6); // ventana de 7 días, incluyendo hoy
  const hace30 = fechaHaceNDias(hoy, 29);
  const en7 = todosEnvios.filter((v) => v.fecha >= hace7);
  const en30 = todosEnvios.filter((v) => v.fecha >= hace30);
  document.getElementById("stat-7dias").textContent = en7.length;
  document.getElementById("stat-30dias").textContent = en30.length;
  document.getElementById("stat-costo-30dias").textContent = money(en30.reduce((a, v) => a + (v.envioCosto || 0), 0));
}

// Para "7 días"/"30 días" se arman esos días de corrido (con 0 en los que no hubo
// ningún envío): en una ventana corta, ver los días en cero también es información útil.
function entradasPorDia(dias) {
  const porFecha = new Map();
  todosEnvios.forEach((v) => {
    if (!porFecha.has(v.fecha)) porFecha.set(v.fecha, []);
    porFecha.get(v.fecha).push(v);
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
      costo: rows.reduce((a, r) => a + (r.envioCosto || 0), 0),
    });
  }
  return lista;
}

function renderResumen() {
  let entradas, etiquetaCortaDe, cantidadEnGrafico;

  if (resumenPeriodo === "7dias" || resumenPeriodo === "30dias") {
    const dias = resumenPeriodo === "7dias" ? 7 : 30;
    entradas = entradasPorDia(dias);
    etiquetaCortaDe = (e) => formatFechaCorta(e.key);
    cantidadEnGrafico = dias;
  } else {
    const grupos = new Map(); // clave del período -> ventas de ese período
    todosEnvios.forEach((v) => {
      const key = resumenPeriodo === "semana" ? getWeekStart(v.fecha) : getMonthKey(v.fecha);
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(v);
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
        costo: rows.reduce((a, r) => a + (r.envioCosto || 0), 0),
      };
    });
    etiquetaCortaDe = (e) => (resumenPeriodo === "semana" ? formatFechaCorta(e.key) : e.key.slice(5));
    cantidadEnGrafico = 12;
  }

  // Gráfico: las últimas N, de más vieja a más nueva.
  const ultimas = entradas.slice(-cantidadEnGrafico);
  const chart = document.getElementById("envios-chart");
  chart.innerHTML = "";
  const maxVal = Math.max(...ultimas.map((e) => e.cantidad), 1);
  ultimas.forEach((e) => {
    const heightPct = e.cantidad > 0 ? Math.max((e.cantidad / maxVal) * 100, 4) : 2;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    wrap.innerHTML = `
      <span class="chart-bar-value">${e.cantidad || ""}</span>
      <div class="chart-bar" style="height:${heightPct}%" title="${escapeHtml(e.label)}: ${e.cantidad} envíos, ${money(e.costo)}"></div>
      <span class="chart-bar-label">${escapeHtml(etiquetaCortaDe(e))}</span>
    `;
    chart.appendChild(wrap);
  });

  // Tabla: más reciente primero.
  const tbody = document.getElementById("resumen-body");
  if (!entradas.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no se registró ningún envío por Uber Moto.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...entradas].reverse().map((e) => `
    <tr>
      <td>${escapeHtml(e.label)}</td>
      <td>${e.cantidad}</td>
      <td>${money(e.costo)}</td>
      <td>${e.cantidad ? money(e.costo / e.cantidad) : "-"}</td>
    </tr>
  `).join("");
}

document.getElementById("resumen-periodo-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".periodo-tab");
  if (!btn) return;
  document.querySelectorAll("#resumen-periodo-tabs .periodo-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  resumenPeriodo = btn.dataset.periodo;

  const TITULOS = {
    "7dias": "Envíos por día (últimos 7 días)",
    "30dias": "Envíos por día (últimos 30 días)",
    semana: "Envíos por semana",
    mes: "Envíos por mes",
  };
  const ENCABEZADOS = { "7dias": "Día", "30dias": "Día", semana: "Semana", mes: "Mes" };
  document.getElementById("resumen-titulo").textContent = TITULOS[resumenPeriodo];
  document.getElementById("th-periodo").textContent = ENCABEZADOS[resumenPeriodo];
  renderResumen();
});

checkAuth();
