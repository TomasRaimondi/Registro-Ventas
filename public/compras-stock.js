function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatFechaCorta(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
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

async function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "inline-block";
  // Se pide la fecha de hoy al servidor (hora argentina) en vez de usar el reloj/huso
  // horario del navegador: de noche, toISOString() del cliente da UTC y ya cae en el
  // día siguiente, lo que hacía que las compras cargadas a la noche quedaran fechadas
  // "mañana" y no contaran en Situación Financiera hasta el día siguiente.
  try {
    const hora = await api("/api/hora");
    hoyFecha = hora.fecha;
  } catch (e) {
    hoyFecha = hoyISO();
  }
  document.getElementById("fecha").value = hoyFecha;
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

// ---------- Estado global ----------

let hoyFecha = null; // fecha de hoy segun el servidor (hora argentina), ver showApp()
let costosGlobal = [];
let comprasGlobal = [];
let composicionGlobal = [];
let tipoActual = "compra";
let carrito = []; // productos ya agregados a la compra/ajuste que se está armando

// ---------- Carga de datos ----------

async function renderAll() {
  try {
    [costosGlobal, comprasGlobal, composicionGlobal] = await Promise.all([
      api("/api/costos"),
      api("/api/compras"),
      api("/api/composicion"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  renderStats();
  renderFiltroProducto();
  renderHistorial();
  actualizarPreview();
}

// ---------- Tarjetas de estadísticas ----------

function renderStats() {
  // Los combos no tienen stock propio (se arma a partir de sus componentes), por eso
  // se excluyen acá igual que en Situación Financiera.
  const combosSet = new Set(composicionGlobal.map(c => c.comboProducto));
  const costosSinCombos = costosGlobal.filter(c => !combosSet.has(c.producto));

  const valorInventario = costosSinCombos.reduce((acc, c) => acc + (c.stock || 0) * (c.costo || 0), 0);
  const productosConStock = costosSinCombos.filter(c => (c.stock || 0) > 0).length;

  const mesActual = (hoyFecha || hoyISO()).slice(0, 7);
  const invertidoMes = comprasGlobal
    .filter(c => c.tipo === "compra" && c.fecha.slice(0, 7) === mesActual)
    .reduce((acc, c) => acc + (c.costoTotal || 0), 0);

  document.getElementById("stat-valor-inventario").textContent = money(valorInventario);
  document.getElementById("stat-invertido-mes").textContent = money(invertidoMes);
  document.getElementById("stat-productos-stock").textContent = productosConStock;
}

// ---------- Pestañas Compra / Ajuste ----------

document.querySelectorAll(".tipo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tipo-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    tipoActual = btn.dataset.tipo;

    // Mezclar productos de compra y de ajuste en una misma tanda no tiene sentido: se reinicia.
    carrito = [];
    renderCart();

    const esCompra = tipoActual === "compra";
    document.getElementById("hint-compra").style.display = esCompra ? "block" : "none";
    document.getElementById("hint-ajuste").style.display = esCompra ? "none" : "block";
    document.getElementById("campo-proveedor").style.display = esCompra ? "block" : "none";
    document.getElementById("campo-vencimiento").style.display = esCompra ? "block" : "none";
    document.getElementById("campo-motivo").style.display = esCompra ? "none" : "block";
    document.getElementById("label-cantidad").textContent = esCompra ? "Cantidad comprada" : "Cantidad (+ para sumar, - para restar)";
    document.getElementById("cantidad").min = esCompra ? "1" : "";
    document.getElementById("campo-precio-unitario").style.display = esCompra ? "block" : "none";
    document.getElementById("add-item-btn").textContent = esCompra ? "+ Agregar producto a esta compra" : "+ Agregar producto a este ajuste";
    document.getElementById("submit-btn").textContent = esCompra ? "Registrar compra" : "Registrar ajuste";

    actualizarPreview();
  });
});

// ---------- Autocompletado de producto ----------

const productoInput = document.getElementById("producto");
const productoSuggestions = document.getElementById("producto-suggestions");

function buscarSugerencias() {
  const q = productoInput.value.trim().toLowerCase();
  if (!q) { renderSuggestions([]); return; }
  const nombres = costosGlobal.map(c => c.producto);
  const matches = nombres.filter(p => p.toLowerCase().includes(q)).slice(0, 6);
  renderSuggestions(matches);
}

function renderSuggestions(matches) {
  if (!matches.length) {
    productoSuggestions.innerHTML = "";
    productoSuggestions.classList.remove("open");
    return;
  }
  productoSuggestions.innerHTML = matches.map(p => `<div class="suggestion-item">${escapeHtml(p)}</div>`).join("");
  productoSuggestions.classList.add("open");
}

productoInput.addEventListener("input", () => { buscarSugerencias(); actualizarPreview(); });
productoInput.addEventListener("focus", buscarSugerencias);
productoInput.addEventListener("blur", () => setTimeout(() => renderSuggestions([]), 150));
productoSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  productoInput.value = item.textContent;
  renderSuggestions([]);
  actualizarPreview();
});

