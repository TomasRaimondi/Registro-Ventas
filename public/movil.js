const TIMEZONE = "America/Argentina/Buenos_Aires";

const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cuentadni: "Cuenta DNI",
  mayorista: "Mayorista",
  web: "Web",
};
const METHODS_ORDEN = ["efectivo", "transferencia", "debito", "credito", "cuentadni", "web", "mayorista"];

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

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function getHoyFechaArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

// ---------- Reloj / fecha ----------

let fechaSubtitulo = "";
function tickClock() {
  const now = new Date();
  fechaSubtitulo = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long",
  }).format(now).replace(",", "");
}
tickClock();
setInterval(tickClock, 60000);

// ---------- Cliente de API ----------

async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error de red (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Panel lateral ----------

const openNav = () => { document.body.classList.add("nav-open"); buzz(8); };
const closeNav = () => document.body.classList.remove("nav-open");
document.getElementById("open").onclick = () =>
  document.body.classList.contains("nav-open") ? closeNav() : openNav();
document.getElementById("scrim").onclick = closeNav;

document.getElementById("navDesktop").onclick = () => {
  try { sessionStorage.setItem("forzar-desktop", "1"); } catch (e) {}
  location.href = "/";
};

let swipeX = null, swipeY = null;
addEventListener("touchstart", (e) => { swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; }, { passive: true });
addEventListener("touchend", (e) => {
  if (swipeX === null) return;
  const dx = e.changedTouches[0].clientX - swipeX;
  const dy = Math.abs(e.changedTouches[0].clientY - swipeY);
  if (dy < 60) {
    if (swipeX < 26 && dx > 55) openNav();
    if (document.body.classList.contains("nav-open") && dx < -55) closeNav();
  }
  swipeX = null;
}, { passive: true });

// ---------- Toast ----------

let toastTimer;
function toast(txt, ok) {
  const t = document.getElementById("toast");
  document.getElementById("toastIcon").textContent = ok === false ? "!" : "✓";
  document.getElementById("toastText").textContent = txt;
  t.classList.toggle("bad", ok === false);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- Cantidad ----------

const qtyInput = document.getElementById("qty");
const setQty = (n) => { qtyInput.value = Math.max(1, n); buzz(6); };
document.getElementById("plus").onclick = () => setQty(+qtyInput.value + 1);
document.getElementById("minus").onclick = () => setQty(+qtyInput.value - 1);

// ---------- Autocompletado de producto ----------

let listaProductos = [];
async function cargarProductos() {
  try { listaProductos = await api("/api/productos"); } catch (e) {}
}
cargarProductos();
setInterval(cargarProductos, 30000);

const prod = document.getElementById("prod");
const prodSuggestions = document.getElementById("prodSuggestions");

function renderSuggestions(matches) {
  if (!matches.length) {
    prodSuggestions.innerHTML = "";
    prodSuggestions.classList.remove("open");
    return;
  }
  prodSuggestions.innerHTML = matches.map((p) => `<div class="suggestion-item">${escapeHtml(p)}</div>`).join("");
  prodSuggestions.classList.add("open");
}

function buscarSugerencias() {
  const q = prod.value.trim().toLowerCase();
  if (!q) { renderSuggestions([]); return; }
  renderSuggestions(listaProductos.filter((p) => p.toLowerCase().includes(q)).slice(0, 6));
}

prod.addEventListener("input", buscarSugerencias);
prod.addEventListener("focus", buscarSugerencias);
prod.addEventListener("blur", () => setTimeout(() => renderSuggestions([]), 150));
prodSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  prod.value = item.textContent;
  renderSuggestions([]);
});

// ---------- Precio / costo de envío con formato de moneda mientras se escribe ----------

const price = document.getElementById("price");
price.addEventListener("input", () => {
  const raw = price.value.replace(/\D/g, "");
  price.value = raw ? money(+raw) : "";
});

