const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cuentadni: "Cuenta DNI",
  mayorista: "Mayorista",
  web: "Web",
};

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

  const fechaInput = document.getElementById("fecha-venta");
  if (!fechaInput.value) {
    const now = new Date();
    fechaInput.value = now.toISOString().slice(0, 10);
  }
  cargarProductos();
  renderHistorial();
  renderGastos();
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

// ---------- Autocompletado de producto ----------

let listaProductos = [];

async function cargarProductos() {
  try {
    listaProductos = await api("/api/productos");
  } catch (e) {
    console.error("No se pudo cargar la lista de productos:", e);
  }
}

const productoInput = document.getElementById("producto");
const productoSuggestions = document.getElementById("producto-suggestions");

function renderSuggestions(matches) {
  if (!matches.length) {
    productoSuggestions.innerHTML = "";
    productoSuggestions.classList.remove("open");
    return;
  }
  productoSuggestions.innerHTML = matches
    .map(p => `<div class="suggestion-item">${escapeHtml(p)}</div>`)
    .join("");
  productoSuggestions.classList.add("open");
}

function buscarSugerencias() {
  const q = productoInput.value.trim().toLowerCase();
  if (!q) { renderSuggestions([]); return; }
  const matches = listaProductos.filter(p => p.toLowerCase().includes(q)).slice(0, 6);
  renderSuggestions(matches);
}

productoInput.addEventListener("input", buscarSugerencias);
productoInput.addEventListener("focus", buscarSugerencias);
productoInput.addEventListener("blur", () => {
  setTimeout(() => renderSuggestions([]), 150);
});
productoSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  productoInput.value = item.textContent;
  renderSuggestions([]);
});

// ---------- Selección de método de pago ----------

const webCalcWrap = document.getElementById("web-calc-wrap");

let metodoSeleccionado = null;
const payButtons = document.querySelectorAll(".pay-btn");
payButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    payButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    metodoSeleccionado = btn.dataset.metodo;

    const esWeb = metodoSeleccionado === "web";
    webCalcWrap.style.display = esWeb ? "block" : "none";
    if (!esWeb) resetWebCalc();
  });
});

// ---------- Venta Web: total de la orden en Tiendanube ----------
// Los productos se cargan como cualquier venta (uno por uno, con su precio real),
// y acá se anota el Total y el Envío que muestra la orden en Tiendanube. Si no se
// pagó con Pago Nube (ej: efectivo, "Pagos Personalizados"), Tiendanube cobra 1%
// de comisión sobre ese Total aparte, a fin de mes — por eso se descuenta acá.
// Si se pagó con Pago Nube, ese 1% ya viene bonificado (ahí Pago Nube cobra su
// propia comisión de procesamiento, que ya está reflejada en el Total que se anota).
// Al registrar la venta, el resultado final se reparte proporcionalmente entre
// los productos cargados, según el precio que se les puso a cada uno.

const webTotalInput = document.getElementById("web-total");
const webEnvioInput = document.getElementById("web-envio");
const webPagoNubeCheckbox = document.getElementById("web-pago-nube");
const webComisionEl = document.getElementById("web-comision");
const webEnvioLineaEl = document.getElementById("web-envio-linea");
const webResultadoEl = document.getElementById("web-resultado");

function calcularNetoWeb() {
  const total = parseFloat(webTotalInput.value) || 0;
  const envio = parseFloat(webEnvioInput.value) || 0;
  const comision = webPagoNubeCheckbox.checked ? 0 : Math.round(total * 0.01 * 100) / 100;
  const resultado = Math.round((total - envio - comision) * 100) / 100;
  return { total, envio, comision, resultado };
}

