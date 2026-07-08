const TIMEZONE = "America/Argentina/Buenos_Aires";

const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cuentadni: "Cuenta DNI",
  mayorista: "Mayorista",
};

function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ---------- Reloj en vivo (solo visual, la hora oficial la pone el servidor) ----------

function formatArgentinaClock() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(now);
  const date = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long",
  }).format(now);
  return { time, date };
}

function tickClock() {
  const { time, date } = formatArgentinaClock();
  document.getElementById("clock-time").textContent = time;
  document.getElementById("clock-date").textContent = date;
}
setInterval(tickClock, 1000);
tickClock();

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

async function fetchTodaySales() {
  return api("/api/ventas");
}

async function fetchSalesForDate(fecha) {
  return api("/api/ventas?fecha=" + encodeURIComponent(fecha));
}

function getHoyFechaArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

function formatFechaLarga(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
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
cargarProductos();
setInterval(cargarProductos, 30000);

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

let metodoSeleccionado = null;
const payButtons = document.querySelectorAll(".pay-btn");
payButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    payButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    metodoSeleccionado = btn.dataset.metodo;
  });
});

// ---------- Carrito de productos (una venta puede tener varios) ----------

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

// ---------- Alta de venta ----------

const form = document.getElementById("sale-form");
const submitBtn = form.querySelector(".submit-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Si quedó cargado un producto en los campos sin apretar "Agregar", se suma solo
  agregarItemDesdeInputs();

  if (carrito.length === 0) {
    alert("Cargá al menos un producto.");
    return;
  }
  if (!metodoSeleccionado) {
    alert("Elegí un método de pago.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Registrando...";

  try {
    const itemsAEnviar = carrito.flatMap(it =>
      Array.from({ length: it.cantidad }, () => ({ producto: it.producto, precio: it.precioUnitario }))
    );

    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsAEnviar, metodo: metodoSeleccionado }),
    });

    carrito = [];
    renderCart();
    form.reset();
    payButtons.forEach(b => b.classList.remove("active"));
    metodoSeleccionado = null;
    document.getElementById("producto").focus();

    // Si estaba viendo el historial de otro día, la venta nueva se cargó hoy: volvemos a hoy para verla.
    fechaSeleccionada = null;
    if (fechaInput) fechaInput.value = getHoyFechaArgentina();

    await refresh();
  } catch (err) {
    alert("No se pudo registrar la venta.\n" + err.message + "\n\nRevisá que el servidor esté encendido y que estés conectado al WiFi del local.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Registrar venta";
  }
});

// ---------- Ver el historial de otro día ----------

let fechaSeleccionada = null; // null = sigue mostrando "hoy" automáticamente
const fechaInput = document.getElementById("historial-fecha-input");
const hoyBtn = document.getElementById("historial-hoy-btn");

fechaInput.addEventListener("change", () => {
  if (!fechaInput.value) return;
  fechaSeleccionada = fechaInput.value;
  refresh();
});

hoyBtn.addEventListener("click", () => {
  fechaSeleccionada = null;
  fechaInput.value = getHoyFechaArgentina();
  refresh();
});

// ---------- Borrar una venta / vaciar historial ----------

async function deleteSale(id) {
  try {
    await api("/api/ventas/" + encodeURIComponent(id), { method: "DELETE" });
    await refresh();
  } catch (err) {
    alert("No se pudo eliminar la venta.\n" + err.message);
  }
}

document.getElementById("clear-day").addEventListener("click", async () => {
  const hoyFecha = getHoyFechaArgentina();
  const fechaActiva = fechaSeleccionada || hoyFecha;
  const mensaje = fechaActiva === hoyFecha
    ? "¿Vaciar todas las ventas registradas hoy? Esta acción no se puede deshacer."
    : `¿Vaciar todas las ventas del ${formatFechaLarga(fechaActiva)}? Esta acción no se puede deshacer.`;
  if (!confirm(mensaje)) return;
  try {
    await api("/api/ventas?fecha=" + encodeURIComponent(fechaActiva), { method: "DELETE" });
    await refresh();
  } catch (err) {
    alert("No se pudo vaciar el historial.\n" + err.message);
  }
});

