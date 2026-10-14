// Cargar compra (pantalla completa): la misma carga que "Nuevo ingreso" de Inventario, pero
// en su propia pantalla, como una planilla. Registra con POST /api/compras: suma stock y
// recalcula el costo promedio de cada producto.

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
const $ = (id) => document.getElementById(id);
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
const money = (n) => { const v = Number(n) || 0; return (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: 0 }); };

let productos = [];
let items = [];

// ---------- Sesión (solo el dueño: la compra muestra costos) ----------
function showLogin() {
  $("login-card").style.display = "block"; $("app-content").style.display = "none"; $("logout-btn").style.display = "none";
}
async function checkAuth() {
  try {
    const { authenticated, role } = await api("/api/auth-check");
    if (!authenticated || role !== "owner") { showLogin(); return; }
    $("login-card").style.display = "none"; $("app-content").style.display = "block"; $("logout-btn").style.display = "inline-block";
    await cargarDatos();
  } catch (e) { showLogin(); }
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error"); err.style.display = "none";
  try {
    await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    checkAuth();
  } catch (ex) { err.textContent = ex.message || "Contraseña incorrecta."; err.style.display = "block"; }
});
$("logout-btn").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); showLogin(); });

async function cargarDatos() {
  const [lista, hora, compras] = await Promise.all([
    api("/api/inventario").catch(() => []),
    api("/api/hora").catch(() => null),
    api("/api/compras").catch(() => []),
  ]);
  productos = lista || [];
  if (hora && hora.fecha) { if (!$("cc-fecha").value) $("cc-fecha").value = hora.fecha; $("cc-fecha").max = hora.fecha; }
  else if (!$("cc-fecha").value) $("cc-fecha").value = new Date().toISOString().slice(0, 10);
  // Proveedores ya usados, para elegirlos sin volver a escribirlos.
  const provs = [...new Set((compras || []).map((c) => (c.proveedor || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  $("cc-proveedores").innerHTML = provs.map((p) => `<option value="${escapeHtml(p)}">`).join("");
  // Llegar desde Inventario con un producto puntual (?producto=...).
  const pedido = new URLSearchParams(location.search).get("producto");
  if (pedido && !items.length) { $("cc-producto").value = pedido; prellenarCosto(); $("cc-cantidad").focus(); }
  else $("cc-producto").focus();
  pintar();
}

const existente = (nombre) => {
  const q = String(nombre || "").trim().toLowerCase();
  return productos.find((p) => String(p.nombre || "").toLowerCase() === q) || null;
};

// ---------- Tabla ----------
function filaHtml(it, i) {
  const sinPrecio = !(it.precioUnitario > 0);
  const nuevo = !existente(it.producto);
  return `
    <tr data-i="${i}" class="${sinPrecio ? "cc-sin-precio" : ""}">
      <td class="cc-col-prod">
        <input type="text" class="cc-in-nombre" data-campo="producto" value="${escapeHtml(it.producto)}" aria-label="Producto">
        ${nuevo ? `<div class="cc-chips"><small class="cc-chip-nuevo" title="No está en tu inventario: se crea al registrar">Producto nuevo</small></div>` : ""}
      </td>
      <td class="cc-col-num"><input type="number" min="1" step="1" data-campo="cantidad" value="${it.cantidad}" aria-label="Cantidad"></td>
      <td class="cc-col-num"><input type="number" min="0" step="0.01" data-campo="precioUnitario" value="${it.precioUnitario || ""}" placeholder="Costo" aria-label="Costo por unidad"></td>
      <td class="cc-col-num cc-subtotal">${money((it.precioUnitario || 0) * it.cantidad)}</td>
      <td class="cc-col-x"><button type="button" class="cart-item-remove" data-quitar="${i}" title="Quitar" aria-label="Quitar">✕</button></td>
    </tr>`;
}

function pintar() {
  $("cc-items").innerHTML = items.map(filaHtml).join("");
  $("cc-vacio").style.display = items.length ? "none" : "block";
  $("cc-vaciar").hidden = !items.length;
  totales();
}

function totales() {
  const unidades = items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0);
  const total = items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precioUnitario) || 0), 0);
  $("cc-t-productos").textContent = items.length;
  $("cc-t-unidades").textContent = unidades.toLocaleString("es-AR");
  $("cc-t-total").textContent = money(total);
  $("cc-registrar").disabled = !items.length;
}

// Editar una fila sin repintar toda la tabla (así no se pierde el foco al escribir).
$("cc-items").addEventListener("input", (e) => {
  const tr = e.target.closest("tr[data-i]");
  const campo = e.target.dataset.campo;
  if (!tr || !campo) return;
  const it = items[Number(tr.dataset.i)];
  if (campo === "producto") { it.producto = e.target.value; return; }
  const v = parseFloat(e.target.value);
  if (campo === "cantidad") it.cantidad = Number.isInteger(v) && v > 0 ? v : it.cantidad;
  if (campo === "precioUnitario") {
    it.precioUnitario = Number.isFinite(v) && v >= 0 ? v : 0;
    tr.classList.toggle("cc-sin-precio", !(it.precioUnitario > 0));
  }
  tr.querySelector(".cc-subtotal").textContent = money((it.precioUnitario || 0) * it.cantidad);
  totales();
});
$("cc-items").addEventListener("change", (e) => {
  if (e.target.dataset.campo !== "producto") return;
  items[Number(e.target.closest("tr").dataset.i)].producto = e.target.value.trim();
  pintar();
});
$("cc-items").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quitar]");
  if (!b) return;
  items.splice(Number(b.dataset.quitar), 1);
  pintar();
});
$("cc-vaciar").addEventListener("click", () => {
  if (items.length && !confirm("¿Sacar todos los productos de esta compra?")) return;
  items = [];
  pintar();
});

