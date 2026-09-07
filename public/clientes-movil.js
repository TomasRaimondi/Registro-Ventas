function formatFechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------- Login ----------

const loginCard = document.getElementById("login-card");
const appContent = document.getElementById("app-content");
const logoutBtn = document.getElementById("logout-btn");

function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "flex";
  cargarClientes();
}

function showLogin() {
  loginCard.style.display = "flex";
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
let acordeonAbierto = null;
const cuponesGenerados = new Map();

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

document.getElementById("refrescar-btn").addEventListener("click", () => { buzz(10); cargarClientes(true); });

setInterval(() => { if (appContent.style.display !== "none") cargarClientes(false); }, 5 * 60 * 1000);

// ---------- Filtros ----------

document.getElementById("segmento-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll("#segmento-tabs .tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  segmentoActivo = btn.dataset.segmento;
  buzz(8);
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

function badgeSegmento(seg) {
  if (seg === "recompro") return `<span class="badge-seg recompro">Recompró</span>`;
  if (seg === "inactivo") return `<span class="badge-seg inactivo">Inactivo</span>`;
  return `<span class="badge-seg unico">Compra única</span>`;
}

function listaProductos(productos) {
  if (!productos.length) return "—";
  const nombres = productos.map((p) => `${p.cantidad > 1 ? p.cantidad + "x " : ""}${escapeHtml(p.nombre)}`);
  if (nombres.length <= 2) return nombres.join(", ");
  return `${nombres.slice(0, 2).join(", ")} +${nombres.length - 2} más`;
}

function render() {
  const umbral = umbralInactivo();
  const texto = document.getElementById("buscador").value.trim().toLowerCase();

  const conSegmento = clientes.map((c) => ({ ...c, segmentoUi: segmentoDeCliente(c, umbral) }));

  const totalRecompro = conSegmento.filter((c) => c.segmento === "recompro").length;
  const totalUnico = conSegmento.filter((c) => c.segmentoUi === "unico").length;
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

  const list = document.getElementById("clientes-list");
  list.innerHTML = "";

  if (!filtrados.length) {
    list.innerHTML = `<p class="empty">No hay clientes que coincidan con el filtro.</p>`;
  } else {
    filtrados.forEach((c) => list.appendChild(filaCliente(c)));
  }

  const syncLabel = document.getElementById("sync-label");
  if (sincronizadoEn) {
    const min = Math.max(0, Math.round((Date.now() - sincronizadoEn) / 60000));
    syncLabel.textContent = min === 0 ? "Sincronizado hace instantes." : `Sincronizado hace ${min} min.`;
  }
}

function filaCliente(c) {
  const key = claveCliente(c);
  const wrap = document.createElement("div");

  const row = document.createElement("button");
  row.type = "button";
  row.className = "acc-row";
  row.innerHTML = `
    <span class="acc-caret">▸</span>
    <span class="acc-info">
      <span class="acc-titulo">${escapeHtml(c.nombre)}</span>
      <span class="acc-sub">${c.compras} compra${c.compras === 1 ? "" : "s"} · ${money(c.totalGastado)}${c.diasSinComprar != null ? ` · hace ${c.diasSinComprar} días` : ""}</span>
    </span>
    <span class="acc-valor">${badgeSegmento(c.segmentoUi)}</span>
  `;

  const detail = document.createElement("div");
  detail.className = "acc-detail";
  detail.style.display = "none";

  row.onclick = () => {
    const abierto = row.classList.contains("open");
    document.querySelectorAll("#clientes-list .acc-row.open").forEach((r) => {
      r.classList.remove("open");
      r.nextElementSibling.style.display = "none";
    });
    if (!abierto) {
      row.classList.add("open");
      renderDetalleCliente(detail, c);
      detail.style.display = "flex";
      acordeonAbierto = key;
    } else {
      acordeonAbierto = null;
    }
    buzz(6);
  };

  wrap.appendChild(row);
  wrap.appendChild(detail);

  if (acordeonAbierto === key) {
    row.classList.add("open");
    renderDetalleCliente(detail, c);
    detail.style.display = "flex";
  }

  return wrap;
}

function renderDetalleCliente(detail, c) {
  const key = claveCliente(c);
  const cuponPrevio = cuponesGenerados.get(key);

  const pedidosHtml = (c.pedidos || []).map((p) => `
    <div class="detalle-pedido">
      <b>#${p.numero} · ${formatFechaHora(p.fecha)} · ${money(p.total)}</b>
      <span>${escapeHtml(p.productos.map((it) => `${it.cantidad}x ${it.nombre}`).join(", "))}</span>
    </div>
  `).join("") || `<p class="hint" style="margin:0;">Sin pedidos.</p>`;

  detail.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${c.email ? `<span class="acc-sub">${escapeHtml(c.email)}</span>` : ""}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${c.whatsapp ? `<a class="wa-btn" href="${c.whatsapp}" target="_blank" rel="noopener">💬 WhatsApp</a>` : `<span class="hint" style="margin:0;">Sin teléfono</span>`}
      <span id="cupon-slot-${key.replace(/[^a-zA-Z0-9-]/g, "")}"></span>
    </div>
    <div>
      <span class="acc-sub">Productos: ${listaProductos(c.productos)}</span>
    </div>
    <div>
      <strong class="acc-sub" style="color:var(--text);">Historial de pedidos</strong>
      ${pedidosHtml}
    </div>
  `;

  const slot = detail.querySelector(`#cupon-slot-${key.replace(/[^a-zA-Z0-9-]/g, "")}`);
  if (cuponPrevio) {
    slot.innerHTML = `<span class="cupon-codigo">${escapeHtml(cuponPrevio.code)}</span>`;
    if (c.whatsapp) {
      const link = document.createElement("a");
      link.className = "wa-btn";
      link.target = "_blank";
      link.rel = "noopener";
      link.href = waLinkConCupon(c, cuponPrevio);
      link.textContent = "Enviar código";
      link.style.marginLeft = "6px";
      slot.appendChild(link);
    }
  } else {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cupon-btn";
    btn.textContent = "Generar cupón";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Generando...";
      try {
        const porcentaje = document.getElementById("porcentaje-cupon").value;
        const cupon = await api("/api/clientes-recompra/cupon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ porcentaje, nota: c.nombre }),
        });
        cuponesGenerados.set(key, cupon);
        buzz(14);
        renderDetalleCliente(detail, c);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Generar cupón";
        toast("No se pudo generar el cupón: " + err.message, false);
      }
    };
    slot.appendChild(btn);
  }
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

checkAuth();
