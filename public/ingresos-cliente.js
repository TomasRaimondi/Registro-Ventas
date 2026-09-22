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

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function nombreDiaSemana(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Fecha larga con el día de la semana adelante (ej. "Martes, 22 de septiembre de 2026"),
// para los lugares donde vale la pena mostrarlo (una fila de tabla, un tooltip) sin
// saturar las etiquetas chicas del gráfico, que se quedan como "22/09".
function formatFechaLargaConDia(fechaStr) {
  return `${nombreDiaSemana(fechaStr)}, ${formatFechaLarga(fechaStr)}`;
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
  cargarTodo();
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
  renderListaDia();
});

hoyBtn.addEventListener("click", () => {
  fechaSeleccionada = null;
  fechaInput.value = getHoyFechaArgentina();
  renderListaDia();
});

// ---------- Datos: se derivan de Ventas Perdidas + Ventas (no de una tabla propia) ----------
// "Ingreso de cliente" ya no se carga a mano: es cada venta perdida (entró y no compró)
// más cada venta local (entró y compró), sin mayorista ni web. Se trae todo una sola vez
// en una lista combinada, y el resumen por período y el detalle del día son filtros
// locales sobre esa lista (no hace falta volver a pedirle nada al servidor).

function esVentaLocal(s) {
  return s.metodo !== "mayorista" && s.metodo !== "web" && s.envioMetodo !== "uber_moto";
}

let todosIngresos = []; // [{ fecha, horaLabel, tipo: "perdida" | "venta", detalle }]

async function cargarTodosLosIngresos() {
  const [perdidas, reportes] = await Promise.all([
    api("/api/ventas-perdidas-todas"),
    api("/api/reportes"),
  ]);
  const deVentasPerdidas = perdidas.map((r) => ({
    fecha: r.fecha,
    horaLabel: r.horaLabel,
    tipo: "perdida",
    detalle: `No compró: ${r.motivo}`,
  }));
  const deVentas = reportes.ventas.filter(esVentaLocal).map((v) => ({
    fecha: v.fecha,
    horaLabel: v.horaLabel,
    tipo: "venta",
    detalle: `Compró: ${v.producto}`,
  }));
  todosIngresos = [...deVentasPerdidas, ...deVentas];
}

async function cargarTodo() {
  document.getElementById("lista-body").innerHTML = `<tr class="empty-row"><td colspan="2">Cargando...</td></tr>`;
  document.getElementById("resumen-body").innerHTML = `<tr class="empty-row"><td colspan="4">Cargando...</td></tr>`;
  try {
    await cargarTodosLosIngresos();
    renderResumen();
    renderListaDia();
  } catch (err) {
    document.getElementById("lista-body").innerHTML = `<tr class="empty-row"><td colspan="2">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
    document.getElementById("resumen-body").innerHTML = `<tr class="empty-row"><td colspan="4">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---------- Detalle del día elegido ----------

function renderListaDia() {
  const hoyFecha = getHoyFechaArgentina();
  const fechaActiva = fechaSeleccionada || hoyFecha;
  fechaInput.value = fechaActiva;
  hoyBtn.style.display = fechaActiva === hoyFecha ? "none" : "inline-block";
  document.getElementById("fecha-label").textContent = fechaActiva === hoyFecha ? "hoy" : formatFechaLargaConDia(fechaActiva);

  const rows = todosIngresos
    .filter((r) => r.fecha === fechaActiva)
    .sort((a, b) => (a.horaLabel || "").localeCompare(b.horaLabel || ""));
  document.getElementById("stat-total").textContent = rows.length;
  const { perdidas, ventas } = contarTipos(rows);
  document.getElementById("stat-total-sub").textContent = rows.length
    ? `${ventas} compraron, ${perdidas} no compraron`
    : "";

  const tbody = document.getElementById("lista-body");
  tbody.innerHTML = !rows.length
    ? `<tr class="empty-row"><td colspan="2">No se registró ningún ingreso ese día.</td></tr>`
    : rows.map((r) => `
        <tr>
          <td>${escapeHtml((r.horaLabel || "").slice(0, 5))}</td>
          <td style="${r.tipo === "venta" ? "color:var(--green);" : "color:var(--red);"}">${escapeHtml(r.detalle)}</td>
        </tr>
      `).join("");
}

// ---------- Resumen por semana / mes, comparado contra ventas perdidas ----------
// Cada ingreso ya viene con su tipo ("perdida" o "venta"): acá se separan para poder
// comparar, período a período, cuántos de los que entraron compraron y cuántos no.

let resumenPeriodo = "semana";

function contarTipos(rows) {
  let perdidas = 0, ventas = 0;
  rows.forEach((r) => { if (r.tipo === "perdida") perdidas++; else ventas++; });
  return { perdidas, ventas, cantidad: perdidas + ventas };
}

// Para "día" se arman los últimos 30 días de corrido (con 0 en los que no hubo
// ninguno), a diferencia de semana/mes que solo muestran períodos con datos: en una
// ventana tan corta, ver los días en cero también es información útil.
function entradasPorDia() {
  const porFecha = new Map();
  todosIngresos.forEach((r) => {
    if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, []);
    porFecha.get(r.fecha).push(r);
  });

  const [y, m, d] = getHoyFechaArgentina().split("-").map(Number);
  const dias = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() - i);
    const fecha = date.toISOString().slice(0, 10);
    dias.push({ key: fecha, label: formatFechaLargaConDia(fecha), ...contarTipos(porFecha.get(fecha) || []) });
  }
  return dias;
}

