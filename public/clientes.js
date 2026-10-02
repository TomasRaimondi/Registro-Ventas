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

const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function mesKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function mesLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MESES_CORTO[m - 1]} ${String(y).slice(2)}`;
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
    renderPanorama();
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

// ---------- Panorama: métricas agregadas para marketing (no dependen del filtro) ----------

function calcularPanorama(lista) {
  const hoyKey = mesKey(new Date().toISOString());

  // Cada pedido de cada cliente, marcado como "primera compra de ese cliente" o
  // "recompra", para poder separar clientes nuevos de recompras mes a mes.
  const pedidosConTipo = [];
  lista.forEach((c) => {
    const ordenados = [...(c.pedidos || [])].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
    ordenados.forEach((p, idx) => {
      if (!p.fecha) return;
      pedidosConTipo.push({ fecha: p.fecha, esPrimera: idx === 0, productos: p.productos || [] });
    });
  });

  const porMes = new Map();
  pedidosConTipo.forEach((p) => {
    const key = mesKey(p.fecha);
    if (!key) return;
    if (!porMes.has(key)) porMes.set(key, { nuevos: 0, recompras: 0 });
    const bucket = porMes.get(key);
    if (p.esPrimera) bucket.nuevos++; else bucket.recompras++;
  });
  const ultimosMeses = [...porMes.keys()].sort().slice(-6).map((key) => ({ key, label: mesLabel(key), ...porMes.get(key) }));

  // Producto que más aparece en una RECOMPRA (no en la primera compra de nadie): qué
  // empujar en el mensaje cuando se le escribe a alguien que ya compró antes.
  const conteoProductoRecompra = new Map();
  pedidosConTipo.forEach((p) => {
    if (p.esPrimera) return;
    p.productos.forEach((it) => {
      conteoProductoRecompra.set(it.nombre, (conteoProductoRecompra.get(it.nombre) || 0) + (it.cantidad || 1));
    });
  });
  const topProductosRecompra = [...conteoProductoRecompra.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, veces]) => ({ nombre, veces }));

  const topClientes = [...lista].sort((a, b) => b.totalGastado - a.totalGastado).slice(0, 5);

  const comprasTotales = lista.reduce((acc, c) => acc + c.compras, 0);
  const ticketPromedioGlobal = comprasTotales ? lista.reduce((acc, c) => acc + c.totalGastado, 0) / comprasTotales : 0;

  const nuevosEsteMes = pedidosConTipo.filter((p) => p.esPrimera && mesKey(p.fecha) === hoyKey).length;
  const recomprasEsteMes = pedidosConTipo.filter((p) => !p.esPrimera && mesKey(p.fecha) === hoyKey).length;

  return { ultimosMeses, topProductosRecompra, topClientes, ticketPromedioGlobal, nuevosEsteMes, recomprasEsteMes };
}

function renderGraficoEvolucion(meses) {
  const cont = document.getElementById("evolucion-chart");
  if (!meses.length) {
    cont.innerHTML = `<p class="hint">Todavía no hay suficiente historial para ver una evolución mensual.</p>`;
    return;
  }
  const max = Math.max(1, ...meses.map((m) => Math.max(m.nuevos, m.recompras)));
  const anchoGrupo = 92;
  const ancho = meses.length * anchoGrupo;
  const altoBarras = 118;
  const baseY = 138;

  const barras = meses.map((m, i) => {
    const x0 = i * anchoGrupo + 16;
    const hN = Math.round((m.nuevos / max) * altoBarras);
    const hR = Math.round((m.recompras / max) * altoBarras);
    return `
      <g>
        <rect x="${x0}" y="${baseY - hN}" width="26" height="${Math.max(hN, 1)}" rx="3" fill="var(--blue)"></rect>
        <text x="${x0 + 13}" y="${baseY - hN - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text-dim)">${m.nuevos}</text>
        <rect x="${x0 + 30}" y="${baseY - hR}" width="26" height="${Math.max(hR, 1)}" rx="3" fill="var(--green)"></rect>
        <text x="${x0 + 43}" y="${baseY - hR - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text-dim)">${m.recompras}</text>
        <text x="${x0 + 28}" y="${baseY + 20}" text-anchor="middle" font-size="12" fill="var(--text-dim)">${escapeHtml(m.label)}</text>
      </g>
    `;
  }).join("");

  cont.innerHTML = `
    <svg viewBox="0 0 ${ancho} 168" width="100%" style="max-width:${ancho}px; display:block;" role="img" aria-label="Clientes nuevos y recompras por mes">
      <line x1="0" y1="${baseY}" x2="${ancho}" y2="${baseY}" stroke="var(--card-border)" stroke-width="1"></line>
      ${barras}
    </svg>
  `;
}

function renderPanorama() {
  if (!clientes.length) return;
  const p = calcularPanorama(clientes);

  document.getElementById("stat-ticket-promedio").textContent = money(p.ticketPromedioGlobal);
  document.getElementById("stat-nuevos-mes").textContent = p.nuevosEsteMes;
  document.getElementById("stat-nuevos-mes-sub").textContent = `${p.recomprasEsteMes} recompra${p.recomprasEsteMes === 1 ? "" : "s"} este mes`;

  renderGraficoEvolucion(p.ultimosMeses);

  document.getElementById("top-productos-recompra").innerHTML = p.topProductosRecompra.length
    ? p.topProductosRecompra.map((pr, i) => `
        <div class="ranking-fila">
          <span class="ranking-pos">${i + 1}</span>
          <span class="ranking-nombre">${escapeHtml(pr.nombre)}</span>
          <span class="ranking-valor">${pr.veces}x</span>
        </div>
      `).join("")
    : `<p class="hint">Todavía no hay recompras registradas.</p>`;

  document.getElementById("top-clientes").innerHTML = p.topClientes.length
    ? p.topClientes.map((c, i) => `
        <div class="ranking-fila">
          <span class="ranking-pos">${i + 1}</span>
          <span class="ranking-nombre">${escapeHtml(c.nombre)}${c.compras >= 3 ? ` <span class="fan-badge" title="Cliente fan: 3 o más compras">⭐</span>` : ""}</span>
          <span class="ranking-valor">${money(c.totalGastado)}</span>
        </div>
      `).join("")
    : `<p class="hint">Todavía no hay clientes.</p>`;
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
document.getElementById("filtro-ciudad").addEventListener("input", () => render());

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
  const totalAlertaProteina = conSegmento.filter((c) => (c.alertasRecompra || []).some((a) => a.activa)).length;

  document.getElementById("stat-total").textContent = conSegmento.length;
  document.getElementById("stat-recompro").textContent = totalRecompro;
  document.getElementById("stat-recompro-pct").textContent = conSegmento.length
    ? `${((totalRecompro / conSegmento.length) * 100).toFixed(1)}% del total`
    : "";
  document.getElementById("stat-unico").textContent = totalUnico;
  document.getElementById("stat-inactivo").textContent = totalInactivo;
  document.getElementById("stat-alerta-proteina").textContent = totalAlertaProteina;

  const textoCiudad = document.getElementById("filtro-ciudad").value.trim().toLowerCase();

  let filtrados = conSegmento.filter((c) => {
    if (segmentoActivo === "alerta_proteina") {
      if (!(c.alertasRecompra || []).some((a) => a.activa)) return false;
    } else if (segmentoActivo !== "todos" && c.segmentoUi !== segmentoActivo) {
      return false;
    }
    if (textoCiudad) {
      const tieneCiudad = (c.ciudades || []).some((ciudad) => ciudad.toLowerCase().includes(textoCiudad));
      if (!tieneCiudad) return false;
    }
    if (!texto) return true;
    const haystack = `${c.nombre || ""} ${c.email || ""} ${c.telefono || ""}`.toLowerCase();
    return haystack.includes(texto);
  });

  if (segmentoActivo === "alerta_proteina") {
    const maxDiasActivo = (c) => Math.max(0, ...((c.alertasRecompra || []).filter((a) => a.activa).map((a) => a.dias)));
    filtrados.sort((a, b) => maxDiasActivo(b) - maxDiasActivo(a));
  } else if (segmentoActivo === "inactivo") {
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

function badgeAlertaProteina(c) {
  return (c.alertasRecompra || [])
    .filter((a) => a.activa)
    .map((a) => `<span class="badge-segmento alerta" title="Última compra de ${escapeHtml(a.etiqueta)}: ${formatFechaHora(a.ultimaCompra)} · umbral ${a.diasUmbral} días">⚠️ ${escapeHtml(a.etiqueta)} hace ${a.dias}d</span>`)
    .join(" ");
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
      <span class="cliente-nombre">${escapeHtml(c.nombre)}${c.compras >= 3 ? ` <span class="fan-badge" title="Cliente fan: 3 o más compras">⭐</span>` : ""}</span>
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
    <td>${badgeSegmento(c.segmentoUi)} ${badgeAlertaProteina(c)}</td>
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
      const productId = ultimoProductoComprado(c)?.productId || null;
      const cupon = await api("/api/clientes-recompra/cupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ porcentaje, nota: c.nombre, productId }),
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

// El producto de la compra más reciente (c.pedidos ya viene ordenado del más nuevo
// al más viejo, y cada pedido trae sus productos en el orden que llegó de Tiendanube).
function ultimoProductoComprado(c) {
  const ultimoPedido = c.pedidos && c.pedidos[0];
  return (ultimoPedido && ultimoPedido.productos && ultimoPedido.productos[0]) || null;
}

function waLinkConCupon(c, cupon) {
  const ultimoProducto = ultimoProductoComprado(c);
  const producto = cupon.producto || null; // { nombre, url, precio } — resuelto en el servidor, puede no venir

  let bloqueProducto = "";
  if (ultimoProducto) {
    bloqueProducto += `\nVimos que tu última compra fue *${ultimoProducto.nombre}*\n`;
  }
  if (producto && producto.precio) {
    // producto.precio es el precio de lista (el "negro"). La web ya le aplica un % de
    // descuento propio por pagar con transferencia (el "verde") antes de que se sume el
    // cupón — ese % se carga a mano arriba porque no viene en la API de Tiendanube.
    const descuentoTransferencia = Number(document.getElementById("descuento-transferencia").value) || 0;
    const precioTransferencia = producto.precio * (1 - descuentoTransferencia / 100);
    const precioConCupon = Math.round(precioTransferencia * (1 - Number(cupon.porcentaje) / 100));
    bloqueProducto += `\n*Precio en transferencia : ${money(precioTransferencia)}*`;
    bloqueProducto += `\nCon el cupón, pagando por transferencia: *${money(precioConCupon)}*\n`;
  }
  if (producto && producto.url) {
    bloqueProducto += `\n${producto.url}\n`;
  }

  const mensaje = `¡Buenas buenas! Por acá Tomi, de Platense Fit

