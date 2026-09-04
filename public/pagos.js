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

function formatMoneda(n) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(n || 0);
}

function formatHoraRelativa(iso) {
  if (!iso) return "nunca";
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "recién";
  if (minutos === 1) return "hace 1 minuto";
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;
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

const ESTADOS = {
  approved: { texto: "Acreditado", color: "var(--green)" },
  authorized: { texto: "Autorizado", color: "var(--green)" },
  pending: { texto: "Pendiente", color: "var(--orange)" },
  in_process: { texto: "En revisión", color: "var(--orange)" },
  in_mediation: { texto: "En mediación", color: "var(--orange)" },
  a_confirmar: { texto: "A confirmar", color: "var(--orange)" },
  rejected: { texto: "Rechazado", color: "var(--red)" },
  cancelled: { texto: "Cancelado", color: "var(--red)" },
  refunded: { texto: "Devuelto", color: "var(--red)" },
  charged_back: { texto: "Contracargo", color: "var(--red)" },
};

function estadoLegible(estado) {
  return ESTADOS[estado] || { texto: estado || "?", color: "inherit" };
}

let rolActual = null;

async function cargar() {
  const hoyFecha = getHoyFechaArgentina();
  const fechaActiva = fechaSeleccionada || hoyFecha;
  fechaInput.value = fechaActiva;
  hoyBtn.style.display = fechaActiva === hoyFecha ? "none" : "inline-block";
  document.getElementById("fecha-label").textContent = fechaActiva === hoyFecha ? "hoy" : formatFechaLarga(fechaActiva);

  const tbody = document.getElementById("lista-body");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Cargando...</td></tr>`;

  try {
    const { pagos, mp, rol } = await api("/api/pagos?fecha=" + encodeURIComponent(fechaActiva));
    rolActual = rol;
    renderEstadoMP(mp);

    const acreditado = pagos
      .filter((p) => p.origen === "mercadopago" && p.estado === "approved")
      .reduce((a, p) => a + (p.monto || 0), 0);
    document.getElementById("stat-acreditado").textContent = formatMoneda(acreditado);
    document.getElementById("stat-cantidad").textContent = pagos.length;
    document.getElementById("stat-pendientes").textContent = pagos.filter((p) => !p.verificado).length;

    if (!pagos.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No entró ningún pago ese día.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    pagos.forEach((p) => tbody.appendChild(filaPago(p)));
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderEstadoMP(mp) {
  const el = document.getElementById("estado-mp");
  if (!mp.configurado) {
    el.innerHTML = `<strong>Mercado Pago no está conectado.</strong> Falta cargar MP_ACCESS_TOKEN en el servidor.`;
    return;
  }
  const partes = [`Mercado Pago conectado · última actualización ${escapeHtml(formatHoraRelativa(mp.ultimaSync))}`];
  if (!mp.firmaActiva) partes.push("aviso sin firma (falta MP_WEBHOOK_SECRET)");
  if (mp.ultimoError) {
    // El error crudo de la API es un JSON largo: se muestra el principio y el resto
    // queda en el título, para que la línea no tape el panel.
    const corto = mp.ultimoError.length > 90 ? mp.ultimoError.slice(0, 90) + "…" : mp.ultimoError;
    partes.push(`<span title="${escapeHtml(mp.ultimoError)}" style="color:var(--red);">último error: ${escapeHtml(corto)}</span>`);
  }
  el.innerHTML = partes.join(" · ");
}

function filaPago(p) {
  const tr = document.createElement("tr");
  const estado = estadoLegible(p.estado);
  const origen = p.origen === "mercadopago" ? "Mercado Pago" : "Cuenta DNI";
  const neto = p.montoNeto != null && p.montoNeto !== p.monto
    ? `<br><small class="hint">neto ${escapeHtml(formatMoneda(p.montoNeto))}</small>`
    : "";

  tr.innerHTML = `
    <td>${escapeHtml((p.horaLabel || "").slice(0, 5))}</td>
    <td>${escapeHtml(origen)}</td>
    <td><strong>${escapeHtml(formatMoneda(p.monto))}</strong>${neto}</td>
    <td>${escapeHtml(p.metodo || "-")}</td>
    <td style="color:${estado.color};">${escapeHtml(estado.texto)}</td>
    <td>${escapeHtml(p.pagador || "-")}</td>
    <td></td>
  `;

  const celdaVerificado = tr.lastElementChild;
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = !!p.verificado;
  check.title = p.verificado ? `Verificado por ${p.verificadoPor || "alguien"}` : "Marcar como verificado";
  check.addEventListener("change", () => verificar(p.id, check));
  celdaVerificado.appendChild(check);

  if (p.verificado && p.verificadoPor) {
    const quien = document.createElement("small");
    quien.className = "hint";
    quien.textContent = " " + (p.verificadoPor === "owner" ? "dueño" : p.verificadoPor);
    celdaVerificado.appendChild(quien);
  }

  // Los pagos de Mercado Pago los borra solo el dueño, y reaparecen en la próxima
  // sincronización: la fuente de verdad es la API, no esta tabla.
  if (rolActual === "owner") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "clear-btn";
    btn.textContent = "Borrar";
    btn.style.marginLeft = "8px";
    btn.addEventListener("click", () => borrar(p.id, btn));
    celdaVerificado.appendChild(btn);
  }

  return tr;
}

async function verificar(id, check) {
  check.disabled = true;
  try {
    await api("/api/pagos/verificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, verificado: check.checked }),
    });
    await cargar();
  } catch (err) {
    check.checked = !check.checked;
    check.disabled = false;
    alert("No se pudo guardar: " + err.message);
  }
}

async function borrar(id, btn) {
  if (!confirm("¿Borrar este pago del registro?")) return;
  btn.disabled = true;
  try {
    await api("/api/pagos?id=" + encodeURIComponent(id), { method: "DELETE" });
    await cargar();
  } catch (err) {
    btn.disabled = false;
    alert("No se pudo borrar: " + err.message);
  }
}

// ---------- Actualizar contra la API ----------

const syncBtn = document.getElementById("sync-btn");
syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  const textoOriginal = syncBtn.textContent;
  syncBtn.textContent = "Actualizando...";
  try {
    await api("/api/pagos/sincronizar", { method: "POST" });
    await cargar();
  } catch (err) {
    alert("No se pudo actualizar: " + err.message);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = textoOriginal;
  }
});

// ---------- Carga manual de Cuenta DNI ----------

document.getElementById("manual-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = document.getElementById("manual-error");
  errorHint.style.display = "none";

  const monto = parseFloat(document.getElementById("manual-monto").value);
  const pagador = document.getElementById("manual-pagador").value.trim();
  const nota = document.getElementById("manual-nota").value.trim();

  try {
    await api("/api/pagos/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monto, pagador, nota }),
    });
    document.getElementById("manual-monto").value = "";
    document.getElementById("manual-pagador").value = "";
    document.getElementById("manual-nota").value = "";
    fechaSeleccionada = null;
    await cargar();
  } catch (err) {
    errorHint.textContent = err.message;
    errorHint.style.display = "block";
  }
});

// Refresco automático mientras la pestaña está abierta: el empleado ve entrar el pago
// sin tocar nada. Se pausa si la pestaña está en segundo plano.
setInterval(() => {
  if (!document.hidden && appContent.style.display !== "none" && !fechaSeleccionada) cargar();
}, 30000);

checkAuth();
