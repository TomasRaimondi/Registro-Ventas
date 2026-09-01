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

function formatFecha(fecha) {
  if (!fecha) return "—";
  const [y, m, d] = fecha.split("-");
  if (!y || !m || !d) return fecha;
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
  cargarClientes();
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

// ---------- Estado ----------

let clientes = [];
let segmentoActivo = "todos";

async function cargarClientes() {
  const tbody = document.getElementById("clientes-body");
  tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Cargando...</td></tr>`;
  try {
    const data = await api("/api/recompra-mayoristas");
    clientes = data.clientes;
    render();
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Error al cargar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---------- Filtros ----------

document.getElementById("segmento-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".periodo-tab");
  if (!btn) return;
  document.querySelectorAll("#segmento-tabs .periodo-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  segmentoActivo = btn.dataset.segmento;
  render();
});

document.getElementById("buscador").addEventListener("input", () => render());
document.getElementById("umbral-dias").addEventListener("input", () => render());

// ---------- Render ----------

function umbralAtrasado() {
  const v = Number(document.getElementById("umbral-dias").value);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

function segmentoDeCliente(c, umbral) {
  if (c.diasSinComprar != null && c.diasSinComprar >= umbral) return "atrasado";
  return c.segmento; // "recurrente" | "unico"
}

function render() {
  const umbral = umbralAtrasado();
  const texto = document.getElementById("buscador").value.trim().toLowerCase();

  const conSegmento = clientes.map((c) => ({ ...c, segmentoUi: segmentoDeCliente(c, umbral) }));

  const totalRecurrente = conSegmento.filter((c) => c.segmento === "recurrente").length;
  const totalUnico = conSegmento.filter((c) => c.segmento === "unico").length;
  const totalAtrasado = conSegmento.filter((c) => c.segmentoUi === "atrasado").length;
  const volumenMensualTotal = conSegmento.reduce((a, c) => a + c.volumenMensualPromedio3m, 0);

  document.getElementById("stat-total").textContent = conSegmento.length;
  document.getElementById("stat-recurrente").textContent = totalRecurrente;
  document.getElementById("stat-unico").textContent = totalUnico;
  document.getElementById("stat-atrasado").textContent = totalAtrasado;
  document.getElementById("stat-volumen-mensual").textContent = money(volumenMensualTotal);

  let filtrados = conSegmento.filter((c) => {
    if (segmentoActivo !== "todos") {
      if (segmentoActivo === "atrasado" && c.segmentoUi !== "atrasado") return false;
      if (segmentoActivo !== "atrasado" && c.segmento !== segmentoActivo) return false;
    }
    if (!texto) return true;
    return (c.nombre || "").toLowerCase().includes(texto);
  });

  if (segmentoActivo === "atrasado") {
    filtrados.sort((a, b) => (b.diasSinComprar || 0) - (a.diasSinComprar || 0));
  } else if (segmentoActivo === "recurrente") {
    filtrados.sort((a, b) => b.totalVolumen - a.totalVolumen);
  } else {
    filtrados.sort((a, b) => (b.ultimaCompra || "").localeCompare(a.ultimaCompra || ""));
  }

  const tbody = document.getElementById("clientes-body");
  tbody.innerHTML = "";

  if (!filtrados.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No hay clientes que coincidan con el filtro.</td></tr>`;
  } else {
    filtrados.forEach((c) => tbody.appendChild(filaCliente(c)));
  }
}

function badgeSegmento(seg) {
  if (seg === "atrasado") return `<span class="badge-segmento inactivo">Atrasado</span>`;
  if (seg === "recurrente") return `<span class="badge-segmento recurrente">Recurrente</span>`;
  return `<span class="badge-segmento unico">Un solo pedido</span>`;
}

