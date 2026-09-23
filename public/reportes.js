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

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function nombreDiaSemana(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
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

function getDiasEnMes(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fechasDeSemana(weekStart) {
  const fechas = [];
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 7; i++) {
    fechas.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return fechas;
}

function semanasDeMes(monthKey) {
  const dias = getDiasEnMes(monthKey);
  const weekStarts = new Set();
  for (let d = 1; d <= dias; d++) {
    const fecha = `${monthKey}-${String(d).padStart(2, "0")}`;
    weekStarts.add(getWeekStart(fecha));
  }
  return [...weekStarts].sort();
}

// Una venta minorista es "Web" si el método de pago es "web" o si se despachó por
// Uber Moto (sea cual sea el método de pago); el resto de las minoristas son "Local".
function esVentaCanalWeb(v) {
  return v.metodo === "web" || v.envioMetodo === "uber_moto";
}

// El gasto de publicidad no tiene tabla propia: se carga como un gasto más, con el
// concepto "Publicidad Instagram" escrito a mano — se lo identifica por ese texto
// (sin importar mayúsculas/espacios) para separarlo del resto de los gastos.
function esGastoPublicidad(g) {
  return (g.concepto || "").trim().toLowerCase() === "publicidad instagram";
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

// ---------- Gráfico de dos barras (minorista + mayorista, con total arriba) ----------

function renderDualBarChart(container, entries, { colorBySignA = false, labelA = "Minorista", labelB = "Mayorista", showGasto = false } = {}) {
  container.innerHTML = "";
  if (entries.length === 0) return;

  const maxAbs = Math.max(
    ...entries.map(e => Math.abs(e.valueA) + Math.abs(e.valueB) + (showGasto ? Math.abs(e.valueC || 0) : 0)),
    1
  );

  entries.forEach(({ label, valueA, valueB, valueC, total }) => {
    const totalMostrado = total !== undefined ? total : valueA + valueB;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const totalLabel = document.createElement("span");
    totalLabel.className = "chart-bar-value";
    totalLabel.textContent = money(totalMostrado);
    wrap.appendChild(totalLabel);

    if (showGasto) {
      const gastoLabel = document.createElement("span");
      gastoLabel.className = "chart-bar-gasto-label";
      gastoLabel.textContent = `Gasto: ${money(valueC || 0)}`;
      wrap.appendChild(gastoLabel);
    }

    const pair = document.createElement("div");
    pair.className = "chart-bar-pair";

    const barA = document.createElement("div");
    barA.className = "chart-bar";
    barA.style.height = Math.max((Math.abs(valueA) / maxAbs) * 100, valueA !== 0 ? 4 : 1) + "%";
    if (colorBySignA && valueA < 0) {
      barA.style.background = "linear-gradient(180deg, #e15b5b, #b83f3f)";
    }
    barA.title = `${label} — ${labelA}: ${money(valueA)}`;

    const barB = document.createElement("div");
    barB.className = "chart-bar chart-bar-mayorista";
    barB.style.height = Math.max((Math.abs(valueB) / maxAbs) * 100, valueB !== 0 ? 4 : 1) + "%";
    barB.title = `${label} — ${labelB}: ${money(valueB)}`;

    pair.appendChild(barA);
    pair.appendChild(barB);

    if (showGasto) {
      const barC = document.createElement("div");
      barC.className = "chart-bar chart-bar-gasto";
      barC.style.height = Math.max((Math.abs(valueC || 0) / maxAbs) * 100, (valueC || 0) !== 0 ? 4 : 1) + "%";
      barC.title = `${label} — Gasto: ${money(valueC || 0)}`;
      pair.appendChild(barC);
    }

    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = label;

    wrap.appendChild(pair);
    wrap.appendChild(hLabel);
    container.appendChild(wrap);
  });
}

// ---------- Estado global ----------

let hoyFecha = null;
let horaLabelActualGlobal = "00:00:00";
let ventasGlobal = [];
let itemsGlobal = [];
let gastosGlobal = [];
let ventasPerdidasGlobal = [];
let porFechaGlobal = {};
let costoPorProductoGlobal = {};
let periodoActual = "dia";
let semanaSeleccionada = null; // weekStart (YYYY-MM-DD), usada por la pestaña "Día"
let mesSeleccionado = null; // YYYY-MM, usada por la pestaña "Semana"

const METODO_LABELS = {
  efectivo: "Efectivo", transferencia: "Transferencia", debito: "Débito",
  credito: "Crédito", cuentadni: "Cuenta DNI", mayorista: "Mayorista", web: "Web",
};

// ---------- Carga de datos ----------

async function renderAll() {
  let data, costos, hora, ventasPerdidas;
  try {
    [data, costos, hora, ventasPerdidas] = await Promise.all([
      api("/api/reportes"),
      api("/api/costos"),
      api("/api/hora"),
      api("/api/ventas-perdidas-todas"),
    ]);
    hoyFecha = hora.fecha;
    horaLabelActualGlobal = hora.horaLabel;
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  ventasGlobal = data.ventas;
  itemsGlobal = data.items;
  gastosGlobal = data.gastos;
  ventasPerdidasGlobal = ventasPerdidas;

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });
  costoPorProductoGlobal = costoPorProducto;

  const porFecha = {};
  function getDia(fecha) {
    if (!porFecha[fecha]) porFecha[fecha] = { volumen: 0, volumenWeb: 0, volumenLocal: 0, volumenMayorista: 0, cantVentas: 0, cantVentasLocales: 0, cantVentasPerdidas: 0, gananciaBruta: 0, gananciaBrutaMayorista: 0, gasto: 0, gastoPublicidad: 0, gastoPublicidadSuavizado: 0 };
    return porFecha[fecha];
  }

  ventasGlobal.forEach(v => {
    const dia = getDia(v.fecha);
    if (v.metodo === "mayorista") {
      dia.volumenMayorista += v.precio;
    } else {
      dia.volumen += v.precio;
      if (esVentaCanalWeb(v)) dia.volumenWeb += v.precio;
      else { dia.volumenLocal += v.precio; dia.cantVentasLocales++; }
    }
    dia.cantVentas++;
  });

  itemsGlobal.forEach(it => {
    const dia = getDia(it.fecha);
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      const margen = it.precio - costoPorProducto[key];
      if (it.metodo === "mayorista") dia.gananciaBrutaMayorista += margen;
      else dia.gananciaBruta += margen;
    }
  });

  gastosGlobal.forEach(g => {
    const dia = getDia(g.fecha);
    dia.gasto += g.monto;
    if (esGastoPublicidad(g)) dia.gastoPublicidad += g.monto;
  });

  // La publicidad se anota como un pago único el día que Meta lo cobra, no repartida
  // día a día — comparada tal cual contra métricas diarias se ve como picos aislados
  // en vez de un gasto real. Se prorratea cada pago entre los días desde el pago
  // anterior (o un solo día si es el primero cargado), para poder dimensionar cuánto
  // se gastó por día en promedio.
  const pagosPublicidad = gastosGlobal
    .filter(esGastoPublicidad)
    .map(g => ({ fecha: g.fecha, monto: g.monto }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  let fechaPagoAnterior = null;
  pagosPublicidad.forEach(({ fecha, monto }) => {
    let desde = fechaPagoAnterior ? restarDias(fechaPagoAnterior, -1) : fecha;
    if (desde > fecha) desde = fecha; // dos pagos el mismo día: cada uno cubre solo ese día
    const dias = fechasEnRangoInclusive(desde, fecha);
    const porDia = monto / dias.length;
    dias.forEach(d => { getDia(d).gastoPublicidadSuavizado += porDia; });
    fechaPagoAnterior = fecha;
  });

  ventasPerdidasGlobal.forEach(vp => {
    const dia = getDia(vp.fecha);
    dia.cantVentasPerdidas++;
  });

  porFechaGlobal = porFecha;

  if (!semanaSeleccionada) semanaSeleccionada = getWeekStart(hoyFecha);
  if (!mesSeleccionado) mesSeleccionado = getMonthKey(hoyFecha);

  renderPeriodo(periodoActual);

  // Si el modal de métrica está abierto en modo "En vivo", este mismo refresco
  // (disparado cada 15s por el polling de esa vista) también lo actualiza a él, sin
  // borrar las líneas de tendencia que el usuario haya dibujado encima.
  if (metricModalKey && metricModalPeriodo === "vivo") renderMetricModal(true);
}

// ---------- Selectores de semana / mes ----------

const selectorSemana = document.getElementById("selector-semana");
const selectorMes = document.getElementById("selector-mes");

function poblarSelectorSemana() {
  const semanas = new Set(Object.keys(porFechaGlobal).map(getWeekStart));
  semanas.add(getWeekStart(hoyFecha));
  const lista = [...semanas].sort().reverse();
  selectorSemana.innerHTML = lista
    .map(ws => `<option value="${ws}">Semana del ${formatFecha(ws)} al ${formatFecha(getWeekEnd(ws))}</option>`)
    .join("");
  selectorSemana.value = semanaSeleccionada;
}

function poblarSelectorMes() {
  const meses = new Set(Object.keys(porFechaGlobal).map(getMonthKey));
  meses.add(getMonthKey(hoyFecha));
  const lista = [...meses].sort().reverse();
  selectorMes.innerHTML = lista
    .map(mk => `<option value="${mk}">${getMonthLabel(mk)}</option>`)
    .join("");
  selectorMes.value = mesSeleccionado;
}

selectorSemana.addEventListener("change", () => {
  semanaSeleccionada = selectorSemana.value;
  renderPeriodo("dia");
});
selectorMes.addEventListener("change", () => {
  mesSeleccionado = selectorMes.value;
  renderPeriodo("semana");
});

// ---------- Utilidades de agrupación ----------

function grupoVacio(key, label) {
  return { key, label, volumen: 0, volumenWeb: 0, volumenLocal: 0, volumenMayorista: 0, cantVentas: 0, cantVentasLocales: 0, cantVentasPerdidas: 0, gananciaBruta: 0, gananciaBrutaMayorista: 0, gasto: 0, gastoPublicidad: 0, gastoPublicidadSuavizado: 0, diasConDatos: 0 };
}

function sumarEnGrupo(acc, d) {
  acc.volumen += d.volumen;
  acc.volumenWeb += d.volumenWeb || 0;
  acc.volumenLocal += d.volumenLocal || 0;
  acc.volumenMayorista += d.volumenMayorista;
  acc.cantVentas += d.cantVentas;
  acc.cantVentasLocales += d.cantVentasLocales || 0;
  acc.cantVentasPerdidas += d.cantVentasPerdidas || 0;
  acc.gananciaBruta += d.gananciaBruta;
  acc.gananciaBrutaMayorista += d.gananciaBrutaMayorista;
  acc.gasto += d.gasto;
  acc.gastoPublicidad += d.gastoPublicidad || 0;
  acc.gastoPublicidadSuavizado += d.gastoPublicidadSuavizado || 0;
  acc.diasConDatos += d.diasConDatos || 0;
  return acc;
}

function agruparPorMesHistorico() {
  const grupos = {};
  Object.keys(porFechaGlobal).forEach(fecha => {
    const mes = getMonthKey(fecha);
    if (!grupos[mes]) grupos[mes] = grupoVacio(mes, getMonthLabel(mes));
    sumarEnGrupo(grupos[mes], { ...porFechaGlobal[fecha], diasConDatos: 1 });
  });
  return Object.values(grupos).sort((a, b) => a.key.localeCompare(b.key));
}

// ---------- Modal de evolución por métrica (al hacer clic en un cuadro) ----------
// A diferencia de las pestañas Día/Semana/Mes de arriba (que eligen UN rango para
// mostrar todas las métricas juntas), esto muestra la evolución de UNA sola métrica
// en una ventana rodante: últimos 30 días, últimas 12 semanas o últimos 12 meses.

function calcularValorMetrica(metricKey, g, diasEnPeriodo) {
  const brutaTotal = g.gananciaBruta + g.gananciaBrutaMayorista;
  const volumenTotal = g.volumen + g.volumenMayorista;
  const neta = brutaTotal - g.gasto;
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : null);
  const pctFmt = (v) => (v !== null ? v.toFixed(1) + "%" : "—");

  switch (metricKey) {
    case "volumen": return { raw: g.volumen, formatted: money(g.volumen) };
    case "volumen-mayorista": return { raw: g.volumenMayorista, formatted: money(g.volumenMayorista) };
    case "ganancia-bruta": return { raw: brutaTotal, formatted: money(brutaTotal) };
    case "pct-retorno-general": { const v = pct(brutaTotal, volumenTotal); return { raw: v || 0, formatted: pctFmt(v) }; }
    case "ganancia-bruta-minorista": return { raw: g.gananciaBruta, formatted: money(g.gananciaBruta) };
    case "pct-retorno-minorista": { const v = pct(g.gananciaBruta, g.volumen); return { raw: v || 0, formatted: pctFmt(v) }; }
    case "ganancia-bruta-mayorista": return { raw: g.gananciaBrutaMayorista, formatted: money(g.gananciaBrutaMayorista) };
    case "pct-retorno-mayorista": { const v = pct(g.gananciaBrutaMayorista, g.volumenMayorista); return { raw: v || 0, formatted: pctFmt(v) }; }
    case "ganancia-neta": return { raw: neta, formatted: money(neta) };
    case "pct-retorno-neto": { const v = pct(neta, volumenTotal); return { raw: v || 0, formatted: pctFmt(v) }; }
    case "gasto": return { raw: g.gasto, formatted: money(g.gasto) };
    case "gasto-publicidad": return { raw: g.gastoPublicidad, formatted: money(g.gastoPublicidad) };
    case "gasto-publicidad-diario": return { raw: g.gastoPublicidadSuavizado, formatted: money(g.gastoPublicidadSuavizado) };
    case "roas": {
      const pub = g.gastoPublicidadSuavizado;
      const v = pub > 0 ? g.volumen / pub : null;
      return { raw: v || 0, formatted: v !== null ? v.toFixed(1) + "x" : "—" };
    }
    case "ganancia-post-publicidad": {
      const v = g.gananciaBruta - g.gastoPublicidadSuavizado;
      return { raw: v, formatted: money(v) };
    }
    case "cant-ventas": return { raw: g.cantVentas, formatted: String(g.cantVentas) };
    case "ticket-promedio": { const v = g.cantVentas ? g.volumen / g.cantVentas : 0; return { raw: v, formatted: money(v) }; }
    case "dias": return { raw: g.diasConDatos, formatted: `${g.diasConDatos} de ${diasEnPeriodo}` };
    case "ventas-perdidas": return { raw: g.cantVentasPerdidas, formatted: String(g.cantVentasPerdidas) };
    case "ingreso-clientes": { const v = g.cantVentasLocales + g.cantVentasPerdidas; return { raw: v, formatted: String(v) }; }
    default: return { raw: 0, formatted: "—" };
  }
}

function diasRecientes(n) {
  const [y, m, d] = hoyFecha.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const fechas = [];
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(base);
    dd.setUTCDate(base.getUTCDate() - i);
    fechas.push(dd.toISOString().slice(0, 10));
  }
  return fechas;
}

function semanasRecientes(n) {
  const [y, m, d] = getWeekStart(hoyFecha).split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const semanas = [];
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(base);
    dd.setUTCDate(base.getUTCDate() - i * 7);
    semanas.push(dd.toISOString().slice(0, 10));
  }
  return semanas;
}