// ---------- Vista previa en vivo (del producto que se está por agregar) ----------

["cantidad", "precio-unitario"].forEach(id => {
  document.getElementById(id).addEventListener("input", actualizarPreview);
});

function obtenerCostoRow(producto) {
  return costosGlobal.find(c => c.producto === producto);
}

function calcularNuevoPromedio(producto, cantidadNueva, precioNuevo) {
  const historial = comprasGlobal.filter(c => c.producto === producto && c.tipo === "compra");
  let totalUnidades = cantidadNueva;
  let totalCosto = cantidadNueva * precioNuevo;
  historial.forEach(h => {
    totalUnidades += h.cantidad;
    totalCosto += h.cantidad * h.precioUnitario;
  });
  // Si ya agregaste este mismo producto antes en esta misma compra, también cuenta.
  carrito.forEach(it => {
    if (it.producto === producto && it.precioUnitario != null) {
      totalUnidades += it.cantidad;
      totalCosto += it.cantidad * it.precioUnitario;
    }
  });
  return totalUnidades > 0 ? totalCosto / totalUnidades : precioNuevo;
}

function actualizarPreview() {
  const producto = productoInput.value.trim();
  const sinProducto = document.getElementById("preview-sin-producto");
  const conProducto = document.getElementById("preview-con-producto");

  if (!producto) {
    sinProducto.style.display = "block";
    conProducto.style.display = "none";
    return;
  }

  sinProducto.style.display = "none";
  conProducto.style.display = "block";

  const costoRow = obtenerCostoRow(producto);
  const stockBase = costoRow ? (costoRow.stock || 0) : 0;
  const costoAntes = costoRow ? (costoRow.costo || 0) : 0;
  // Si este producto ya está en el carrito de esta compra, el "antes" ya incluye eso.
  const stockYaEnCarrito = carrito.filter(it => it.producto === producto).reduce((a, it) => a + it.cantidad, 0);
  const stockAntes = Math.max(0, stockBase + stockYaEnCarrito);
  const cantidad = parseInt(document.getElementById("cantidad").value, 10) || 0;

  document.getElementById("preview-stock-antes").textContent = stockAntes;
  document.getElementById("preview-costo-antes").textContent = money(costoAntes);

  if (tipoActual === "compra") {
    const precio = parseFloat(document.getElementById("precio-unitario").value) || 0;
    const stockDespues = stockAntes + Math.max(cantidad, 0);
    const costoDespues = cantidad > 0 && precio > 0 ? calcularNuevoPromedio(producto, cantidad, precio) : costoAntes;

    document.getElementById("preview-stock-despues").textContent = stockDespues;
    document.getElementById("preview-costo-despues").textContent = money(costoDespues);
    document.getElementById("preview-total-row").style.display = "flex";
    document.getElementById("preview-total").textContent = money(cantidad * precio);
  } else {
    const stockDespues = Math.max(0, stockAntes + cantidad);
    document.getElementById("preview-stock-despues").textContent = stockDespues;
    document.getElementById("preview-costo-despues").textContent = money(costoAntes);
    document.getElementById("preview-total-row").style.display = "none";
  }
}