// ---------- Render de métricas (siempre de hoy) ----------

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

  // Totales por método de pago
  const totalsByMethod = { efectivo: 0, transferencia: 0, debito: 0, credito: 0, cuentadni: 0, mayorista: 0 };
  sales.forEach(s => { totalsByMethod[s.metodo] = (totalsByMethod[s.metodo] || 0) + s.precio; });
  document.getElementById("total-efectivo").textContent = money(totalsByMethod.efectivo);
  document.getElementById("total-transferencia").textContent = money(totalsByMethod.transferencia);
  document.getElementById("total-debito").textContent = money(totalsByMethod.debito);
  document.getElementById("total-credito").textContent = money(totalsByMethod.credito);
  document.getElementById("total-cuentadni").textContent = money(totalsByMethod.cuentadni);
  document.getElementById("total-mayorista").textContent = money(totalsByMethod.mayorista);

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

// ---------- Render del historial (de hoy o del día elegido) ----------

function renderHistory(sales, fecha, hoyFecha) {
  const esHoy = fecha === hoyFecha;
  document.getElementById("historial-fecha-label").textContent = esHoy ? "hoy" : formatFechaLarga(fecha);
  hoyBtn.style.display = esHoy ? "none" : "inline-block";

  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";

  if (sales.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${esHoy ? "Todavía no cargaste ninguna venta hoy." : "No hay ventas registradas ese día."}</td></tr>`;
    return;
  }

  [...sales].reverse().forEach(s => {
    const tr = document.createElement("tr");
    tr.className = "sale-row";
    tr.innerHTML = `
      <td>${s.horaLabel}</td>
      <td><span class="expand-caret">▸</span>${escapeHtml(s.producto)}</td>
      <td>${money(s.precio)}</td>
      <td><span class="pm-tag ${s.metodo}">${PAYMENT_LABELS[s.metodo] || s.metodo}</span></td>
      <td><button class="del-btn" title="Eliminar" data-id="${s.id}">✕</button></td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".del-btn")) return;
      toggleSaleDetail(s.id, tr);
    });
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteSale(btn.dataset.id));
  });
}

// ---------- Combina metricas + historial en cada actualización ----------

async function refresh() {
  const hoyFecha = getHoyFechaArgentina();
  const fechaActiva = fechaSeleccionada || hoyFecha;
  fechaInput.max = hoyFecha;
  if (!fechaInput.value) fechaInput.value = hoyFecha;

  let todaySales, historySales;
  try {
    if (fechaActiva === hoyFecha) {
      todaySales = await fetchTodaySales();
      historySales = todaySales;
    } else {
      [todaySales, historySales] = await Promise.all([fetchTodaySales(), fetchSalesForDate(fechaActiva)]);
    }
  } catch (err) {
    console.error("No se pudo cargar el estado del servidor:", err);
    return;
  }

  renderMetrics(todaySales);
  renderHistory(historySales, fechaActiva, hoyFecha);
}

// ---------- Desglose por producto de una venta ----------

const itemsCache = new Map();

async function toggleSaleDetail(ventaId, row) {
  const tbody = document.getElementById("history-body");
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("sale-detail-row")) {
    existing.remove();
    row.classList.remove("expanded");
    return;
  }

  tbody.querySelectorAll(".sale-detail-row").forEach(r => r.remove());
  tbody.querySelectorAll(".sale-row.expanded").forEach(r => r.classList.remove("expanded"));
  row.classList.add("expanded");

  const detailRow = document.createElement("tr");
  detailRow.className = "sale-detail-row";
  const td = document.createElement("td");
  td.colSpan = 5;
  td.innerHTML = `<div class="sale-detail-loading">Cargando...</div>`;
  detailRow.appendChild(td);
  row.after(detailRow);

  try {
    let items = itemsCache.get(ventaId);
    if (!items) {
      items = await api("/api/ventas/" + encodeURIComponent(ventaId) + "/items");
      itemsCache.set(ventaId, items);
    }
    td.innerHTML = items.map(it => `
      <div class="sale-detail-item">
        <span>${escapeHtml(it.producto)}</span>
        <span>${money(it.precio)}</span>
      </div>
    `).join("");
  } catch (err) {
    td.innerHTML = `<div class="sale-detail-loading">No se pudo cargar el detalle.</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

refresh();

// Se refresca solo, para que las métricas se actualicen aunque carguen ventas desde otro dispositivo
setInterval(refresh, 5000);