const envioCostoInput = document.getElementById("envioCosto");
envioCostoInput.addEventListener("input", () => {
  const raw = envioCostoInput.value.replace(/\D/g, "");
  envioCostoInput.value = raw ? money(+raw) : "";
});

// ---------- Carrito de productos (una venta puede tener varios) ----------

let carrito = [];
const cartList = document.getElementById("cartList");

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
    div.querySelector(".cart-item-remove").onclick = () => { carrito.splice(idx, 1); renderCart(); buzz(8); };
    cartList.appendChild(div);
  });

  if (carrito.length > 0) {
    const totalUnidades = carrito.reduce((acc, it) => acc + it.cantidad, 0);
    const subtotal = carrito.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);
    const sub = document.createElement("div");
    sub.className = "cart-subtotal";
    sub.innerHTML = `<span>${totalUnidades} unidad${totalUnidades === 1 ? "" : "es"}</span><span>${money(subtotal)}</span>`;
    cartList.appendChild(sub);
  }
}

function agregarItemDesdeInputs() {
  const producto = prod.value.trim();
  const precio = parseFloat(price.value.replace(/\D/g, ""));
  const cantidadInput = parseInt(qtyInput.value, 10);
  const cantidad = Number.isInteger(cantidadInput) && cantidadInput > 0 ? cantidadInput : 1;

  if (!producto || isNaN(precio) || precio <= 0) return false;

  carrito.push({ producto, precioUnitario: precio, cantidad });
  prod.value = "";
  price.value = "";
  qtyInput.value = "1";
  renderSuggestions([]);
  renderCart();
  return true;
}

document.getElementById("addMore").onclick = () => {
  if (!agregarItemDesdeInputs()) { toast("Completá el producto y el precio", false); return; }
  buzz(8);
  prod.focus();
};

// ---------- Método de pago ----------

let metodoSeleccionado = null;
document.querySelectorAll(".pay").forEach((btn) => {
  btn.onclick = () => {
    const on = btn.getAttribute("aria-pressed") === "true";
    document.querySelectorAll(".pay").forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", on ? "false" : "true");
    metodoSeleccionado = on ? null : btn.dataset.m;
    buzz(10);
  };
});

// ---------- Envío por Uber Moto ----------

const uberBtn = document.getElementById("uber");
const envioCostoRow = document.getElementById("envioCostoRow");
let envioActivo = false;

uberBtn.onclick = () => {
  envioActivo = !envioActivo;
  uberBtn.setAttribute("aria-pressed", envioActivo);
  envioCostoRow.style.display = envioActivo ? "block" : "none";
  if (envioActivo) { envioCostoInput.focus(); } else { envioCostoInput.value = ""; }
  buzz(envioActivo ? 14 : 6);
};

function resetearEnvio() {
  envioActivo = false;
  uberBtn.setAttribute("aria-pressed", "false");
  envioCostoRow.style.display = "none";
  envioCostoInput.value = "";
}

// ---------- Venta perdida ----------

const vpScrim = document.getElementById("vpScrim");
const vpModal = document.getElementById("vpModal");
const vpTexto = document.getElementById("vpTexto");
const vpError = document.getElementById("vpError");

async function cargarContadorPerdidas() {
  try {
    const rows = await api("/api/ventas-perdidas");
    document.getElementById("lostCount").textContent = rows.length;
    document.getElementById("badgePerdidas").textContent = rows.length;
  } catch (e) {}
}
cargarContadorPerdidas();

function abrirVp() {
  vpTexto.value = "";
  vpError.style.display = "none";
  document.querySelectorAll(".vp-q").forEach((b) => { b.disabled = false; b.textContent = b.dataset.motivo; });
  vpScrim.style.display = "block";
  vpModal.style.display = "block";
  buzz(8);
}
function cerrarVp() {
  vpScrim.style.display = "none";
  vpModal.style.display = "none";
}
document.getElementById("lostBtn").onclick = abrirVp;
document.getElementById("vpClose").onclick = cerrarVp;
vpScrim.onclick = cerrarVp;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarVp(); });