// ---------- Agregar ----------
const sugerencias = $("cc-sugerencias");
function pintarSugerencias(lista) {
  if (!lista.length) { sugerencias.innerHTML = ""; sugerencias.classList.remove("open"); return; }
  sugerencias.innerHTML = lista.map((p) => `<div class="suggestion-item">${escapeHtml(p.nombre)}</div>`).join("");
  sugerencias.classList.add("open");
}
function prellenarCosto() {
  const ex = existente($("cc-producto").value);
  if (ex && ex.costo && !$("cc-costo").value) $("cc-costo").value = ex.costo;
}
$("cc-producto").addEventListener("input", () => {
  const q = $("cc-producto").value.trim().toLowerCase();
  pintarSugerencias(q ? productos.filter((p) => String(p.nombre || "").toLowerCase().includes(q)).slice(0, 8) : []);
});
$("cc-producto").addEventListener("blur", () => setTimeout(() => pintarSugerencias([]), 150));
sugerencias.addEventListener("mousedown", (e) => {
  const it = e.target.closest(".suggestion-item");
  if (!it) return;
  $("cc-producto").value = it.textContent;
  pintarSugerencias([]);
  prellenarCosto();
  $("cc-cantidad").focus();
});
$("cc-producto").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (!$("cc-producto").value.trim()) return;
  pintarSugerencias([]);
  prellenarCosto();
  $("cc-cantidad").focus();
});
$("cc-cantidad").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("cc-costo").focus(); $("cc-costo").select(); } });
$("cc-costo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } });
$("cc-agregar-btn").addEventListener("click", agregar);

function agregar() {
  const producto = $("cc-producto").value.trim();
  const cantidad = parseInt($("cc-cantidad").value || "1", 10);
  const precioUnitario = parseFloat($("cc-costo").value);
  if (!producto) { $("cc-producto").focus(); return; }
  if (!Number.isInteger(cantidad) || cantidad <= 0) { alert("Cantidad inválida."); $("cc-cantidad").focus(); return; }
  if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) { alert("Poné el costo por unidad."); $("cc-costo").focus(); return; }
  const ex = existente(producto);
  items.push({ producto: ex ? ex.nombre : producto, cantidad, precioUnitario });
  $("cc-producto").value = ""; $("cc-cantidad").value = ""; $("cc-costo").value = "";
  pintar();
  $("cc-producto").focus();
}

// ---------- Registrar ----------
$("cc-registrar").addEventListener("click", async () => {
  const err = $("cc-error"); err.style.display = "none";
  if (!items.length) return;
  if (items.some((it) => !String(it.producto).trim())) { err.textContent = "Hay un producto sin nombre."; err.style.display = "block"; return; }
  if (items.some((it) => !(it.precioUnitario > 0))) { err.textContent = "Hay productos sin costo (marcados en naranja): completalos antes de registrar."; err.style.display = "block"; return; }
  const factura = $("cc-factura").value.trim();
  const notas = $("cc-notas").value.trim();
  const body = {
    tipo: "compra",
    fecha: $("cc-fecha").value,
    proveedor: $("cc-proveedor").value.trim() || null,
    vencimiento: $("cc-vencimiento").value || null,
    nota: [factura ? `Factura/remito: ${factura}` : "", notas].filter(Boolean).join(" — ") || null,
    items: items.map((it) => ({ producto: it.producto, cantidad: it.cantidad, precioUnitario: it.precioUnitario })),
  };
  const btn = $("cc-registrar");
  btn.disabled = true; btn.textContent = "Registrando…";
  try {
    await api("/api/compras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const unidades = items.reduce((a, it) => a + it.cantidad, 0);
    const total = items.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0);
    $("cc-listo-texto").textContent = `${unidades.toLocaleString("es-AR")} unidades en ${items.length} producto${items.length === 1 ? "" : "s"}, por ${money(total)}. El stock y los costos ya están actualizados.`;
    items = [];
    $("cc-formulario").style.display = "none";
    document.querySelector(".cc-cab").style.display = "none";
    $("cc-listo").style.display = "flex";
  } catch (ex) {
    err.textContent = ex.message || "No se pudo registrar la compra."; err.style.display = "block";
  } finally {
    btn.textContent = "Registrar compra";
    btn.disabled = !items.length;
  }
});

$("cc-otra").addEventListener("click", async () => {
  ["cc-proveedor", "cc-factura", "cc-notas", "cc-vencimiento"].forEach((id) => { $(id).value = ""; });
  $("cc-listo").style.display = "none";
  $("cc-formulario").style.display = "";
  document.querySelector(".cc-cab").style.display = "";
  history.replaceState(null, "", "/cargar-compra.html");
  await cargarDatos();
});

// No perder una compra a medio cargar al salir de la página.
window.addEventListener("beforeunload", (e) => { if (items.length) { e.preventDefault(); e.returnValue = ""; } });

checkAuth();