function actualizarWebCalc() {
  const { comision, envio, resultado } = calcularNetoWeb();
  webComisionEl.textContent = (comision > 0 ? "-" : "") + money(comision);
  webEnvioLineaEl.textContent = (envio > 0 ? "-" : "") + money(envio);
  webResultadoEl.textContent = money(Math.max(resultado, 0));
  webResultadoEl.classList.remove("web-calc-pop");
  void webResultadoEl.offsetWidth;
  webResultadoEl.classList.add("web-calc-pop");
}

function resetWebCalc() {
  webTotalInput.value = "";
  webEnvioInput.value = "";
  webPagoNubeCheckbox.checked = false;
  actualizarWebCalc();
}

webTotalInput.addEventListener("input", actualizarWebCalc);
webEnvioInput.addEventListener("input", actualizarWebCalc);
webPagoNubeCheckbox.addEventListener("change", actualizarWebCalc);

// ---------- Carrito ----------

let carrito = [];
const cartList = document.getElementById("cart-list");

function renderCart() {
  cartList.innerHTML = "";
  carrito.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "cart-item";
    const detalle = item.cantidad > 1
      ? `${money(item.precioUnitario)} c/u × ${item.cantidad} = ${money(item.precioUnitario * item.cantidad)}`
      : money(item.precioUnitario);
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
    });
    cartList.appendChild(div);
  });

  if (carrito.length > 0) {
    const totalUnidades = carrito.reduce((acc, it) => acc + it.cantidad, 0);
    const subtotal = carrito.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);
    const sub = document.createElement("div");
    sub.className = "cart-subtotal";
    sub.innerHTML = `<span>${totalUnidades} unidad${totalUnidades === 1 ? "" : "es"} en esta venta</span><span>${money(subtotal)}</span>`;
    cartList.appendChild(sub);
  }
}

function agregarItemDesdeInputs() {
  const producto = productoInput.value.trim();
  const precio = parseFloat(document.getElementById("precio").value);
  const cantidadInput = parseInt(document.getElementById("cantidad").value, 10);
  const cantidad = Number.isInteger(cantidadInput) && cantidadInput > 0 ? cantidadInput : 1;

  if (!producto || isNaN(precio) || precio <= 0) return false;

  carrito.push({ producto, precioUnitario: precio, cantidad });
  productoInput.value = "";
  document.getElementById("precio").value = "";
  document.getElementById("cantidad").value = "1";
  renderSuggestions([]);
  renderCart();
  return true;
}

document.getElementById("add-item-btn").addEventListener("click", () => {
  const agregado = agregarItemDesdeInputs();
  if (!agregado) {
    alert("Completá el producto y el precio antes de agregarlo.");
    return;
  }
  productoInput.focus();
});

// ---------- Alta de venta pasada ----------

const form = document.getElementById("sale-form");
const submitBtn = form.querySelector(".submit-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  agregarItemDesdeInputs();

  const fecha = document.getElementById("fecha-venta").value;
  if (!fecha) {
    alert("Elegí la fecha de la venta.");
    return;
  }
  if (carrito.length === 0) {
    alert("Cargá al menos un producto.");
    return;
  }
  if (!metodoSeleccionado) {
    alert("Elegí un método de pago.");
    return;
  }

  // Venta web: el Total/Envío de la calculadora representan el pedido completo de
  // Tiendanube. El resultado final se reparte proporcionalmente entre los productos
  // cargados, según el precio que se le puso a cada uno.
  let factorWeb = 1;
  if (metodoSeleccionado === "web") {
    const { total, resultado } = calcularNetoWeb();
    if (!Number.isFinite(total) || total <= 0) {
      alert("Ingresá el Total de la venta web.");
      return;
    }
    const subtotalCrudo = carrito.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);
    if (subtotalCrudo <= 0) {
      alert("Cargá el precio de los productos de esta venta web.");
      return;
    }
    if (resultado <= 0) {
      alert("El valor a registrar dio $0 o menos. Revisá el Total y el Envío.");
      return;
    }
    factorWeb = resultado / subtotalCrudo;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Registrando...";

  try {
    const itemsAEnviar = carrito.flatMap(it =>
      Array.from({ length: it.cantidad }, () => ({
        producto: it.producto,
        precio: metodoSeleccionado === "web" ? Math.round(it.precioUnitario * factorWeb * 100) / 100 : it.precioUnitario,
      }))
    );

    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsAEnviar, metodo: metodoSeleccionado, fecha }),
    });

    carrito = [];
    renderCart();
    payButtons.forEach(b => b.classList.remove("active"));
    metodoSeleccionado = null;
    webCalcWrap.style.display = "none";
    resetWebCalc();
    productoInput.focus();

    await renderHistorial();
  } catch (err) {
    alert("No se pudo registrar la venta.\n" + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Registrar venta pasada";
  }
});

