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
    // Inventario expone costos y márgenes: si por algún motivo entra una sesión de
    // empleado (no dueño), se la trata como no logueada, igual que Costos Fijos.
    if (authenticated && role === "owner") showApp();
    else showLogin();
  } catch (e) {
    showLogin();
  }
}

// ---------- Estado ----------

let productosGlobal = [];
let proveedoresGlobal = [];
let expandidoKey = null;
let hoyFecha = new Date().toISOString().slice(0, 10);

function keyDe(p) {
  return p.id || p.nombre;
}

async function cargarTodo() {
  const tbody = document.getElementById("inv-body");
  try {
    const [resumen, productos] = await Promise.all([
      api("/api/inventario/resumen"),
      api("/api/inventario"),
    ]);
    productosGlobal = productos;
    renderStats(resumen);
    renderTabla();
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderStats(r) {
  document.getElementById("stat-capital").textContent = money(r.capitalInvertido);
  document.getElementById("stat-valor-estimado").textContent = money(r.valorEstimado);
  document.getElementById("stat-ganancia-potencial").textContent = money(r.gananciaPotencial);
  document.getElementById("stat-stock-total").textContent = r.stockTotal.toLocaleString("es-AR");
  document.getElementById("stat-productos").textContent = r.productosActivos;
  document.getElementById("stat-sin-clasificar").textContent = r.sinClasificar > 0 ? `${r.sinClasificar} sin clasificar` : "";
  document.getElementById("stat-stock-bajo").textContent = r.stockBajo;
  document.getElementById("stat-agotados").textContent = r.agotados;
}

// ---------- Tabla ----------

function estadoBadge(p) {
  if (!p.enriquecido) return `<span class="inv-estado-badge sin-clasificar">Sin clasificar</span>`;
  if (p.estadoStock === "agotado") return `<span class="inv-estado-badge agotado">Agotado</span>`;
  if (p.estadoStock === "bajo") return `<span class="inv-estado-badge bajo">Stock bajo</span>`;
  return `<span class="inv-estado-badge normal">Normal</span>`;
}

function aplicarFiltrosYOrden(lista) {
  const q = document.getElementById("inv-buscador").value.trim().toLowerCase();
  const filtroEstado = document.getElementById("inv-filtro-estado").value;
  const orden = document.getElementById("inv-orden").value;

  let resultado = lista.filter((p) => {
    if (q) {
      const campos = [p.nombre, p.marca, p.categoria, p.sku].filter(Boolean).join(" ").toLowerCase();
      if (!campos.includes(q)) return false;
    }
    if (filtroEstado === "sin-clasificar") return !p.enriquecido;
    if (filtroEstado !== "todos") return p.estadoStock === filtroEstado;
    return true;
  });

  const cmp = {
    nombre: (a, b) => a.nombre.localeCompare(b.nombre),
    "stock-asc": (a, b) => a.stock - b.stock,
    "stock-desc": (a, b) => b.stock - a.stock,
    "valor-desc": (a, b) => b.valorEstimadoStock - a.valorEstimadoStock,
    "capital-desc": (a, b) => b.capitalInvertido - a.capitalInvertido,
    "ganancia-desc": (a, b) => (b.valorEstimadoStock - b.capitalInvertido) - (a.valorEstimadoStock - a.capitalInvertido),
  }[orden] || ((a, b) => a.nombre.localeCompare(b.nombre));

  return resultado.sort(cmp);
}

function renderTabla() {
  const tbody = document.getElementById("inv-body");
  const lista = aplicarFiltrosYOrden(productosGlobal);

  if (!lista.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No hay productos que coincidan.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  lista.forEach((p) => {
    tbody.appendChild(filaProducto(p));
    if (expandidoKey === keyDe(p)) {
      tbody.appendChild(filaDetalle(p));
    }
  });
}

function inputInline(valor, campo, opts) {
  opts = opts || {};
  const v = valor == null ? "" : valor;
  return `<input type="number" class="inv-input" data-campo="${campo}" value="${v}" min="0" step="${opts.step || "0.01"}" placeholder="${opts.placeholder || "—"}">`;
}

function filaProducto(p) {
  const tr = document.createElement("tr");
  tr.className = "inv-fila";
  tr.dataset.key = keyDe(p);
  tr.innerHTML = `
    <td class="col-producto">
      <span class="inv-producto-nombre">${escapeHtml(p.nombre)}</span>
      ${p.marca ? `<span class="hint">${escapeHtml(p.marca)}</span>` : (!p.enriquecido ? `<span class="inv-sin-clasificar-tag">Tocá para completar datos</span>` : "")}
    </td>
    <td class="inv-td-input">${inputInline(p.stockLocal, "stockLocal", { step: "1" })}</td>
    <td class="inv-td-input">${inputInline(p.stockDeposito, "stockDeposito", { step: "1" })}</td>
    <td class="inv-td-input">${inputInline(p.costo, "costo")}</td>
    <td class="inv-td-input">${inputInline(p.stockMinimo, "stockMinimo", { step: "1" })}</td>
    <td class="inv-td-input">${inputInline(p.precioMinoristaActual, "precioMinoristaActual")}</td>
    <td class="inv-td-input">${inputInline(p.precioMayoristaActual, "precioMayoristaActual")}</td>
    <td title="Stock × costo">${money(p.capitalInvertido)}</td>
    <td title="${escapeHtml(p.metodoValorEstimado)}">${money(p.valorEstimadoStock)}</td>
    <td>${estadoBadge(p)}</td>
  `;
  tr.addEventListener("click", (e) => {
    if (e.target.closest(".inv-input")) return;
    toggleDetalle(p);
  });
  return tr;
}

function campoDetalleTexto(label, campo, valor) {
  return `
    <div class="inv-detalle-campo">
      <label>${escapeHtml(label)}</label>
      <input type="text" class="inv-input inv-input-texto" data-campo="${campo}" value="${escapeHtml(valor || "")}">
    </div>
  `;
}

function formatUltimoPrecio(u, cantidad) {
  if (!u) return `<span class="hint">Sin ventas registradas</span>`;
  const vecesTxt = cantidad === 1 ? "1 vez" : `${cantidad} veces`;
  return `<strong>${money(u.precio)}</strong> — ${escapeHtml(u.fecha)} <span class="hint">(vendido ${vecesTxt})</span>`;
}

function filaDetalle(p) {
  const tr = document.createElement("tr");
  tr.className = "inv-fila-detalle";
  tr.innerHTML = `
    <td colspan="10">
      <div class="inv-traspaso">
        <label>Traspaso de stock (local: ${p.stockLocal} / depósito: ${p.stockDeposito})</label>
        <div class="inv-traspaso-row">
          <input type="number" class="inv-traspaso-cantidad" min="1" step="1" placeholder="Cantidad">
          <button type="button" class="clear-btn inv-traspaso-btn" data-direccion="local-a-deposito">Local → Depósito</button>
          <button type="button" class="clear-btn inv-traspaso-btn" data-direccion="deposito-a-local">Depósito → Local</button>
        </div>
      </div>
      <div class="inv-detalle-grid">
        ${campoDetalleTexto("Marca", "marca", p.marca)}
        ${campoDetalleTexto("Categoría", "categoria", p.categoria)}
        ${campoDetalleTexto("Subcategoría", "subcategoria", p.subcategoria)}
        ${campoDetalleTexto("Variante", "variante", p.variante)}
        ${campoDetalleTexto("Sabor", "sabor", p.sabor)}
        ${campoDetalleTexto("Tamaño", "tamano", p.tamano)}
        ${campoDetalleTexto("SKU", "sku", p.sku)}
        ${campoDetalleTexto("Código de barra", "codigoBarra", p.codigoBarra)}
        <div class="inv-detalle-campo">
          <label>Stock ideal</label>
          <input type="number" class="inv-input inv-input-texto" data-campo="stockIdeal" value="${p.stockIdeal == null ? "" : p.stockIdeal}" min="0" step="1">
        </div>
      </div>
      <div class="inv-detalle-campo" style="margin-bottom:14px;">
        <label>Notas</label>
        <input type="text" class="inv-input inv-input-texto" data-campo="notas" value="${escapeHtml(p.notas || "")}">
      </div>
      <div class="inv-ultimo-precio">Último precio minorista vendido: ${formatUltimoPrecio(p.ultimoPrecioMinorista, p.cantidadVentasMinorista)}</div>
      <div class="inv-ultimo-precio">Último precio mayorista vendido: ${formatUltimoPrecio(p.ultimoPrecioMayorista, p.cantidadVentasMayorista)}</div>
      <div class="inv-metodo-estimacion">Valor de stock estimado con: ${escapeHtml(p.metodoValorEstimado)}</div>
      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
        <button type="button" class="clear-btn inv-ver-evolucion" style="width:auto; padding:8px 16px;">📈 Ver evolución</button>
        <button type="button" class="clear-btn inv-toggle-estado" style="width:auto; padding:8px 16px;" data-estado="${p.estado === "discontinuado" ? "activo" : "discontinuado"}">
          ${p.estado === "discontinuado" ? "Reactivar producto" : "Marcar como discontinuado"}
        </button>
      </div>
    </td>
  `;
  tr.addEventListener("click", (e) => e.stopPropagation());
  return tr;
}

function toggleDetalle(p) {
  expandidoKey = expandidoKey === keyDe(p) ? null : keyDe(p);
  renderTabla();
}

async function ensureProductoId(p) {
  if (p.id) return p.id;
  const row = await api("/api/productos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: p.nombre, costo: p.costo, stockInicial: p.stock }),
  });
  p.id = row.id;
  p.enriquecido = true;
  return p.id;
}

async function guardarCampo(p, campo, valorCrudo, inputEl) {
  let valor = valorCrudo;
  const camposStock = ["stockLocal", "stockDeposito"];
  const camposNumericos = ["costo", "stockMinimo", "stockIdeal", "precioMinoristaActual", "precioMayoristaActual"];
  if (camposStock.includes(campo) || camposNumericos.includes(campo)) {
    valor = valorCrudo === "" ? null : Number(valorCrudo);
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) { alert("Valor inválido"); renderTabla(); return; }
  } else {
    valor = valorCrudo.trim() || null;
  }

  try {
    // El stock (local y depósito) vive en la tabla "costos" (no en "productos"): se edita
    // con los mismos endpoints que ya usa el resto de la app para ajustes manuales, que
    // además dejan constancia en el historial de movimientos (compras_stock).
    if (campo === "stockLocal" || campo === "stockDeposito") {
      if (valor === null) { alert("El stock no puede quedar vacío."); renderTabla(); return; }
      const url = campo === "stockLocal" ? "/api/costos/stock" : "/api/costos/stock-deposito";
      const bodyKey = campo === "stockLocal" ? "stock" : "stockDeposito";
      await api(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ producto: p.nombre, [bodyKey]: valor }),
      });
    } else {
      const id = await ensureProductoId(p);
      await api(`/api/productos/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: valor }),
      });
    }
    await cargarTodo();
  } catch (err) {
    alert("No se pudo guardar: " + err.message);
    renderTabla();
  }
}

async function hacerTraspaso(p, cantidad, direccion) {
  try {
    await api("/api/costos/traspaso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto: p.nombre, cantidad, direccion }),
    });
    await cargarTodo();
  } catch (err) {
    alert("No se pudo hacer el traspaso: " + err.message);
  }
}

document.getElementById("inv-body").addEventListener("change", (e) => {
  const input = e.target.closest(".inv-input");
  if (!input) return;
  const tr = input.closest("tr");
  const fila = tr.classList.contains("inv-fila") ? tr : tr.previousElementSibling;
  const key = fila.dataset.key;
  const p = productosGlobal.find((x) => keyDe(x) === key);
  if (!p) return;
  guardarCampo(p, input.dataset.campo, input.value, input);
});

document.getElementById("inv-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".inv-toggle-estado");
  if (!btn) return;
  e.stopPropagation();
  const tr = btn.closest("tr").previousElementSibling;
  const key = tr.dataset.key;
  const p = productosGlobal.find((x) => keyDe(x) === key);
  if (!p) return;
  try {
    const id = await ensureProductoId(p);
    await api(`/api/productos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: btn.dataset.estado }),
    });
    await cargarTodo();
  } catch (err) {
    alert("No se pudo actualizar: " + err.message);
  }
});