function mesesRecientes(n) {
  const [y, m] = getMonthKey(hoyFecha).split("-").map(Number);
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    meses.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return meses;
}

function grupoDeUnDia(fecha) {
  const d = porFechaGlobal[fecha];
  const g = grupoVacio(fecha, formatFecha(fecha));
  if (d) sumarEnGrupo(g, { ...d, diasConDatos: 1 });
  return g;
}

function grupoDeUnaSemana(ws) {
  const g = grupoVacio(ws, `${formatFecha(ws)}-${formatFecha(getWeekEnd(ws))}`);
  fechasDeSemana(ws).forEach(fecha => {
    const d = porFechaGlobal[fecha];
    if (d) sumarEnGrupo(g, { ...d, diasConDatos: 1 });
  });
  return g;
}

function grupoDeUnMes(mk) {
  const g = grupoVacio(mk, getMonthLabel(mk));
  Object.keys(porFechaGlobal).filter(fecha => getMonthKey(fecha) === mk).forEach(fecha => {
    sumarEnGrupo(g, { ...porFechaGlobal[fecha], diasConDatos: 1 });
  });
  return g;
}

// ---------- "En vivo" (intradía de hoy): mismos datos ya cargados, agrupados en
// bloques de N minutos, como el timeframe de un gráfico intradía. ----------

function claveBucketIntradia(horaLabel, minutosBucket) {
  const [h, m] = horaLabel.split(":").map(Number);
  const totalMin = h * 60 + m;
  const bucketMin = Math.floor(totalMin / minutosBucket) * minutosBucket;
  return `${String(Math.floor(bucketMin / 60)).padStart(2, "0")}:${String(bucketMin % 60).padStart(2, "0")}`;
}

function agruparPorBucketIntradia(minutosBucket) {
  const gruposMap = new Map();
  function getBucket(horaLabel) {
    const key = claveBucketIntradia(horaLabel, minutosBucket);
    if (!gruposMap.has(key)) gruposMap.set(key, grupoVacio(key, key));
    return gruposMap.get(key);
  }

  ventasGlobal.filter(v => v.fecha === hoyFecha).forEach(v => {
    const g = getBucket(v.horaLabel);
    if (v.metodo === "mayorista") {
      g.volumenMayorista += v.precio;
    } else {
      g.volumen += v.precio;
      if (esVentaCanalWeb(v)) g.volumenWeb += v.precio;
      else { g.volumenLocal += v.precio; g.cantVentasLocales++; }
    }
    g.cantVentas++;
  });

  itemsGlobal.filter(it => it.fecha === hoyFecha).forEach(it => {
    const g = getBucket(it.horaLabel);
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProductoGlobal, key)) {
      const margen = it.precio - costoPorProductoGlobal[key];
      if (it.metodo === "mayorista") g.gananciaBrutaMayorista += margen;
      else g.gananciaBruta += margen;
    }
  });

  gastosGlobal.filter(g2 => g2.fecha === hoyFecha).forEach(g2 => {
    const g = getBucket(g2.horaLabel);
    g.gasto += g2.monto;
    if (esGastoPublicidad(g2)) g.gastoPublicidad += g2.monto;
  });

  ventasPerdidasGlobal.filter(vp => vp.fecha === hoyFecha).forEach(vp => {
    const g = getBucket(vp.horaLabel);
    g.cantVentasPerdidas++;
  });

  // Se listan TODOS los bloques desde las 00:00 hasta el bloque actual (aunque estén
  // vacíos), para que el eje de tiempo sea continuo y el gráfico "avance" solo a medida
  // que pasan los minutos, como uno en vivo de verdad.
  const [hAhora, mAhora] = horaLabelActualGlobal.split(":").map(Number);
  const minutosAhora = hAhora * 60 + mAhora;
  const ultimoBucketMin = Math.floor(minutosAhora / minutosBucket) * minutosBucket;
  const resultado = [];
  for (let min = 0; min <= ultimoBucketMin; min += minutosBucket) {
    const key = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    resultado.push(gruposMap.get(key) || grupoVacio(key, key));
  }
  return resultado;
}

function renderSingleBarChart(container, entries) {
  container.innerHTML = "";
  if (entries.length === 0) return;
  const maxAbs = Math.max(...entries.map(e => Math.abs(e.raw)), 1);
  const barras = [];
  entries.forEach((e, i) => {
    const heightPct = e.raw !== 0 ? Math.max((Math.abs(e.raw) / maxAbs) * 100, 4) : 2;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const valLabel = document.createElement("span");
    valLabel.className = "chart-bar-value";
    valLabel.textContent = e.formatted;

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = "0%"; // arranca en 0 y crece animado (ver abajo)
    bar.style.transitionDelay = Math.min(i * 12, 300) + "ms";
    if (e.raw < 0) bar.style.background = "linear-gradient(180deg, #e15b5b, #b83f3f)";
    bar.title = `${e.label}: ${e.formatted}`;

    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = e.label;

    wrap.appendChild(valLabel);
    wrap.appendChild(bar);
    wrap.appendChild(hLabel);
    container.appendChild(wrap);
    barras.push({ bar, heightPct });
  });

  // Crecimiento animado: se fija la altura real recién en el siguiente frame, para que
  // la transición CSS (.chart-bar { transition: height .2s }) tenga de dónde arrancar.
  requestAnimationFrame(() => {
    barras.forEach(({ bar, heightPct }) => { bar.style.height = heightPct + "%"; });
  });
}

// Formatea un valor "en crudo" (número puro) para el eje Y del gráfico de líneas,
// con el mismo criterio que usa cada métrica en calcularValorMetrica (money, % o entero).
function formatValorEje(metricKey, raw) {
  if (metricKey.startsWith("pct-")) return raw.toFixed(1) + "%";
  if (metricKey === "cant-ventas" || metricKey === "dias" || metricKey === "ventas-perdidas" || metricKey === "ingreso-clientes") return Math.round(raw).toLocaleString("es-AR");
  if (metricKey === "roas") return raw.toFixed(1) + "x";
  return money(raw);
}