async function guardarVp(motivo, boton) {
  try {
    await api("/api/ventas-perdidas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    cerrarVp();
    await cargarContadorPerdidas();
    buzz(22);
    toast("Venta perdida registrada");
  } catch (err) {
    if (boton) { boton.disabled = false; boton.textContent = boton.dataset.motivo; }
    vpError.textContent = err.message || "No se pudo guardar.";
    vpError.style.display = "block";
  }
}

document.querySelectorAll(".vp-q").forEach((btn) => {
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = "Guardando...";
    guardarVp(btn.dataset.motivo, btn);
  };
});

document.getElementById("vpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const motivo = vpTexto.value.trim();
  if (!motivo) {
    vpError.textContent = "Escribí algo, aunque sea corto.";
    vpError.style.display = "block";
    return;
  }
  guardarVp(motivo, null);
});

// ---------- Pagos recientes (transferencias) ----------

const pagosFeed = document.getElementById("pagosFeed");
const pagosEmpty = document.getElementById("pagosEmpty");
const pagosUsados = new Set();
let pagosConocidos = null;

function formatMonedaCorta(n) {
  return "$" + Math.round(n || 0).toLocaleString("es-AR");
}

async function cargarPagosRecientes() {
  try {
    const { pagos } = await api("/api/pagos-recientes");
    const idsNuevos = pagosConocidos ? pagos.filter((p) => !pagosConocidos.has(p.id)).map((p) => p.id) : [];
    pagosConocidos = new Set(pagos.map((p) => p.id));

    pagosEmpty.style.display = pagos.length ? "none" : "block";
    pagosFeed.innerHTML = "";
    pagos.forEach((p) => pagosFeed.appendChild(filaPagoReciente(p, idsNuevos.includes(p.id))));
  } catch (e) {}
}

function filaPagoReciente(p, esNuevo) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pago-item" + (pagosUsados.has(p.id) ? " usado" : "") + (esNuevo ? " nuevo" : "");
  const origen = p.origen === "mercadopago" ? "Mercado Pago" : "Cuenta DNI";
  btn.innerHTML = `
    <span class="pago-info">
      <span class="monto">${formatMonedaCorta(p.monto)}</span>
      <span class="quien">${escapeHtml(p.pagador || origen)}</span>
    </span>
    <span class="hora">${escapeHtml((p.horaLabel || "").slice(0, 5))}</span>
  `;
  btn.onclick = () => {
    price.value = money(p.monto);
    prod.focus();
    pagosUsados.add(p.id);
    btn.classList.add("usado");
    buzz(10);
  };
  return btn;
}

document.getElementById("pagosActualizar").onclick = async () => {
  const btn = document.getElementById("pagosActualizar");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Buscando...";
  try {
    await api("/api/pagos/sincronizar", { method: "POST" });
    await cargarPagosRecientes();
  } catch (e) {
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
};

cargarPagosRecientes();
setInterval(() => { if (!document.hidden) cargarPagosRecientes(); }, 15000);

// ---------- Registrar venta ----------

const saveBtn = document.getElementById("save");

saveBtn.onclick = async () => {
  agregarItemDesdeInputs();

  if (carrito.length === 0) { buzz([40, 60, 40]); toast("Cargá al menos un producto", false); return; }
  if (!metodoSeleccionado) { buzz([40, 60, 40]); toast("Elegí el método de pago", false); return; }

  const envioCosto = envioActivo ? parseFloat(envioCostoInput.value.replace(/\D/g, "")) : null;
  if (envioActivo && (!Number.isFinite(envioCosto) || envioCosto <= 0)) {
    buzz([40, 60, 40]); toast("Ingresá el costo del envío", false); return;
  }

  saveBtn.disabled = true;
  const originalTxt = saveBtn.textContent;
  saveBtn.textContent = "Registrando...";

  try {
    const itemsAEnviar = carrito.flatMap((it) =>
      Array.from({ length: it.cantidad }, () => ({ producto: it.producto, precio: it.precioUnitario }))
    );

    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: itemsAEnviar,
        metodo: metodoSeleccionado,
        envioMetodo: envioActivo ? "uber_moto" : null,
        envioCosto,
      }),
    });

    carrito = [];
    renderCart();
    document.querySelectorAll(".pay").forEach((b) => b.setAttribute("aria-pressed", "false"));
    metodoSeleccionado = null;
    resetearEnvio();

    buzz([16, 40, 26]);
    saveBtn.classList.add("done");
    saveBtn.textContent = "✓ Registrada";
    document.getElementById("pill").classList.add("bump");
    toast("Venta registrada");
    setTimeout(() => {
      saveBtn.classList.remove("done");
      saveBtn.textContent = originalTxt;
      document.getElementById("pill").classList.remove("bump");
    }, 1100);

    prod.focus();
    await refresh();
  } catch (err) {
    buzz([40, 60, 40]);
    toast(err.message || "No se pudo registrar la venta", false);
  } finally {
    saveBtn.disabled = false;
    if (!saveBtn.classList.contains("done")) saveBtn.textContent = originalTxt;
  }
};

