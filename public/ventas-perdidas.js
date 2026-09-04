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
  cargar();
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

// ---------- Fecha ----------

let fechaSeleccionada = null; // null = hoy
const fechaInput = document.getElementById("fecha-input");
const hoyBtn = document.getElementById("hoy-btn");

fechaInput.addEventListener("change", () => {
  if (!fechaInput.value) return;
  fechaSeleccionada = fechaInput.value;
  cargar();
});

hoyBtn.addEventListener("click", () => {
  fechaSeleccionada = null;
  fechaInput.value = getHoyFechaArgentina();
  cargar();
});

// ---------- Carga y render ----------

async function cargar() {
  const hoyFecha = getHoyFechaArgentina();
  const fechaActiva = fechaSeleccionada || hoyFecha;
  fechaInput.value = fechaActiva;
  hoyBtn.style.display = fechaActiva === hoyFecha ? "none" : "inline-block";
  document.getElementById("fecha-label").textContent = fechaActiva === hoyFecha ? "hoy" : formatFechaLarga(fechaActiva);

  const tbody = document.getElementById("lista-body");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Cargando...</td></tr>`;

  try {
    const rows = await api("/api/ventas-perdidas?fecha=" + encodeURIComponent(fechaActiva));
    document.getElementById("stat-total").textContent = rows.length;

    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="3">No se registró ninguna venta perdida ese día.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(r.horaLabel.slice(0, 5))}</td>
        <td>${escapeHtml(r.motivo)}</td>
        <td></td>
      `;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "clear-btn";
      btn.textContent = "Borrar";
      btn.addEventListener("click", () => borrar(r.id, btn));
      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function borrar(id, btn) {
  if (!confirm("¿Borrar este registro de venta perdida?")) return;
  btn.disabled = true;
  try {
    await api("/api/ventas-perdidas/" + encodeURIComponent(id), { method: "DELETE" });
    await cargar();
    await cargarResumen();
  } catch (err) {
    btn.disabled = false;
    alert("No se pudo borrar: " + err.message);
  }
}

// ---------- Resumen por semana / mes ----------

let todasVentasPerdidas = [];
let resumenPeriodo = "semana";

async function cargarResumen() {
  try {
    todasVentasPerdidas = await api("/api/ventas-perdidas-todas");
    renderResumen();
  } catch (err) {
    document.getElementById("resumen-body").innerHTML =
      `<tr class="empty-row"><td colspan="3">Error al cargar el resumen: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function motivoMasComun(rows) {
  const conteo = new Map();
  rows.forEach((r) => conteo.set(r.motivo, (conteo.get(r.motivo) || 0) + 1));
  let top = null;
  let topN = 0;
  for (const [motivo, n] of conteo) {
    if (n > topN) { top = motivo; topN = n; }
  }
  return top;
}

function renderResumen() {
  const grupos = new Map(); // clave del período -> filas de ese período
  todasVentasPerdidas.forEach((r) => {
    const key = resumenPeriodo === "semana" ? getWeekStart(r.fecha) : getMonthKey(r.fecha);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(r);
  });

  const entradas = [...grupos.keys()].sort().map((key) => {
    const rows = grupos.get(key);
    const label = resumenPeriodo === "semana"
      ? `${formatFechaCorta(key)} al ${formatFechaCorta(getWeekEnd(key))}`
      : getMonthLabel(key);
    return { key, label, cantidad: rows.length, motivoTop: motivoMasComun(rows) };
  });

  // Gráfico: las últimas 12 (semanas o meses), de más vieja a más nueva.
  const ultimas = entradas.slice(-12);
  const chart = document.getElementById("resumen-chart");
  chart.innerHTML = "";
  const maxVal = Math.max(...ultimas.map((e) => e.cantidad), 1);
  ultimas.forEach((e) => {
    const heightPct = e.cantidad > 0 ? Math.max((e.cantidad / maxVal) * 100, 4) : 2;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    const etiquetaCorta = resumenPeriodo === "semana" ? formatFechaCorta(e.key) : e.key.slice(5);
    wrap.innerHTML = `
      <span class="chart-bar-value">${e.cantidad || ""}</span>
      <div class="chart-bar" style="height:${heightPct}%" title="${escapeHtml(e.label)}: ${e.cantidad}"></div>
      <span class="chart-bar-label">${escapeHtml(etiquetaCorta)}</span>
    `;
    chart.appendChild(wrap);
  });

  // Tabla: más reciente primero.
  const tbody = document.getElementById("resumen-body");
  if (!entradas.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Todavía no hay ventas perdidas registradas.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...entradas].reverse().map((e) => `
    <tr>
      <td>${escapeHtml(e.label)}</td>
      <td>${e.cantidad}</td>
      <td>${escapeHtml(e.motivoTop || "-")}</td>
    </tr>
  `).join("");
}

document.getElementById("resumen-periodo-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".periodo-tab");
  if (!btn) return;
  document.querySelectorAll("#resumen-periodo-tabs .periodo-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  resumenPeriodo = btn.dataset.periodo;
  document.getElementById("resumen-titulo").textContent =
    resumenPeriodo === "semana" ? "Ventas perdidas por semana" : "Ventas perdidas por mes";
  document.getElementById("th-periodo").textContent = resumenPeriodo === "semana" ? "Semana" : "Mes";
  renderResumen();
});

checkAuth();
