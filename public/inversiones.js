function usd(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? "-" : "";
  return sign + "US$" + Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatFechaCorta(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

const CATEGORIA_LABELS = {
  cripto: "Criptomonedas",
  accion: "Acciones",
  ia: "Empresas de IA",
  "energia-ia": "Energía para IA",
};

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
  const hoy = new Date().toISOString().slice(0, 10);
  document.getElementById("pf-fecha").value = hoy;
  document.getElementById("nota-fecha").value = hoy;
  renderAll();
  setInterval(renderAll, 60000);
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

// ---------- Agregar activo custom ----------

document.getElementById("btn-toggle-nuevo-activo").addEventListener("click", () => {
  const form = document.getElementById("nuevo-activo-form");
  form.style.display = form.style.display === "none" ? "flex" : "none";
});

document.getElementById("nuevo-activo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const simbolo = document.getElementById("na-simbolo").value.trim();
  const nombre = document.getElementById("na-nombre").value.trim();
  const categoria = document.getElementById("na-categoria").value;
  const precioManual = document.getElementById("na-precio").value;
  if (!simbolo || !nombre) return;
  try {
    await api("/api/inversiones/activos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simbolo, nombre, categoria, precioManual: precioManual || null }),
    });
    e.target.reset();
    e.target.style.display = "none";
    renderAll();
  } catch (err) {
    alert("No se pudo agregar el activo.\n" + err.message);
  }
});

async function deleteActivo(id) {
  if (!confirm("¿Borrar este activo? También se borran las posiciones de portafolio que lo usen.")) return;
  try {
    await api("/api/inversiones/activos/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el activo.\n" + err.message);
  }
}

async function guardarPrecioManual(id, input) {
  const precio = parseFloat(input.value);
  if (!Number.isFinite(precio) || precio < 0) return;
  try {
    await api(`/api/inversiones/activos/${encodeURIComponent(id)}/precio-manual`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio }),
    });
    renderAll();
  } catch (err) {
    alert("No se pudo guardar el precio.\n" + err.message);
  }
}

// ---------- Portafolio ----------

document.getElementById("portafolio-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const activoId = document.getElementById("pf-activo").value;
  const cantidad = parseFloat(document.getElementById("pf-cantidad").value);
  const precioCompra = parseFloat(document.getElementById("pf-precio-compra").value);
  const fecha = document.getElementById("pf-fecha").value;
  const nota = document.getElementById("pf-nota").value.trim();
  if (!activoId || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precioCompra) || !fecha) return;
  try {
    await api("/api/inversiones/portafolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activoId, cantidad, precioCompra, fecha, nota }),
    });
    document.getElementById("pf-cantidad").value = "";
    document.getElementById("pf-precio-compra").value = "";
    document.getElementById("pf-nota").value = "";
    renderAll();
  } catch (err) {
    alert("No se pudo agregar la posición.\n" + err.message);
  }
});

async function deletePortafolio(id) {
  try {
    await api("/api/inversiones/portafolio/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar la posición.\n" + err.message);
  }
}

// ---------- Notas ----------

document.getElementById("nota-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fecha = document.getElementById("nota-fecha").value;
  const activoId = document.getElementById("nota-activo").value || null;
  const texto = document.getElementById("nota-texto").value.trim();
  if (!fecha || !texto) return;
  try {
    await api("/api/inversiones/notas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, activoId, texto }),
    });
    document.getElementById("nota-texto").value = "";
    renderAll();
  } catch (err) {
    alert("No se pudo agregar la nota.\n" + err.message);
  }
});

async function deleteNota(id) {
  try {
    await api("/api/inversiones/notas/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar la nota.\n" + err.message);
  }
}

// ---------- Render ----------