document.getElementById("fecha-venta").addEventListener("change", () => {
  renderHistorial();
  renderGastos();
});

// ---------- Historial de la fecha elegida ----------

async function deleteSale(id) {
  try {
    await api("/api/ventas/" + encodeURIComponent(id), { method: "DELETE" });
    await renderHistorial();
  } catch (err) {
    alert("No se pudo eliminar la venta.\n" + err.message);
  }
}

function renderMetrics(sales) {
  // Total del día y cantidad de ventas (no incluye Mayorista, que tiene su total aparte)
  const ventasSinMayorista = sales.filter(s => s.metodo !== "mayorista");
  const total = ventasSinMayorista.reduce((acc, s) => acc + s.precio, 0);
  document.getElementById("total-dia").textContent = money(total);
  document.getElementById("cant-ventas").textContent =
    ventasSinMayorista.length === 1 ? "1 venta" : `${ventasSinMayorista.length} ventas`;

  // Total exclusivo de ventas registradas como Mayorista
  const ventasMayorista = sales.filter(s => s.metodo === "mayorista");
  const totalMayorista = ventasMayorista.reduce((acc, s) => acc + s.precio, 0);
  document.getElementById("total-dia-mayorista").textContent = money(totalMayorista);
  document.getElementById("cant-ventas-mayorista").textContent =
    ventasMayorista.length === 1 ? "1 venta" : `${ventasMayorista.length} ventas`;

  // Envíos por Uber Moto de la fecha: cuántos salieron y cuánto se gastó en viajes
  const envios = sales.filter(s => s.envioMetodo === "uber_moto");
  const costoEnvios = envios.reduce((acc, s) => acc + (s.envioCosto || 0), 0);
  document.getElementById("cant-envios-hoy").textContent = envios.length;
  document.getElementById("costo-envios-hoy").textContent = `${money(costoEnvios)} en viajes`;

  // Totales por método de pago
  const totalsByMethod = { efectivo: 0, transferencia: 0, debito: 0, credito: 0, cuentadni: 0, mayorista: 0, web: 0 };
  sales.forEach(s => { totalsByMethod[s.metodo] = (totalsByMethod[s.metodo] || 0) + s.precio; });
  document.getElementById("total-efectivo").textContent = money(totalsByMethod.efectivo);
  document.getElementById("total-transferencia").textContent = money(totalsByMethod.transferencia);
  document.getElementById("total-debito").textContent = money(totalsByMethod.debito);
  document.getElementById("total-credito").textContent = money(totalsByMethod.credito);
  document.getElementById("total-cuentadni").textContent = money(totalsByMethod.cuentadni);
  document.getElementById("total-mayorista").textContent = money(totalsByMethod.mayorista);
  document.getElementById("total-web").textContent = money(totalsByMethod.web);

  // Volumen de ventas por hora (0 a 23)
  const byHour = Array(24).fill(0);
  sales.forEach(s => { byHour[s.hora] += s.precio; });

  const maxVal = Math.max(...byHour, 1);
  const chart = document.getElementById("hour-chart");
  chart.innerHTML = "";

  const activeHours = byHour
    .map((v, h) => ({ h, v }))
    .filter(x => x.v > 0)
    .map(x => x.h);

  let startHour = 8, endHour = 22;
  if (activeHours.length) {
    startHour = Math.min(startHour, Math.min(...activeHours));
    endHour = Math.max(endHour, Math.max(...activeHours));
  }

  for (let h = startHour; h <= endHour; h++) {
    const value = byHour[h];
    const heightPct = value > 0 ? Math.max((value / maxVal) * 100, 4) : 2;

    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";

    const valLabel = document.createElement("span");
    valLabel.className = "chart-bar-value";
    valLabel.textContent = value > 0 ? money(value) : "";

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = heightPct + "%";
    bar.title = `${h}:00 - ${money(value)}`;

    const hLabel = document.createElement("span");
    hLabel.className = "chart-bar-label";
    hLabel.textContent = String(h).padStart(2, "0") + "h";

    wrap.appendChild(valLabel);
    wrap.appendChild(bar);
    wrap.appendChild(hLabel);
    chart.appendChild(wrap);
  }
}