¡Hace rato no te vemos por la web!

Te queremos dejar un CUPÓN ${cupon.porcentaje}% OFF en tu próxima compra
${bloqueProducto}
Te mandamos un fuerte abrazo desde el equipo

CUPÓN: ${cupon.code}

platensefit.com`;

  const numero = c.whatsapp.match(/wa\.me\/(\d+)/)?.[1];
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

// Promedio de días entre una compra y la siguiente (solo tiene sentido con 2+ pedidos):
// da una idea de cada cuánto conviene volver a escribirle a este cliente puntual.
function cadenciaDias(c) {
  const fechas = (c.pedidos || [])
    .map((p) => p.fecha)
    .filter(Boolean)
    .sort();
  if (fechas.length < 2) return null;
  let totalDias = 0;
  for (let i = 1; i < fechas.length; i++) {
    totalDias += (new Date(fechas[i]) - new Date(fechas[i - 1])) / 86400000;
  }
  return Math.round(totalDias / (fechas.length - 1));
}

function toggleDetalle(tr, c) {
  const siguiente = tr.nextElementSibling;
  if (siguiente && siguiente.classList.contains("fila-detalle")) {
    siguiente.remove();
    return;
  }
  document.querySelectorAll(".fila-detalle").forEach((f) => f.remove());

  const ticketPromedio = c.compras ? c.totalGastado / c.compras : 0;
  const cadencia = cadenciaDias(c);

  const detalle = document.createElement("tr");
  detalle.className = "fila-detalle";
  const pedidosHtml = c.pedidos.map((p) => `
    <div class="detalle-pedido">
      <span>#${p.numero} — ${formatFechaHora(p.fecha)} — ${money(p.total)}${p.ciudad ? ` — <span class="hint">${escapeHtml(p.ciudad)}</span>` : ""}</span>
      <span class="detalle-pedido-productos">${escapeHtml(p.productos.map((it) => `${it.cantidad}x ${it.nombre}`).join(", "))}</span>
    </div>
  `).join("");
  detalle.innerHTML = `<td colspan="8">
    <strong>Historial de ${escapeHtml(c.nombre)}</strong>
    <div class="detalle-mini-stats">
      <div class="mini-stat"><span class="mini-stat-label">Ticket promedio</span><span class="mini-stat-valor">${money(ticketPromedio)}</span></div>
      <div class="mini-stat"><span class="mini-stat-label">Cadencia de compra</span><span class="mini-stat-valor">${cadencia != null ? `cada ${cadencia} días` : "—"}</span></div>
      <div class="mini-stat"><span class="mini-stat-label">Total histórico</span><span class="mini-stat-valor">${money(c.totalGastado)}</span></div>
    </div>
    ${pedidosHtml || "<p class=\"hint\">Sin pedidos.</p>"}
  </td>`;
  tr.after(detalle);
}

checkAuth();
