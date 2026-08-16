function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatFechaCorta(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

function diasEntre(fechaA, fechaB) {
  const a = new Date(fechaA + "T00:00:00Z");
  const b = new Date(fechaB + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function sumarDias(fecha, dias) {
  const [y, m, d] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
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
  renderAll();
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

// ---------- Formulario: tipo (producto / general) ----------

let tipoSeleccionado = "producto";
const productoField = document.getElementById("anuncio-producto-field");

document.querySelectorAll("#anuncio-tipo-tabs .periodo-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    tipoSeleccionado = btn.dataset.tipo;
    document.querySelectorAll("#anuncio-tipo-tabs .periodo-tab").forEach(b => b.classList.toggle("active", b === btn));
    productoField.style.display = tipoSeleccionado === "producto" ? "block" : "none";
  });
});

// ---------- Autocomplete de producto ----------

const productoInput = document.getElementById("anuncio-producto-input");
const productoSuggestions = document.getElementById("anuncio-producto-suggestions");
let costosGlobal = [];

function renderSuggestions(matches) {
  if (!matches.length) {
    productoSuggestions.innerHTML = "";
    productoSuggestions.classList.remove("open");
    return;
  }
  productoSuggestions.innerHTML = matches.map(p => `<div class="suggestion-item">${escapeHtml(p)}</div>`).join("");
  productoSuggestions.classList.add("open");
}

productoInput.addEventListener("input", () => {
  const q = normalizeNombre(productoInput.value);
  if (!q) { renderSuggestions([]); return; }
  const matches = costosGlobal.map(c => c.producto).filter(p => p.toLowerCase().includes(q)).slice(0, 8);
  renderSuggestions(matches);
});
productoInput.addEventListener("blur", () => setTimeout(() => renderSuggestions([]), 150));
productoSuggestions.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  productoInput.value = item.textContent;
  renderSuggestions([]);
});

// ---------- Alta de anuncio ----------

let anunciosGlobal = [];

document.getElementById("anuncio-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorHint = document.getElementById("anuncio-error");
  errorHint.style.display = "none";

  const nombre = document.getElementById("anuncio-nombre").value.trim();
  const producto = tipoSeleccionado === "producto" ? productoInput.value.trim() : null;
  const fechaInicio = document.getElementById("anuncio-fecha-inicio").value;
  const fechaFin = document.getElementById("anuncio-fecha-fin").value;
  const montoInvertido = parseFloat(document.getElementById("anuncio-monto").value);
  const notas = document.getElementById("anuncio-notas").value.trim() || null;

  if (tipoSeleccionado === "producto" && !producto) {
    errorHint.textContent = "Elegí el producto que promocionaste.";
    errorHint.style.display = "block";
    return;
  }
  if (fechaFin < fechaInicio) {
    errorHint.textContent = "La fecha de fin no puede ser anterior a la de inicio.";
    errorHint.style.display = "block";
    return;
  }

  try {
    const row = await api("/api/anuncios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, producto, fechaInicio, fechaFin, montoInvertido, notas }),
    });
    anunciosGlobal.push(row);
    renderAnuncios();
    document.getElementById("anuncio-form").reset();
    productoInput.value = "";
    document.getElementById("anuncio-tipo-tabs").querySelector('[data-tipo="producto"]').click();
  } catch (err) {
    errorHint.textContent = err.message || "No se pudo crear el anuncio.";
    errorHint.style.display = "block";
  }
});

async function borrarAnuncio(id) {
  if (!confirm("¿Borrar este anuncio?")) return;
  try {
    await api("/api/anuncios/" + encodeURIComponent(id), { method: "DELETE" });
    anunciosGlobal = anunciosGlobal.filter(a => a.id !== id);
    renderAnuncios();
  } catch (err) {
    alert("No se pudo borrar el anuncio.\n" + err.message);
  }
}

// ---------- Cálculo de rentabilidad por anuncio ----------

let itemsGlobal = [];
let gastosGlobal = [];