function listaProductos(productos) {
  if (!productos.length) return "—";
  const nombres = productos.map((p) => `${p.cantidad > 1 ? p.cantidad + "x " : ""}${escapeHtml(p.nombre)}`);
  if (nombres.length <= 2) return nombres.join(", ");
  return `${nombres.slice(0, 2).join(", ")} <span class="ver-mas">+${nombres.length - 2} más</span>`;
}

function celdaWhatsapp(c) {
  if (c.whatsapp) {
    return `<a class="wa-btn" href="${c.whatsapp}" target="_blank" rel="noopener" onclick="event.stopPropagation()">💬 WhatsApp</a>`;
  }
  const idInput = `tel-${c.nombreNormalizado.replace(/[^a-z0-9]/g, "")}`;
  return `
    <div class="tel-inline" onclick="event.stopPropagation()">
      <input type="text" id="${idInput}" placeholder="Agregar tel.">
      <button type="button" data-guardar-tel="${escapeHtml(c.nombre)}" data-input="${idInput}">Guardar</button>
    </div>
  `;
}

function filaCliente(c) {
  const tr = document.createElement("tr");
  tr.className = "fila-cliente";

  const cadenciaHtml = c.cadenciaDiasPromedio != null
    ? `<span class="cadencia-info ${c.atrasadoSegunRitmo ? "atrasado" : ""}">
         suele comprar cada ${c.cadenciaDiasPromedio} días${c.atrasadoSegunRitmo ? " — atrasado" : ""}
       </span>`
    : "";

  tr.innerHTML = `
    <td><span class="cliente-nombre">${escapeHtml(c.nombre)}</span></td>
    <td>${celdaWhatsapp(c)}</td>
    <td>${c.cantidadPedidos}</td>
    <td>
      ${formatFecha(c.ultimaCompra)}
      ${c.diasSinComprar != null ? `<span class="dias-sin-comprar">hace ${c.diasSinComprar} días</span>` : ""}
      ${cadenciaHtml}
    </td>
    <td>${money(c.volumenMensualPromedio3m)}</td>
    <td>${money(c.totalVolumen)} <span class="dias-sin-comprar">ticket prom. ${money(c.ticketPromedio)}</span></td>
    <td><div class="productos-lista">${listaProductos(c.productos)}</div></td>
    <td>${badgeSegmento(c.segmentoUi)}</td>
  `;

  const btnTel = tr.querySelector("[data-guardar-tel]");
  if (btnTel) {
    btnTel.addEventListener("click", async () => {
      const input = document.getElementById(btnTel.dataset.input);
      const telefono = input.value.trim();
      if (!telefono) return;
      btnTel.disabled = true;
      btnTel.textContent = "...";
      try {
        await api("/api/clientes-mayoristas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: c.nombre, telefono }),
        });
        await cargarClientes();
      } catch (err) {
        btnTel.disabled = false;
        btnTel.textContent = "Guardar";
        alert("No se pudo guardar el teléfono: " + err.message);
      }
    });
  }

  tr.addEventListener("click", () => toggleDetalle(tr, c));

  return tr;
}

function toggleDetalle(tr, c) {
  const siguiente = tr.nextElementSibling;
  if (siguiente && siguiente.classList.contains("fila-detalle")) {
    siguiente.remove();
    return;
  }
  document.querySelectorAll(".fila-detalle").forEach((f) => f.remove());

  const detalle = document.createElement("tr");
  detalle.className = "fila-detalle";
  const pedidosHtml = c.pedidos.map((p) => `
    <div class="detalle-pedido">
      <span>${formatFecha(p.fecha)} — ${money(p.total)}</span>
      <span class="detalle-pedido-productos">${escapeHtml(p.productos.map((it) => `${it.cantidad}x ${it.nombre}`).join(", "))}</span>
    </div>
  `).join("");
  detalle.innerHTML = `<td colspan="8">
    <strong>Historial de pedidos de ${escapeHtml(c.nombre)}</strong>
    ${pedidosHtml || "<p class=\"hint\">Sin pedidos.</p>"}
  </td>`;
  tr.after(detalle);
}

checkAuth();
