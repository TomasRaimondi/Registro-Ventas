function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function normalizeConcepto(s) {
  return (s || "").trim().toLowerCase();
}

function formatFechaCorta(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

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

// ---------- Agrupación ----------

function agruparPorConcepto(gastos) {
  const mapa = new Map();
  gastos.forEach(g => {
    const key = normalizeConcepto(g.concepto);
    if (!mapa.has(key)) mapa.set(key, { concepto: g.concepto, veces: 0, total: 0 });
    const acc = mapa.get(key);
    acc.veces += 1;
    acc.total += g.monto;
  });
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

function agruparPorMes(gastos) {
  const mapa = new Map();
  gastos.forEach(g => {
    const [y, m] = g.fecha.split("-").map(Number);
    const key = y * 12 + (m - 1);
    if (!mapa.has(key)) mapa.set(key, { label: `${MESES[m - 1]} ${y}`, total: 0, gastos: [] });
    const acc = mapa.get(key);
    acc.total += g.monto;
    acc.gastos.push(g);
  });
  return [...mapa.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

// ---------- Render ----------

async function renderAll() {
  let data;
  try {
    data = await api("/api/reportes");
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const gastos = data.gastos || [];

  const totalGeneral = gastos.reduce((acc, g) => acc + g.monto, 0);
  document.getElementById("total-general").textContent = money(totalGeneral);
  document.getElementById("cantidad-general").textContent =
    gastos.length === 1 ? "1 gasto cargado" : `${gastos.length} gastos cargados`;

  // Gastos que más se repiten
  const repetidosBody = document.getElementById("repetidos-body");
  repetidosBody.innerHTML = "";
  if (gastos.length === 0) {
    repetidosBody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no hay gastos cargados.</td></tr>`;
  } else {
    agruparPorConcepto(gastos).forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(g.concepto)}</td>
        <td>${g.veces}</td>
        <td>${money(g.total)}</td>
        <td>${money(g.total / g.veces)}</td>
      `;
      repetidosBody.appendChild(tr);
    });
  }

  // Desglose mensual, con el mes más reciente desplegado por defecto
  const mesesContainer = document.getElementById("meses-container");
  const mesesEmpty = document.getElementById("meses-empty");
  mesesContainer.querySelectorAll(".mes-bloque").forEach(el => el.remove());

  const meses = agruparPorMes(gastos);
  mesesEmpty.style.display = meses.length === 0 ? "block" : "none";

  meses.forEach((mes, index) => {
    const bloque = document.createElement("div");
    bloque.className = "mes-bloque";

    const filas = [...mes.gastos]
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creadoEn.localeCompare(b.creadoEn))
      .map(g => `
        <tr>
          <td>${formatFechaCorta(g.fecha)}</td>
          <td>${escapeHtml(g.concepto)}</td>
          <td>${money(g.monto)}</td>
        </tr>
      `).join("");

    const abierto = index === 0;
    bloque.innerHTML = `
      <h3 class="collapsible-header mes-header${abierto ? " expanded" : ""}">
        <span><span class="expand-caret">▸</span>${escapeHtml(mes.label.charAt(0).toUpperCase() + mes.label.slice(1))}</span>
        <span class="mes-total">${money(mes.total)}</span>
      </h3>
      <div class="table-wrap mes-tabla" style="display:${abierto ? "block" : "none"};">
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    `;

    const header = bloque.querySelector(".mes-header");
    const tabla = bloque.querySelector(".mes-tabla");
    header.addEventListener("click", () => {
      const abierto = tabla.style.display !== "none";
      tabla.style.display = abierto ? "none" : "block";
      header.classList.toggle("expanded", !abierto);
    });

    mesesContainer.appendChild(bloque);
  });
}

checkAuth();