// Ganancia bruta de todas las ventas (cualquier método de pago) dentro de un rango de
// fechas inclusive, usando solo productos con costo cargado (si no hay costo, esa venta
// no se puede evaluar y se ignora en vez de mostrar un número incorrecto).
function gananciaBrutaEnRango(fechaDesde, fechaHasta) {
  const costoPorProducto = {};
  costosGlobal.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  let bruta = 0;
  itemsGlobal.forEach(it => {
    if (it.fecha < fechaDesde || it.fecha > fechaHasta) return;
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      bruta += it.precio - costoPorProducto[key];
    }
  });
  return bruta;
}

function gastoEnRango(fechaDesde, fechaHasta) {
  return gastosGlobal.reduce((acc, g) => (g.fecha >= fechaDesde && g.fecha <= fechaHasta ? acc + g.monto : acc), 0);
}

function ventasEnRango(fechaDesde, fechaHasta) {
  let unidades = 0, ingresos = 0;
  itemsGlobal.forEach(it => {
    if (it.fecha < fechaDesde || it.fecha > fechaHasta) return;
    unidades++;
    ingresos += it.precio;
  });
  return { unidades, ingresos };
}

function metricasAnuncio(anuncio) {
  if (anuncio.producto) {
    // Anuncio de producto puntual: mido directamente lo vendido de ese producto (o combo)
    // en el rango del anuncio. No reparto el precio de un combo entre sus componentes:
    // si el anuncio promocionó el combo, cuenta la venta del combo tal cual se registró.
    const costoRow = costosGlobal.find(c => normalizeNombre(c.producto) === normalizeNombre(anuncio.producto));
    const tieneCosto = !!costoRow;
    let unidades = 0, ingresos = 0, ganancia = 0;
    itemsGlobal.forEach(it => {
      if (normalizeNombre(it.producto) !== normalizeNombre(anuncio.producto)) return;
      if (it.fecha < anuncio.fechaInicio || it.fecha > anuncio.fechaFin) return;
      unidades++;
      ingresos += it.precio;
      if (tieneCosto) ganancia += it.precio - costoRow.costo;
    });
    const resultadoNeto = tieneCosto ? ganancia - anuncio.montoInvertido : null;
    const pctRetorno = tieneCosto && anuncio.montoInvertido > 0 ? (resultadoNeto / anuncio.montoInvertido) * 100 : null;
    return { tipo: "producto", tieneCosto, unidades, ingresos, ganancia, resultadoNeto, pctRetorno };
  }

  // Anuncio general: comparo la ganancia neta (bruta - gastos) del período del anuncio
  // contra el período inmediato anterior de la misma duración, para ver si el anuncio
  // generó un salto en las ventas generales del local.
  const dias = diasEntre(anuncio.fechaInicio, anuncio.fechaFin) + 1;
  const finAnterior = sumarDias(anuncio.fechaInicio, -1);
  const inicioAnterior = sumarDias(finAnterior, -(dias - 1));

  const netaActual = gananciaBrutaEnRango(anuncio.fechaInicio, anuncio.fechaFin) - gastoEnRango(anuncio.fechaInicio, anuncio.fechaFin);
  const netaAnterior = gananciaBrutaEnRango(inicioAnterior, finAnterior) - gastoEnRango(inicioAnterior, finAnterior);
  const ventasActual = ventasEnRango(anuncio.fechaInicio, anuncio.fechaFin);
  const ventasAnterior = ventasEnRango(inicioAnterior, finAnterior);

  const lift = netaActual - netaAnterior;
  const resultadoNeto = lift - anuncio.montoInvertido;
  const pctRetorno = anuncio.montoInvertido > 0 ? (resultadoNeto / anuncio.montoInvertido) * 100 : null;

  return {
    tipo: "general", dias, inicioAnterior, finAnterior,
    netaActual, netaAnterior, lift, resultadoNeto, pctRetorno,
    ventasActual, ventasAnterior,
  };
}

