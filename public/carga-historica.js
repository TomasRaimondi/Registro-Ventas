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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
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

  const fechaInput = document.getElementById("fecha-venta");
  if (!fechaInput.value) {
    const now = new Date();
    fechaInput.value = now.toISOString().slice(0, 10);
  }
  cargarProductos();
  renderHistorial();
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

let metodoSeleccionado = null;
const payButtons = document.querySelectorAll(".pay-btn");
payButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    payButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    metodoSeleccionado = btn.dataset.metodo;
  });
});

// ---------- Carrito ----------

let carrito = [];
const cartList = document.getElementById("cart-list");

function renderCart() {
  cartList.innerHTML = "";
  carrito.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <div class="cart-item-info">
        <span class="cart-item-nombre">${escapeHtml(item.producto)}</span>
        <span class="cart-item-precio">${money(item.precio)}</span>
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
    const subtotal = carrito.reduce((acc, it) => acc + it.precio, 0);
    const sub = document.createElement("div");
    sub.className = "cart-subtotal";
    sub.innerHTML = `<span>${carrito.length} producto${carrito.length === 1 ? "" : "s"} en esta venta</span><span>${money(subtotal)}</span>`;
    cartList.appendChild(sub);
  }
}

function agregarItemDesdeInputs() {
  const producto = productoInput.value.trim();
  const precio = parseFloat(document.getElementById("precio").value);
  if (!producto || isNaN(precio) || precio <= 0) return false;

  carrito.push({ producto, precio });
  productoInput.value = "";
  document.getElementById("precio").value = "";
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

  submitBtn.disabled = true;
  submitBtn.textContent = "Registrando...";

  try {
    await api("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: carrito, metodo: metodoSeleccionado, fecha }),
    });

    carrito = [];
    renderCart();
    payButtons.forEach(b => b.classList.remove("active"));
    metodoSeleccionado = null;
    productoInput.focus();

    await renderHistorial();
  } catch (err) {
    alert("No se pudo registrar la venta.\n" + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Registrar venta pasada";
  }
});

document.getElementById("fecha-venta").addEventListener("change", renderHistorial);

// ---------- Historial de la fecha elegida ----------

async function deleteSale(id) {
  try {
    await api("/api/ventas/" + encodeURIComponent(id), { method: "DELETE" });
    await renderHistorial();
  } catch (err) {
    alert("No se pudo eliminar la venta.\n" + err.message);
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
      <td><span class="pm-tag ${s.metodo}">${PAYMENT_LABELS[s.metodo] || s.metodo}</span></td>
      <td><button class="del-btn" title="Eliminar" data-id="${s.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteSale(btn.dataset.id));
  });
}

checkAuth();