document.getElementById("inv-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".inv-traspaso-btn");
  if (!btn) return;
  e.stopPropagation();
  const tr = btn.closest("tr").previousElementSibling;
  const key = tr.dataset.key;
  const p = productosGlobal.find((x) => keyDe(x) === key);
  if (!p) return;
  const cantidadInput = btn.closest(".inv-traspaso-row").querySelector(".inv-traspaso-cantidad");
  const cantidad = parseInt(cantidadInput.value, 10);
  if (!Number.isInteger(cantidad) || cantidad <= 0) { alert("Ingresá una cantidad válida."); return; }
  hacerTraspaso(p, cantidad, btn.dataset.direccion);
});

document.getElementById("inv-buscador").addEventListener("input", renderTabla);
document.getElementById("inv-orden").addEventListener("change", renderTabla);
document.getElementById("inv-filtro-estado").addEventListener("change", renderTabla);

// ---------- Modal: Nuevo Producto ----------

const modalNuevoProducto = document.getElementById("modal-nuevo-producto");

function abrirModalNuevoProducto() {
  document.getElementById("np-form").reset();
  document.getElementById("np-error").style.display = "none";
  modalNuevoProducto.style.display = "flex";
  document.getElementById("np-nombre").focus();
}

function cerrarModalNuevoProducto() {
  modalNuevoProducto.style.display = "none";
}

