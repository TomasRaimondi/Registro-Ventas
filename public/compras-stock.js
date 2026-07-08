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

function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "inline-block";
  document.getElementById("fecha").value = hoyISO();
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

let costosGlobal = [];
let comprasGlobal = [];
let tipoActual = "compra";

// ---------- Carga de datos ----------

async function renderAll() {
  try {
    [costosGlobal, comprasGlobal] = await Promise.all([
      api("/api/costos"),
      api("/api/compras"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  renderStats();
  renderAutocompleteList();
  renderFiltroProducto();
  renderHistorial();
  actualizarPreview();
}

// ---------- Tarjetas de estadísticas ----------

function renderStats() {
  const valorInventario = costosGlobal.reduce((acc, c) => acc + (c.stock || 0) * (c.costo || 0), 0);
  const productosConStock = costosGlobal.filter(c => (c.stock || 0) > 0).length;

  const mesActual = hoyISO().slice(0, 7);
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

    const esCompra = tipoActual === "compra";
    document.getElementById("label-cantidad").textContent = esCompra ? "Cantidad comprada" : "Cantidad (+ para sumar, - para restar)";
    document.getElementById("cantidad").min = esCompra ? "1" : "";
    document.getElementById("fila-precio").style.display = esCompra ? "flex" : "none";
    document.getElementById("fila-vencimiento").style.display = esCompra ? "block" : "none";
    document.getElementById("fila-motivo").style.display = esCompra ? "none" : "block";
    document.getElementById("precio-unitario").required = esCompra;
    document.getElementById("submit-btn").textContent = esCompra ? "Registrar compra" : "Registrar ajuste";

    actualizarPreview();
  });
});

// ---------- Autocompletado de producto ----------

const productoInput = document.getElementById("producto");
const productoSuggestions = document.getElementById("producto-suggestions");

function renderAutocompleteList() {
  // Se recalcula en cada búsqueda a partir de costosGlobal
}

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

// ---------- Vista previa en vivo ----------

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
  const stockAntes = costoRow ? (costoRow.stock || 0) : 0;
  const costoAntes = costoRow ? (costoRow.costo || 0) : 0;
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

// ---------- Alta de movimiento ----------

const form = document.getElementById("compra-form");
const submitBtn = document.getElementById("submit-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const producto = productoInput.value.trim();
  const fecha = document.getElementById("fecha").value;
  const cantidad = parseInt(document.getElementById("cantidad").value, 10);

  if (!producto || !fecha || !Number.isFinite(cantidad) || cantidad === 0) {
    alert("Completá el producto, la fecha y la cantidad.");
    return;
  }

  const body = { tipo: tipoActual, producto, fecha, cantidad };

  if (tipoActual === "compra") {
    const precioUnitario = parseFloat(document.getElementById("precio-unitario").value);
    if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) {
      alert("Ingresá el precio pagado por unidad.");
      return;
    }
    if (cantidad <= 0) {
      alert("La cantidad comprada tiene que ser mayor a 0.");
      return;
    }
    body.precioUnitario = precioUnitario;
    body.proveedor = document.getElementById("proveedor").value.trim();
    body.vencimiento = document.getElementById("vencimiento").value || null;
  } else {
    body.nota = document.getElementById("nota").value.trim();
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Guardando...";

  try {
    await api("/api/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    productoInput.value = "";
    document.getElementById("cantidad").value = "";
    document.getElementById("precio-unitario").value = "";
    document.getElementById("proveedor").value = "";
    document.getElementById("vencimiento").value = "";
    document.getElementById("nota").value = "";
    document.getElementById("fecha").value = hoyISO();

    await renderAll();
  } catch (err) {
    alert("No se pudo registrar el movimiento.\n" + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = tipoActual === "compra" ? "Registrar compra" : "Registrar ajuste";
  }
});

// ---------- Historial ----------

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

function diasHasta(fecha) {
  const a = new Date(hoyISO() + "T00:00:00Z");
  const b = new Date(fecha + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function renderHistorial() {
  const filtro = document.getElementById("filtro-producto").value;
  const body = document.getElementById("historial-body");
  const filas = filtro ? comprasGlobal.filter(c => c.producto === filtro) : comprasGlobal;

  if (filas.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="10">Todavía no cargaste ningún movimiento.</td></tr>`;
    return;
  }

  body.innerHTML = filas.map(c => {
    const vencBadge = c.vencimiento && diasHasta(c.vencimiento) <= 30
      ? `<span class="badge-vencimiento">${diasHasta(c.vencimiento) < 0 ? "Vencido" : "Vence pronto"}</span>`
      : "";
    return `
      <tr>
        <td>${formatFechaCorta(c.fecha)}</td>
        <td><span class="badge-tipo ${c.tipo}">${c.tipo === "compra" ? "Compra" : "Ajuste"}</span></td>
        <td>${escapeHtml(c.producto)}</td>
        <td>${c.cantidad > 0 ? "+" : ""}${c.cantidad}</td>
        <td>${c.precioUnitario !== null ? money(c.precioUnitario) : "—"}</td>
        <td>${c.costoTotal !== null ? money(c.costoTotal) : "—"}</td>
        <td>${c.proveedor ? escapeHtml(c.proveedor) : "—"}</td>
        <td>${c.vencimiento ? formatFechaCorta(c.vencimiento) + vencBadge : "—"}</td>
        <td>${c.stockAntes} → ${c.stockDespues}</td>
        <td><button class="del-btn" title="Borrar" data-id="${c.id}">✕</button></td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteCompra(btn.dataset.id));
  });
}

checkAuth();