// ---------- Borrar una venta ----------

async function eliminarVenta(id) {
  try {
    await api("/api/ventas/" + encodeURIComponent(id), { method: "DELETE" });
    await refresh();
  } catch (err) {
    toast("No se pudo eliminar: " + err.message, false);
  }
}

// ---------- Métricas + feed (siempre de hoy) ----------

function countTo(el, from, to) {
  const t0 = performance.now(), dur = 550;
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}

function render(sales, prevTotal) {
  const sinMayorista = sales.filter((s) => s.metodo !== "mayorista");
  const total = sinMayorista.reduce((acc, s) => acc + s.precio, 0);
  const mayo = sales.filter((s) => s.metodo === "mayorista").reduce((acc, s) => acc + s.precio, 0);
  const envios = sales.filter((s) => s.envioMetodo === "uber_moto");

  countTo(document.getElementById("total"), prevTotal ?? total, total);
  document.getElementById("pillTotal").textContent = money(total);
  document.getElementById("pillCount").textContent =
    sinMayorista.length + (sinMayorista.length === 1 ? " venta hoy" : " ventas hoy");
  document.getElementById("count").textContent =
    (sinMayorista.length === 1 ? "1 venta · " : `${sinMayorista.length} ventas · `) + fechaSubtitulo;
  document.getElementById("mayo").textContent = money(mayo);
  document.getElementById("ubers").textContent = envios.length;

  const totals = {};
  sales.forEach((s) => { totals[s.metodo] = (totals[s.metodo] || 0) + s.precio; });
  document.getElementById("methods").innerHTML = METHODS_ORDEN.map((m) => {
    const v = totals[m] || 0;
    return `<div class="m ${v ? "" : "zero"}"><span>${PAYMENT_LABELS[m]}</span><b>${money(v)}</b></div>`;
  }).join("");

  document.getElementById("empty").style.display = sales.length ? "none" : "block";
  document.getElementById("feed").innerHTML = sales.slice().reverse().slice(0, 8).map((s) => `
    <li>
      <span class="t">${(s.horaLabel || "").slice(0, 5)}</span>
      <span class="n">${escapeHtml(s.producto)}${s.envioMetodo === "uber_moto" ? " 🛵" : ""}</span>
      <span class="v">${money(s.precio)}</span>
      <button type="button" class="feed-del" data-id="${s.id}">✕</button>
    </li>
  `).join("");
  document.querySelectorAll(".feed-del").forEach((b) => { b.onclick = () => eliminarVenta(b.dataset.id); });
}

let totalPrevio = 0;
async function refresh() {
  try {
    const sales = await api("/api/ventas");
    render(sales, totalPrevio);
    totalPrevio = sales.filter((s) => s.metodo !== "mayorista").reduce((acc, s) => acc + s.precio, 0);
  } catch (err) {
    console.error("No se pudo cargar el estado del servidor:", err);
  }
}

refresh();
setInterval(refresh, 5000);