async function renderHistorial() {
  const fecha = document.getElementById("fecha-venta").value;
  const tbody = document.getElementById("history-body");
  if (!fecha) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Elegí una fecha para ver sus ventas.</td></tr>`;
    return;
  }

  let sales;
  try {
    sales = await api("/api/ventas?fecha=" + encodeURIComponent(fecha));
  } catch (err) {
    console.error("No se pudo cargar el historial:", err);
    return;
  }

  document.querySelectorAll(".fecha-dinamica").forEach((el) => {
    el.textContent = formatFechaLarga(fecha);
  });
  renderMetrics(sales);

  if (sales.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no hay ventas cargadas para esta fecha.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  [...sales].reverse().forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.horaLabel}</td>
      <td>${escapeHtml(s.producto)}</td>
      <td>${money(s.precio)}</td>
      <td><span class="pm-tag ${s.metodo}">${PAYMENT_LABELS[s.metodo] || s.metodo}</span>${s.envioMetodo === "uber_moto" ? '<span class="uber-tag">🛵 Uber Moto</span>' : ""}</td>
      <td><button class="del-btn" title="Eliminar" data-id="${s.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteSale(btn.dataset.id));
  });
}

// ---------- Gastos de la fecha elegida ----------

document.getElementById("gasto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fecha = document.getElementById("fecha-venta").value;
  const concepto = document.getElementById("gasto-concepto").value.trim();
  const monto = parseFloat(document.getElementById("gasto-monto").value);

  if (!fecha) {
    alert("Elegí la fecha primero.");
    return;
  }
  if (!concepto || isNaN(monto) || monto <= 0) return;

  try {
    await api("/api/gastos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concepto, monto, fecha }),
    });
    e.target.reset();
    await renderGastos();
  } catch (err) {
    alert("No se pudo registrar el gasto.\n" + err.message);
  }
});

async function deleteGasto(id) {
  try {
    await api("/api/gastos/" + encodeURIComponent(id), { method: "DELETE" });
    await renderGastos();
  } catch (err) {
    alert("No se pudo borrar el gasto.\n" + err.message);
  }
}

async function renderGastos() {
  const fecha = document.getElementById("fecha-venta").value;
  const tbody = document.getElementById("gastos-body");
  if (!fecha) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Elegí una fecha para ver sus gastos.</td></tr>`;
    return;
  }

  let gastos;
  try {
    gastos = await api("/api/gastos?fecha=" + encodeURIComponent(fecha));
  } catch (err) {
    console.error("No se pudo cargar los gastos:", err);
    return;
  }

  if (gastos.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Todavía no hay gastos cargados para esta fecha.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  [...gastos].reverse().forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(g.concepto)}</td>
      <td>${money(g.monto)}</td>
      <td><button class="del-btn" title="Eliminar" data-id="${g.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteGasto(btn.dataset.id));
  });
}

checkAuth();