document.getElementById("btn-nuevo-producto").addEventListener("click", abrirModalNuevoProducto);
document.getElementById("np-cerrar-btn").addEventListener("click", cerrarModalNuevoProducto);
modalNuevoProducto.addEventListener("click", (e) => { if (e.target === modalNuevoProducto) cerrarModalNuevoProducto(); });

document.getElementById("np-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = document.getElementById("np-error");
  errorHint.style.display = "none";

  const campoNum = (id) => {
    const v = document.getElementById(id).value;
    return v === "" ? null : Number(v);
  };

  const body = {
    nombre: document.getElementById("np-nombre").value.trim(),
    marca: document.getElementById("np-marca").value.trim() || null,
    categoria: document.getElementById("np-categoria").value.trim() || null,
    costo: campoNum("np-costo"),
    stockInicial: campoNum("np-stock-inicial") || 0,
    precioMinoristaActual: campoNum("np-minorista"),
    precioMayoristaActual: campoNum("np-mayorista"),
    stockMinimo: campoNum("np-stock-minimo"),
    stockIdeal: campoNum("np-stock-ideal"),
  };

  if (!body.nombre) { errorHint.textContent = "Ingresá un nombre."; errorHint.style.display = "block"; return; }
  if (!Number.isFinite(body.costo) || body.costo < 0) { errorHint.textContent = "Costo inválido."; errorHint.style.display = "block"; return; }

  try {
    await api("/api/productos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    cerrarModalNuevoProducto();
    await cargarTodo();
  } catch (err) {
    errorHint.textContent = err.message || "No se pudo crear el producto.";
    errorHint.style.display = "block";
  }
});

