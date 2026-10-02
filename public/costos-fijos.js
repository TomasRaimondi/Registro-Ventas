function money(n) {
  const num = Number(n);
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
  cargarLista();
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
  const { authenticated, role } = await api("/api/auth-check");
  // Costos fijos expone información sensible del negocio: si por algún motivo entra
  // alguien con la sesión de empleado, se lo trata como no logueado en esta página.
  if (authenticated && role === "owner") showApp();
  else showLogin();
}

// ---------- Datos ----------

let costosGlobal = [];

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function estaPagadoEsteMes(c) {
  return c.pagadoMes === mesActual();
}

async function cargarLista() {
  const cont = document.getElementById("cf-lista");
  try {
    costosGlobal = await api("/api/costos-fijos");
    renderLista();
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    cont.innerHTML = `<p class="cf-vacio">Error al cargar: ${escapeHtml(err.message)}</p>`;
  }
}

function renderStats() {
  const total = costosGlobal.reduce((acc, c) => acc + c.monto, 0);
  const pagados = costosGlobal.filter(estaPagadoEsteMes);
  const pagado = pagados.reduce((acc, c) => acc + c.monto, 0);
  const falta = total - pagado;
  const faltantes = costosGlobal.length - pagados.length;

  document.getElementById("stat-total").textContent = money(total);
  document.getElementById("stat-cantidad").textContent =
    `${costosGlobal.length} costo${costosGlobal.length === 1 ? "" : "s"} fijo${costosGlobal.length === 1 ? "" : "s"}`;

  document.getElementById("stat-pagado").textContent = money(pagado);
  document.getElementById("stat-pagado-cant").textContent =
    `${pagados.length} de ${costosGlobal.length} pagado${pagados.length === 1 ? "" : "s"}`;

  document.getElementById("stat-falta").textContent = money(falta);
  document.getElementById("stat-falta-cant").textContent =
    faltantes > 0 ? `${faltantes} costo${faltantes === 1 ? "" : "s"} sin pagar` : "¡Todo pagado este mes! 🎉";
}

function renderLista() {
  renderStats();
  const cont = document.getElementById("cf-lista");
  if (!costosGlobal.length) {
    cont.innerHTML = `<p class="cf-vacio">Todavía no cargaste ningún costo fijo.</p>`;
    return;
  }

  cont.innerHTML = "";
  costosGlobal.forEach((c) => {
    const pagado = estaPagadoEsteMes(c);
    const fila = document.createElement("div");
    fila.className = "cf-fila" + (pagado ? " cf-pagada" : "");
    fila.dataset.id = c.id;
    fila.innerHTML = `
      <input type="checkbox" class="cf-pagado-check" data-campo="pagadoMes" ${pagado ? "checked" : ""} title="Marcar como pagado este mes">
      <input type="text" class="cf-input" data-campo="concepto" value="${escapeHtml(c.concepto)}">
      <div class="cf-monto-wrap"><span>$</span><input type="number" class="cf-input" data-campo="monto" value="${c.monto}" min="0" step="0.01"></div>
      <input type="text" class="cf-input" data-campo="notas" placeholder="Notas" value="${escapeHtml(c.notas || "")}">
      <span class="cf-guardado">Guardado ✓</span>
      <button type="button" class="del-btn" title="Borrar">✕</button>
    `;
    cont.appendChild(fila);
  });
}

async function guardarCampo(fila, campo, valor) {
  const id = fila.dataset.id;
  try {
    await api("/api/costos-fijos/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
    const c = costosGlobal.find((x) => x.id === id);
    if (c) c[campo] = valor;
    if (campo === "monto" || campo === "pagadoMes") renderStats();
    if (campo === "pagadoMes") fila.classList.toggle("cf-pagada", valor === mesActual());
    const aviso = fila.querySelector(".cf-guardado");
    aviso.classList.add("visible");
    setTimeout(() => aviso.classList.remove("visible"), 1500);
  } catch (err) {
    alert("No se pudo guardar: " + err.message);
  }
}

document.getElementById("cf-lista").addEventListener("change", (e) => {
  const checkbox = e.target.closest(".cf-pagado-check");
  if (checkbox) {
    const fila = checkbox.closest(".cf-fila");
    guardarCampo(fila, "pagadoMes", checkbox.checked ? mesActual() : null);
    return;
  }

  const input = e.target.closest(".cf-input");
  if (!input) return;
  const fila = input.closest(".cf-fila");
  const campo = input.dataset.campo;
  let valor = input.value;
  if (campo === "monto") {
    valor = Number(valor);
    if (!Number.isFinite(valor) || valor < 0) { alert("Monto inválido"); return; }
  } else {
    valor = valor.trim();
    if (campo === "concepto" && !valor) { alert("El concepto no puede quedar vacío"); return; }
  }
  guardarCampo(fila, campo, valor);
});

document.getElementById("cf-lista").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-btn");
  if (!btn) return;
  const fila = btn.closest(".cf-fila");
  const id = fila.dataset.id;
  const c = costosGlobal.find((x) => x.id === id);
  if (!confirm(`¿Borrar "${c ? c.concepto : "este costo fijo"}"?`)) return;
  try {
    await api("/api/costos-fijos/" + encodeURIComponent(id), { method: "DELETE" });
    costosGlobal = costosGlobal.filter((x) => x.id !== id);
    renderLista();
  } catch (err) {
    alert("No se pudo borrar: " + err.message);
  }
});

// ---------- Alta ----------

document.getElementById("cf-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = document.getElementById("cf-error");
  errorHint.style.display = "none";

  const concepto = document.getElementById("cf-concepto").value.trim();
  const monto = parseFloat(document.getElementById("cf-monto").value);
  const notas = document.getElementById("cf-notas").value.trim() || null;

  if (!concepto) { errorHint.textContent = "Ingresá un concepto."; errorHint.style.display = "block"; return; }
  if (!Number.isFinite(monto) || monto < 0) { errorHint.textContent = "Monto inválido."; errorHint.style.display = "block"; return; }

  try {
    const row = await api("/api/costos-fijos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concepto, monto, notas }),
    });
    costosGlobal.push(row);
    costosGlobal.sort((a, b) => a.concepto.localeCompare(b.concepto));
    renderLista();
    document.getElementById("cf-form").reset();
  } catch (err) {
    errorHint.textContent = err.message || "No se pudo agregar.";
    errorHint.style.display = "block";
  }
});

checkAuth();
