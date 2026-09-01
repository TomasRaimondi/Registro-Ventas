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

function formatFechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
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

// ---------- Login (mismo patrón que el resto del panel) ----------

const loginCard = document.getElementById("login-card");
const appContent = document.getElementById("app-content");
const logoutBtn = document.getElementById("logout-btn");

function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "inline-block";
  cargarClientes();
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

// ---------- Estado ----------

let clientes = [];
let sincronizadoEn = null;
let segmentoActivo = "todos";
let cargando = false;
const cuponesGenerados = new Map(); // clienteKey -> { code, porcentaje }

function claveCliente(c) {
  return c.id ? `id-${c.id}` : `email-${(c.email || "").toLowerCase()}`;
}

// ---------- Carga de datos ----------

async function cargarClientes(forzar = false) {
  if (cargando) return;
  cargando = true;
  const syncLabel = document.getElementById("sync-label");
  syncLabel.textContent = "Sincronizando con Tiendanube...";

  try {
    const data = await api(`/api/clientes-recompra${forzar ? "?forzar=1" : ""}`);
    clientes = data.clientes;
    sincronizadoEn = data.sincronizadoEn;
    document.getElementById("sin-conexion").style.display = "none";
    render();
  } catch (err) {
    if (err.status === 503) {
      document.getElementById("sin-conexion").style.display = "block";
      syncLabel.textContent = "Tienda no conectada.";
    } else {
      syncLabel.textContent = "Error al sincronizar: " + err.message;
    }
  } finally {
    cargando = false;
  }
}

document.getElementById("refrescar-btn").addEventListener("click", () => cargarClientes(true));

// Refresco silencioso cada 5 minutos mientras la pestaña está abierta (la API tiene su
// propia cache de 3 min del lado del servidor, así que esto no la satura).
setInterval(() => { if (appContent.style.display !== "none") cargarClientes(false); }, 5 * 60 * 1000);

// ---------- Filtros ----------

document.getElementById("segmento-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".periodo-tab");
  if (!btn) return;
  document.querySelectorAll("#segmento-tabs .periodo-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  segmentoActivo = btn.dataset.segmento;
  render();
});

document.getElementById("buscador").addEventListener("input", () => render());
document.getElementById("umbral-dias").addEventListener("input", () => render());

// ---------- Render ----------

function umbralInactivo() {
  const v = Number(document.getElementById("umbral-dias").value);
  return Number.isFinite(v) && v > 0 ? v : 45;
}

function segmentoDeCliente(c, umbral) {
  if (c.segmento === "recompro") return "recompro";
  if (c.diasSinComprar != null && c.diasSinComprar >= umbral) return "inactivo";
  return "unico";
}