// ---------- Carrito de productos (una compra puede traer varios) ----------

function renderCart() {
  const cartList = document.getElementById("cart-list");
  cartList.innerHTML = "";

  carrito.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "cart-item";
    const detalle = tipoActual === "compra"
      ? `${item.cantidad} × ${money(item.precioUnitario)} = ${money(item.cantidad * item.precioUnitario)}`
      : `${item.cantidad > 0 ? "+" : ""}${item.cantidad} unidades`;
    div.innerHTML = `
      <div class="cart-item-info">
        <span class="cart-item-nombre">${escapeHtml(item.producto)}</span>
        <span class="cart-item-precio">${detalle}</span>
      </div>
      <button type="button" class="cart-item-remove" title="Quitar">✕</button>
    `;
    div.querySelector(".cart-item-remove").addEventListener("click", () => {
      carrito.splice(idx, 1);
      renderCart();
      actualizarPreview();
    });
    cartList.appendChild(div);
  });

  const cartSummary = document.getElementById("cart-summary");
  const cartSummaryTotal = document.getElementById("cart-summary-total");
  if (carrito.length > 0 && tipoActual === "compra") {
    const totalInvertido = carrito.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0);
    cartSummary.style.display = "flex";
    cartSummaryTotal.textContent = money(totalInvertido);
  } else {
    cartSummary.style.display = "none";
  }
}

function agregarItemDesdeInputs() {
  const producto = productoInput.value.trim();
  const cantidadInput = parseInt(document.getElementById("cantidad").value, 10);

  if (!producto || !Number.isFinite(cantidadInput) || cantidadInput === 0) return false;

  if (tipoActual === "compra") {
    const precioUnitario = parseFloat(document.getElementById("precio-unitario").value);
    if (cantidadInput <= 0 || !Number.isFinite(precioUnitario) || precioUnitario <= 0) return false;
    carrito.push({ producto, cantidad: cantidadInput, precioUnitario });
  } else {
    carrito.push({ producto, cantidad: cantidadInput });
  }

  productoInput.value = "";
  document.getElementById("cantidad").value = "";
  document.getElementById("precio-unitario").value = "";
  renderSuggestions([]);
  renderCart();
  actualizarPreview();
  return true;
}

document.getElementById("add-item-btn").addEventListener("click", () => {
  const agregado = agregarItemDesdeInputs();
  if (!agregado) {
    alert(tipoActual === "compra"
      ? "Completá el producto, la cantidad y el precio antes de agregarlo."
      : "Completá el producto y la cantidad antes de agregarlo.");
    return;
  }
  productoInput.focus();
});

// ---------- Reautenticación sin perder lo que ya se cargó ----------
// Si la sesión se vence a mitad de armar una compra grande, no queremos que se
// pierda el carrito: se pide la contraseña de nuevo arriba de todo y se reintenta
// el mismo guardado apenas el login vuelve a funcionar.

const reauthModal = document.getElementById("reauth-modal");
const reauthForm = document.getElementById("reauth-form");
const reauthError = document.getElementById("reauth-error");
let reintentoPendiente = null;

function pedirReautenticacion(reintentar) {
  reintentoPendiente = reintentar;
  reauthError.style.display = "none";
  document.getElementById("reauth-password").value = "";
  reauthModal.style.display = "flex";
  document.getElementById("reauth-password").focus();
}

reauthForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("reauth-password").value;
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    reauthModal.style.display = "none";
    const fn = reintentoPendiente;
    reintentoPendiente = null;
    if (fn) await fn();
  } catch (err) {
    reauthError.textContent = err.message || "Contraseña incorrecta.";
    reauthError.style.display = "block";
  }
});

// ---------- Alta de la compra/ajuste completo ----------

const form = document.getElementById("compra-form");
const submitBtn = document.getElementById("submit-btn");

