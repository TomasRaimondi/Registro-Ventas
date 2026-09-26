const TIMEZONE = "America/Argentina/Buenos_Aires";

const ESTADO_LABEL = {
  recibido: "Recibido",
  preparando: "Preparando",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

async function api(url, options) {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `Error de red (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

function jsonOpts(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function horaCorta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE });
}

// ---------- Login ----------

let appIniciada = false;
let pollTimer = null;

function showApp() {
  $("login-card").style.display = "none";
  $("app-content").style.display = "block";
  $("logout-btn").style.display = "inline-block";
  if (!appIniciada) {
    appIniciada = true;
    cargarLista();
    pollTimer = setInterval(() => {
      // No redibujar mientras alguien está escribiendo en un campo de la lista
      const a = document.activeElement;
      if (a && a.closest && a.closest("#seg-lista") && (a.tagName === "INPUT")) return;
      cargarLista();
    }, 30000);
  }
}

function showLogin() {
  $("login-card").style.display = "block";
  $("app-content").style.display = "none";
  $("logout-btn").style.display = "none";
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = $("login-error");
  errorHint.style.display = "none";
  try {
    await api("/api/login", jsonOpts("POST", { usuario: $("usuario").value, password: $("password").value }));
    $("password").value = "";
    showApp();
  } catch (err) {
    errorHint.textContent = err.message || "Usuario o contraseña incorrectos.";
    errorHint.style.display = "block";
  }
});

$("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

// ---------- Nuevo seguimiento ----------

function mostrarInfo(html, aviso) {
  const box = $("seg-info");
  box.innerHTML = html;
  box.classList.toggle("aviso", !!aviso);
  box.style.display = html ? "block" : "none";
}

function mostrarError(msg) {
  const e = $("seg-error");
  e.textContent = msg || "";
  e.style.display = msg ? "block" : "none";
}

$("seg-buscar-btn").addEventListener("click", async () => {
  mostrarError("");
  mostrarInfo("");
  const n = $("seg-orden").value.replace(/\D/g, "");
  if (!n) { mostrarError("Escribí el número de pedido."); return; }
  const btn = $("seg-buscar-btn");
  btn.disabled = true;
  try {
    const o = await api("/api/seguimientos/orden/" + encodeURIComponent(n));
    if (o.cliente) $("seg-cliente").value = o.cliente;
    if (o.telefono) $("seg-telefono").value = o.telefono;
    const avisos = [];
    if (!o.pagado) avisos.push("⚠️ Este pedido todavía figura sin pagar.");
    if (o.ciudad && !/la plata/i.test(o.ciudad)) avisos.push("⚠️ La ciudad del pedido es " + esc(o.ciudad) + ".");
    mostrarInfo(
      "<strong>" + esc(o.cliente || "Sin nombre") + "</strong>" +
      (o.ciudad ? " · " + esc(o.ciudad) : "") +
      (o.direccion ? "<br>" + esc(o.direccion) : "") +
      (o.productos.length ? "<br>" + esc(o.productos.join(", ")) : "") +
      (avisos.length ? "<br>" + avisos.join(" ") : ""),
      avisos.length > 0
    );
  } catch (err) {
    mostrarError(err.message || "No se pudo buscar el pedido.");
  } finally {
    btn.disabled = false;
  }
});

$("seg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  mostrarError("");
  const btn = $("seg-crear-btn");
  btn.disabled = true;
  try {
    await api("/api/seguimientos", jsonOpts("POST", {
      orden: $("seg-orden").value,
      cliente: $("seg-cliente").value,
      telefono: $("seg-telefono").value,
      uberUrl: $("seg-uber").value,
    }));
    $("seg-form").reset();
    mostrarInfo("");
    await cargarLista();
  } catch (err) {
    mostrarError(err.message || "No se pudo crear el seguimiento.");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Lista ----------

let seguimientos = [];

async function cargarLista() {
  try {
    seguimientos = await api("/api/seguimientos");
    renderLista();
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    $("seg-lista").innerHTML = '<div class="seg-vacio">No se pudo cargar la lista.</div>';
  }
}

function linkCliente(s) {
  return location.origin + "/seguimiento.html?t=" + encodeURIComponent(s.id);
}

function mensajeWa(s) {
  const nombre = (s.cliente || "").split(/\s+/)[0];
  const saludo = nombre ? "Hola " + nombre + "! " : "Hola! ";
  const link = linkCliente(s);
  if (s.estado === "en_camino") {
    return saludo + "Tu pedido #" + s.orden + " de Platense Fit ya salió 🛵 Seguilo en tiempo real acá: " + link;
  }
  return saludo + "Recibimos tu pedido #" + s.orden + " de Platense Fit 💚 Seguí su estado y la llegada de la moto acá: " + link;
}

function renderItem(s) {
  const cerrado = s.estado === "entregado" || s.estado === "cancelado";
  const pasos = ["preparando", "en_camino", "entregado"].map((est) => {
    const rotulo = est === "en_camino" ? "🛵 Salió" : est === "preparando" ? "📦 Preparando" : "🎉 Entregado";
    return `<button type="button" class="seg-btn${s.estado === est ? " activo" : ""}" data-accion="estado" data-estado="${est}">${rotulo}</button>`;
  }).join("");

  const etaTexto = s.etaISO ? `Llegada estimada: <strong>${esc(horaCorta(s.etaISO))} hs</strong>` : "Sin hora estimada cargada";
  const wa = s.telefonoWa
    ? `<a class="seg-btn wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(s.telefonoWa)}?text=${encodeURIComponent(mensajeWa(s))}">📲 Enviar link por WhatsApp</a>`
    : "";

  return `
  <div class="seg-item${cerrado ? " cerrado" : ""}" data-id="${esc(s.id)}">
    <div class="seg-head">
      <div>
        <div class="seg-titulo">#${esc(s.orden)}${s.cliente ? " · " + esc(s.cliente) : ""}</div>
        <div class="seg-sub">${s.telefono ? esc(s.telefono) + " · " : ""}creado ${esc(horaCorta(s.creadoEn))} hs</div>
      </div>
      <span class="seg-badge ${esc(s.estado)}">${esc(ESTADO_LABEL[s.estado] || s.estado)}</span>
    </div>

    <div class="seg-bloque">
      <div class="seg-bloque-titulo">Estado</div>
      <div class="seg-fila">
        ${pasos}
        <button type="button" class="seg-btn peligro" data-accion="estado" data-estado="cancelado">Cancelar</button>
      </div>
    </div>

    <div class="seg-bloque">
      <div class="seg-bloque-titulo">Llega en...</div>
      <div class="seg-fila">
        ${[10, 15, 20, 30, 45].map((m) => `<button type="button" class="seg-btn" data-accion="eta" data-min="${m}">${m} min</button>`).join("")}
        <input type="number" class="seg-input-mini min" min="1" max="600" placeholder="min" data-campo="eta-custom">
        <button type="button" class="seg-btn" data-accion="eta-custom">OK</button>
      </div>
      <div class="seg-eta-actual">${etaTexto}</div>
    </div>

    <div class="seg-bloque">
      <div class="seg-bloque-titulo">Link de seguimiento de Uber</div>
      <div class="seg-fila">
        <input type="url" class="seg-input-mini url" placeholder="Pegá acá el link de Uber" value="${esc(s.uberUrl)}" data-campo="uber">
        <button type="button" class="seg-btn" data-accion="uber">Guardar</button>
      </div>
    </div>

    <div class="seg-bloque">
      <div class="seg-fila">
        ${wa}
        <button type="button" class="seg-btn" data-accion="copiar">🔗 Copiar link del cliente</button>
        <a class="seg-btn" target="_blank" rel="noopener noreferrer" href="${esc(linkCliente(s))}">👁 Ver como cliente</a>
        <button type="button" class="seg-btn peligro" data-accion="borrar">🗑</button>
      </div>
    </div>
  </div>`;
}

function renderLista() {
  const cont = $("seg-lista");
  if (!seguimientos.length) {
    cont.innerHTML = '<div class="seg-vacio">Todavía no hay envíos cargados.</div>';
    return;
  }
  const activos = seguimientos.filter((s) => s.estado !== "entregado" && s.estado !== "cancelado");
  const cerrados = seguimientos.filter((s) => s.estado === "entregado" || s.estado === "cancelado");
  cont.innerHTML = activos.concat(cerrados).map(renderItem).join("");
}

$("seg-lista").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-accion]");
  if (!btn) return;
  const item = btn.closest(".seg-item");
  const id = item.dataset.id;
  const s = seguimientos.find((x) => x.id === id);
  if (!s) return;
  const accion = btn.dataset.accion;

  try {
    if (accion === "estado") {
      await api("/api/seguimientos/" + encodeURIComponent(id), jsonOpts("PATCH", { estado: btn.dataset.estado }));
    } else if (accion === "eta") {
      await api("/api/seguimientos/" + encodeURIComponent(id), jsonOpts("PATCH", { etaMin: Number(btn.dataset.min) }));
    } else if (accion === "eta-custom") {
      const v = Number(item.querySelector('[data-campo="eta-custom"]').value);
      if (!v) return;
      await api("/api/seguimientos/" + encodeURIComponent(id), jsonOpts("PATCH", { etaMin: v }));
    } else if (accion === "uber") {
      const url = item.querySelector('[data-campo="uber"]').value;
      await api("/api/seguimientos/" + encodeURIComponent(id), jsonOpts("PATCH", { uberUrl: url }));
    } else if (accion === "copiar") {
      try {
        await navigator.clipboard.writeText(linkCliente(s));
        btn.textContent = "✓ Copiado";
        setTimeout(() => { btn.textContent = "🔗 Copiar link del cliente"; }, 1600);
      } catch (err) {
        window.prompt("Copiá este link:", linkCliente(s));
      }
      return;
    } else if (accion === "borrar") {
      if (!confirm("¿Borrar el seguimiento del pedido #" + s.orden + "?")) return;
      await api("/api/seguimientos/" + encodeURIComponent(id), { method: "DELETE" });
    }
    await cargarLista();
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    alert(err.message || "No se pudo guardar el cambio.");
  }
});

// ---------- Arranque ----------

(async function checkAuth() {
  try {
    const { authenticated } = await api("/api/auth-check");
    if (authenticated) showApp();
    else showLogin();
  } catch (e) {
    showLogin();
  }
})();
