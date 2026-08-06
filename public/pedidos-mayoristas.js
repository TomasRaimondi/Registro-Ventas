function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
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
  mostrarVista("inicio");
  cargarRecientes();
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

// ---------- Navegación entre vistas ----------

const VISTAS = ["inicio", "elegir-modo", "hoja", "factura"];

function mostrarVista(nombre) {
  VISTAS.forEach(v => {
    document.getElementById(`vista-${v}`).style.display = v === nombre ? "block" : "none";
  });
}

// ---------- Estado del pedido en armado ----------

let modoActual = "cliente"; // "cliente" | "empresa"
let itemsPedido = []; // { producto, costo, cantidad, precioVenta }
let productosDisponibles = []; // { producto, costo }, sin combos

async function cargarProductosDisponibles() {
  const [costos, composicion] = await Promise.all([
    api("/api/costos"),
    api("/api/composicion"),
  ]);
  const combosSet = new Set(composicion.map(c => c.comboProducto));
  productosDisponibles = costos.filter(c => !combosSet.has(c.producto));
}

function resetPedido() {
  itemsPedido = [];
  document.getElementById("pedido-cliente").value = "";
  document.getElementById("pedido-producto-input").value = "";
  document.getElementById("pedido-producto-error").style.display = "none";
  document.getElementById("pedido-error").style.display = "none";
  renderSuggestions([]);
  renderItemsTable();
}

function setModo(modo) {
  modoActual = modo;
  document.getElementById("vista-hoja").classList.toggle("modo-cliente", modo === "cliente");
  document.querySelectorAll(".modo-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.modo === modo);
  });
}

document.getElementById("nuevo-pedido-btn").addEventListener("click", async () => {
  try {
    await cargarProductosDisponibles();
  } catch (err) {
    console.error(err);
    alert("No se pudo cargar la lista de productos con costo.");
    return;
  }
  mostrarVista("elegir-modo");
});

document.getElementById("cancelar-modo-btn").addEventListener("click", () => mostrarVista("inicio"));

// Momento (hora Argentina, autoritativa del servidor) en que se abrió el pedido actual.
let pedidoFechaHora = null;

document.querySelectorAll(".modo-opcion-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    resetPedido();
    setModo(btn.dataset.modo);
    try {
      pedidoFechaHora = await api("/api/hora");
    } catch (err) {
      console.error(err);
      pedidoFechaHora = null;
    }
    document.getElementById("pedido-fecha").textContent = pedidoFechaHora ? formatFechaCorta(pedidoFechaHora.fecha) : "—";
    document.getElementById("pedido-hora").textContent = pedidoFechaHora ? pedidoFechaHora.horaLabel : "—";
    mostrarVista("hoja");
    document.getElementById("pedido-cliente").focus();
  });
});

document.querySelectorAll(".modo-tab").forEach(btn => {
  btn.addEventListener("click", () => setModo(btn.dataset.modo));
});

document.getElementById("pedido-cancelar-btn").addEventListener("click", () => {
  if (itemsPedido.length > 0 && !confirm("¿Cancelar este pedido? Se va a perder lo que cargaste.")) return;
  mostrarVista("inicio");
});

// ---------- Buscador de productos (solo los que tienen costo cargado, sin combos) ----------

const productoInput = document.getElementById("pedido-producto-input");
const productoSuggestions = document.getElementById("pedido-producto-suggestions");
const productoError = document.getElementById("pedido-producto-error");

function renderSuggestions(matches) {
  if (!matches.length) {
    productoSuggestions.innerHTML = "";
    productoSuggestions.classList.remove("open");
    return;
  }
  productoSuggestions.innerHTML = matches
    .map(p => `<div class="suggestion-item">${escapeHtml(p.producto)}</div>`)
    .join("");
  productoSuggestions.classList.add("open");
}

function buscarSugerencias() {
  const q = normalizeNombre(productoInput.value);
  if (!q) { renderSuggestions([]); return; }
  const matches = productosDisponibles.filter(p => p.producto.toLowerCase().includes(q)).slice(0, 8);
  renderSuggestions(matches);
}

productoInput.addEventListener("input", buscarSugerencias);
productoInput.addEventListener("focus", buscarSugerencias);
productoInput.addEventListener("blur", () => setTimeout(() => renderSuggestions([]), 150));
productoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    intentarAgregarProducto();
  }
});

productoSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  agregarProductoAlPedido(item.textContent);
  productoInput.value = "";
  renderSuggestions([]);
  productoInput.focus();
});

document.getElementById("pedido-agregar-producto-btn").addEventListener("click", intentarAgregarProducto);

function intentarAgregarProducto() {
  const nombre = productoInput.value.trim();
  if (!nombre) return;
  const agregado = agregarProductoAlPedido(nombre);
  if (agregado) {
    productoInput.value = "";
    renderSuggestions([]);
  }
  productoInput.focus();
}