// ---------- Render ----------

function renderAnuncios() {
  const body = document.getElementById("anuncios-body");
  body.querySelectorAll(".sale-row, .sale-detail-row").forEach(el => el.remove());

  if (anunciosGlobal.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">Todavía no cargaste ningún anuncio.</td></tr>`;
    return;
  }
  body.innerHTML = "";

  const conMetricas = anunciosGlobal.map(a => ({ anuncio: a, m: metricasAnuncio(a) }));
  conMetricas.sort((a, b) => {
    const pa = a.m.pctRetorno, pb = b.m.pctRetorno;
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa;
  });

  conMetricas.forEach(({ anuncio, m }) => {
    const row = document.createElement("tr");
    row.className = "sale-row";

    const resultadoTexto = m.resultadoNeto === null ? "—" : money(m.resultadoNeto);
    const resultadoColor = m.resultadoNeto === null ? "" : m.resultadoNeto >= 0 ? "value-positive" : "value-negative";
    const pctTexto = m.pctRetorno === null ? "—" : m.pctRetorno.toFixed(1) + "%";
    const pctColor = m.pctRetorno === null ? "" : m.pctRetorno >= 0 ? "value-positive" : "value-negative";

    row.innerHTML = `
      <td><span class="expand-caret">▸</span>${escapeHtml(anuncio.nombre)}</td>
      <td>${anuncio.producto ? `<span class="pm-tag" style="background:var(--accent-soft); color:var(--accent);">${escapeHtml(anuncio.producto)}</span>` : `<span class="pm-tag" style="background:var(--card-border); color:var(--text-dim);">General</span>`}</td>
      <td>${formatFechaCorta(anuncio.fechaInicio)} – ${formatFechaCorta(anuncio.fechaFin)}</td>
      <td>${money(anuncio.montoInvertido)}</td>
      <td class="${resultadoColor}">${resultadoTexto}</td>
      <td class="${pctColor}">${pctTexto}</td>
      <td><button class="del-btn" title="Borrar anuncio" data-id="${anuncio.id}">✕</button></td>
    `;
    row.querySelector(".del-btn").addEventListener("click", (e) => { e.stopPropagation(); borrarAnuncio(anuncio.id); });

    const detailRow = document.createElement("tr");
    detailRow.className = "sale-detail-row";
    detailRow.style.display = "none";
    const detailCell = document.createElement("td");
    detailCell.colSpan = 7;
    detailCell.appendChild(renderDetalleAnuncio(anuncio, m));
    detailRow.appendChild(detailCell);

    row.addEventListener("click", () => {
      const abierto = detailRow.style.display !== "none";
      detailRow.style.display = abierto ? "none" : "table-row";
      row.classList.toggle("expanded", !abierto);
    });

    body.appendChild(row);
    body.appendChild(detailRow);
  });
}