// Elige qué índices llevan etiqueta en el eje X: separados por un ancho mínimo en
// píxeles (así nunca se pisan entre sí), pero siempre mostrando el último punto —
// si el anterior mostrado queda demasiado pegado a él, se saca ese en vez de amontonarlos.
function elegirIndicesEtiquetas(n, plotW) {
  if (n <= 1) return [0];
  const minGapPx = 72;
  const pxPorPunto = plotW / (n - 1);
  const step = Math.max(1, Math.round(minGapPx / pxPorPunto));
  const idxs = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  const ultimo = n - 1;
  if (idxs[idxs.length - 1] !== ultimo) {
    const anterior = idxs[idxs.length - 1];
    if (ultimo - anterior < step * 0.6) idxs.pop();
    idxs.push(ultimo);
  }
  return idxs;
}

// Gráfico de línea con eje X (períodos) e Y (valor), a diferencia del de barras: se
// entiende mejor cuando hay muchos puntos seguidos (ej. 30 días), que amontonados en
// barras quedan ilegibles. Los puntos se pueden tocar/clickear para ver el valor exacto
// en un tooltip, y la línea se dibuja animada al abrir o cambiar de vista.
function renderLineChart(container, entries, metricKey) {
  ocultarChartTooltip();
  container.innerHTML = "";
  if (entries.length === 0) return;

  const W = Math.max(entries.length * 46, 320);
  const H = 320;
  const padL = 64, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const valores = entries.map(e => e.raw);
  let maxV = Math.max(...valores, 0);
  let minV = Math.min(...valores, 0);
  if (maxV === minV) { maxV += 1; minV -= 1; }
  const rango = maxV - minV;

  const xFor = (i) => padL + (entries.length === 1 ? plotW / 2 : (i / (entries.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - ((v - minV) / rango) * plotH;

  const numLineas = 4;
  let gridSvg = "";
  for (let i = 0; i <= numLineas; i++) {
    const v = minV + (rango * i) / numLineas;
    const y = yFor(v);
    gridSvg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--card-border)" stroke-width="1" />`;
    gridSvg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-dim)">${escapeHtml(formatValorEje(metricKey, v))}</text>`;
  }
  if (minV < 0 && maxV > 0) {
    const y0 = yFor(0);
    gridSvg += `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" stroke="var(--text-dim)" stroke-width="1.5" />`;
  }

  const puntos = entries.map((e, i) => `${xFor(i).toFixed(1)},${yFor(e.raw).toFixed(1)}`).join(" ");

  const indicesConEtiqueta = new Set(elegirIndicesEtiquetas(entries.length, plotW));
  let xLabelsSvg = "";
  entries.forEach((e, i) => {
    if (indicesConEtiqueta.has(i)) {
      xLabelsSvg += `<text x="${xFor(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--text-dim)">${escapeHtml(e.label)}</text>`;
    }
  });

  const circlesSvg = entries.map((e, i) => `
    <circle
      class="chart-line-point"
      style="animation-delay:${Math.min(i * 15, 400)}ms;"
      cx="${xFor(i).toFixed(1)}" cy="${yFor(e.raw).toFixed(1)}" r="4" fill="var(--accent)"
      data-label="${escapeHtml(e.fecha ? `${e.label} · ${nombreDiaSemana(e.fecha)}` : e.label)}" data-valor="${escapeHtml(e.formatted)}"
    ></circle>
  `).join("");

  container.style.display = "block";
  container.style.overflowX = "auto";
  container.style.position = "relative";
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="100%" style="display:block;">
      ${gridSvg}
      <polyline class="chart-line-path" points="${puntos}" fill="none" stroke="var(--accent)" stroke-width="2.5" />
      ${circlesSvg}
      ${xLabelsSvg}
    </svg>
  `;

  // Animación de "dibujado" de la línea: se calcula el largo real del trazo y se anima
  // el stroke-dashoffset de ese valor a 0.
  const path = container.querySelector(".chart-line-path");
  if (path && typeof path.getTotalLength === "function") {
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    path.getBoundingClientRect(); // fuerza reflow para que la transición no arranque ya en 0
    path.style.transition = "stroke-dashoffset .8s ease";
    requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; });
  }
}

// Gráfico de dos líneas superpuestas sobre el mismo eje (una sólida, una punteada),
// usado tanto para comparar dos rangos de fechas elegidos a mano como para segmentar
// una métrica en dos series (ej. Web vs Local) sobre el mismo período. `opts.xLabels`
// permite pasar una etiqueta propia por índice del eje X; si no se pasa, se usa "Día N"
// (caso de comparar rangos de largo distinto, donde no hay una fecha en común por punto).
function renderDualLineChart(container, seriesA, seriesB, metricKey, labelA, labelB, opts = {}) {
  ocultarChartTooltip();
  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "stretch";
  container.style.overflowX = "";
  const maxLen = Math.max(seriesA.length, seriesB.length);
  if (maxLen === 0) return;

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.style.margin = "0 0 8px";
  legend.style.flex = "0 0 auto";
  legend.innerHTML = `
    <span class="legend-item"><span class="legend-dot" style="background:var(--accent);"></span>${escapeHtml(labelA)}</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--orange);"></span>${escapeHtml(labelB)}</span>
  `;
  container.appendChild(legend);

  const svgWrap = document.createElement("div");
  svgWrap.style.overflowX = "auto";
  svgWrap.style.flex = "1 1 auto";
  svgWrap.style.minHeight = "0";
  container.appendChild(svgWrap);

  const W = Math.max(maxLen * 46, 320);
  const H = 320;
  const padL = 64, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const valores = [...seriesA, ...seriesB].map(e => e.raw);
  let maxV = Math.max(...valores, 0);
  let minV = Math.min(...valores, 0);
  if (maxV === minV) { maxV += 1; minV -= 1; }
  const rango = maxV - minV;

  const xFor = (i) => padL + (maxLen === 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW);
  const yFor = (v) => padT + plotH - ((v - minV) / rango) * plotH;

  const numLineas = 4;
  let gridSvg = "";
  for (let i = 0; i <= numLineas; i++) {
    const v = minV + (rango * i) / numLineas;
    const y = yFor(v);
    gridSvg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--card-border)" stroke-width="1" />`;
    gridSvg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-dim)">${escapeHtml(formatValorEje(metricKey, v))}</text>`;
  }
  if (minV < 0 && maxV > 0) {
    const y0 = yFor(0);
    gridSvg += `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" stroke="var(--text-dim)" stroke-width="1.5" />`;
  }

  const xLabels = opts.xLabels || Array.from({ length: maxLen }, (_, i) => `Día ${i + 1}`);
  const indicesConEtiqueta = new Set(elegirIndicesEtiquetas(maxLen, plotW));
  let xLabelsSvg = "";
  for (let i = 0; i < maxLen; i++) {
    if (indicesConEtiqueta.has(i)) {
      xLabelsSvg += `<text x="${xFor(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--text-dim)">${escapeHtml(xLabels[i] || "")}</text>`;
    }
  }

  function serieSvg(serie, color, dashed) {
    const puntos = serie.map((e, i) => `${xFor(i).toFixed(1)},${yFor(e.raw).toFixed(1)}`).join(" ");
    const circles = serie.map((e, i) => `
      <circle
        class="chart-line-point"
        style="animation-delay:${Math.min(i * 15, 400)}ms;"
        cx="${xFor(i).toFixed(1)}" cy="${yFor(e.raw).toFixed(1)}" r="4" fill="${color}"
        data-label="${escapeHtml(e.fecha ? `${xLabels[i] || e.label} · ${nombreDiaSemana(e.fecha)}` : (xLabels[i] || e.label))}" data-valor="${escapeHtml(e.formatted)}"
      ></circle>
    `).join("");
    return `<polyline class="chart-line-path${dashed ? " chart-line-path-dashed" : ""}" points="${puntos}" fill="none" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="6,4"' : ""} />${circles}`;
  }

  svgWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="100%" style="display:block;">
      ${gridSvg}
      ${serieSvg(seriesA, "var(--accent)", false)}
      ${serieSvg(seriesB, "var(--orange)", true)}
      ${xLabelsSvg}
    </svg>
  `;

  // Solo la línea A (sólida) se anima dibujándose; la B (punteada) ya usa su propio
  // stroke-dasharray para el patrón de guiones, así que se muestra directamente.
  const pathA = svgWrap.querySelector(".chart-line-path:not(.chart-line-path-dashed)");
  if (pathA && typeof pathA.getTotalLength === "function") {
    const len = pathA.getTotalLength();
    pathA.style.strokeDasharray = String(len);
    pathA.style.strokeDashoffset = String(len);
    pathA.getBoundingClientRect();
    pathA.style.transition = "stroke-dashoffset .8s ease";
    requestAnimationFrame(() => { pathA.style.strokeDashoffset = "0"; });
  }
}

// ---------- Tooltip de los puntos del gráfico de líneas ----------
// Un solo elemento reutilizado (no uno por punto), posicionado con position:fixed según
// dónde haya quedado el punto tocado/clickeado en pantalla — funciona igual con scroll
// horizontal del gráfico y en modo pantalla completa.

let chartTooltipEl = null;
function getChartTooltipEl() {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement("div");
    chartTooltipEl.className = "chart-line-tooltip";
    document.body.appendChild(chartTooltipEl);
  }
  return chartTooltipEl;
}

function mostrarChartTooltip(circle) {
  const tt = getChartTooltipEl();
  tt.innerHTML = `<span class="tt-label">${circle.dataset.label}</span>${circle.dataset.valor}`;
  const rect = circle.getBoundingClientRect();
  tt.style.left = (rect.left + rect.width / 2) + "px";
  tt.style.top = rect.top + "px";
  tt.style.display = "block";
  document.querySelectorAll(".chart-line-point.active").forEach(c => c.classList.remove("active"));
  circle.classList.add("active");
}

function ocultarChartTooltip() {
  if (chartTooltipEl) chartTooltipEl.style.display = "none";
  document.querySelectorAll(".chart-line-point.active").forEach(c => c.classList.remove("active"));
}

document.getElementById("metric-modal-chart").addEventListener("click", (e) => {
  const circle = e.target.closest(".chart-line-point");
  if (circle) mostrarChartTooltip(circle);
});
document.getElementById("metric-modal-chart").addEventListener("mouseover", (e) => {
  const circle = e.target.closest(".chart-line-point");
  if (circle) mostrarChartTooltip(circle);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".chart-line-point")) ocultarChartTooltip();
});

let metricModalKey = null;
let metricModalPeriodo = "dia";
let metricModalTipoGrafico = "barras";
let metricModalTimeframe = 60; // minutos, usado en el modo "vivo"
let metricModalLiveInterval = null;
let metricModalCanalActivo = false; // segmentar "Volumen" en Web vs Local
let metricModalComparCanal = "total"; // filtro de canal en "Comparar rangos": total | web | local
let metricModalMetricasExtra = []; // claves de métricas a comparar contra la abierta, en "Comparar métricas"
const MAX_METRICAS_EXTRA = 4; // + la abierta = hasta 5 líneas en el gráfico

function abrirMetricModal(metricKey, titulo) {
  metricModalKey = metricKey;
  metricModalPeriodo = "dia";
  metricModalCanalActivo = false;
  metricModalMetricasExtra = [];
  metricModalComparCanal = "total";
  document.getElementById("metric-modal-titulo").textContent = titulo;
  document.querySelectorAll("#metric-modal-tabs .periodo-tab").forEach(b => b.classList.toggle("active", b.dataset.periodo === "dia"));
  document.getElementById("metric-modal-canal-btn").classList.remove("active");
  document.querySelectorAll("#metric-modal-comparar-canal .periodo-tab").forEach(b => b.classList.toggle("active", b.dataset.canal === "total"));
  document.getElementById("metric-modal").style.display = "flex";
  setMetricModalMaximizado(false);
  actualizarModoVivo();
  actualizarModoExtra();
  actualizarVisibilidadCanalBtn();
  renderMetricModal();
}

function cerrarMetricModal() {
  document.getElementById("metric-modal").style.display = "none";
  metricModalKey = null;
  ocultarChartTooltip();
  setMetricModalMaximizado(false);
  actualizarModoVivo();
  limpiarDibujosChart();
  dibujoActivo = false;
  document.getElementById("metric-modal-dibujar-btn").classList.remove("active");
  document.getElementById("metric-modal-chart-wrap").classList.remove("dibujando");
}

// Prende o apaga el polling de 15s y muestra/oculta el selector de timeframe y la
// insignia "En vivo", según si la pestaña activa del modal es "vivo" o no.
function actualizarModoVivo() {
  const enVivo = metricModalKey && metricModalPeriodo === "vivo";
  document.getElementById("metric-modal-live-badge").style.display = enVivo ? "inline-flex" : "none";
  document.getElementById("metric-modal-timeframe").style.display = enVivo ? "flex" : "none";
  if (enVivo && !metricModalLiveInterval) {
    metricModalLiveInterval = setInterval(renderAll, 15000);
  } else if (!enVivo && metricModalLiveInterval) {
    clearInterval(metricModalLiveInterval);
    metricModalLiveInterval = null;
  }
}

// Muestra/oculta los paneles de "Comparar rangos" y "Comparar métricas" (mutuamente
// excluyentes) y, mientras cualquiera de los dos está activo, esconde el selector de
// tipo de gráfico: ambas vistas siempre se dibujan en líneas, la primera porque los dos
// rangos elegidos a mano pueden tener distinta cantidad de días, la segunda porque cada
// métrica puede tener su propia escala (eje doble).
function actualizarModoExtra() {
  const comparandoRangos = metricModalKey && metricModalPeriodo === "comparar";
  const comparandoMetricas = metricModalKey && metricModalPeriodo === "metricas";
  document.getElementById("metric-modal-comparar-panel").style.display = comparandoRangos ? "flex" : "none";
  document.getElementById("metric-modal-metricas-panel").style.display = comparandoMetricas ? "flex" : "none";
  document.getElementById("metric-modal-btn-lineas").style.display = (comparandoRangos || comparandoMetricas) ? "none" : "";
  document.getElementById("metric-modal-btn-barras").style.display = (comparandoRangos || comparandoMetricas) ? "none" : "";

  const conFiltroCanal = comparandoRangos && metricModalKey === "volumen";
  document.getElementById("metric-modal-comparar-canal").style.display = conFiltroCanal ? "flex" : "none";
  if (!conFiltroCanal) {
    metricModalComparCanal = "total";
    document.querySelectorAll("#metric-modal-comparar-canal .periodo-tab").forEach(b => b.classList.toggle("active", b.dataset.canal === "total"));
  }

  if (comparandoRangos) inicializarFechasComparacion();
  if (comparandoMetricas) inicializarComparacionMetricas();
}

// El botón "Web / Local" solo tiene sentido para la métrica "Volumen" (que mezcla
// ambos canales) y no se combina con los modos de comparación, para no armar un
// gráfico de demasiadas series a la vez.
function actualizarVisibilidadCanalBtn() {
  const btn = document.getElementById("metric-modal-canal-btn");
  const disponible = metricModalKey === "volumen" && metricModalPeriodo !== "comparar" && metricModalPeriodo !== "metricas";
  btn.style.display = disponible ? "" : "none";
  if (!disponible) metricModalCanalActivo = false;
  btn.classList.toggle("active", metricModalCanalActivo);
}

function fechasEnRangoInclusive(desdeStr, hastaStr) {
  const [y1, m1, d1] = desdeStr.split("-").map(Number);
  const [y2, m2, d2] = hastaStr.split("-").map(Number);
  let cur = new Date(Date.UTC(y1, m1 - 1, d1));
  const fin = new Date(Date.UTC(y2, m2 - 1, d2));
  const out = [];
  let guard = 0;
  while (cur <= fin && guard < 366) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return out;
}

function restarDias(fechaStr, n) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

// Retrocede un mes calendario manteniendo el día (ej. 30/09 -> 30/08), acotando al
// último día del mes de destino si este es más corto (ej. 31/03 -> 28 o 29/02).
function restarMes(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  let yy = y, mm = m - 1;
  if (mm === 0) { mm = 12; yy -= 1; }
  const diasEnMesDestino = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dd = Math.min(d, diasEnMesDestino);
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// Precarga los cuatro campos de fecha con un default útil (esta semana vs. la semana
// anterior) la primera vez que se abre "Comparar rangos" — si ya tienen algo cargado
// (el usuario los tocó antes en esta misma sesión del modal), no los pisa.
function inicializarFechasComparacion() {
  const $aDesde = document.getElementById("cmp-a-desde");
  if ($aDesde.value) return;
  const aDesde = diasRecientes(7)[0];
  const aHasta = hoyFecha;
  document.getElementById("cmp-a-desde").value = aDesde;
  document.getElementById("cmp-a-hasta").value = aHasta;
  document.getElementById("cmp-b-desde").value = restarDias(aDesde, 7);
  document.getElementById("cmp-b-hasta").value = restarDias(aHasta, 7);
}

function tituloDeMetrica(key) {
  const card = document.querySelector(`.metric-card-clickable[data-metric="${key}"]`);
  return card ? card.querySelector(".label").textContent : key;
}

// Misma lista que las tarjetas clickeables de arriba, para no duplicar a mano el
// listado de métricas disponibles en los selects de "Comparar con".
function opcionesMetricasDisponibles() {
  return [...document.querySelectorAll(".metric-card-clickable")].map(card => ({
    key: card.dataset.metric,
    label: card.querySelector(".label").textContent,
  }));
}

// Elige una métrica que todavía no esté siendo comparada (ni sea la abierta), para
// que "Agregar métrica" siempre sume algo nuevo en vez de repetir una ya elegida.
function siguienteMetricaDisponible() {
  const usadas = new Set([metricModalKey, ...metricModalMetricasExtra]);
  const todas = opcionesMetricasDisponibles();
  const libre = todas.find(o => !usadas.has(o.key));
  return libre ? libre.key : (todas[0] ? todas[0].key : metricModalKey);
}

const PALETA_COMPARAR_METRICAS = ["var(--accent)", "var(--orange)", "var(--green)", "var(--purple)", "var(--red)"];
function colorDeSerieMetrica(i) {
  return PALETA_COMPARAR_METRICAS[i % PALETA_COMPARAR_METRICAS.length];
}

// Reconstruye las filas de "Comparar con" (una por métrica extra elegida), cada una
// con su propio select y un botón para sacarla — siempre queda al menos una (el
// gráfico necesita mínimo dos métricas: la abierta + esta).
function renderFilasMetricasExtra() {
  const opciones = opcionesMetricasDisponibles();
  const lista = document.getElementById("metric-modal-metricas-lista");
  lista.innerHTML = metricModalMetricasExtra.map((key, i) => `
    <div class="metrica-extra-row" data-idx="${i}">
      <span class="comparar-rango-dot" style="background:${colorDeSerieMetrica(i + 1)};"></span>
      <select class="cmp-metrica-extra">
        ${opciones.map(o => `<option value="${o.key}"${o.key === key ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
      </select>
      <button type="button" class="metrica-quitar-btn" title="Quitar"${metricModalMetricasExtra.length <= 1 ? " disabled" : ""}>✕</button>
    </div>
  `).join("");

  lista.querySelectorAll(".metrica-extra-row").forEach(row => {
    const idx = Number(row.dataset.idx);
    row.querySelector(".cmp-metrica-extra").addEventListener("change", (e) => {
      metricModalMetricasExtra[idx] = e.target.value;
      renderMetricModal();
    });
    row.querySelector(".metrica-quitar-btn").addEventListener("click", () => {
      if (metricModalMetricasExtra.length <= 1) return;
      metricModalMetricasExtra.splice(idx, 1);
      renderFilasMetricasExtra();
      renderMetricModal();
    });
  });

  document.getElementById("cmp-metrica-agregar-btn").style.display =
    metricModalMetricasExtra.length >= MAX_METRICAS_EXTRA ? "none" : "";
}