async function renderAll() {
  let activos, precios, portafolio, notas;
  try {
    [activos, precios, portafolio, notas] = await Promise.all([
      api("/api/inversiones/activos"),
      api("/api/inversiones/precios"),
      api("/api/inversiones/portafolio"),
      api("/api/inversiones/notas"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const activoPorId = {};
  activos.forEach(a => { activoPorId[a.id] = a; });

  // ---- Activos seguidos, agrupados por categoría ----
  const cont = document.getElementById("activos-container");
  const focoActivo = document.activeElement && document.activeElement.classList.contains("precio-manual-input")
    ? document.activeElement.dataset.id : null;
  if (!focoActivo) {
    cont.innerHTML = "";
    const categorias = ["cripto", "accion", "ia", "energia-ia"];
    categorias.forEach(cat => {
      const items = activos.filter(a => a.categoria === cat);
      if (!items.length) return;
      const bloque = document.createElement("div");
      const titulo = document.createElement("div");
      titulo.className = "categoria-titulo";
      titulo.textContent = CATEGORIA_LABELS[cat] || cat;
      bloque.appendChild(titulo);

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px;";
      items.forEach(a => {
        const p = precios[a.id];
        const row = document.createElement("div");
        row.style.cssText = "border:1px solid var(--card-border); border-radius:12px; padding:12px 14px; display:flex; flex-direction:column; gap:6px;";
        const badgeClass = !p ? "fuente-sin" : p.fuente === "live" ? "fuente-live" : "fuente-manual";
        const badgeText = !p ? "sin precio" : p.fuente === "live" ? "en vivo" : "manual";
        row.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div>
              <strong>${escapeHtml(a.simbolo)}</strong>
              <div class="hint" style="margin:2px 0 0;">${escapeHtml(a.nombre)}</div>
            </div>
            <span class="fuente-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-size:20px; font-weight:800;">${p ? usd(p.precio) : "—"}</span>
            <button type="button" class="del-btn" title="Eliminar activo" data-id="${a.id}">✕</button>
          </div>
          <div class="input-prefix" style="max-width:160px;">
            <span>US$</span>
            <input type="number" class="precio-manual-input" data-id="${a.id}" placeholder="Precio manual" min="0" step="0.01" value="${a.precioManual != null ? a.precioManual : ""}">
          </div>
        `;
        row.querySelector(".del-btn").addEventListener("click", () => deleteActivo(a.id));
        const input = row.querySelector(".precio-manual-input");
        input.addEventListener("change", () => guardarPrecioManual(a.id, input));
        grid.appendChild(row);
      });
      bloque.appendChild(grid);
      cont.appendChild(bloque);
    });
  }

  // ---- Selects de activo (portafolio + notas) ----
  [document.getElementById("pf-activo")].forEach(sel => {
    const valorPrevio = sel.value;
    sel.innerHTML = activos.map(a => `<option value="${a.id}">${escapeHtml(a.simbolo)} — ${escapeHtml(a.nombre)}</option>`).join("");
    if (valorPrevio) sel.value = valorPrevio;
  });
  const notaSel = document.getElementById("nota-activo");
  const notaValorPrevio = notaSel.value;
  notaSel.innerHTML = `<option value="">General (sin activo)</option>` +
    activos.map(a => `<option value="${a.id}">${escapeHtml(a.simbolo)} — ${escapeHtml(a.nombre)}</option>`).join("");
  notaSel.value = notaValorPrevio;

  // ---- Resumen del portafolio ----
  let totalInvertido = 0, valorActual = 0;
  const filasPortafolio = portafolio.map(pos => {
    const activo = activoPorId[pos.activoId];
    const p = activo ? precios[activo.id] : null;
    const invertido = pos.cantidad * pos.precioCompra;
    const actual = p ? pos.cantidad * p.precio : null;
    totalInvertido += invertido;
    if (actual !== null) valorActual += actual;
    return { pos, activo, precioActual: p ? p.precio : null, invertido, actual };
  });
  const gananciaTotal = valorActual - totalInvertido;
  const gananciaPct = totalInvertido > 0 ? (gananciaTotal / totalInvertido) * 100 : 0;

  document.getElementById("stat-valor-actual").textContent = usd(valorActual);
  document.getElementById("stat-actualizado").textContent = portafolio.length
    ? `${portafolio.length} posición${portafolio.length === 1 ? "" : "es"} cargada${portafolio.length === 1 ? "" : "s"}`
    : "Sin posiciones cargadas";
  document.getElementById("stat-invertido").textContent = usd(totalInvertido);
  const gananciaEl = document.getElementById("stat-ganancia");
  gananciaEl.textContent = usd(gananciaTotal);
  gananciaEl.classList.toggle("value-positive", gananciaTotal > 0);
  gananciaEl.classList.toggle("value-negative", gananciaTotal < 0);
  document.getElementById("stat-ganancia-pct").textContent = `${gananciaPct >= 0 ? "+" : ""}${gananciaPct.toFixed(1)}%`;

  // ---- Tabla de portafolio ----
  const pfBody = document.getElementById("portafolio-body");
  if (filasPortafolio.length === 0) {
    pfBody.innerHTML = `<tr class="empty-row"><td colspan="8">Todavía no cargaste ninguna posición.</td></tr>`;
  } else {
    pfBody.innerHTML = filasPortafolio.map(({ pos, activo, precioActual, invertido, actual }) => {
      const ganancia = actual !== null ? actual - invertido : null;
      const gananciaPctFila = actual !== null && invertido > 0 ? (ganancia / invertido) * 100 : null;
      return `
        <tr>
          <td>${activo ? escapeHtml(activo.simbolo) : "(borrado)"}</td>
          <td>${pos.cantidad}</td>
          <td>${usd(pos.precioCompra)}</td>
          <td>${precioActual !== null ? usd(precioActual) : "—"}</td>
          <td>${actual !== null ? usd(actual) : "—"}</td>
          <td style="${ganancia !== null && ganancia < 0 ? 'color:var(--red);' : ganancia !== null && ganancia > 0 ? 'color:var(--green);' : ''}">
            ${ganancia !== null ? `${usd(ganancia)} (${gananciaPctFila >= 0 ? "+" : ""}${gananciaPctFila.toFixed(1)}%)` : "—"}
          </td>
          <td>${formatFechaCorta(pos.fecha)}</td>
          <td><button class="del-btn" title="Eliminar" data-id="${pos.id}">✕</button></td>
        </tr>
      `;
    }).join("");
    pfBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deletePortafolio(btn.dataset.id));
    });
  }

  // ---- Tabla de notas ----
  const notasBody = document.getElementById("notas-body");
  if (notas.length === 0) {
    notasBody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no cargaste ninguna nota.</td></tr>`;
  } else {
    notasBody.innerHTML = notas.map(n => {
      const activo = n.activoId ? activoPorId[n.activoId] : null;
      return `
        <tr>
          <td>${formatFechaCorta(n.fecha)}</td>
          <td>${activo ? escapeHtml(activo.simbolo) : "—"}</td>
          <td>${escapeHtml(n.texto)}</td>
          <td><button class="del-btn" title="Eliminar" data-id="${n.id}">✕</button></td>
        </tr>
      `;
    }).join("");
    notasBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteNota(btn.dataset.id));
    });
  }
}

checkAuth();