function agregarProductoAlPedido(nombre) {
  const key = normalizeNombre(nombre);
  const producto = productosDisponibles.find(p => normalizeNombre(p.producto) === key);
  if (!producto) {
    productoError.textContent = `"${nombre}" no está en la lista de productos con costo cargado.`;
    productoError.style.display = "block";
    return false;
  }
  productoError.style.display = "none";

  const existente = itemsPedido.find(it => normalizeNombre(it.producto) === key);
  if (existente) {
    existente.cantidad += 1;
  } else {
    itemsPedido.push({ producto: producto.producto, costo: producto.costo, cantidad: 1, precioVenta: "" });
  }
  renderItemsTable();
  return true;
}

// ---------- Tabla de productos del pedido ----------

function renderItemsTable() {
  const body = document.getElementById("pedido-items-body");
  body.innerHTML = "";

  if (itemsPedido.length === 0) {
    const colspan = modoActual === "cliente" ? 5 : 7;
    body.innerHTML = `<tr class="empty-row"><td colspan="${colspan}">Todavía no agregaste productos.</td></tr>`;
    recomputeTotales();
    return;
  }

  itemsPedido.forEach((it, idx) => {
    const tr = document.createElement("tr");
    const subtotalCosto = it.costo * it.cantidad;
    const precioVentaNum = Number(it.precioVenta) || 0;
    const subtotalVenta = precioVentaNum * it.cantidad;

    tr.innerHTML = `
      <td>${escapeHtml(it.producto)}</td>
      <td><input type="number" class="input-cantidad" min="1" step="1" value="${it.cantidad}" style="width:80px;"></td>
      <td class="col-costo">${money(it.costo)}</td>
      <td><input type="number" class="input-precio-venta" min="0" step="0.01" placeholder="0" value="${it.precioVenta}" style="width:100px;"></td>
      <td class="col-costo subtotal-costo">${money(subtotalCosto)}</td>
      <td class="subtotal-venta">${money(subtotalVenta)}</td>
      <td><button type="button" class="del-btn" title="Quitar">✕</button></td>
    `;

    tr.querySelector(".input-cantidad").addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      itemsPedido[idx].cantidad = Number.isInteger(val) && val > 0 ? val : 1;
      renderItemsTable();
    });
    tr.querySelector(".input-precio-venta").addEventListener("input", (e) => {
      itemsPedido[idx].precioVenta = e.target.value;
      const cant = itemsPedido[idx].cantidad;
      tr.querySelector(".subtotal-venta").textContent = money((Number(e.target.value) || 0) * cant);
      recomputeTotales();
    });
    tr.querySelector(".del-btn").addEventListener("click", () => {
      itemsPedido.splice(idx, 1);
      renderItemsTable();
    });

    body.appendChild(tr);
  });

  recomputeTotales();
}

function recomputeTotales() {
  const totalCosto = itemsPedido.reduce((acc, it) => acc + it.costo * it.cantidad, 0);
  const totalVenta = itemsPedido.reduce((acc, it) => acc + (Number(it.precioVenta) || 0) * it.cantidad, 0);
  document.getElementById("pedido-total-costo").textContent = money(totalCosto);
  document.getElementById("pedido-total-venta").textContent = money(totalVenta);
  document.getElementById("pedido-total-ganancia").textContent = money(totalVenta - totalCosto);
}

// ---------- Validación común ----------

function validarPedido() {
  const errorEl = document.getElementById("pedido-error");
  errorEl.style.display = "none";

  const cliente = document.getElementById("pedido-cliente").value.trim();
  if (!cliente) {
    errorEl.textContent = "Ingresá el nombre del cliente o empresa.";
    errorEl.style.display = "block";
    return null;
  }
  if (itemsPedido.length === 0) {
    errorEl.textContent = "Agregá al menos un producto al pedido.";
    errorEl.style.display = "block";
    return null;
  }
  const sinPrecio = itemsPedido.find(it => !(Number(it.precioVenta) > 0));
  if (sinPrecio) {
    errorEl.textContent = `Falta el precio de venta de "${sinPrecio.producto}".`;
    errorEl.style.display = "block";
    return null;
  }
  return cliente;
}

// ---------- Guardar como venta real (descuenta stock) ----------

document.getElementById("pedido-guardar-stock-btn").addEventListener("click", async () => {
  const cliente = validarPedido();
  if (!cliente) return;

  const btn = document.getElementById("pedido-guardar-stock-btn");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const itemsExpandidos = [];
  itemsPedido.forEach(it => {
    for (let i = 0; i < it.cantidad; i++) {
      itemsExpandidos.push({ producto: it.producto, precio: Number(it.precioVenta) });
    }
  });

  try {
    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metodo: "mayorista", items: itemsExpandidos, cliente }),
    });
    mostrarFactura({ titulo: "FACTURA", cliente, guardado: true });
    cargarRecientes();
  } catch (err) {
    const errorEl = document.getElementById("pedido-error");
    errorEl.textContent = err.message || "No se pudo guardar el pedido.";
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar pedido y descontar stock";
  }
});

