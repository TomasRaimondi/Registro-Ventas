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
  } catch (err) {
    btn.disabled = false;
    alert("No se pudo borrar: " + err.message);
  }
}

checkAuth();