// Arranca con una sola métrica extra (el comportamiento de siempre) y precarga el
// rango de fechas (últimos 30 días) la primera vez que se usa esta pestaña.
function inicializarComparacionMetricas() {
  if (metricModalMetricasExtra.length === 0) {
    metricModalMetricasExtra = [siguienteMetricaDisponible()];
  }
  renderFilasMetricasExtra();

  const $desde = document.getElementById("cmp-metricas-desde");
  if (!$desde.value) {
    $desde.value = diasRecientes(30)[0];
    document.getElementById("cmp-metricas-hasta").value = hoyFecha;
  }
}

function renderMetricModal(preservarDibujos) {
  if (!metricModalKey) return;
  ocultarChartTooltip();
  if (!preservarDibujos) limpiarDibujosChart();

  if (metricModalPeriodo === "comparar") {
    renderMetricModalComparacion();
    return;
  }
  if (metricModalPeriodo === "metricas") {
    renderMetricModalComparacionMetricas();
    return;
  }

  let grupos, thLabel;
  if (metricModalPeriodo === "dia") {
    grupos = diasRecientes(30).map(grupoDeUnDia);
    thLabel = "Día";
  } else if (metricModalPeriodo === "semana") {
    grupos = semanasRecientes(12).map(grupoDeUnaSemana);
    thLabel = "Semana";
  } else if (metricModalPeriodo === "mes") {
    grupos = mesesRecientes(12).map(grupoDeUnMes);
    thLabel = "Mes";
  } else {
    grupos = agruparPorBucketIntradia(metricModalTimeframe);
    thLabel = "Hora";
  }

  const diasEnPeriodoDe = (g) => {
    if (metricModalPeriodo === "semana") return 7;
    if (metricModalPeriodo === "mes") return getDiasEnMes(g.key);
    return 1;
  };

  const chartEl = document.getElementById("metric-modal-chart");
  const segmentarCanal = metricModalCanalActivo && metricModalKey === "volumen";

  if (segmentarCanal) {
    document.getElementById("metric-modal-thead-row").innerHTML = `<th>${escapeHtml(thLabel)}</th><th>Web</th><th>Local</th><th>Total</th>`;
    const fechaDe = (g) => (metricModalPeriodo === "dia" ? g.key : undefined);
    const seriesWeb = grupos.map(g => ({ label: g.label, fecha: fechaDe(g), raw: g.volumenWeb || 0, formatted: money(g.volumenWeb || 0) }));
    const seriesLocal = grupos.map(g => ({ label: g.label, fecha: fechaDe(g), raw: g.volumenLocal || 0, formatted: money(g.volumenLocal || 0) }));

    if (metricModalTipoGrafico === "lineas") {
      renderDualLineChart(chartEl, seriesWeb, seriesLocal, metricModalKey, "Web", "Local", { xLabels: grupos.map(g => g.label) });
    } else {
      chartEl.style.display = "";
      chartEl.style.overflowX = "";
      renderDualBarChart(
        chartEl,
        grupos.map(g => ({ label: g.label, valueA: g.volumenWeb || 0, valueB: g.volumenLocal || 0 })),
        { labelA: "Web", labelB: "Local" }
      );
    }

    document.getElementById("metric-modal-body").innerHTML = [...grupos].reverse().map(g => `
      <tr>
        <td>${escapeHtml(g.label)}</td>
        <td>${money(g.volumenWeb || 0)}</td>
        <td>${money(g.volumenLocal || 0)}</td>
        <td>${money((g.volumenWeb || 0) + (g.volumenLocal || 0))}</td>
      </tr>
    `).join("");
    return;
  }

  document.getElementById("metric-modal-thead-row").innerHTML = `<th>${escapeHtml(thLabel)}</th><th>Valor</th>`;

  const entries = grupos.map(g => {
    const { raw, formatted } = calcularValorMetrica(metricModalKey, g, diasEnPeriodoDe(g));
    return { label: g.label, fecha: metricModalPeriodo === "dia" ? g.key : undefined, raw, formatted };
  });

  if (metricModalTipoGrafico === "lineas") {
    renderLineChart(chartEl, entries, metricModalKey);
  } else {
    chartEl.style.display = "";
    chartEl.style.overflowX = "";
    renderSingleBarChart(chartEl, entries);
  }

  document.getElementById("metric-modal-body").innerHTML = [...entries].reverse().map(e => `
    <tr><td>${escapeHtml(e.label)}</td><td>${escapeHtml(e.formatted)}</td></tr>
  `).join("");
}