// ---------- Modal: Nuevo Ingreso (reutiliza POST /api/compras) ----------

const modalNuevoIngreso = document.getElementById("modal-nuevo-ingreso");
let carritoIngreso = [];

async function abrirModalNuevoIngreso() {
  document.getElementById("ni-form").reset();
  document.getElementById("ni-error").style.display = "none";
  carritoIngreso = [];
  renderCarritoIngreso();
  try {
    const hora = await api("/api/hora");
    hoyFecha = hora.fecha;
  } catch (e) { /* usa el valor que ya tenía */ }
  document.getElementById("ni-fecha").value = hoyFecha;
  modalNuevoIngreso.style.display = "flex";
  document.getElementById("ni-producto-input").focus();
}

function cerrarModalNuevoIngreso() {
  modalNuevoIngreso.style.display = "none";
}

document.getElementById("btn-nuevo-ingreso").addEventListener("click", abrirModalNuevoIngreso);
document.getElementById("ni-cerrar-btn").addEventListener("click", cerrarModalNuevoIngreso);
modalNuevoIngreso.addEventListener("click", (e) => { if (e.target === modalNuevoIngreso) cerrarModalNuevoIngreso(); });

// Autocompletado de producto (mismo patrón que usaba la vieja Compras de Stock).
const niProductoInput = document.getElementById("ni-producto-input");
const niSuggestions = document.getElementById("ni-producto-suggestions");

