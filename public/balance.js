function money(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
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
  try {
    const { authenticated, role } = await api("/api/auth-check");
    if (authenticated && role === "owner") showApp();
    else showLogin();
  } catch (e) {
    showLogin();
  }
}

// ---------- Estado ----------

let valorStockVivo = 0;
let historialGlobal = [];

async function cargarTodo() {
  try {
    const [resumen, historial, hora] = await Promise.all([
      api("/api/inventario/resumen"),
      api("/api/balance"),
      api("/api/hora"),
    ]);
    valorStockVivo = resumen.capitalInvertido;
    historialGlobal = historial;
    document.getElementById("stat-valor-stock-vivo").textContent = money(valorStockVivo);
    document.getElementById("preview-valor-stock").textContent = money(valorStockVivo);

    if (!document.getElementById("bal-fecha").value) {
      document.getElementById("bal-fecha").value = hora.fecha;
    }

    renderUltimoBalance();
    renderHistorial();
    actualizarPreview();
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    document.getElementById("bal-historial-body").innerHTML =
      `<tr class="empty-row"><td colspan="12">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUltimoBalance() {
  const statPatrimonio = document.getElementById("stat-ultimo-patrimonio");
  const statFecha = document.getElementById("stat-ultimo-fecha");
  if (!historialGlobal.length) {
    statPatrimonio.textContent = "—";
    statFecha.textContent = "Todavía no hiciste ningún balance";
    return;
  }
  const ultimo = historialGlobal[historialGlobal.length - 1];
  statPatrimonio.textContent = money(ultimo.patrimonioNeto);
  statFecha.textContent = `Del ${ultimo.fecha}`;
}

// ---------- Vista previa en vivo ----------

function calcularPatrimonio() {
  const num = (id) => Number(document.getElementById(id).value) || 0;
  const deudasPagar = num("bal-deudas-pagar");
  const deudasCobrar = num("bal-deudas-cobrar");
  const cuenta1 = num("bal-cuenta1");
  const cuenta2 = num("bal-cuenta2");
  const efectivo = num("bal-efectivo");
  const inversionBase = num("bal-inversion-base");
  const patrimonioNeto = valorStockVivo + cuenta1 + cuenta2 + efectivo + deudasCobrar - deudasPagar;
  const roi = inversionBase > 0 ? ((patrimonioNeto - inversionBase) / inversionBase) * 100 : null;
  return { patrimonioNeto, roi };
}

function actualizarPreview() {
  const { patrimonioNeto, roi } = calcularPatrimonio();
  document.getElementById("preview-patrimonio").textContent = money(patrimonioNeto);
  const roiEl = document.getElementById("preview-roi");
  if (roi === null) {
    roiEl.textContent = "—";
    roiEl.className = "valor";
  } else {
    roiEl.textContent = (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%";
    roiEl.className = "valor " + (roi >= 0 ? "bal-roi-positivo" : "bal-roi-negativo");
  }
}

["bal-deudas-pagar", "bal-deudas-cobrar", "bal-cuenta1", "bal-cuenta2", "bal-efectivo", "bal-inversion-base"].forEach((id) => {
  document.getElementById(id).addEventListener("input", actualizarPreview);
});

// ---------- Guardar balance ----------

document.getElementById("bal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = document.getElementById("bal-error");
  errorHint.style.display = "none";

  const fecha = document.getElementById("bal-fecha").value;
  if (!fecha) { errorHint.textContent = "Elegí la fecha."; errorHint.style.display = "block"; return; }

  const yaExiste = historialGlobal.some((b) => b.fecha === fecha);
  if (yaExiste && !confirm(`Ya hay un balance guardado para el ${fecha}. ¿Reemplazarlo?`)) return;

  const body = {
    fecha,
    deudasPagar: Number(document.getElementById("bal-deudas-pagar").value) || 0,
    deudasCobrar: Number(document.getElementById("bal-deudas-cobrar").value) || 0,
    capitalCuenta1: Number(document.getElementById("bal-cuenta1").value) || 0,
    capitalCuenta2: Number(document.getElementById("bal-cuenta2").value) || 0,
    efectivo: Number(document.getElementById("bal-efectivo").value) || 0,
    inversionBase: Number(document.getElementById("bal-inversion-base").value) || 0,
    nota: document.getElementById("bal-nota").value.trim() || null,
  };

  try {
    await api("/api/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    document.getElementById("bal-nota").value = "";
    await cargarTodo();
  } catch (err) {
    errorHint.textContent = err.message || "No se pudo guardar el balance.";
    errorHint.style.display = "block";
  }
});

// ---------- Historial ----------

function renderHistorial() {
  const tbody = document.getElementById("bal-historial-body");
  if (!historialGlobal.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">Todavía no hiciste ningún balance.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  [...historialGlobal].reverse().forEach((b) => {
    const roi = b.inversionInicial > 0 ? ((b.patrimonioNeto - b.inversionInicial) / b.inversionInicial) * 100 : null;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(b.fecha)}</strong></td>
      <td>${money(b.valorStock)}</td>
      <td>${money(b.capitalCuenta1)}</td>
      <td>${money(b.capitalCuenta2)}</td>
      <td>${money(b.capitalEfectivo)}</td>
      <td>${money(b.deudasPagar)}</td>
      <td>${money(b.deudasCobrar)}</td>
      <td>${money(b.inversionInicial)}</td>
      <td><strong>${money(b.patrimonioNeto)}</strong></td>
      <td class="${roi === null ? "" : (roi >= 0 ? "bal-roi-positivo" : "bal-roi-negativo")}">${roi === null ? "—" : (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%"}</td>
      <td>${escapeHtml(b.nota || "")}</td>
      <td><button type="button" class="del-btn" title="Borrar" data-fecha="${escapeHtml(b.fecha)}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("bal-historial-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-btn");
  if (!btn) return;
  const fecha = btn.dataset.fecha;
  if (!confirm(`¿Borrar el balance del ${fecha}?`)) return;
  try {
    await api("/api/balance/" + encodeURIComponent(fecha), { method: "DELETE" });
    historialGlobal = historialGlobal.filter((b) => b.fecha !== fecha);
    renderUltimoBalance();
    renderHistorial();
  } catch (err) {
    alert("No se pudo borrar: " + err.message);
  }
});

checkAuth();