// ---------- Solo generar presupuesto/factura (no toca el stock) ----------

document.getElementById("pedido-solo-presupuesto-btn").addEventListener("click", () => {
  const cliente = validarPedido();
  if (!cliente) return;
  mostrarFactura({ titulo: "PRESUPUESTO", cliente, guardado: false });
});

// ---------- Vista de factura / presupuesto ----------

function mostrarFactura({ titulo, cliente }) {
  document.getElementById("factura-titulo").textContent = titulo;
  document.getElementById("factura-fecha").textContent = pedidoFechaHora ? formatFechaCorta(pedidoFechaHora.fecha) : "—";
  document.getElementById("factura-hora").textContent = pedidoFechaHora ? pedidoFechaHora.horaLabel : "—";
  document.getElementById("factura-cliente").textContent = cliente;

  const esCliente = modoActual === "cliente";
  const theadRow = document.getElementById("factura-thead-row");
  theadRow.innerHTML = esCliente
    ? "<th>Producto</th><th>Cantidad</th><th>Precio venta</th><th>Subtotal</th>"
    : "<th>Producto</th><th>Cantidad</th><th>Precio costo</th><th>Precio venta</th><th>Subtotal costo</th><th>Subtotal venta</th>";

  const body = document.getElementById("factura-body");
  body.innerHTML = itemsPedido.map(it => {
    const precioVenta = Number(it.precioVenta) || 0;
    const subtotalVenta = precioVenta * it.cantidad;
    if (esCliente) {
      return `
        <tr>
          <td>${escapeHtml(it.producto)}</td>
          <td>${it.cantidad}</td>
          <td>${money(precioVenta)}</td>
          <td>${money(subtotalVenta)}</td>
        </tr>
      `;
    }
    const subtotalCosto = it.costo * it.cantidad;
    return `
      <tr>
        <td>${escapeHtml(it.producto)}</td>
        <td>${it.cantidad}</td>
        <td>${money(it.costo)}</td>
        <td>${money(precioVenta)}</td>
        <td>${money(subtotalCosto)}</td>
        <td>${money(subtotalVenta)}</td>
      </tr>
    `;
  }).join("");

  const totalVenta = itemsPedido.reduce((acc, it) => acc + (Number(it.precioVenta) || 0) * it.cantidad, 0);
  const totalesEl = document.getElementById("factura-totales");
  if (esCliente) {
    totalesEl.innerHTML = `<span class="factura-total-final">Total: ${money(totalVenta)}</span>`;
  } else {
    const totalCosto = itemsPedido.reduce((acc, it) => acc + it.costo * it.cantidad, 0);
    totalesEl.innerHTML = `
      <span>Total costo: ${money(totalCosto)}</span>
      <span>Ganancia: ${money(totalVenta - totalCosto)}</span>
      <span class="factura-total-final">Total venta: ${money(totalVenta)}</span>
    `;
  }

  mostrarVista("factura");
}

document.getElementById("factura-imprimir-btn").addEventListener("click", () => window.print());
document.getElementById("factura-volver-btn").addEventListener("click", () => mostrarVista("inicio"));

// ---------- Pedidos mayoristas recientes ----------

async function cargarRecientes() {
  const body = document.getElementById("recientes-body");
  let data;
  try {
    data = await api("/api/reportes");
  } catch (err) {
    console.error(err);
    return;
  }

  const ventasMayoristas = data.ventas
    .filter(v => v.metodo === "mayorista")
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .slice(0, 30);

  if (ventasMayoristas.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no hay pedidos mayoristas guardados.</td></tr>`;
    return;
  }

  const itemsPorVenta = new Map();
  data.items.forEach(it => {
    if (!itemsPorVenta.has(it.ventaId)) itemsPorVenta.set(it.ventaId, 0);
    itemsPorVenta.set(it.ventaId, itemsPorVenta.get(it.ventaId) + 1);
  });

  body.innerHTML = ventasMayoristas.map(v => `
    <tr>
      <td>${formatFechaCorta(v.fecha)}</td>
      <td>${v.cliente ? escapeHtml(v.cliente) : "—"}</td>
      <td>${itemsPorVenta.get(v.id) || 1} unidad${(itemsPorVenta.get(v.id) || 1) === 1 ? "" : "es"}</td>
      <td>${money(v.precio)}</td>
    </tr>
  `).join("");
}

checkAuth();