function renderSuggestions(matches) {
  if (!matches.length) { niSuggestions.innerHTML = ""; niSuggestions.classList.remove("open"); return; }
  niSuggestions.innerHTML = matches.map((p) => `<div class="suggestion-item">${escapeHtml(p)}</div>`).join("");
  niSuggestions.classList.add("open");
}

niProductoInput.addEventListener("input", () => {
  const q = niProductoInput.value.trim().toLowerCase();
  if (!q) { renderSuggestions([]); return; }
  const nombres = productosGlobal.map((p) => p.nombre);
  renderSuggestions(nombres.filter((n) => n.toLowerCase().includes(q)).slice(0, 6));
});
niProductoInput.addEventListener("blur", () => setTimeout(() => renderSuggestions([]), 150));
niSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  niProductoInput.value = item.textContent;
  renderSuggestions([]);
  niProductoInput.focus();
});

function renderCarritoIngreso() {
  const cont = document.getElementById("ni-items");
  cont.innerHTML = "";
  carritoIngreso.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "inv-ingreso-item-row";
    row.innerHTML = `
      <span>${escapeHtml(item.producto)}</span>
      <span>${item.cantidad} × ${money(item.precioUnitario)}</span>
      <button type="button" class="cart-item-remove" title="Quitar">✕</button>
    `;
    row.querySelector(".cart-item-remove").addEventListener("click", () => {
      carritoIngreso.splice(idx, 1);
      renderCarritoIngreso();
    });
    cont.appendChild(row);
  });
}

document.getElementById("ni-producto-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
});

// Se agrega un producto al carrito con Enter desde el input de cantidad/precio, para no
// tener que meter botones "+" extra: el flujo es buscar producto -> Enter con cantidad y
// precio ya tipeados en el mismo input usando el formato "cantidad,precio" sería confuso,
// así que en vez de eso se usan dos inputs chicos que aparecen al lado del buscador.
const niCantidadInput = document.createElement("input");
niCantidadInput.type = "number"; niCantidadInput.className = "cantidad-input"; niCantidadInput.placeholder = "Cant."; niCantidadInput.min = "1"; niCantidadInput.step = "1";
const niPrecioInput = document.createElement("input");
niPrecioInput.type = "number"; niPrecioInput.className = "precio-input"; niPrecioInput.placeholder = "Precio unit."; niPrecioInput.min = "0"; niPrecioInput.step = "0.01";
const niAgregarBtn = document.createElement("button");
niAgregarBtn.type = "button"; niAgregarBtn.className = "clear-btn"; niAgregarBtn.textContent = "+ Agregar"; niAgregarBtn.style.flex = "0 0 auto";