function renderResumen() {
  let entradas, etiquetaCortaDe, cantidadEnGrafico;

  if (resumenPeriodo === "dia") {
    entradas = entradasPorDia();
    etiquetaCortaDe = (e) => formatFechaCorta(e.key);
    cantidadEnGrafico = 30;
  } else {
    const grupos = new Map(); // clave del período -> filas de ese período
    todosIngresos.forEach((r) => {
      const key = resumenPeriodo === "semana" ? getWeekStart(r.fecha) : getMonthKey(r.fecha);
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(r);
    });
    entradas = [...grupos.keys()].sort().map((key) => {
      const label = resumenPeriodo === "semana"
        ? `${formatFechaCorta(key)} al ${formatFechaCorta(getWeekEnd(key))}`
        : getMonthLabel(key);
      return { key, label, ...contarTipos(grupos.get(key)) };
    });
    etiquetaCortaDe = (e) => (resumenPeriodo === "semana" ? formatFechaCorta(e.key) : e.key.slice(5));
    cantidadEnGrafico = 12;
  }

  // Gráfico: las últimas N, de más vieja a más nueva. Cada período muestra dos barras
  // lado a lado (compraron / no compraron), escaladas contra el total del período más
  // activo para que se puedan comparar entre sí.
  const ultimas = entradas.slice(-cantidadEnGrafico);
  const chart = document.getElementById("resumen-chart");
  chart.innerHTML = "";
  const maxVal = Math.max(...ultimas.map((e) => e.cantidad), 1);
  ultimas.forEach((e) => {
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const totalLabel = document.createElement("span");
    totalLabel.className = "chart-bar-value";
    totalLabel.textContent = e.cantidad || "";
    wrap.appendChild(totalLabel);

    const pair = document.createElement("div");
    pair.className = "chart-bar-pair";

    const barVentas = document.createElement("div");
    barVentas.className = "chart-bar chart-bar-verde";
    barVentas.style.height = Math.max((e.ventas / maxVal) * 100, e.ventas > 0 ? 4 : 1) + "%";
    barVentas.title = `${e.label} — Compraron: ${e.ventas}`;

    const barPerdidas = document.createElement("div");
    barPerdidas.className = "chart-bar chart-bar-gasto";
    barPerdidas.style.height = Math.max((e.perdidas / maxVal) * 100, e.perdidas > 0 ? 4 : 1) + "%";
    barPerdidas.title = `${e.label} — No compraron: ${e.perdidas}`;

    pair.appendChild(barVentas);
    pair.appendChild(barPerdidas);
    wrap.appendChild(pair);

    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = etiquetaCortaDe(e);
    wrap.appendChild(hLabel);

    chart.appendChild(wrap);
  });

  // Tabla: más reciente primero.
  const tbody = document.getElementById("resumen-body");
  if (!entradas.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no hay ingresos registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...entradas].reverse().map((e) => `
    <tr>
      <td>${escapeHtml(e.label)}</td>
      <td style="color:var(--green);">${e.ventas}</td>
      <td style="color:var(--red);">${e.perdidas}</td>
      <td>${e.cantidad}</td>
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
    dia: "Ingresos de clientes por día (últimos 30 días)",
    semana: "Ingresos de clientes por semana",
    mes: "Ingresos de clientes por mes",
  };
  const ENCABEZADOS = { dia: "Día", semana: "Semana", mes: "Mes" };
  document.getElementById("resumen-titulo").textContent = TITULOS[resumenPeriodo];
  document.getElementById("th-periodo").textContent = ENCABEZADOS[resumenPeriodo];
  renderResumen();
});

checkAuth();
