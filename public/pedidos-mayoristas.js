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

const VISTAS = ["inicio", "hoja", "factura"];

function mostrarVista(nombre) {
  VISTAS.forEach(v => {
    document.getElementById(`vista-${v}`).style.display = v === nombre ? "block" : "none";
  });
}

// ---------- Estado del pedido en armado ----------

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

const CAMPOS_DATOS_CLIENTE = [
  "pedido-cliente", "pedido-domicilio", "pedido-localidad", "pedido-provincia",
  "pedido-telefono", "pedido-email", "pedido-iva", "pedido-vencimiento", "pedido-cuit-propio",
];

function resetPedido() {
  itemsPedido = [];
  CAMPOS_DATOS_CLIENTE.forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("pedido-producto-input").value = "";
  document.getElementById("pedido-producto-error").style.display = "none";
  document.getElementById("pedido-error").style.display = "none";
  renderSuggestions([]);
  renderItemsTable();
}

function obtenerDatosCliente() {
  return {
    nombre: document.getElementById("pedido-cliente").value.trim(),
    domicilio: document.getElementById("pedido-domicilio").value.trim(),
    localidad: document.getElementById("pedido-localidad").value.trim(),
    provincia: document.getElementById("pedido-provincia").value.trim(),
    telefono: document.getElementById("pedido-telefono").value.trim(),
    email: document.getElementById("pedido-email").value.trim(),
    iva: document.getElementById("pedido-iva").value,
    vencimiento: document.getElementById("pedido-vencimiento").value,
    cuit: document.getElementById("pedido-cuit-propio").value.trim(),
  };
}

// Momento (hora Argentina, autoritativa del servidor) en que se abrió el pedido actual.
let pedidoFechaHora = null;

// Si no es null, guardar reemplaza esta venta ya guardada en vez de crear una nueva
// (se borra la original, revirtiendo su stock, y se crea la versión editada).
let editandoVentaId = null;
let editandoFecha = null;
let editandoHora = null;
let editandoHoraLabel = null;

function actualizarEncabezadoHoja() {
  const titulo = document.getElementById("hoja-titulo");
  const hint = document.getElementById("hoja-editando-hint");
  const btnGuardar = document.getElementById("pedido-guardar-stock-btn");
  if (editandoVentaId) {
    titulo.textContent = "Editar pedido mayorista";
    hint.textContent = "Estás editando un pedido ya guardado. Al guardar los cambios, se reemplaza el pedido original: se revierte su stock y se aplica el del pedido editado.";
    hint.style.display = "block";
    btnGuardar.textContent = "Guardar cambios";
  } else {
    titulo.textContent = "Nuevo pedido mayorista";
    hint.style.display = "none";
    btnGuardar.textContent = "Guardar pedido y descontar stock";
  }
}

document.getElementById("nuevo-pedido-btn").addEventListener("click", async () => {
  try {
    await cargarProductosDisponibles();
  } catch (err) {
    console.error(err);
    alert("No se pudo cargar la lista de productos con costo.");
    return;
  }
  editandoVentaId = null;
  resetPedido();
  try {
    pedidoFechaHora = await api("/api/hora");
  } catch (err) {
    console.error(err);
    pedidoFechaHora = null;
  }
  document.getElementById("pedido-fecha").textContent = pedidoFechaHora ? formatFechaCorta(pedidoFechaHora.fecha) : "—";
  document.getElementById("pedido-hora").textContent = pedidoFechaHora ? pedidoFechaHora.horaLabel : "—";
  actualizarEncabezadoHoja();
  mostrarVista("hoja");
  document.getElementById("pedido-cliente").focus();
});

// ---------- Editar un pedido ya guardado ----------