const niProductoField = niProductoInput.closest(".autocomplete-field");
const niAgregarRow = document.createElement("div");
niAgregarRow.className = "inv-ingreso-item-row";
niAgregarRow.appendChild(niCantidadInput);
niAgregarRow.appendChild(niPrecioInput);
niAgregarRow.appendChild(niAgregarBtn);
niProductoField.after(niAgregarRow);

function agregarItemIngreso() {
  const producto = niProductoInput.value.trim();
  const cantidad = parseInt(niCantidadInput.value, 10);
  const precioUnitario = parseFloat(niPrecioInput.value);
  if (!producto) { alert("Elegí un producto."); return; }
  if (!Number.isInteger(cantidad) || cantidad <= 0) { alert("Cantidad inválida."); return; }
  if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) { alert("Precio inválido."); return; }
  carritoIngreso.push({ producto, cantidad, precioUnitario });
  niProductoInput.value = ""; niCantidadInput.value = ""; niPrecioInput.value = "";
  renderSuggestions([]);
  renderCarritoIngreso();
  niProductoInput.focus();
}

niAgregarBtn.addEventListener("click", agregarItemIngreso);

document.getElementById("ni-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = document.getElementById("ni-error");
  errorHint.style.display = "none";

  if (!carritoIngreso.length) { errorHint.textContent = "Agregá al menos un producto."; errorHint.style.display = "block"; return; }

  const factura = document.getElementById("ni-factura").value.trim();
  const notasBase = document.getElementById("ni-notas").value.trim();
  const nota = [factura ? `Factura/remito: ${factura}` : "", notasBase].filter(Boolean).join(" — ") || null;

  const body = {
    tipo: "compra",
    fecha: document.getElementById("ni-fecha").value,
    proveedor: document.getElementById("ni-proveedor").value.trim() || null,
    nota,
    items: carritoIngreso,
  };

  try {
    await api("/api/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    cerrarModalNuevoIngreso();
    await cargarTodo();
  } catch (err) {
    errorHint.textContent = err.message || "No se pudo registrar el ingreso.";
    errorHint.style.display = "block";
  }
});

// ---------- Modal: Evolución de producto ----------

const modalEvolucion = document.getElementById("modal-evolucion");
let evolucionActual = null; // último resultado de /evolucion, para cambiar de pestaña sin volver a pedirlo
let evolucionPeriodo = "dia";

document.getElementById("inv-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".inv-ver-evolucion");
  if (!btn) return;
  e.stopPropagation();
  const tr = btn.closest("tr").previousElementSibling;
  const key = tr.dataset.key;
  const p = productosGlobal.find((x) => keyDe(x) === key);
  if (!p) return;
  abrirModalEvolucion(p);
});