// ---------- "Comparar rangos": dos rangos de fechas elegidos a mano, alineados por
// índice de día (Día 1, Día 2, ...) para poder poner uno al lado del otro aunque sean
// de meses distintos — el caso pedido es justamente ese: mismos días del mes pasado
// contra los de este mes. ----------

function renderMetricModalComparacion() {
  const aDesde = document.getElementById("cmp-a-desde").value;
  const aHasta = document.getElementById("cmp-a-hasta").value;
  const bDesde = document.getElementById("cmp-b-desde").value;
  const bHasta = document.getElementById("cmp-b-hasta").value;

  const chartEl = document.getElementById("metric-modal-chart");
  const bodyEl = document.getElementById("metric-modal-body");
  document.getElementById("metric-modal-thead-row").innerHTML = `<th>Día</th><th>Rango A</th><th>Rango B</th><th>Variación</th>`;

  if (!aDesde || !aHasta || !bDesde || !bHasta) {
    chartEl.innerHTML = "";
    bodyEl.innerHTML = `<tr class="empty-row"><td colspan="4">Elegí las dos fechas de cada rango para comparar.</td></tr>`;
    return;
  }

  const fechasA = fechasEnRangoInclusive(aDesde, aHasta).slice(0, 90);
  const fechasB = fechasEnRangoInclusive(bDesde, bHasta).slice(0, 90);

  const conFiltroCanal = metricModalKey === "volumen" && metricModalComparCanal !== "total";
  const armarSerie = (fechas) => fechas.map(fecha => {
    const g = grupoDeUnDia(fecha);
    let raw, formatted;
    if (conFiltroCanal) {
      raw = metricModalComparCanal === "web" ? (g.volumenWeb || 0) : (g.volumenLocal || 0);
      formatted = money(raw);
    } else {
      ({ raw, formatted } = calcularValorMetrica(metricModalKey, g, 1));
    }
    return { fecha, label: formatFecha(fecha), raw, formatted };
  });

  const seriesA = armarSerie(fechasA);
  const seriesB = armarSerie(fechasB);
  const sufijoCanal = conFiltroCanal ? (metricModalComparCanal === "web" ? " (Web)" : " (Local)") : "";
  const labelA = `Rango A${sufijoCanal}: ${formatFecha(aDesde)} al ${formatFecha(aHasta)}`;
  const labelB = `Rango B${sufijoCanal}: ${formatFecha(bDesde)} al ${formatFecha(bHasta)}`;

  renderDualLineChart(chartEl, seriesA, seriesB, metricModalKey, labelA, labelB);

  const maxLen = Math.max(seriesA.length, seriesB.length);
  const filas = [];
  for (let i = 0; i < maxLen; i++) {
    const ea = seriesA[i];
    const eb = seriesB[i];
    let variacion = "—";
    let colorVariacion = "";
    if (ea && eb && ea.raw) {
      const pct = ((eb.raw - ea.raw) / Math.abs(ea.raw)) * 100;
      variacion = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      colorVariacion = pct >= 0 ? "color:var(--green);" : "color:#e15b5b;";
    }
    filas.push(`
      <tr>
        <td>Día ${i + 1}</td>
        <td>${ea ? `${escapeHtml(ea.label)} — ${escapeHtml(ea.formatted)}` : "—"}</td>
        <td>${eb ? `${escapeHtml(eb.label)} — ${escapeHtml(eb.formatted)}` : "—"}</td>
        <td style="${colorVariacion}">${variacion}</td>
      </tr>
    `);
  }
  bodyEl.innerHTML = maxLen === 0
    ? `<tr class="empty-row"><td colspan="4">Sin datos.</td></tr>`
    : filas.join("");
}

// ---------- "Comparar métricas": la métrica abierta contra otra elegida, en el mismo
// rango de fechas. A diferencia de "Comparar rangos" (mismo indicador, dos rangos),
// acá cada serie puede tener una escala totalmente distinta (ej. "Volumen" en pesos
// contra "Ventas perdidas" en cantidad de casos) — por eso el gráfico usa un eje Y
// propio para cada una (izquierda para la métrica abierta, derecha para la elegida),
// en vez de forzarlas a compartir una sola escala que las volvería ilegibles. ----------

