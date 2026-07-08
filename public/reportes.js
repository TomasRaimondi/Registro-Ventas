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

// ---------- Gráfico de barras genérico ----------

function renderBarChart(container, entries, { colorBySign = false } = {}) {
  container.innerHTML = "";
  if (entries.length === 0) return;

  const maxAbs = Math.max(...entries.map(e => Math.abs(e.value)), 1);

  entries.forEach(({ label, value }) => {
    const heightPct = Math.max((Math.abs(value) / maxAbs) * 100, value === 0 ? 2 : 4);

    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const valLabel = document.createElement("span");
    valLabel.className = "chart-bar-value";
    valLabel.textContent = money(value);

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = heightPct + "%";
    if (colorBySign) {
      bar.style.background = value < 0
        ? "linear-gradient(180deg, #e15b5b, #b83f3f)"
        : "linear-gradient(180deg, var(--green), #1f8f66)";
    }
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

// ---------- Render principal ----------

let hoyFecha = null;

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

  const { ventas, items, gastos } = data;

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  const porFecha = {};
  function getDia(fecha) {
    if (!porFecha[fecha]) porFecha[fecha] = { volumen: 0, cantVentas: 0, gananciaBruta: 0, gasto: 0 };
    return porFecha[fecha];
  }

  ventas.forEach(v => {
    const dia = getDia(v.fecha);
    if (v.metodo !== "mayorista") dia.volumen += v.precio;
    dia.cantVentas++;
  });

  const productoStats = {};
  items.forEach(it => {
    const dia = getDia(it.fecha);
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      dia.gananciaBruta += it.precio - costoPorProducto[key];
    }
    if (!productoStats[it.producto]) productoStats[it.producto] = { unidades: 0, volumen: 0 };
    productoStats[it.producto].unidades++;
    productoStats[it.producto].volumen += it.precio;
  });

  gastos.forEach(g => {
    const dia = getDia(g.fecha);
    dia.gasto += g.monto;
  });

  // ---- Gráficos, tarjetas y resumen por período (Día / Semana / Mes) ----
  porFechaGlobal = porFecha;
  renderPeriodo(periodoActual);

  // ---- Top productos ----
  const topProductos = Object.entries(productoStats)
    .map(([producto, s]) => ({ producto, ...s }))
    .sort((a, b) => b.volumen - a.volumen)
    .slice(0, 10);

  const topBody = document.getElementById("top-productos-body");
  topBody.innerHTML = topProductos.length === 0
    ? `<tr class="empty-row"><td colspan="3">Sin datos todavía.</td></tr>`
    : topProductos.map(p => `
        <tr>
          <td>${escapeHtml(p.producto)}</td>
          <td>${p.unidades}</td>
          <td>${money(p.volumen)}</td>
        </tr>
      `).join("");

  // ---- Total histórico por método de pago ----
  const porMetodo = {};
  ventas.forEach(v => { porMetodo[v.metodo] = (porMetodo[v.metodo] || 0) + v.precio; });
  const METODO_LABELS = {
    efectivo: "Efectivo", transferencia: "Transferencia", debito: "Débito",
    credito: "Crédito", cuentadni: "Cuenta DNI", mayorista: "Mayorista",
  };
  const metodoBody = document.getElementById("por-metodo-body");
  const metodosOrdenados = Object.entries(porMetodo).sort((a, b) => b[1] - a[1]);
  metodoBody.innerHTML = metodosOrdenados.length === 0
    ? `<tr class="empty-row"><td colspan="2">Sin datos todavía.</td></tr>`
    : metodosOrdenados.map(([metodo, total]) => `
        <tr>
          <td><span class="pm-tag ${metodo}">${METODO_LABELS[metodo] || metodo}</span></td>
          <td>${money(total)}</td>
        </tr>
      `).join("");

}

// ---------- Agrupación por Día / Semana / Mes ----------

let porFechaGlobal = {};
let periodoActual = "dia";

function agruparPorPeriodo(porFecha, tipo) {
  const grupos = {};

  function addFecha(fecha, key, label) {
    if (!grupos[key]) grupos[key] = { key, label, volumen: 0, cantVentas: 0, gananciaBruta: 0, gasto: 0, diasConDatos: 0 };
    const d = porFecha[fecha];
    grupos[key].volumen += d.volumen;
    grupos[key].cantVentas += d.cantVentas;
    grupos[key].gananciaBruta += d.gananciaBruta;
    grupos[key].gasto += d.gasto;
    grupos[key].diasConDatos += 1;
  }

  Object.keys(porFecha).forEach(fecha => {
    if (tipo === "dia") {
      addFecha(fecha, fecha, formatFecha(fecha));
    } else if (tipo === "semana") {
      const inicio = getWeekStart(fecha);
      addFecha(fecha, inicio, `${formatFecha(inicio)}-${formatFecha(getWeekEnd(inicio))}`);
    } else {
      const mes = getMonthKey(fecha);
      addFecha(fecha, mes, getMonthLabel(mes));
    }
  });

  return Object.values(grupos).sort((a, b) => a.key.localeCompare(b.key));
}

function getDiasEnMes(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function claveYLabelActual(tipo) {
  if (tipo === "dia") return { key: hoyFecha, label: formatFecha(hoyFecha) };
  if (tipo === "semana") {
    const inicio = getWeekStart(hoyFecha);
    return { key: inicio, label: `${formatFecha(inicio)}-${formatFecha(getWeekEnd(inicio))}` };
  }
  const mes = getMonthKey(hoyFecha);
  return { key: mes, label: getMonthLabel(mes) };
}

function renderPeriodo(tipo) {
  const limites = { dia: 30, semana: 20, mes: 24 };
  let grupos = agruparPorPeriodo(porFechaGlobal, tipo);

  // Asegura que el período actual (hoy / esta semana / este mes) siempre aparezca,
  // aunque todavía no tenga ninguna venta cargada.
  const { key: keyActual, label: labelActual } = claveYLabelActual(tipo);
  let actual = grupos.find(g => g.key === keyActual);
  if (!actual) {
    actual = { key: keyActual, label: labelActual, volumen: 0, cantVentas: 0, gananciaBruta: 0, gasto: 0, diasConDatos: 0 };
    grupos.push(actual);
  }
  grupos.sort((a, b) => a.key.localeCompare(b.key));
  grupos = grupos.slice(-limites[tipo]);

  const nombrePeriodo = { dia: "día", semana: "semana", mes: "mes" }[tipo];
  const nombrePeriodoDel = { dia: "del día", semana: "de la semana", mes: "del mes" }[tipo];
  document.getElementById("titulo-chart-volumen").textContent = `Volumen vendido por ${nombrePeriodo}`;
  document.getElementById("titulo-chart-ganancia").textContent = `Ganancia neta por ${nombrePeriodo}`;
  document.getElementById("titulo-resumen").textContent = `Resumen por ${nombrePeriodo}`;
  document.getElementById("th-periodo").textContent = tipo === "dia" ? "Fecha" : tipo === "semana" ? "Semana" : "Mes";

  // Tarjetas de arriba: siempre reflejan el período actual real (hoy / esta semana / este mes)
  const netaActual = actual.gananciaBruta - actual.gasto;
  const ticketActual = actual.cantVentas ? actual.volumen / actual.cantVentas : 0;
  const diasEnPeriodo = tipo === "dia" ? 1 : tipo === "semana" ? 7 : getDiasEnMes(keyActual);

  document.getElementById("label-volumen").textContent = `Volumen ${nombrePeriodoDel} (${actual.label})`;
  document.getElementById("label-ganancia-neta").textContent = `Ganancia neta ${nombrePeriodoDel}`;
  document.getElementById("label-gasto").textContent = `Gasto ${nombrePeriodoDel}`;
  document.getElementById("label-cant-ventas").textContent = `Ventas ${nombrePeriodoDel}`;
  document.getElementById("label-dias").textContent = tipo === "dia" ? "Ventas registradas" : `Días con actividad ${nombrePeriodoDel}`;

  document.getElementById("stat-volumen").textContent = money(actual.volumen);
  document.getElementById("stat-ganancia-neta").textContent = money(netaActual);
  document.getElementById("stat-gasto").textContent = money(actual.gasto);
  document.getElementById("stat-cant-ventas").textContent = actual.cantVentas;
  document.getElementById("stat-ticket-promedio").textContent = money(ticketActual);
  document.getElementById("stat-dias").textContent = tipo === "dia" ? actual.cantVentas : `${actual.diasConDatos} de ${diasEnPeriodo}`;

  renderBarChart(
    document.getElementById("chart-volumen-dia"),
    grupos.map(g => ({ label: g.label, value: g.volumen }))
  );
  renderBarChart(
    document.getElementById("chart-ganancia-dia"),
    grupos.map(g => ({ label: g.label, value: g.gananciaBruta - g.gasto })),
    { colorBySign: true }
  );

  const resumenBody = document.getElementById("resumen-periodo-body");
  const gruposDesc = [...grupos].reverse();
  resumenBody.innerHTML = gruposDesc.length === 0
    ? `<tr class="empty-row"><td colspan="6">Sin datos todavía.</td></tr>`
    : gruposDesc.map(g => {
        const neta = g.gananciaBruta - g.gasto;
        return `
          <tr>
            <td>${g.label}</td>
            <td>${g.cantVentas}</td>
            <td>${money(g.volumen)}</td>
            <td>${money(g.gananciaBruta)}</td>
            <td>${money(g.gasto)}</td>
            <td style="${neta < 0 ? 'color:#e15b5b;' : ''}">${money(neta)}</td>
          </tr>
        `;
      }).join("");
}

document.querySelectorAll(".periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".periodo-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    periodoActual = btn.dataset.periodo;
    renderPeriodo(periodoActual);
  });
});
document.querySelector('.periodo-tab[data-periodo="dia"]').classList.add("active");

checkAuth();