function renderDetalleAnuncio(anuncio, m) {
  const wrap = document.createElement("div");
  wrap.style.padding = "16px 20px";

  if (m.tipo === "producto") {
    const avisoCosto = m.tieneCosto ? "" : `<p class="hint error-hint" style="text-align:left; margin-bottom:12px;">Este producto no tiene precio costo cargado en "Rentabilidad", así que no se puede calcular la ganancia ni el resultado del anuncio (solo unidades e ingresos).</p>`;
    wrap.innerHTML = `
      ${avisoCosto}
      <div class="rentabilidad-resumen">
        <div class="rentabilidad-stat minorista">
          <span class="label">Unidades vendidas</span>
          <span class="big-number">${m.unidades}</span>
          <span class="sub">del ${formatFechaCorta(anuncio.fechaInicio)} al ${formatFechaCorta(anuncio.fechaFin)}</span>
        </div>
        <div class="rentabilidad-stat minorista">
          <span class="label">Ingresos generados</span>
          <span class="big-number">${money(m.ingresos)}</span>
        </div>
        <div class="rentabilidad-stat mayorista">
          <span class="label">Ganancia (venta - costo)</span>
          <span class="big-number">${m.tieneCosto ? money(m.ganancia) : "—"}</span>
        </div>
        <div class="rentabilidad-stat" style="border-left-color: ${m.resultadoNeto === null ? 'transparent' : m.resultadoNeto >= 0 ? 'var(--green)' : 'var(--red)'};">
          <span class="label">Resultado neto del anuncio</span>
          <span class="big-number ${m.resultadoNeto === null ? '' : m.resultadoNeto >= 0 ? 'value-positive' : 'value-negative'}">${m.resultadoNeto === null ? "—" : money(m.resultadoNeto)}</span>
          <span class="sub">Ganancia − $${Math.round(anuncio.montoInvertido).toLocaleString("es-AR")} invertidos</span>
        </div>
      </div>
      ${anuncio.notas ? `<p class="hint" style="text-align:left;">Notas: ${escapeHtml(anuncio.notas)}</p>` : ""}
    `;
  } else {
    wrap.innerHTML = `
      <p class="hint" style="text-align:left; margin-bottom:12px;">
        Se compara la ganancia neta general del local durante el anuncio (${formatFechaCorta(anuncio.fechaInicio)} al
        ${formatFechaCorta(anuncio.fechaFin)}, ${m.dias} días) contra los ${m.dias} días inmediatos anteriores
        (${formatFechaCorta(m.inicioAnterior)} al ${formatFechaCorta(m.finAnterior)}), para ver si hubo un salto en
        las ventas generales del local mientras corría el anuncio.
      </p>
      <div class="rentabilidad-resumen">
        <div class="rentabilidad-stat minorista">
          <span class="label">Ventas (unidades) durante el anuncio</span>
          <span class="big-number">${m.ventasActual.unidades}</span>
          <span class="sub">Período anterior: ${m.ventasAnterior.unidades}</span>
        </div>
        <div class="rentabilidad-stat minorista">
          <span class="label">Ingresos durante el anuncio</span>
          <span class="big-number">${money(m.ventasActual.ingresos)}</span>
          <span class="sub">Período anterior: ${money(m.ventasAnterior.ingresos)}</span>
        </div>
        <div class="rentabilidad-stat mayorista">
          <span class="label">Ganancia neta durante el anuncio</span>
          <span class="big-number">${money(m.netaActual)}</span>
          <span class="sub">Período anterior: ${money(m.netaAnterior)}</span>
        </div>
        <div class="rentabilidad-stat" style="border-left-color: ${m.lift >= 0 ? 'var(--green)' : 'var(--red)'};">
          <span class="label">Salto en ganancia neta (lift)</span>
          <span class="big-number ${m.lift >= 0 ? 'value-positive' : 'value-negative'}">${money(m.lift)}</span>
          <span class="sub">Actual − período anterior</span>
        </div>
        <div class="rentabilidad-stat" style="border-left-color: ${m.resultadoNeto >= 0 ? 'var(--green)' : 'var(--red)'};">
          <span class="label">Resultado neto del anuncio</span>
          <span class="big-number ${m.resultadoNeto >= 0 ? 'value-positive' : 'value-negative'}">${money(m.resultadoNeto)}</span>
          <span class="sub">Salto − $${Math.round(anuncio.montoInvertido).toLocaleString("es-AR")} invertidos</span>
        </div>
      </div>
      ${anuncio.notas ? `<p class="hint" style="text-align:left;">Notas: ${escapeHtml(anuncio.notas)}</p>` : ""}
    `;
  }
  return wrap;
}

// ---------- Carga inicial ----------

async function renderAll() {
  let reportes, costos;
  try {
    [reportes, costos] = await Promise.all([
      api("/api/reportes"),
      api("/api/costos"),
      (async () => { anunciosGlobal = await api("/api/anuncios"); })(),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  itemsGlobal = reportes.items;
  gastosGlobal = reportes.gastos;
  costosGlobal = costos;

  renderAnuncios();
}

checkAuth();