async function iniciarEdicionPedido(venta, items, costoPorProducto) {
  try {
    await cargarProductosDisponibles();
  } catch (err) {
    console.error(err);
    alert("No se pudo cargar la lista de productos con costo.");
    return;
  }

  resetPedido();
  editandoVentaId = venta.id;
  editandoFecha = venta.fecha;
  editandoHora = venta.hora;
  editandoHoraLabel = venta.horaLabel;

  document.getElementById("pedido-cliente").value = venta.cliente || "";

  itemsPedido = agruparProductosReciente(items).map(g => {
    const key = normalizeNombre(g.producto);
    const costo = Object.prototype.hasOwnProperty.call(costoPorProducto, key) ? costoPorProducto[key] : 0;
    const precioTotal = g.items.reduce((acc, it) => acc + it.precio, 0);
    const precioVenta = Math.round((precioTotal / g.cantidad) * 100) / 100;
    return { producto: g.producto, costo, cantidad: g.cantidad, precioVenta: String(precioVenta) };
  });

  pedidoFechaHora = { fecha: venta.fecha, horaLabel: venta.horaLabel };
  document.getElementById("pedido-fecha").textContent = formatFechaCorta(venta.fecha);
  document.getElementById("pedido-hora").textContent = venta.horaLabel;

  actualizarEncabezadoHoja();
  renderItemsTable();
  mostrarVista("hoja");
  document.getElementById("pedido-cliente").focus();
}