async function abrirModalEvolucion(p) {
  document.getElementById("ev-titulo").textContent = `Evolución — ${p.nombre}`;
  document.getElementById("ev-chart").innerHTML = "";
  document.getElementById("ev-tabla-body").innerHTML = `<tr class="empty-row"><td colspan="9">Cargando...</td></tr>`;
  document.getElementById("ev-costo-tabla-body").innerHTML = "";
  evolucionPeriodo = "dia";
  document.querySelectorAll("#ev-periodo-tabs .periodo-tab").forEach((b) => b.classList.toggle("active", b.dataset.periodo === "dia"));
  modalEvolucion.style.display = "flex";
  try {
    evolucionActual = await api(`/api/inventario/producto/${encodeURIComponent(p.nombre)}/evolucion`);
    renderEvolucion();
  } catch (err) {
    document.getElementById("ev-tabla-body").innerHTML = `<tr class="empty-row"><td colspan="9">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function cerrarModalEvolucion() {
  modalEvolucion.style.display = "none";
}

document.getElementById("ev-cerrar-btn").addEventListener("click", cerrarModalEvolucion);
modalEvolucion.addEventListener("click", (e) => { if (e.target === modalEvolucion) cerrarModalEvolucion(); });

document.querySelectorAll("#ev-periodo-tabs .periodo-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    evolucionPeriodo = btn.dataset.periodo;
    document.querySelectorAll("#ev-periodo-tabs .periodo-tab").forEach((b) => b.classList.toggle("active", b === btn));
    renderEvolucion();
  });
});

function labelPeriodo(row) {
  if (row.fecha) return row.fecha.slice(5); // MM-DD, alcanza para el eje del gráfico
  if (row.semana) return "sem " + row.semana.slice(5);
  return row.mes;
}

function renderDualBarChartEvolucion(container, filas) {
  container.innerHTML = "";
  if (!filas.length) return;
  const maxAbs = Math.max(...filas.map((f) => f.volumenMinorista + f.volumenMayorista), 1);
  filas.forEach((f) => {
    const total = f.volumenMinorista + f.volumenMayorista;
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const totalLabel = document.createElement("span");
    totalLabel.className = "chart-bar-value";
    totalLabel.textContent = money(total);
    wrap.appendChild(totalLabel);

    const pair = document.createElement("div");
    pair.className = "chart-bar-pair";

    const barA = document.createElement("div");
    barA.className = "chart-bar";
    barA.style.height = Math.max((f.volumenMinorista / maxAbs) * 100, f.volumenMinorista !== 0 ? 4 : 1) + "%";
    barA.title = `${labelPeriodo(f)} — Minorista: ${money(f.volumenMinorista)}`;

    const barB = document.createElement("div");
    barB.className = "chart-bar chart-bar-mayorista";
    barB.style.height = Math.max((f.volumenMayorista / maxAbs) * 100, f.volumenMayorista !== 0 ? 4 : 1) + "%";
    barB.title = `${labelPeriodo(f)} — Mayorista: ${money(f.volumenMayorista)}`;

    pair.appendChild(barA);
    pair.appendChild(barB);

    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = labelPeriodo(f);

    wrap.appendChild(pair);
    wrap.appendChild(hLabel);
    container.appendChild(wrap);
  });
}

function pctTexto(v) {
  return v === null ? "—" : v.toFixed(1) + "%";
}

function renderEvolucion() {
  if (!evolucionActual) return;
  const filas = evolucionActual[evolucionPeriodo === "dia" ? "porDia" : evolucionPeriodo === "semana" ? "porSemana" : "porMes"];

  renderDualBarChartEvolucion(document.getElementById("ev-chart"), filas);

  const tbody = document.getElementById("ev-tabla-body");
  if (!filas.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">Todavía no hay ventas registradas de este producto.</td></tr>`;
  } else {
    tbody.innerHTML = [...filas].reverse().map((f) => `
      <tr>
        <td><strong>${escapeHtml(labelPeriodo(f))}</strong></td>
        <td>${f.unidadesMinorista}</td>
        <td>${f.unidadesMayorista}</td>
        <td>${money(f.volumenMinorista)}</td>
        <td>${money(f.volumenMayorista)}</td>
        <td>${money(f.gananciaMinorista)}</td>
        <td>${money(f.gananciaMayorista)}</td>
        <td>${pctTexto(f.retornoMinorista)}</td>
        <td>${pctTexto(f.retornoMayorista)}</td>
      </tr>
    `).join("");
  }

  const costoBody = document.getElementById("ev-costo-tabla-body");
  if (!evolucionActual.costoHistorial.length) {
    costoBody.innerHTML = `<tr class="empty-row"><td colspan="2">Sin historial de costo todavía.</td></tr>`;
  } else {
    costoBody.innerHTML = [...evolucionActual.costoHistorial].reverse().map((c) => `
      <tr><td>${escapeHtml(c.vigenteDesde)}</td><td>${money(c.costo)}</td></tr>
    `).join("");
  }
}

checkAuth();
