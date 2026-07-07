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
  return "$" + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

// ---------- Alta de venta ----------

const form = document.getElementById("sale-form");
const submitBtn = form.querySelector(".submit-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const producto = document.getElementById("producto").value.trim();
  const precio = parseFloat(document.getElementById("precio").value);

  if (!producto) return;
  if (isNaN(precio) || precio <= 0) return;
  if (!metodoSeleccionado) {
    alert("Elegí un método de pago.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Registrando...";

  try {
    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto, precio, metodo: metodoSeleccionado }),
    });

    form.reset();
    payButtons.forEach(b => b.classList.remove("active"));
    metodoSeleccionado = null;
    document.getElementById("producto").focus();

    await render();
  } catch (err) {
    alert("No se pudo registrar la venta.\n" + err.message + "\n\nRevisá que el servidor esté encendido y que estés conectado al WiFi del local.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Registrar venta";
  }
});

// ---------- Borrar una venta / vaciar historial ----------

async function deleteSale(id) {
  try {
    await api("/api/ventas/" + encodeURIComponent(id), { method: "DELETE" });
    await render();
  } catch (err) {
    alert("No se pudo eliminar la venta.\n" + err.message);
  }
}

document.getElementById("clear-day").addEventListener("click", async () => {
  if (!confirm("¿Vaciar todas las ventas registradas hoy? Esta acción no se puede deshacer.")) return;
  try {
    await api("/api/ventas", { method: "DELETE" });
    await render();
  } catch (err) {
    alert("No se pudo vaciar el historial.\n" + err.message);
  }
});

// ---------- Render de métricas e historial ----------

async function render() {
  let sales;
  try {
    sales = await fetchTodaySales();
  } catch (err) {
    console.error("No se pudo cargar el estado del servidor:", err);
    return;
  }

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

  // Historial de ventas de hoy (más reciente primero)
  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";

  if (sales.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no cargaste ninguna venta hoy.</td></tr>`;
    return;
  }

  [...sales].reverse().forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.horaLabel}</td>
      <td>${escapeHtml(s.producto)}</td>
      <td>${money(s.precio)}</td>
      <td><span class="pm-tag ${s.metodo}">${PAYMENT_LABELS[s.metodo] || s.metodo}</span></td>
      <td><button class="del-btn" title="Eliminar" data-id="${s.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteSale(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

render();

// Se refresca solo, para que las métricas se actualicen aunque carguen ventas desde otro dispositivo
setInterval(render, 5000);