function renderDualAxisLineChart(container, seriesA, seriesB, metricKeyA, metricKeyB, labelA, labelB) {
  ocultarChartTooltip();
  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "stretch";
  container.style.overflowX = "";
  const n = seriesA.length;
  if (n === 0) return;

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.style.margin = "0 0 8px";
  legend.style.flex = "0 0 auto";
  legend.innerHTML = `
    <span class="legend-item"><span class="legend-dot" style="background:var(--accent);"></span>${escapeHtml(labelA)}</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--orange);"></span>${escapeHtml(labelB)}</span>
  `;
  container.appendChild(legend);

  const svgWrap = document.createElement("div");
  svgWrap.style.overflowX = "auto";
  svgWrap.style.flex = "1 1 auto";
  svgWrap.style.minHeight = "0";
  container.appendChild(svgWrap);

  const W = Math.max(n * 46, 320);
  const H = 320;
  const padL = 64, padR = 64, padT = 16, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  function minMax(values) {
    let maxV = Math.max(...values, 0);
    let minV = Math.min(...values, 0);
    if (maxV === minV) { maxV += 1; minV -= 1; }
    return { minV, maxV };
  }
  const { minV: minA, maxV: maxA } = minMax(seriesA.map(e => e.raw));
  const { minV: minB, maxV: maxB } = minMax(seriesB.map(e => e.raw));
  const rangoA = maxA - minA, rangoB = maxB - minB;

  const xFor = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yForT = (t) => padT + plotH - t * plotH; // t en [0,1], compartido por las dos escalas
  const yForA = (v) => yForT((v - minA) / rangoA);
  const yForB = (v) => yForT((v - minB) / rangoB);

  // Un solo juego de líneas de grilla (a fracción t pareja), con la etiqueta de cada
  // escala puesta a cada lado a la misma altura — así no hay dos grillas superpuestas
  // ni números de una métrica pisando a los de la otra.
  const numLineas = 4;
  let gridSvg = "";
  for (let i = 0; i <= numLineas; i++) {
    const t = i / numLineas;
    const y = yForT(t);
    const vA = minA + t * rangoA;
    const vB = minB + t * rangoB;
    gridSvg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--card-border)" stroke-width="1" />`;
    gridSvg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--accent)">${escapeHtml(formatValorEje(metricKeyA, vA))}</text>`;
    gridSvg += `<text x="${W - padR + 8}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-size="11" fill="var(--orange)">${escapeHtml(formatValorEje(metricKeyB, vB))}</text>`;
  }

  const xLabels = seriesA.map(e => e.label);
  const indicesConEtiqueta = new Set(elegirIndicesEtiquetas(n, plotW));
  let xLabelsSvg = "";
  for (let i = 0; i < n; i++) {
    if (indicesConEtiqueta.has(i)) {
      xLabelsSvg += `<text x="${xFor(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--text-dim)">${escapeHtml(xLabels[i])}</text>`;
    }
  }

  function serieSvg(serie, color, yFor, dashed) {
    const puntos = serie.map((e, i) => `${xFor(i).toFixed(1)},${yFor(e.raw).toFixed(1)}`).join(" ");
    const circles = serie.map((e, i) => `
      <circle
        class="chart-line-point"
        style="animation-delay:${Math.min(i * 15, 400)}ms;"
        cx="${xFor(i).toFixed(1)}" cy="${yFor(e.raw).toFixed(1)}" r="4" fill="${color}"
        data-label="${escapeHtml(e.fecha ? `${e.label} · ${nombreDiaSemana(e.fecha)}` : e.label)}" data-valor="${escapeHtml(e.formatted)}"
      ></circle>
    `).join("");
    return `<polyline class="chart-line-path${dashed ? " chart-line-path-dashed" : ""}" points="${puntos}" fill="none" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="6,4"' : ""} />${circles}`;
  }

  svgWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="100%" style="display:block;">
      ${gridSvg}
      ${serieSvg(seriesA, "var(--accent)", yForA, false)}
      ${serieSvg(seriesB, "var(--orange)", yForB, true)}
      ${xLabelsSvg}
    </svg>
  `;

  const pathA = svgWrap.querySelector(".chart-line-path:not(.chart-line-path-dashed)");
  if (pathA && typeof pathA.getTotalLength === "function") {
    const len = pathA.getTotalLength();
    pathA.style.strokeDasharray = String(len);
    pathA.style.strokeDashoffset = String(len);
    pathA.getBoundingClientRect();
    pathA.style.transition = "stroke-dashoffset .8s ease";
    requestAnimationFrame(() => { pathA.style.strokeDashoffset = "0"; });
  }
}

// Con exactamente dos métricas (la abierta + una) se usa el gráfico de eje doble real,
// que muestra la escala verdadera de cada una. Con tres o más ya no entran ejes reales
// para todas, así que cada línea pasa a su propia escala relativa (0 a 100% de su
// rango) — la forma se puede seguir comparando, y el valor real queda en el tooltip y
// en la tabla de abajo.
function renderMultiLineChartNormalizado(container, seriesList, labels) {
  ocultarChartTooltip();
  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "stretch";
  container.style.overflowX = "";
  const n = seriesList[0] ? seriesList[0].length : 0;
  if (n === 0) return;

  const colores = labels.map((_, i) => colorDeSerieMetrica(i));

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.style.margin = "0 0 8px";
  legend.style.flex = "0 0 auto";
  legend.innerHTML = labels.map((label, i) => `
    <span class="legend-item"><span class="legend-dot" style="background:${colores[i]};"></span>${escapeHtml(label)}</span>
  `).join("");
  container.appendChild(legend);

  const svgWrap = document.createElement("div");
  svgWrap.style.overflowX = "auto";
  svgWrap.style.flex = "1 1 auto";
  svgWrap.style.minHeight = "0";
  container.appendChild(svgWrap);

  const W = Math.max(n * 46, 320);
  const H = 320;
  const padL = 20, padR = 20, padT = 16, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  function normalizar(serie) {
    const valores = serie.map(e => e.raw);
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    if (max === min) return serie.map(() => 0.5);
    return serie.map(e => (e.raw - min) / (max - min));
  }
  const tPorSerie = seriesList.map(normalizar);

  const xFor = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (t) => padT + plotH - t * plotH;

  const numLineas = 4;
  let gridSvg = "";
  for (let i = 0; i <= numLineas; i++) {
    const y = padT + plotH - (i / numLineas) * plotH;
    gridSvg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--card-border)" stroke-width="1" />`;
  }

  const indicesConEtiqueta = new Set(elegirIndicesEtiquetas(n, plotW));
  let xLabelsSvg = "";
  for (let i = 0; i < n; i++) {
    if (indicesConEtiqueta.has(i)) {
      xLabelsSvg += `<text x="${xFor(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--text-dim)">${escapeHtml(seriesList[0][i].label)}</text>`;
    }
  }

  const DASH_PATRONES = ["", "6,4", "2,3", "8,3,2,3", "1,3"];
  function serieSvg(serie, ts, color, dash) {
    const puntos = serie.map((e, i) => `${xFor(i).toFixed(1)},${yFor(ts[i]).toFixed(1)}`).join(" ");
    const circles = serie.map((e, i) => `
      <circle
        class="chart-line-point"
        style="animation-delay:${Math.min(i * 15, 400)}ms;"
        cx="${xFor(i).toFixed(1)}" cy="${yFor(ts[i]).toFixed(1)}" r="4" fill="${color}"
        data-label="${escapeHtml(e.fecha ? `${e.label} · ${nombreDiaSemana(e.fecha)}` : e.label)}" data-valor="${escapeHtml(e.formatted)}"
      ></circle>
    `).join("");
    return `<polyline class="chart-line-path${dash ? " chart-line-path-dashed" : ""}" points="${puntos}" fill="none" stroke="${color}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ""} />${circles}`;
  }

  const seriesSvg = seriesList.map((serie, i) => serieSvg(serie, tPorSerie[i], colores[i], DASH_PATRONES[i % DASH_PATRONES.length])).join("");

  svgWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="100%" style="display:block;">
      ${gridSvg}
      ${seriesSvg}
      ${xLabelsSvg}
    </svg>
  `;

  const pathPrincipal = svgWrap.querySelector(".chart-line-path:not(.chart-line-path-dashed)");
  if (pathPrincipal && typeof pathPrincipal.getTotalLength === "function") {
    const len = pathPrincipal.getTotalLength();
    pathPrincipal.style.strokeDasharray = String(len);
    pathPrincipal.style.strokeDashoffset = String(len);
    pathPrincipal.getBoundingClientRect();
    pathPrincipal.style.transition = "stroke-dashoffset .8s ease";
    requestAnimationFrame(() => { pathPrincipal.style.strokeDashoffset = "0"; });
  }
}

function renderMetricModalComparacionMetricas() {
  const desde = document.getElementById("cmp-metricas-desde").value;
  const hasta = document.getElementById("cmp-metricas-hasta").value;

  const chartEl = document.getElementById("metric-modal-chart");
  const bodyEl = document.getElementById("metric-modal-body");
  const keys = [metricModalKey, ...metricModalMetricasExtra];
  const labels = keys.map(tituloDeMetrica);
  document.getElementById("metric-modal-thead-row").innerHTML =
    `<th>Día</th>${labels.map(l => `<th>${escapeHtml(l)}</th>`).join("")}`;
  document.getElementById("metric-modal-metricas-hint").style.display = keys.length >= 3 ? "block" : "none";

  if (!desde || !hasta) {
    chartEl.innerHTML = "";
    bodyEl.innerHTML = `<tr class="empty-row"><td colspan="${keys.length + 1}">Elegí el rango para comparar.</td></tr>`;
    return;
  }

  const fechas = fechasEnRangoInclusive(desde, hasta).slice(0, 90);
  const armarSerie = (key) => fechas.map(fecha => {
    const g = grupoDeUnDia(fecha);
    const { raw, formatted } = calcularValorMetrica(key, g, 1);
    return { fecha, label: formatFecha(fecha), raw, formatted };
  });
  const seriesPorMetrica = keys.map(armarSerie);

  if (keys.length === 2) {
    renderDualAxisLineChart(chartEl, seriesPorMetrica[0], seriesPorMetrica[1], keys[0], keys[1], labels[0], labels[1]);
  } else {
    renderMultiLineChartNormalizado(chartEl, seriesPorMetrica, labels);
  }

  bodyEl.innerHTML = fechas.length === 0
    ? `<tr class="empty-row"><td colspan="${keys.length + 1}">Sin datos.</td></tr>`
    : fechas.map((fecha, i) => `
        <tr>
          <td>${escapeHtml(nombreDiaSemana(fecha))}, ${escapeHtml(formatFecha(fecha))}</td>
          ${seriesPorMetrica.map(serie => `<td>${escapeHtml(serie[i].formatted)}</td>`).join("")}
        </tr>
      `).reverse().join("");
}

document.querySelectorAll(".metric-card-clickable").forEach(card => {
  card.addEventListener("click", () => {
    const titulo = card.querySelector(".label").textContent;
    abrirMetricModal(card.dataset.metric, titulo);
  });
});

document.querySelectorAll("#metric-modal-tabs .periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    metricModalPeriodo = btn.dataset.periodo;
    document.querySelectorAll("#metric-modal-tabs .periodo-tab").forEach(b => b.classList.toggle("active", b === btn));
    actualizarModoVivo();
    actualizarModoExtra();
    actualizarVisibilidadCanalBtn();
    renderMetricModal();
  });
});

// Los botones Líneas/Barras/Web-Local están agrupados en la misma barra, pero solo los
// dos primeros son mutuamente excluyentes (tipo de gráfico); "Web / Local" es un toggle
// aparte que se puede combinar con cualquiera de los dos.
document.querySelectorAll("#metric-modal-tipo-grafico .periodo-tab[data-tipo]").forEach(btn => {
  btn.addEventListener("click", () => {
    metricModalTipoGrafico = btn.dataset.tipo;
    document.querySelectorAll("#metric-modal-tipo-grafico .periodo-tab[data-tipo]").forEach(b => b.classList.toggle("active", b === btn));
    renderMetricModal();
  });
});

document.getElementById("metric-modal-canal-btn").addEventListener("click", () => {
  metricModalCanalActivo = !metricModalCanalActivo;
  document.getElementById("metric-modal-canal-btn").classList.toggle("active", metricModalCanalActivo);
  renderMetricModal();
});

document.querySelectorAll("#metric-modal-timeframe .periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    metricModalTimeframe = Number(btn.dataset.tf);
    document.querySelectorAll("#metric-modal-timeframe .periodo-tab").forEach(b => b.classList.toggle("active", b === btn));
    renderMetricModal();
  });
});

["cmp-a-desde", "cmp-a-hasta", "cmp-b-desde", "cmp-b-hasta"].forEach(id => {
  document.getElementById(id).addEventListener("change", () => renderMetricModal());
});

document.querySelectorAll("#metric-modal-comparar-canal .periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    metricModalComparCanal = btn.dataset.canal;
    document.querySelectorAll("#metric-modal-comparar-canal .periodo-tab").forEach(b => b.classList.toggle("active", b === btn));
    renderMetricModal();
  });
});

document.getElementById("cmp-mes-anterior-btn").addEventListener("click", () => {
  const aDesde = document.getElementById("cmp-a-desde").value;
  const aHasta = document.getElementById("cmp-a-hasta").value;
  if (!aDesde || !aHasta) return;
  document.getElementById("cmp-b-desde").value = restarMes(aDesde);
  document.getElementById("cmp-b-hasta").value = restarMes(aHasta);
  renderMetricModal();
});

["cmp-metricas-desde", "cmp-metricas-hasta"].forEach(id => {
  document.getElementById(id).addEventListener("change", () => renderMetricModal());
});

document.getElementById("cmp-metrica-agregar-btn").addEventListener("click", () => {
  if (metricModalMetricasExtra.length >= MAX_METRICAS_EXTRA) return;
  metricModalMetricasExtra.push(siguienteMetricaDisponible());
  renderFilasMetricasExtra();
  renderMetricModal();
});

document.getElementById("metric-modal-cerrar").addEventListener("click", cerrarMetricModal);
document.getElementById("metric-modal").addEventListener("click", (e) => {
  if (e.target.id === "metric-modal") cerrarMetricModal();
});

// ---------- Pantalla completa del modal de métrica ----------
// No usa la Fullscreen API del navegador (poco confiable en iOS/Safari para elementos
// sueltos): agranda el modal a todo el viewport con CSS, que funciona igual en cualquier
// dispositivo.

let metricModalMaximizado = false;
const metricModalCardEl = document.getElementById("metric-modal-card");
const metricModalFullscreenBtn = document.getElementById("metric-modal-fullscreen-btn");

function setMetricModalMaximizado(valor) {
  metricModalMaximizado = valor;
  metricModalCardEl.classList.toggle("modal-card-maximizado", valor);
  document.getElementById("metric-modal").classList.toggle("modal-overlay-maximizado", valor);
  metricModalFullscreenBtn.textContent = valor ? "🗗 Salir de pantalla completa" : "⛶ Pantalla completa";
  // El cuadro del gráfico cambia de tamaño al maximizar: las líneas dibujadas se
  // reubican solas porque se guardan como fracción del ancho/alto, no en píxeles fijos.
  requestAnimationFrame(() => { if (lineasDibujadas.length) renderDibujos(); });
}

metricModalFullscreenBtn.addEventListener("click", () => setMetricModalMaximizado(!metricModalMaximizado));

// ---------- Dibujar tendencias sobre el gráfico (estilo TradingView) ----------
// Una capa de líneas aparte del contenido del gráfico (que se re-dibuja solo cada vez
// que cambian los datos): así lo dibujado no desaparece si se toca un punto o se hace
// scroll. Se guarda como fracción del ancho/alto del cuadro, no en píxeles fijos, para
// que se reubique sola si el tamaño cambia (pantalla completa, resize).

const chartDrawWrap = document.getElementById("metric-modal-chart-wrap");
const chartDrawOverlay = document.getElementById("metric-modal-draw-overlay");
const dibujarBtn = document.getElementById("metric-modal-dibujar-btn");
const borrarDibujosBtn = document.getElementById("metric-modal-borrar-dibujos-btn");

let dibujoActivo = false;
let lineasDibujadas = []; // [{x1,y1,x2,y2}] fracciones 0..1 del cuadro del gráfico
let lineaEnCurso = null;

function puntoRelativo(clientX, clientY) {
  const rect = chartDrawOverlay.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1),
    y: Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1),
  };
}

function renderDibujos() {
  const rect = chartDrawOverlay.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  const todas = lineaEnCurso ? [...lineasDibujadas, lineaEnCurso] : lineasDibujadas;
  chartDrawOverlay.innerHTML = todas.map(l => `
    <line x1="${(l.x1 * w).toFixed(1)}" y1="${(l.y1 * h).toFixed(1)}" x2="${(l.x2 * w).toFixed(1)}" y2="${(l.y2 * h).toFixed(1)}"
      stroke="#F2C94C" stroke-width="2" stroke-linecap="round" />
  `).join("");
  borrarDibujosBtn.style.display = lineasDibujadas.length ? "" : "none";
}

// Se llama cada vez que el gráfico muestra datos distintos (cambio de pestaña, de
// métrica, de rango, etc.) para que no queden líneas viejas sobre un gráfico nuevo. No
// se llama en el refresco automático de "En vivo", que sigue siendo el mismo gráfico.
function limpiarDibujosChart() {
  lineasDibujadas = [];
  lineaEnCurso = null;
  if (chartDrawOverlay) chartDrawOverlay.innerHTML = "";
  if (borrarDibujosBtn) borrarDibujosBtn.style.display = "none";
}

function coordsDeEvento(e) {
  if (e.touches && e.touches[0]) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  return { clientX: e.clientX, clientY: e.clientY };
}

function iniciarLinea(e) {
  if (!dibujoActivo) return;
  e.preventDefault();
  const { clientX, clientY } = coordsDeEvento(e);
  const p = puntoRelativo(clientX, clientY);
  lineaEnCurso = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  renderDibujos();
}

function moverLinea(e) {
  if (!dibujoActivo || !lineaEnCurso) return;
  e.preventDefault();
  const { clientX, clientY } = coordsDeEvento(e);
  const p = puntoRelativo(clientX, clientY);
  lineaEnCurso.x2 = p.x;
  lineaEnCurso.y2 = p.y;
  renderDibujos();
}

function terminarLinea() {
  if (!dibujoActivo || !lineaEnCurso) return;
  // Descarta las líneas de un solo click sin arrastre (demasiado cortas para ser una
  // tendencia real).
  const distancia = Math.hypot(lineaEnCurso.x2 - lineaEnCurso.x1, lineaEnCurso.y2 - lineaEnCurso.y1);
  if (distancia > 0.01) lineasDibujadas.push(lineaEnCurso);
  lineaEnCurso = null;
  renderDibujos();
}

chartDrawOverlay.addEventListener("mousedown", iniciarLinea);
chartDrawOverlay.addEventListener("mousemove", moverLinea);
window.addEventListener("mouseup", terminarLinea);
chartDrawOverlay.addEventListener("touchstart", iniciarLinea, { passive: false });
chartDrawOverlay.addEventListener("touchmove", moverLinea, { passive: false });
chartDrawOverlay.addEventListener("touchend", terminarLinea);

dibujarBtn.addEventListener("click", () => {
  dibujoActivo = !dibujoActivo;
  dibujarBtn.classList.toggle("active", dibujoActivo);
  chartDrawWrap.classList.toggle("dibujando", dibujoActivo);
});

borrarDibujosBtn.addEventListener("click", limpiarDibujosChart);

window.addEventListener("resize", () => { if (lineasDibujadas.length) renderDibujos(); });

// ---------- Render por período ----------

function renderPeriodo(tipo) {
  periodoActual = tipo;
  document.querySelectorAll("#periodo-tabs .periodo-tab").forEach(b => b.classList.toggle("active", b.dataset.periodo === tipo));
  selectorSemana.style.display = tipo === "dia" ? "block" : "none";
  selectorMes.style.display = tipo === "semana" ? "block" : "none";

  let grupos, fechasEnRango, actual, diasEnPeriodo, rangoLabel;

  if (tipo === "dia") {
    poblarSelectorSemana();
    fechasEnRango = fechasDeSemana(semanaSeleccionada);
    grupos = fechasEnRango.map(fecha => {
      const d = porFechaGlobal[fecha];
      const g = grupoVacio(fecha, formatFecha(fecha));
      if (d) sumarEnGrupo(g, { ...d, diasConDatos: 1 });
      return g;
    });
    rangoLabel = `${formatFecha(semanaSeleccionada)} al ${formatFecha(getWeekEnd(semanaSeleccionada))}`;
    actual = grupos.reduce(sumarEnGrupo, grupoVacio("actual", rangoLabel));
    diasEnPeriodo = 7;
  } else if (tipo === "semana") {
    poblarSelectorMes();
    const semanas = semanasDeMes(mesSeleccionado);
    grupos = semanas.map(ws => {
      const g = grupoVacio(ws, `${formatFecha(ws)}-${formatFecha(getWeekEnd(ws))}`);
      fechasDeSemana(ws).forEach(fecha => {
        const d = porFechaGlobal[fecha];
        if (d) sumarEnGrupo(g, { ...d, diasConDatos: 1 });
      });
      return g;
    });
    // Las tarjetas de arriba ("Del mes") tienen que coincidir con la pestaña "Mes": se
    // calculan sobre los días exactos del mes elegido, no sobre semanas completas — la
    // primera y la última semana del mes casi siempre incluyen días de otro mes (las
    // semanas van de lunes a domingo), y antes esos días se colaban en el total.
    fechasEnRango = Object.keys(porFechaGlobal).filter(fecha => getMonthKey(fecha) === mesSeleccionado);
    rangoLabel = getMonthLabel(mesSeleccionado);
    actual = fechasEnRango.reduce(
      (acc, fecha) => sumarEnGrupo(acc, { ...porFechaGlobal[fecha], diasConDatos: 1 }),
      grupoVacio("actual", rangoLabel)
    );
    diasEnPeriodo = getDiasEnMes(mesSeleccionado);
  } else {
    // Mes: histórico completo, sin filtro (como estaba antes)
    grupos = agruparPorMesHistorico();
    const keyMesActual = getMonthKey(hoyFecha);
    let actualMes = grupos.find(g => g.key === keyMesActual);
    if (!actualMes) {
      actualMes = grupoVacio(keyMesActual, getMonthLabel(keyMesActual));
      grupos.push(actualMes);
    }
    grupos.sort((a, b) => a.key.localeCompare(b.key));
    grupos = grupos.slice(-24);
    actual = actualMes;
    rangoLabel = actualMes.label;
    fechasEnRango = null; // sin filtro: todo el histórico
    diasEnPeriodo = getDiasEnMes(keyMesActual);
  }

  const nombrePeriodo = { dia: "día", semana: "semana", mes: "mes" }[tipo];
  const nombrePeriodoDel = { dia: "de la semana", semana: "del mes", mes: "del mes" }[tipo];
  document.getElementById("titulo-chart-volumen").textContent = `Volumen vendido por ${nombrePeriodo}`;
  document.getElementById("titulo-chart-ganancia-bruta").textContent = `Ganancia bruta por ${nombrePeriodo}`;
  document.getElementById("titulo-chart-ganancia").textContent = `Ganancia neta por ${nombrePeriodo}`;
  document.getElementById("titulo-resumen").textContent = `Resumen por ${nombrePeriodo}`;
  document.getElementById("titulo-top-productos").textContent = `Top productos (${rangoLabel})`;
  document.getElementById("titulo-por-metodo").textContent = `Total por método de pago (${rangoLabel})`;
  document.getElementById("th-periodo").textContent = tipo === "dia" ? "Fecha" : tipo === "semana" ? "Semana" : "Mes";

  // Tarjetas de arriba: reflejan el rango visible (semana elegida / mes elegido / mes actual)
  const brutaActual = actual.gananciaBruta + actual.gananciaBrutaMayorista;
  const volumenTotalActual = actual.volumen + actual.volumenMayorista;
  const netaActual = brutaActual - actual.gasto;
  const ticketActual = actual.cantVentas ? actual.volumen / actual.cantVentas : 0;

  const fmtPct = (ganancia, venta) => (venta > 0 ? (ganancia / venta) * 100 : null);
  const pctRetornoGeneral = fmtPct(brutaActual, volumenTotalActual);
  const pctRetornoMinorista = fmtPct(actual.gananciaBruta, actual.volumen);
  const pctRetornoMayorista = fmtPct(actual.gananciaBrutaMayorista, actual.volumenMayorista);
  const pctRetornoNeto = fmtPct(netaActual, volumenTotalActual);

  document.getElementById("label-volumen").textContent = actual.label;
  document.getElementById("label-volumen-mayorista").textContent = actual.label;
  document.getElementById("label-ganancia-bruta").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-pct-retorno-general").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-ganancia-bruta-minorista").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-pct-retorno-minorista").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-ganancia-bruta-mayorista").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-pct-retorno-mayorista").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-ganancia-neta").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-pct-retorno-neto").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-gasto").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-gasto-publicidad").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-gasto-publicidad-diario").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-roas").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-ganancia-post-publicidad").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-cant-ventas").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-dias").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-ingreso-clientes").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);
  document.getElementById("label-ventas-perdidas").textContent = nombrePeriodoDel.charAt(0).toUpperCase() + nombrePeriodoDel.slice(1);

  document.getElementById("stat-volumen").textContent = money(actual.volumen);
  document.getElementById("stat-volumen-mayorista").textContent = money(actual.volumenMayorista);
  const statGananciaBruta = document.getElementById("stat-ganancia-bruta");
  statGananciaBruta.textContent = money(brutaActual);
  statGananciaBruta.classList.toggle("value-positive", brutaActual > 0);
  statGananciaBruta.classList.toggle("value-negative", brutaActual < 0);
  const statPctRetornoGeneral = document.getElementById("stat-pct-retorno-general");
  statPctRetornoGeneral.textContent = pctRetornoGeneral !== null ? pctRetornoGeneral.toFixed(1) + "%" : "—";
  statPctRetornoGeneral.classList.toggle("value-positive", pctRetornoGeneral !== null && pctRetornoGeneral > 0);
  statPctRetornoGeneral.classList.toggle("value-negative", pctRetornoGeneral !== null && pctRetornoGeneral < 0);
  const statGananciaBrutaMinorista = document.getElementById("stat-ganancia-bruta-minorista");
  statGananciaBrutaMinorista.textContent = money(actual.gananciaBruta);
  statGananciaBrutaMinorista.classList.toggle("value-positive", actual.gananciaBruta > 0);
  statGananciaBrutaMinorista.classList.toggle("value-negative", actual.gananciaBruta < 0);
  const statPctRetornoMinorista = document.getElementById("stat-pct-retorno-minorista");
  statPctRetornoMinorista.textContent = pctRetornoMinorista !== null ? pctRetornoMinorista.toFixed(1) + "%" : "—";
  statPctRetornoMinorista.classList.toggle("value-positive", pctRetornoMinorista !== null && pctRetornoMinorista > 0);
  statPctRetornoMinorista.classList.toggle("value-negative", pctRetornoMinorista !== null && pctRetornoMinorista < 0);
  document.getElementById("stat-ganancia-bruta-mayorista").textContent = money(actual.gananciaBrutaMayorista);
  document.getElementById("stat-pct-retorno-mayorista").textContent = pctRetornoMayorista !== null ? pctRetornoMayorista.toFixed(1) + "%" : "—";
  const statGananciaNeta = document.getElementById("stat-ganancia-neta");
  statGananciaNeta.textContent = money(netaActual);
  statGananciaNeta.classList.toggle("value-positive", netaActual > 0);
  statGananciaNeta.classList.toggle("value-negative", netaActual < 0);
  const statPctRetornoNeto = document.getElementById("stat-pct-retorno-neto");
  statPctRetornoNeto.textContent = pctRetornoNeto !== null ? pctRetornoNeto.toFixed(1) + "%" : "—";
  statPctRetornoNeto.classList.toggle("value-positive", pctRetornoNeto !== null && pctRetornoNeto > 0);
  statPctRetornoNeto.classList.toggle("value-negative", pctRetornoNeto !== null && pctRetornoNeto < 0);
  document.getElementById("stat-gasto").textContent = money(actual.gasto);
  document.getElementById("stat-gasto-publicidad").textContent = money(actual.gastoPublicidad);
  document.getElementById("stat-gasto-publicidad-diario").textContent = money(actual.gastoPublicidadSuavizado);
  const roasActual = actual.gastoPublicidadSuavizado > 0 ? actual.volumen / actual.gastoPublicidadSuavizado : null;
  document.getElementById("stat-roas").textContent = roasActual !== null ? roasActual.toFixed(1) + "x" : "—";
  const gananciaPostPublicidad = actual.gananciaBruta - actual.gastoPublicidadSuavizado;
  const statGananciaPostPublicidad = document.getElementById("stat-ganancia-post-publicidad");
  statGananciaPostPublicidad.textContent = money(gananciaPostPublicidad);
  statGananciaPostPublicidad.classList.toggle("value-positive", gananciaPostPublicidad > 0);
  statGananciaPostPublicidad.classList.toggle("value-negative", gananciaPostPublicidad < 0);
  document.getElementById("stat-cant-ventas").textContent = actual.cantVentas;
  document.getElementById("stat-ticket-promedio").textContent = money(ticketActual);
  document.getElementById("stat-dias").textContent = `${actual.diasConDatos} de ${diasEnPeriodo}`;
  document.getElementById("stat-ingreso-clientes").textContent = actual.cantVentasLocales + actual.cantVentasPerdidas;
  document.getElementById("stat-ventas-perdidas").textContent = actual.cantVentasPerdidas;

  renderDualBarChart(
    document.getElementById("chart-volumen-dia"),
    grupos.map(g => ({ label: g.label, valueA: g.volumen, valueB: g.volumenMayorista, valueC: g.gasto })),
    { showGasto: true }
  );
  renderDualBarChart(
    document.getElementById("chart-ganancia-bruta-dia"),
    grupos.map(g => ({
      label: g.label,
      valueA: g.gananciaBruta,
      valueB: g.gananciaBrutaMayorista,
      total: g.gananciaBruta + g.gananciaBrutaMayorista,
    })),
    { colorBySignA: true, labelA: "Minorista", labelB: "Mayorista" }
  );
  renderDualBarChart(
    document.getElementById("chart-ganancia-dia"),
    grupos.map(g => ({
      label: g.label,
      valueA: g.gananciaBruta - g.gasto,
      valueB: g.gananciaBrutaMayorista,
      total: (g.gananciaBruta + g.gananciaBrutaMayorista) - g.gasto,
    })),
    { colorBySignA: true, labelA: "Minorista (neto de gastos)", labelB: "Mayorista" }
  );

  const resumenBody = document.getElementById("resumen-periodo-body");
  const gruposDesc = [...grupos].reverse();
  resumenBody.innerHTML = gruposDesc.length === 0
    ? `<tr class="empty-row"><td colspan="8">Sin datos todavía.</td></tr>`
    : gruposDesc.map(g => {
        const neta = (g.gananciaBruta + g.gananciaBrutaMayorista) - g.gasto;
        return `
          <tr>
            <td>${g.label}</td>
            <td>${g.cantVentas}</td>
            <td>${money(g.volumen)}</td>
            <td style="color:var(--orange);">${money(g.volumenMayorista)}</td>
            <td>${money(g.gananciaBruta)}</td>
            <td style="color:var(--orange);">${money(g.gananciaBrutaMayorista)}</td>
            <td>${money(g.gasto)}</td>
            <td style="${neta < 0 ? 'color:#e15b5b;' : ''}">${money(neta)}</td>
          </tr>
        `;
      }).join("");

  // ---- Top productos y total por método de pago, filtrados al rango visible ----
  const fechasSet = fechasEnRango ? new Set(fechasEnRango) : null;
  const ventasEnRango = fechasSet ? ventasGlobal.filter(v => fechasSet.has(v.fecha)) : ventasGlobal;
  const itemsEnRango = fechasSet ? itemsGlobal.filter(it => fechasSet.has(it.fecha)) : itemsGlobal;

  const productoStats = {};
  itemsEnRango.forEach(it => {
    if (!productoStats[it.producto]) productoStats[it.producto] = { unidades: 0, volumen: 0 };
    productoStats[it.producto].unidades++;
    productoStats[it.producto].volumen += it.precio;
  });
  const topProductos = Object.entries(productoStats)
    .map(([producto, s]) => ({ producto, ...s }))
    .sort((a, b) => b.volumen - a.volumen)
    .slice(0, 10);

  const topBody = document.getElementById("top-productos-body");
  topBody.innerHTML = topProductos.length === 0
    ? `<tr class="empty-row"><td colspan="3">Sin datos en este rango.</td></tr>`
    : topProductos.map(p => `
        <tr>
          <td>${escapeHtml(p.producto)}</td>
          <td>${p.unidades}</td>
          <td>${money(p.volumen)}</td>
        </tr>
      `).join("");

  const porMetodo = {};
  ventasEnRango.forEach(v => { porMetodo[v.metodo] = (porMetodo[v.metodo] || 0) + v.precio; });
  const metodoBody = document.getElementById("por-metodo-body");
  const metodosOrdenados = Object.entries(porMetodo).sort((a, b) => b[1] - a[1]);
  metodoBody.innerHTML = metodosOrdenados.length === 0
    ? `<tr class="empty-row"><td colspan="2">Sin datos en este rango.</td></tr>`
    : metodosOrdenados.map(([metodo, total]) => `
        <tr>
          <td><span class="pm-tag ${metodo}">${METODO_LABELS[metodo] || metodo}</span></td>
          <td>${money(total)}</td>
        </tr>
      `).join("");
}

document.querySelectorAll("#periodo-tabs .periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => renderPeriodo(btn.dataset.periodo));
});
document.querySelector('#periodo-tabs .periodo-tab[data-periodo="dia"]').classList.add("active");

// ---------- Pantalla completa de los gráficos "de siempre" (Volumen, Ganancia bruta,
// Ganancia neta) ---------- Agranda la tarjeta entera del gráfico a todo el viewport con
// CSS, igual que el modal de métrica — no la Fullscreen API del navegador, poco
// confiable en iOS/Safari.

function salirDeTodosLosGraficosMaximizados() {
  document.querySelectorAll(".card-chart-maximizada").forEach(card => {
    card.classList.remove("card-chart-maximizada");
    const btn = card.querySelector(".chart-zoom-btn");
    if (btn) btn.textContent = "⛶ Pantalla completa";
  });
  document.body.classList.remove("chart-maximizado-activo");
}

document.querySelectorAll(".chart-zoom-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".card");
    const yaMaximizada = card.classList.contains("card-chart-maximizada");
    salirDeTodosLosGraficosMaximizados(); // solo uno a la vez
    if (!yaMaximizada) {
      card.classList.add("card-chart-maximizada");
      btn.textContent = "🗗 Salir de pantalla completa";
      document.body.classList.add("chart-maximizado-activo");
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") salirDeTodosLosGraficosMaximizados();
});

checkAuth();