document.getElementById("pedido-cancelar-btn").addEventListener("click", () => {
  if (itemsPedido.length > 0 && !confirm("¿Cancelar? Se va a perder lo que cargaste.")) return;
  editandoVentaId = null;
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

function calcularFila(it) {
  const cantidad = it.cantidad;
  const subtotalCosto = it.costo * cantidad;
  const precioVentaNum = Number(it.precioVenta) || 0;
  const subtotalVenta = precioVentaNum * cantidad;
  const ganancia = subtotalVenta - subtotalCosto;
  const pctRetorno = subtotalVenta > 0 ? (ganancia / subtotalVenta) * 100 : null;
  return { subtotalCosto, subtotalVenta, ganancia, pctRetorno };
}

// Actualiza solo las celdas calculadas de una fila (sin tocar los <input>, para no
// perderles el foco mientras el usuario está escribiendo cantidad o precio).
function actualizarCalculosFila(tr, it) {
  const { subtotalCosto, subtotalVenta, ganancia, pctRetorno } = calcularFila(it);
  tr.querySelector(".subtotal-costo").textContent = money(subtotalCosto);
  tr.querySelector(".subtotal-venta").textContent = money(subtotalVenta);
  tr.querySelector(".ganancia-fila").textContent = money(ganancia);
  tr.querySelector(".pct-retorno-fila").textContent = pctRetorno !== null ? pctRetorno.toFixed(1) + "%" : "—";
}

function renderItemsTable() {
  const body = document.getElementById("pedido-items-body");
  body.innerHTML = "";

  if (itemsPedido.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">Todavía no agregaste productos.</td></tr>`;
    recomputeTotales();
    return;
  }

  itemsPedido.forEach((it, idx) => {
    const tr = document.createElement("tr");
    const { subtotalCosto, subtotalVenta, ganancia, pctRetorno } = calcularFila(it);

    tr.innerHTML = `
      <td>${escapeHtml(it.producto)}</td>
      <td><input type="number" class="input-cantidad" min="1" step="1" value="${it.cantidad}" style="width:80px;"></td>
      <td class="col-costo">${money(it.costo)}</td>
      <td><input type="number" class="input-precio-venta" min="0" step="0.01" placeholder="0" value="${it.precioVenta}" style="width:100px;"></td>
      <td class="col-costo subtotal-costo">${money(subtotalCosto)}</td>
      <td class="subtotal-venta">${money(subtotalVenta)}</td>
      <td class="col-costo ganancia-fila">${money(ganancia)}</td>
      <td class="col-costo pct-retorno-fila">${pctRetorno !== null ? pctRetorno.toFixed(1) + "%" : "—"}</td>
      <td><button type="button" class="del-btn" title="Quitar">✕</button></td>
    `;

    const inputCantidad = tr.querySelector(".input-cantidad");
    const inputPrecioVenta = tr.querySelector(".input-precio-venta");

    inputCantidad.addEventListener("focus", () => inputCantidad.select());
    inputCantidad.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      itemsPedido[idx].cantidad = Number.isInteger(val) && val > 0 ? val : 1;
      actualizarCalculosFila(tr, itemsPedido[idx]);
      recomputeTotales();
    });

    inputPrecioVenta.addEventListener("focus", () => inputPrecioVenta.select());
    inputPrecioVenta.addEventListener("input", (e) => {
      itemsPedido[idx].precioVenta = e.target.value;
      actualizarCalculosFila(tr, itemsPedido[idx]);
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

  const datosCliente = obtenerDatosCliente();
  if (!datosCliente.nombre) {
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
  return datosCliente;
}

// ---------- Guardar como venta real (descuenta stock) ----------

document.getElementById("pedido-guardar-stock-btn").addEventListener("click", async () => {
  const datosCliente = validarPedido();
  if (!datosCliente) return;

  const btn = document.getElementById("pedido-guardar-stock-btn");
  btn.disabled = true;
  btn.textContent = editandoVentaId ? "Guardando cambios..." : "Guardando...";

  const itemsExpandidos = [];
  itemsPedido.forEach(it => {
    for (let i = 0; i < it.cantidad; i++) {
      itemsExpandidos.push({ producto: it.producto, precio: Number(it.precioVenta) });
    }
  });

  const bodyPayload = { metodo: "mayorista", items: itemsExpandidos, cliente: datosCliente.nombre };
  if (editandoVentaId) {
    // Se manda la fecha/hora original para que el pedido editado no se mueva al día de hoy.
    bodyPayload.fecha = editandoFecha;
    bodyPayload.hora = editandoHora;
    bodyPayload.horaLabel = editandoHoraLabel;
  }

  try {
    // Primero se crea la versión nueva y recién si eso funciona se borra la original: así, si
    // algo falla a mitad de camino, en el peor caso queda un duplicado (fácil de notar y borrar
    // a mano) en vez de perderse el pedido original sin que se haya guardado el editado.
    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (editandoVentaId) {
      try {
        await api("/api/ventas/" + encodeURIComponent(editandoVentaId), { method: "DELETE" });
      } catch (err) {
        console.error(err);
        alert("Se guardó el pedido editado, pero no se pudo borrar el pedido original: quedaron los dos cargados. Borrá el que sobra a mano desde \"Pedidos mayoristas recientes\".");
      }
      editandoVentaId = null;
    }

    mostrarFactura({ titulo: "FACTURA", datosCliente });
    cargarRecientes();
  } catch (err) {
    const errorEl = document.getElementById("pedido-error");
    errorEl.textContent = err.message || "No se pudo guardar el pedido.";
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    actualizarEncabezadoHoja();
  }
});

// ---------- Solo generar presupuesto/factura (no toca el stock) ----------

document.getElementById("pedido-solo-presupuesto-btn").addEventListener("click", () => {
  const datosCliente = validarPedido();
  if (!datosCliente) return;
  mostrarFactura({ titulo: "PRESUPUESTO", datosCliente });
});

// ---------- Vista de factura / presupuesto ----------

// "empresa" = versión completa (con costo y ganancia, uso interno).
// "cliente" = solo Producto, Cantidad, Precio venta y Subtotal, para archivarle/imprimirle al cliente.
let facturaVistaModo = "empresa";
let facturaDatosClienteActual = null;
let facturaNumeroActual = null;

// Numeración correlativa simple, guardada en este navegador (no hay backend de
// facturación numerada). Sirve para tener un N° de comprobante prolijo y único.
function obtenerProximoNumeroComprobante() {
  const key = "pedidosMayoristasUltimoNumero";
  const n = (parseInt(localStorage.getItem(key) || "0", 10) || 0) + 1;
  localStorage.setItem(key, String(n));
  return String(n).padStart(8, "0");
}

function renderDatosClienteBox() {
  const d = facturaDatosClienteActual;
  const el = document.getElementById("factura-datos-cliente");
  if (!d) { el.innerHTML = ""; return; }

  const filas = [];
  if (d.domicilio) filas.push(`<span><span class="dato-label">Domicilio:</span>${escapeHtml(d.domicilio)}</span>`);
  if (d.localidad) filas.push(`<span><span class="dato-label">Localidad:</span>${escapeHtml(d.localidad)}</span>`);
  if (d.provincia) filas.push(`<span><span class="dato-label">Provincia:</span>${escapeHtml(d.provincia)}</span>`);
  if (d.telefono) filas.push(`<span><span class="dato-label">Teléfono:</span>${escapeHtml(d.telefono)}</span>`);
  if (d.email) filas.push(`<span><span class="dato-label">Email:</span>${escapeHtml(d.email)}</span>`);
  if (d.iva) filas.push(`<span><span class="dato-label">Cond. IVA:</span>${escapeHtml(d.iva)}</span>`);
  if (d.vencimiento) filas.push(`<span><span class="dato-label">Válido hasta:</span>${formatFechaCorta(d.vencimiento)}</span>`);
  if (d.cuit) filas.push(`<span><span class="dato-label">CUIT:</span>${escapeHtml(d.cuit)}</span>`);

  el.innerHTML = `<span class="dato-cliente-nombre"><strong>Cliente / Empresa:</strong> ${escapeHtml(d.nombre)}</span>` + filas.join("");
}

function mostrarFactura({ titulo, datosCliente }) {
  facturaDatosClienteActual = datosCliente;
  facturaNumeroActual = obtenerProximoNumeroComprobante();

  document.getElementById("factura-titulo").textContent = titulo;
  document.getElementById("factura-fecha").textContent = pedidoFechaHora ? formatFechaCorta(pedidoFechaHora.fecha) : "—";
  document.getElementById("factura-numero").textContent = facturaNumeroActual;
  renderDatosClienteBox();

  facturaVistaModo = "empresa";
  document.querySelectorAll(".factura-vista-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.vista === facturaVistaModo);
  });

  renderFacturaContenido();
  mostrarVista("factura");
}

function renderFacturaContenido() {
  const esCliente = facturaVistaModo === "cliente";

  const theadRow = document.getElementById("factura-thead-row");
  theadRow.innerHTML = esCliente
    ? "<th>Producto</th><th>Cantidad</th><th>Precio venta</th><th>Subtotal</th>"
    : "<th>Producto</th><th>Cantidad</th><th>Precio costo</th><th>Precio venta</th><th>Subtotal costo</th><th>Subtotal venta</th><th>Ganancia</th><th>% Retorno</th>";

  const body = document.getElementById("factura-body");
  body.innerHTML = itemsPedido.map(it => {
    const { subtotalCosto, subtotalVenta, ganancia, pctRetorno } = calcularFila(it);
    const precioVenta = Number(it.precioVenta) || 0;
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
    return `
      <tr>
        <td>${escapeHtml(it.producto)}</td>
        <td>${it.cantidad}</td>
        <td>${money(it.costo)}</td>
        <td>${money(precioVenta)}</td>
        <td>${money(subtotalCosto)}</td>
        <td>${money(subtotalVenta)}</td>
        <td>${money(ganancia)}</td>
        <td>${pctRetorno !== null ? pctRetorno.toFixed(1) + "%" : "—"}</td>
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
}

document.querySelectorAll(".factura-vista-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    facturaVistaModo = btn.dataset.vista;
    document.querySelectorAll(".factura-vista-tab").forEach(b => b.classList.toggle("active", b === btn));
    renderFacturaContenido();
  });
});

document.getElementById("factura-imprimir-btn").addEventListener("click", () => window.print());
document.getElementById("factura-volver-btn").addEventListener("click", () => mostrarVista("inicio"));

// ---------- Guardar la factura/presupuesto como archivo en la computadora ----------

let logoBase64Cache = null;

async function obtenerLogoBase64() {
  if (logoBase64Cache) return logoBase64Cache;
  const res = await fetch("/logo-platense-fit.png");
  const blob = await res.blob();
  logoBase64Cache = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return logoBase64Cache;
}

async function construirHtmlFactura() {
  const titulo = document.getElementById("factura-titulo").textContent;
  const numero = document.getElementById("factura-numero").textContent;
  const fecha = document.getElementById("factura-fecha").textContent;
  const datosClienteHtml = document.getElementById("factura-datos-cliente").innerHTML;
  const theadHtml = document.getElementById("factura-thead-row").innerHTML;
  const bodyHtml = document.getElementById("factura-body").innerHTML;
  const totalesHtml = document.getElementById("factura-totales").innerHTML;
  const cliente = facturaDatosClienteActual ? facturaDatosClienteActual.nombre : "";

  let logoImgTag = "";
  try {
    const logoData = await obtenerLogoBase64();
    logoImgTag = `<img src="${logoData}" alt="Platense Fit" class="factura-logo">`;
  } catch (err) {
    console.error("No se pudo incrustar el logo:", err);
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(titulo)} ${escapeHtml(numero)} - ${escapeHtml(cliente)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background:#fff; color:#1a2230; padding:32px; max-width:800px; margin:0 auto; }
  .factura-header { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; padding-bottom:18px; border-bottom:2px solid #1a2230; margin-bottom:18px; }
  .factura-marca { display:flex; align-items:center; gap:14px; }
  .factura-logo { width:62px; height:62px; object-fit:contain; border-radius:50%; }
  .factura-marca-texto { display:flex; flex-direction:column; gap:2px; font-size:13px; color:#4a5468; }
  .factura-marca-texto strong { font-size:17px; color:#1a2230; }
  .factura-doc-info { text-align:right; display:flex; flex-direction:column; gap:4px; font-size:13px; color:#667088; }
  .factura-doc-info h2 { margin:0 0 4px; font-size:21px; letter-spacing:1.5px; color:#1a2230; }
  .factura-datos-cliente { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:6px 28px; padding:14px 16px; border:1px solid #e3e7f0; border-radius:10px; margin-bottom:20px; font-size:13.5px; }
  .factura-datos-cliente .dato-label { color:#667088; margin-right:4px; }
  .factura-datos-cliente .dato-cliente-nombre { grid-column: 1 / -1; font-size:15px; margin-bottom:4px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid #e3e7f0; font-size:14px; }
  th { text-transform:uppercase; font-size:11px; color:#667088; letter-spacing:0.4px; }
  .totales { margin-top:18px; text-align:right; font-size:15px; }
  .totales span { display:block; margin-bottom:4px; }
  .factura-total-final { font-size:19px; font-weight:800; }
</style>
</head>
<body>
  <div class="factura-header">
    <div class="factura-marca">
      ${logoImgTag}
      <div class="factura-marca-texto">
        <strong>Platense Fit Suplementos</strong>
        <span>Calle 14 e/ 57 y 58 N° 1242, La Plata</span>
      </div>
    </div>
    <div class="factura-doc-info">
      <h2>${escapeHtml(titulo)}</h2>
      <span>N° ${escapeHtml(numero)}</span>
      <span>Fecha: ${escapeHtml(fecha)}</span>
    </div>
  </div>
  <div class="factura-datos-cliente">${datosClienteHtml}</div>
  <table>
    <thead><tr>${theadHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  <div class="totales">${totalesHtml}</div>
</body>
</html>`;
}

document.getElementById("factura-guardar-btn").addEventListener("click", async () => {
  const btn = document.getElementById("factura-guardar-btn");
  btn.disabled = true;
  try {
    const html = await construirHtmlFactura();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    const titulo = document.getElementById("factura-titulo").textContent.toLowerCase();
    const cliente = facturaDatosClienteActual ? facturaDatosClienteActual.nombre : "cliente";
    const fecha = pedidoFechaHora ? pedidoFechaHora.fecha : "sin-fecha";
    const sufijoVista = facturaVistaModo === "cliente" ? "cliente" : "completa";
    const nombreArchivo = `${titulo}_${sufijoVista}_${cliente}_${fecha}`.replace(/[^a-zA-Z0-9-_]+/g, "_") + ".html";

    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Pedidos mayoristas recientes ----------

// Agrupa las unidades de un pedido por producto, igual que en el armado del pedido,
// para que el desglose muestre "x6 Producto" en vez de repetir la fila por cada unidad.
function agruparProductosReciente(items) {
  const mapa = new Map();
  items.forEach(it => {
    const key = normalizeNombre(it.producto);
    if (!mapa.has(key)) mapa.set(key, { producto: it.producto, cantidad: 0, items: [] });
    const grupo = mapa.get(key);
    grupo.cantidad += 1;
    grupo.items.push(it);
  });
  return [...mapa.values()].sort((a, b) => a.producto.localeCompare(b.producto, "es"));
}

let recienteExpandidoId = null;

function renderDetalleReciente(ventaId, row, items, costoPorProducto) {
  row.classList.add("expanded");
  recienteExpandidoId = ventaId;

  const detailRow = document.createElement("tr");
  detailRow.className = "sale-detail-row";
  const td = document.createElement("td");
  td.colSpan = 5;
  td.innerHTML = agruparProductosReciente(items).map(g => {
    const key = normalizeNombre(g.producto);
    const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorProducto, key);
    const costoUnit = tieneCosto ? costoPorProducto[key] : null;
    const precioTotal = g.items.reduce((acc, it) => acc + it.precio, 0);
    const precioVentaUnit = precioTotal / g.cantidad;
    const costoTotal = tieneCosto ? costoUnit * g.cantidad : null;
    const ganancia = tieneCosto ? precioTotal - costoTotal : null;
    const etiqueta = g.cantidad > 1 ? `x${g.cantidad} ${g.producto}` : g.producto;
    const costoUnitTag = tieneCosto ? ` <span class="hint" style="margin:0;">(costo c/u: ${money(costoUnit)})</span>` : "";
    return `
      <div class="lote-detail-item" style="grid-template-columns: 2fr 1fr 1fr 1fr 1fr;">
        <span>${escapeHtml(etiqueta)}${costoUnitTag}</span>
        <span>${money(precioVentaUnit)} c/u</span>
        <span>${money(precioTotal)}</span>
        <span>${tieneCosto ? money(costoTotal) : "—"}</span>
        <span style="${ganancia !== null && ganancia < 0 ? 'color:var(--red);' : ''}">${ganancia !== null ? money(ganancia) : "—"}</span>
      </div>
    `;
  }).join("");
  detailRow.appendChild(td);
  row.after(detailRow);
}

function toggleDetalleReciente(ventaId, row, items, costoPorProducto) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("sale-detail-row")) {
    existing.remove();
    row.classList.remove("expanded");
    recienteExpandidoId = null;
    return;
  }

  const tbody = document.getElementById("recientes-body");
  tbody.querySelectorAll(".sale-detail-row").forEach(r => r.remove());
  tbody.querySelectorAll(".sale-row.expanded").forEach(r => r.classList.remove("expanded"));

  renderDetalleReciente(ventaId, row, items, costoPorProducto);
}

async function cargarRecientes() {
  const body = document.getElementById("recientes-body");
  let data, costos;
  try {
    [data, costos] = await Promise.all([api("/api/reportes"), api("/api/costos")]);
  } catch (err) {
    console.error(err);
    return;
  }

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  const ventasMayoristas = data.ventas
    .filter(v => v.metodo === "mayorista")
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .slice(0, 30);

  if (ventasMayoristas.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no hay pedidos mayoristas guardados.</td></tr>`;
    return;
  }

  const itemsPorVenta = new Map();
  data.items.forEach(it => {
    if (!itemsPorVenta.has(it.ventaId)) itemsPorVenta.set(it.ventaId, []);
    itemsPorVenta.get(it.ventaId).push(it);
  });

  body.innerHTML = "";
  ventasMayoristas.forEach(v => {
    const items = itemsPorVenta.get(v.id) || [{ producto: v.producto, precio: v.precio }];
    const tr = document.createElement("tr");
    tr.className = "sale-row";
    tr.innerHTML = `
      <td>${formatFechaCorta(v.fecha)}</td>
      <td>${v.cliente ? escapeHtml(v.cliente) : "—"}</td>
      <td><span class="expand-caret">▸</span>${items.length} unidad${items.length === 1 ? "" : "es"}</td>
      <td>${money(v.precio)}</td>
      <td><button type="button" class="del-btn editar-btn" title="Editar pedido">✎</button><button type="button" class="del-btn" title="Borrar pedido">✕</button></td>
    `;
    tr.addEventListener("click", () => toggleDetalleReciente(v.id, tr, items, costoPorProducto));
    tr.querySelector(".editar-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      iniciarEdicionPedido(v, items, costoPorProducto);
    });
    tr.querySelector(".del-btn:not(.editar-btn)").addEventListener("click", (e) => {
      e.stopPropagation();
      borrarPedidoMayorista(v.id);
    });
    body.appendChild(tr);

    if (recienteExpandidoId === v.id) {
      renderDetalleReciente(v.id, tr, items, costoPorProducto);
    }
  });
}

async function borrarPedidoMayorista(ventaId) {
  if (!confirm("¿Borrar este pedido mayorista? Esto revierte el stock que había descontado.")) return;
  try {
    await api("/api/ventas/" + encodeURIComponent(ventaId), { method: "DELETE" });
    await cargarRecientes();
  } catch (err) {
    alert("No se pudo borrar el pedido.\n" + err.message);
  }
}

checkAuth();
