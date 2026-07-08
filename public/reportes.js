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

function renderDualBarChart(container, entries, { colorBySignA = false, labelA = "Minorista", labelB = "Mayorista" } = {}) {
  container.innerHTML = "";
  if (entries.length === 0) return;

  const maxAbs = Math.max(...entries.map(e => Math.abs(e.valueA) + Math.abs(e.valueB)), 1);

  entries.forEach(({ label, valueA, valueB, total }) => {
    const totalMostrado = total !== undefined ? total : valueA + valueB;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const totalLabel = document.createElement("span");
    totalLabel.className = "chart-bar-value";
    totalLabel.textContent = money(totalMostrado);

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

    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = label;

    wrap.appendChild(totalLabel);
    wrap.appendChild(pair);
    wrap.appendChild(hLabel);
    container.appendChild(wrap);
  });
}

// ---------- Estado global ----------

let hoyFecha = null;
let ventasGlobal = [];
let itemsGlobal = [];
let gastosGlobal = [];
let porFechaGlobal = {};
let periodoActual = "dia";
let semanaSeleccionada = null; // weekStart (YYYY-MM-DD), usada por la pestaña "Día"
let mesSeleccionado = null; // YYYY-MM, usada por la pestaña "Semana"

const METODO_LABELS = {
  efectivo: "Efectivo", transferencia: "Transferencia", debito: "Débito",
  credito: "Crédito", cuentadni: "Cuenta DNI", mayorista: "Mayorista",
};

// ---------- Carga de datos ----------

async function renderAll() {
  let data, costos, hora;
  try {
    [data, costos, hora] = await Promise.all([
      api("/api/reportes"),
      api("/api/costos"),
      api("/api/hora"),
    ]);
    hoyFecha = hora.fecha;
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  ventasGlobal = data.ventas;
  itemsGlobal = data.items;
  gastosGlobal = data.gastos;

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  const porFecha = {};
  function getDia(fecha) {
    if (!porFecha[fecha]) porFecha[fecha] = { volumen: 0, volumenMayorista: 0, cantVentas: 0, gananciaBruta: 0, gananciaBrutaMayorista: 0, gasto: 0 };
    return porFecha[fecha];
  }

  ventasGlobal.forEach(v => {
    const dia = getDia(v.fecha);
    if (v.metodo === "mayorista") dia.volumenMayorista += v.precio;
    else dia.volumen += v.precio;
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
  });

  porFechaGlobal = porFecha;

  if (!semanaSeleccionada) semanaSeleccionada = getWeekStart(hoyFecha);
  if (!mesSeleccionado) mesSeleccionado = getMonthKey(hoyFecha);

  renderPeriodo(periodoActual);
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
  return { key, label, volumen: 0, volumenMayorista: 0, cantVentas: 0, gananciaBruta: 0, gananciaBrutaMayorista: 0, gasto: 0, diasConDatos: 0 };
}

function sumarEnGrupo(acc, d) {
  acc.volumen += d.volumen;
  acc.volumenMayorista += d.volumenMayorista;
  acc.cantVentas += d.cantVentas;
  acc.gananciaBruta += d.gananciaBruta;
  acc.gananciaBrutaMayorista += d.gananciaBrutaMayorista;
  acc.gasto += d.gasto;
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

// ---------- Render por período ----------

function renderPeriodo(tipo) {
  periodoActual = tipo;
  document.querySelectorAll(".periodo-tab").forEach(b => b.classList.toggle("active", b.dataset.periodo === tipo));
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
    fechasEnRango = semanas.flatMap(fechasDeSemana);
    rangoLabel = getMonthLabel(mesSeleccionado);
    actual = grupos.reduce(sumarEnGrupo, grupoVacio("actual", rangoLabel));
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
  document.getElementById("titulo-chart-ganancia").textContent = `Ganancia neta por ${nombrePeriodo}`;
  document.getElementById("titulo-resumen").textContent = `Resumen por ${nombrePeriodo}`;
  document.getElementById("titulo-top-productos").textContent = `Top productos (${rangoLabel})`;
  document.getElementById("titulo-por-metodo").textContent = `Total por método de pago (${rangoLabel})`;
  document.getElementById("th-periodo").textContent = tipo === "dia" ? "Fecha" : tipo === "semana" ? "Semana" : "Mes";

  // Tarjetas de arriba: reflejan el rango visible (semana elegida / mes elegido / mes actual)
  const netaActual = (actual.gananciaBruta + actual.gananciaBrutaMayorista) - actual.gasto;
  const ticketActual = actual.cantVentas ? actual.volumen / actual.cantVentas : 0;

  document.getElementById("label-volumen").textContent = `Volumen (${actual.label})`;
  document.getElementById("label-volumen-mayorista").textContent = `Volumen Mayorista (${actual.label})`;
  document.getElementById("label-ganancia-neta").textContent = `Ganancia neta ${nombrePeriodoDel}`;
  document.getElementById("label-gasto").textContent = `Gasto ${nombrePeriodoDel}`;
  document.getElementById("label-cant-ventas").textContent = `Ventas ${nombrePeriodoDel}`;
  document.getElementById("label-dias").textContent = `Días con actividad ${nombrePeriodoDel}`;

  document.getElementById("stat-volumen").textContent = money(actual.volumen);
  document.getElementById("stat-volumen-mayorista").textContent = money(actual.volumenMayorista);
  document.getElementById("stat-ganancia-neta").textContent = money(netaActual);
  document.getElementById("stat-gasto").textContent = money(actual.gasto);
  document.getElementById("stat-cant-ventas").textContent = actual.cantVentas;
  document.getElementById("stat-ticket-promedio").textContent = money(ticketActual);
  document.getElementById("stat-dias").textContent = `${actual.diasConDatos} de ${diasEnPeriodo}`;

  renderDualBarChart(
    document.getElementById("chart-volumen-dia"),
    grupos.map(g => ({ label: g.label, valueA: g.volumen, valueB: g.volumenMayorista }))
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

document.querySelectorAll(".periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => renderPeriodo(btn.dataset.periodo));
});
document.querySelector('.periodo-tab[data-periodo="dia"]').classList.add("active");

checkAuth();