async function guardarCompra(bodyPayload) {
  submitBtn.disabled = true;
  submitBtn.textContent = "Guardando...";

  try {
    await api("/api/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    carrito = [];
    renderCart();
    document.getElementById("proveedor").value = "";
    document.getElementById("vencimiento").value = "";
    document.getElementById("nota").value = "";
    // La fecha se deja como está: es común cargar varias compras seguidas del mismo día.

    await renderAll();
  } catch (err) {
    if (err.status === 401) {
      pedirReautenticacion(() => guardarCompra(bodyPayload));
      return;
    }
    alert("No se pudo registrar la compra.\n" + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = tipoActual === "compra" ? "Registrar compra" : "Registrar ajuste";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Si quedó cargado un producto en los campos sin apretar "+ Agregar", se suma solo.
  agregarItemDesdeInputs();

  if (carrito.length === 0) {
    alert("Agregá al menos un producto.");
    return;
  }

  const fecha = document.getElementById("fecha").value;
  if (!fecha) {
    alert("Elegí la fecha.");
    return;
  }

  const bodyPayload = { tipo: tipoActual, items: carrito, fecha };
  if (tipoActual === "compra") {
    bodyPayload.proveedor = document.getElementById("proveedor").value.trim();
    bodyPayload.vencimiento = document.getElementById("vencimiento").value || null;
  } else {
    bodyPayload.nota = document.getElementById("nota").value.trim();
  }

  await guardarCompra(bodyPayload);
});

// ---------- Historial, agrupado por compra ----------

function renderFiltroProducto() {
  const select = document.getElementById("filtro-producto");
  const valorPrevio = select.value;
  const productos = [...new Set(comprasGlobal.map(c => c.producto))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">Todos los productos</option>` +
    productos.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  select.value = productos.includes(valorPrevio) ? valorPrevio : "";
}

document.getElementById("filtro-producto").addEventListener("change", renderHistorial);

async function deleteCompra(id) {
  if (!confirm("¿Borrar este movimiento? Esto revierte el stock y recalcula el costo promedio.")) return;
  try {
    await api("/api/compras/" + encodeURIComponent(id), { method: "DELETE" });
    await renderAll();
  } catch (err) {
    alert("No se pudo borrar.\n" + err.message);
  }
}

async function deleteLote(loteId) {
  const cantidad = comprasGlobal.filter(c => c.loteId === loteId).length;
  if (!confirm(`¿Borrar toda esta compra (${cantidad} producto${cantidad === 1 ? "" : "s"})? Esto revierte el stock de cada uno y recalcula el costo promedio.`)) return;
  try {
    await api("/api/compras/lote/" + encodeURIComponent(loteId), { method: "DELETE" });
    await renderAll();
  } catch (err) {
    alert("No se pudo borrar la compra.\n" + err.message);
  }
}

function diasHasta(fecha) {
  const a = new Date((hoyFecha || hoyISO()) + "T00:00:00Z");
  const b = new Date(fecha + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function vencimientoBadge(c) {
  if (!c.vencimiento) return "";
  const dias = diasHasta(c.vencimiento);
  if (dias > 30) return "";
  return `<span class="badge-vencimiento">${dias < 0 ? "Vencido" : "Vence pronto"}</span>`;
}

// Agrupa por loteId: las filas viejas (de antes de esta función) no tienen loteId, así que
// cada una queda como grupo de un solo producto, igual que se veían antes.
function agruparPorLote(compras) {
  const grupos = new Map();
  compras.forEach(c => {
    const key = c.loteId || c.id;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(c);
  });
  return [...grupos.values()];
}

function renderFilaSimple(c) {
  return `
    <tr>
      <td>${formatFechaCorta(c.fecha)}</td>
      <td><span class="badge-tipo ${c.tipo}">${c.tipo === "compra" ? "Compra" : "Ajuste"}</span></td>
      <td>${escapeHtml(c.producto)}</td>
      <td>${c.cantidad > 0 ? "+" : ""}${c.cantidad}</td>
      <td>${c.precioUnitario !== null ? money(c.precioUnitario) : "—"}</td>
      <td>${c.costoTotal !== null ? money(c.costoTotal) : "—"}</td>
      <td>${c.proveedor ? escapeHtml(c.proveedor) : "—"}</td>
      <td>${c.vencimiento ? formatFechaCorta(c.vencimiento) + vencimientoBadge(c) : "—"}</td>
      <td>${c.stockAntes} → ${c.stockDespues}</td>
      <td><button class="del-btn" title="Borrar" data-id="${c.id}">✕</button></td>
    </tr>
  `;
}

function renderFilaGrupo(grupo) {
  if (grupo.length === 1) return renderFilaSimple(grupo[0]);

  const primero = grupo[0];
  const totalCosto = grupo.reduce((acc, c) => acc + (c.costoTotal || 0), 0);
  const totalUnidades = grupo.reduce((acc, c) => acc + c.cantidad, 0);

  return `
    <tr class="lote-row" data-lote="${primero.loteId}">
      <td>${formatFechaCorta(primero.fecha)}</td>
      <td><span class="badge-tipo ${primero.tipo}">${primero.tipo === "compra" ? "Compra" : "Ajuste"}</span></td>
      <td><span class="expand-caret">▸</span>${grupo.length} productos (${totalUnidades} un.)</td>
      <td>—</td>
      <td>—</td>
      <td>${primero.tipo === "compra" ? money(totalCosto) : "—"}</td>
      <td>${primero.proveedor ? escapeHtml(primero.proveedor) : "—"}</td>
      <td>${primero.vencimiento ? formatFechaCorta(primero.vencimiento) + vencimientoBadge(primero) : "—"}</td>
      <td>—</td>
      <td><button class="del-btn" title="Borrar toda la compra" data-lote="${primero.loteId}">✕</button></td>
    </tr>
  `;
}

function toggleLoteDetail(tr) {
  const loteId = tr.dataset.lote;
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains("lote-detail-row")) {
    existing.remove();
    tr.classList.remove("expanded");
    return;
  }

  document.querySelectorAll(".lote-detail-row").forEach(r => r.remove());
  document.querySelectorAll(".lote-row.expanded").forEach(r => r.classList.remove("expanded"));
  tr.classList.add("expanded");

  const filas = comprasGlobal.filter(c => c.loteId === loteId);
  const detailRow = document.createElement("tr");
  detailRow.className = "lote-detail-row";
  const td = document.createElement("td");
  td.colSpan = 10;
  td.innerHTML = filas.map(c => `
    <div class="lote-detail-item">
      <span>${escapeHtml(c.producto)}</span>
      <span>${c.cantidad > 0 ? "+" : ""}${c.cantidad}${c.precioUnitario !== null ? ` × ${money(c.precioUnitario)}` : ""}</span>
      <span>${c.costoTotal !== null ? money(c.costoTotal) : "—"}</span>
      <span>${c.stockAntes} → ${c.stockDespues}</span>
      <button class="del-btn" title="Borrar este producto" data-id="${c.id}">✕</button>
    </div>
  `).join("");
  detailRow.appendChild(td);
  tr.after(detailRow);

  td.querySelectorAll(".del-btn[data-id]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteCompra(btn.dataset.id); });
  });
}

function renderHistorial() {
  const filtro = document.getElementById("filtro-producto").value;
  const body = document.getElementById("historial-body");
  const comprasFiltradas = filtro ? comprasGlobal.filter(c => c.producto === filtro) : comprasGlobal;

  if (comprasFiltradas.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="10">Todavía no cargaste ningún movimiento.</td></tr>`;
    return;
  }

  const grupos = agruparPorLote(comprasFiltradas);
  body.innerHTML = grupos.map(renderFilaGrupo).join("");

  body.querySelectorAll(".lote-row").forEach(tr => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".del-btn")) return;
      toggleLoteDetail(tr);
    });
  });
  body.querySelectorAll(".del-btn[data-lote]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteLote(btn.dataset.lote); });
  });
  body.querySelectorAll(".del-btn[data-id]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteCompra(btn.dataset.id); });
  });
}

checkAuth();