function render() {
  const umbral = umbralInactivo();
  const texto = document.getElementById("buscador").value.trim().toLowerCase();

  const conSegmento = clientes.map((c) => ({ ...c, segmentoUi: segmentoDeCliente(c, umbral) }));

  const totalRecompro = conSegmento.filter((c) => c.segmento === "recompro").length;
  const totalUnico = conSegmento.filter((c) => c.segmento === "unico").length;
  const totalInactivo = conSegmento.filter((c) => c.segmentoUi === "inactivo").length;

  document.getElementById("stat-total").textContent = conSegmento.length;
  document.getElementById("stat-recompro").textContent = totalRecompro;
  document.getElementById("stat-recompro-pct").textContent = conSegmento.length
    ? `${((totalRecompro / conSegmento.length) * 100).toFixed(1)}% del total`
    : "";
  document.getElementById("stat-unico").textContent = totalUnico;
  document.getElementById("stat-inactivo").textContent = totalInactivo;

  let filtrados = conSegmento.filter((c) => {
    if (segmentoActivo !== "todos" && c.segmentoUi !== segmentoActivo) return false;
    if (!texto) return true;
    const haystack = `${c.nombre || ""} ${c.email || ""} ${c.telefono || ""}`.toLowerCase();
    return haystack.includes(texto);
  });

  if (segmentoActivo === "inactivo") {
    filtrados.sort((a, b) => (b.diasSinComprar || 0) - (a.diasSinComprar || 0));
  } else if (segmentoActivo === "recompro") {
    filtrados.sort((a, b) => b.compras - a.compras || b.totalGastado - a.totalGastado);
  } else {
    filtrados.sort((a, b) => (b.ultimaCompra || "").localeCompare(a.ultimaCompra || ""));
  }

  const tbody = document.getElementById("clientes-body");
  tbody.innerHTML = "";

  if (!filtrados.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No hay clientes que coincidan con el filtro.</td></tr>`;
  } else {
    filtrados.forEach((c) => tbody.appendChild(filaCliente(c)));
  }

  const syncLabel = document.getElementById("sync-label");
  if (sincronizadoEn) {
    const min = Math.max(0, Math.round((Date.now() - sincronizadoEn) / 60000));
    syncLabel.textContent = min === 0 ? "Sincronizado hace instantes." : `Sincronizado hace ${min} min.`;
  }
}

function badgeSegmento(seg) {
  if (seg === "recompro") return `<span class="badge-segmento recompro">Recompró</span>`;
  if (seg === "inactivo") return `<span class="badge-segmento inactivo">Inactivo</span>`;
  return `<span class="badge-segmento unico">Compra única</span>`;
}

function listaProductos(productos) {
  if (!productos.length) return "—";
  const nombres = productos.map((p) => `${p.cantidad > 1 ? p.cantidad + "x " : ""}${escapeHtml(p.nombre)}`);
  if (nombres.length <= 2) return nombres.join(", ");
  return `${nombres.slice(0, 2).join(", ")} <span class="ver-mas">+${nombres.length - 2} más</span>`;
}

function filaCliente(c) {
  const tr = document.createElement("tr");
  tr.className = "fila-cliente";

  const wa = c.whatsapp
    ? `<a class="wa-btn" href="${c.whatsapp}" target="_blank" rel="noopener" onclick="event.stopPropagation()">💬 WhatsApp</a>`
    : `<span class="sin-telefono">Sin teléfono</span>`;

  const key = claveCliente(c);
  const cuponPrevio = cuponesGenerados.get(key);

  tr.innerHTML = `
    <td>
      <span class="cliente-nombre">${escapeHtml(c.nombre)}</span>
      <span class="cliente-email">${escapeHtml(c.email || "")}</span>
    </td>
    <td>${wa}</td>
    <td>${c.compras}</td>
    <td>
      ${formatFechaHora(c.ultimaCompra)}
      ${c.diasSinComprar != null ? `<span class="dias-sin-comprar">hace ${c.diasSinComprar} días</span>` : ""}
    </td>
    <td>${money(c.totalGastado)}</td>
    <td><div class="productos-lista">${listaProductos(c.productos)}</div></td>
    <td>${badgeSegmento(c.segmentoUi)}</td>
    <td class="cupon-celda"></td>
  `;

  const cuponCelda = tr.querySelector(".cupon-celda");
  renderCuponCelda(cuponCelda, c, cuponPrevio);

  tr.addEventListener("click", () => toggleDetalle(tr, c));

  return tr;
}

function renderCuponCelda(celda, c, cuponPrevio) {
  if (cuponPrevio) {
    celda.innerHTML = `
      <div class="cupon-generado">
        <span class="cupon-codigo">${escapeHtml(cuponPrevio.code)}</span>
        ${c.whatsapp
          ? `<a class="wa-btn" href="${waLinkConCupon(c, cuponPrevio)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Enviar código</a>`
          : ""}
      </div>
    `;
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cupon-btn";
  btn.textContent = "Generar cupón";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    btn.textContent = "Generando...";
    try {
      const porcentaje = document.getElementById("porcentaje-cupon").value;
      const cupon = await api("/api/clientes-recompra/cupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ porcentaje, nota: c.nombre }),
      });
      cuponesGenerados.set(claveCliente(c), cupon);
      renderCuponCelda(celda, c, cupon);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Generar cupón";
      alert("No se pudo generar el cupón: " + err.message);
    }
  });
  celda.appendChild(btn);
}

function waLinkConCupon(c, cupon) {
  const mensaje = `CUPON ${cupon.porcentaje}% OFF EN TODA LA WEB

Buenas! Por acá Tomi, del equipo!

Vi que hace tiempo no pasas por la web!

Te queríamos dejar un ${cupon.porcentaje}% de descuento para que aproveches las promos que tenemos disponibles!

Te mandamos un fuerte abrazo desde el equipo!

CUPON : ${cupon.code}

platensefit.com`;
  const numero = c.whatsapp.match(/wa\.me\/(\d+)/)?.[1];
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

function toggleDetalle(tr, c) {
  const siguiente = tr.nextElementSibling;
  if (siguiente && siguiente.classList.contains("fila-detalle")) {
    siguiente.remove();
    return;
  }
  document.querySelectorAll(".fila-detalle").forEach((f) => f.remove());

  const detalle = document.createElement("tr");
  detalle.className = "fila-detalle";
  const pedidosHtml = c.pedidos.map((p) => `
    <div class="detalle-pedido">
      <span>#${p.numero} — ${formatFechaHora(p.fecha)} — ${money(p.total)}</span>
      <span class="detalle-pedido-productos">${escapeHtml(p.productos.map((it) => `${it.cantidad}x ${it.nombre}`).join(", "))}</span>
    </div>
  `).join("");
  detalle.innerHTML = `<td colspan="8">
    <strong>Historial de pedidos de ${escapeHtml(c.nombre)}</strong>
    ${pedidosHtml || "<p class=\"hint\">Sin pedidos.</p>"}
  </td>`;
  tr.after(detalle);
}

checkAuth();
