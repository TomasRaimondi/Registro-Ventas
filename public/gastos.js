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

function normalizeConcepto(s) {
  return (s || "").trim().toLowerCase();
}

function formatFechaCorta(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

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

// ---------- Agrupación inteligente por similitud de nombre ----------
//
// Para "Gastos que más se repiten" no alcanza con agrupar por texto exacto: si un mes
// anotás "Bono Chino" y otro mes "Bonificación Chino" (o "Sueldo Bono Chino"), en la
// práctica es el mismo gasto recurrente. Se agrupan primero por texto exacto (para no
// perder el conteo real de cada variante) y después se unen los grupos que comparten
// alguna palabra "significativa" (se ignoran tildes, mayúsculas y palabras genéricas
// como "pago", "sueldo", "bono", "mensual", etc., que aparecen en muchos gastos
// distintos y arruinarían la agrupación si se las tuviera en cuenta).

const GASTOS_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "en", "para", "por", "con", "sin",
  "a", "al", "un", "una", "unos", "unas", "mensual", "mensuales", "pago", "pagos",
  "gasto", "gastos", "cuota", "cuotas", "servicio", "servicios", "factura", "facturas",
  "compra", "compras", "varios", "general", "gral", "extra",
  "sueldo", "sueldos", "salario", "salarios", "bono", "bonos", "bonificacion",
  "bonificaciones", "comision", "comisiones", "honorarios", "aporte", "aportes",
  "cargo", "cargos", "total", "monto",
]);

function normalizarTexto(s) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // saca tildes
    .toLowerCase()
    .trim();
}

function tokensSignificativos(textoNormalizado) {
  return textoNormalizado
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !GASTOS_STOPWORDS.has(w));
}

// Union-Find simple para agrupar transitivamente (si A se une con B, y B con C, A y C
// terminan en el mismo grupo aunque A y C no compartan ninguna palabra entre sí).
class UnionFind {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let raiz = x;
    while (this.parent.get(raiz) !== raiz) raiz = this.parent.get(raiz);
    let actual = x;
    while (this.parent.get(actual) !== raiz) {
      const siguiente = this.parent.get(actual);
      this.parent.set(actual, raiz);
      actual = siguiente;
    }
    return raiz;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function agruparConceptosSimilares(gastos) {
  // 1) Agrupar por texto exacto normalizado, guardando cada variante de escritura tal
  // cual se cargó (para poder mostrarla) y todas sus entradas (fecha + monto).
  const porTextoExacto = new Map();
  gastos.forEach(g => {
    const key = normalizarTexto(g.concepto);
    if (!porTextoExacto.has(key)) porTextoExacto.set(key, { variantes: new Map(), entradas: [] });
    const acc = porTextoExacto.get(key);
    acc.variantes.set(g.concepto, (acc.variantes.get(g.concepto) || 0) + 1);
    acc.entradas.push({ fecha: g.fecha, monto: g.monto });
  });

  // 2) Unir los textos que comparten alguna palabra significativa.
  const keys = [...porTextoExacto.keys()];
  const tokensPorKey = new Map(keys.map(k => [k, tokensSignificativos(k)]));
  const uf = new UnionFind();
  keys.forEach(k => uf.find(k));
  for (let i = 0; i < keys.length; i++) {
    const tokensA = tokensPorKey.get(keys[i]);
    if (tokensA.length === 0) continue;
    for (let j = i + 1; j < keys.length; j++) {
      const tokensB = tokensPorKey.get(keys[j]);
      if (tokensB.length === 0) continue;
      if (tokensA.some(t => tokensB.includes(t))) uf.union(keys[i], keys[j]);
    }
  }

  // 3) Juntar todo lo que quedó en el mismo grupo del union-find.
  const clusters = new Map();
  keys.forEach(k => {
    const raiz = uf.find(k);
    if (!clusters.has(raiz)) clusters.set(raiz, { entradas: [], variantes: new Map() });
    const cluster = clusters.get(raiz);
    const grupo = porTextoExacto.get(k);
    cluster.entradas.push(...grupo.entradas);
    grupo.variantes.forEach((veces, texto) => {
      cluster.variantes.set(texto, (cluster.variantes.get(texto) || 0) + veces);
    });
  });

  // 4) Calcular los datos finales de cada cluster: total, promedio y tendencia
  // (compara el primer monto cargado contra el último, en orden de fecha).
  const resultado = [...clusters.values()].map(cluster => {
    const entradas = [...cluster.entradas].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const veces = entradas.length;
    const total = entradas.reduce((acc, e) => acc + e.monto, 0);
    const promedio = total / veces;
    const variantesOrdenadas = [...cluster.variantes.entries()].sort((a, b) => b[1] - a[1]);
    const concepto = variantesOrdenadas[0][0];
    const otrasVariantes = variantesOrdenadas.slice(1).map(([texto]) => texto);
    const ultimo = entradas[entradas.length - 1];
    const primero = entradas[0];

    let tendencia = null;
    if (veces > 1 && primero.monto > 0) {
      const pctCambio = ((ultimo.monto - primero.monto) / primero.monto) * 100;
      const direccion = pctCambio > 5 ? "subida" : pctCambio < -5 ? "bajada" : "estable";
      tendencia = { pctCambio, direccion };
    }

    return { concepto, otrasVariantes, veces, total, promedio, ultimo, tendencia };
  });

  resultado.sort((a, b) => b.total - a.total);
  return resultado;
}

function agruparPorMes(gastos) {
  const mapa = new Map();
  gastos.forEach(g => {
    const [y, m] = g.fecha.split("-").map(Number);
    const key = y * 12 + (m - 1);
    if (!mapa.has(key)) mapa.set(key, { label: `${MESES[m - 1]} ${y}`, total: 0, gastos: [] });
    const acc = mapa.get(key);
    acc.total += g.monto;
    acc.gastos.push(g);
  });
  return [...mapa.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

// ---------- Gastos fijos mensuales (estimados) ----------

let gastosFijosGlobal = [];

function renderGastosFijos() {
  const body = document.getElementById("gastos-fijos-body");
  if (gastosFijosGlobal.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="3">Todavía no anotaste ningún gasto fijo.</td></tr>`;
  } else {
    body.innerHTML = gastosFijosGlobal.map(gf => `
      <tr>
        <td>${escapeHtml(gf.concepto)}</td>
        <td>${money(gf.monto)}</td>
        <td><button class="del-btn" title="Quitar" data-id="${gf.id}">✕</button></td>
      </tr>
    `).join("");
    body.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteGastoFijo(btn.dataset.id));
    });
  }

  const total = gastosFijosGlobal.reduce((acc, gf) => acc + gf.monto, 0);
  document.getElementById("gastos-fijos-total").textContent = money(total);
}

async function deleteGastoFijo(id) {
  try {
    await api("/api/gastos-fijos/" + encodeURIComponent(id), { method: "DELETE" });
    gastosFijosGlobal = gastosFijosGlobal.filter(gf => gf.id !== id);
    renderGastosFijos();
  } catch (err) {
    alert("No se pudo borrar el gasto fijo.\n" + err.message);
  }
}

document.getElementById("gasto-fijo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const concepto = document.getElementById("gasto-fijo-concepto").value.trim();
  const monto = parseFloat(document.getElementById("gasto-fijo-monto").value);
  if (!concepto || !Number.isFinite(monto) || monto <= 0) return;

  try {
    const row = await api("/api/gastos-fijos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concepto, monto }),
    });
    gastosFijosGlobal.push(row);
    renderGastosFijos();
    document.getElementById("gasto-fijo-form").reset();
    document.getElementById("gasto-fijo-concepto").focus();
  } catch (err) {
    alert("No se pudo agregar el gasto fijo.\n" + err.message);
  }
});

// Se llama desde el botón "+ Fijo" de cada fila de "Gastos que más se repiten".
function precargarGastoFijo(concepto, monto) {
  document.getElementById("gasto-fijo-concepto").value = concepto;
  document.getElementById("gasto-fijo-monto").value = Math.round(monto);
  document.getElementById("gasto-fijo-concepto").scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("gasto-fijo-monto").focus();
}

// ---------- Render principal ----------

async function renderAll() {
  let data, gastosFijos;
  try {
    [data, gastosFijos] = await Promise.all([api("/api/reportes"), api("/api/gastos-fijos")]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const gastos = data.gastos || [];
  gastosFijosGlobal = gastosFijos || [];

  const totalGeneral = gastos.reduce((acc, g) => acc + g.monto, 0);
  document.getElementById("total-general").textContent = money(totalGeneral);
  document.getElementById("cantidad-general").textContent =
    gastos.length === 1 ? "1 gasto cargado" : `${gastos.length} gastos cargados`;

  renderGastosFijos();

  // Desglose mensual, con el mes más reciente desplegado por defecto
  const mesesContainer = document.getElementById("meses-container");
  const mesesEmpty = document.getElementById("meses-empty");
  mesesContainer.querySelectorAll(".mes-bloque").forEach(el => el.remove());

  const meses = agruparPorMes(gastos);
  mesesEmpty.style.display = meses.length === 0 ? "block" : "none";

  meses.forEach((mes, index) => {
    const bloque = document.createElement("div");
    bloque.className = "mes-bloque";

    const filas = [...mes.gastos]
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creadoEn.localeCompare(b.creadoEn))
      .map(g => `
        <tr>
          <td>${formatFechaCorta(g.fecha)}</td>
          <td>${escapeHtml(g.concepto)}</td>
          <td>${money(g.monto)}</td>
        </tr>
      `).join("");

    const abierto = index === 0;
    bloque.innerHTML = `
      <h3 class="collapsible-header mes-header${abierto ? " expanded" : ""}">
        <span><span class="expand-caret">▸</span>${escapeHtml(mes.label.charAt(0).toUpperCase() + mes.label.slice(1))}</span>
        <span class="mes-total">${money(mes.total)}</span>
      </h3>
      <div class="table-wrap mes-tabla" style="display:${abierto ? "block" : "none"};">
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    `;

    const header = bloque.querySelector(".mes-header");
    const tabla = bloque.querySelector(".mes-tabla");
    header.addEventListener("click", () => {
      const abierto = tabla.style.display !== "none";
      tabla.style.display = abierto ? "none" : "block";
      header.classList.toggle("expanded", !abierto);
    });

    mesesContainer.appendChild(bloque);
  });

  // Gastos que más se repiten (agrupados por similitud, con tendencia)
  const repetidosBody = document.getElementById("repetidos-body");
  repetidosBody.innerHTML = "";
  if (gastos.length === 0) {
    repetidosBody.innerHTML = `<tr class="empty-row"><td colspan="7">Todavía no hay gastos cargados.</td></tr>`;
  } else {
    agruparConceptosSimilares(gastos).forEach(g => {
      const tr = document.createElement("tr");

      const vecesPill = g.veces >= 3
        ? `<span class="pm-tag" style="background:var(--accent-soft); color:var(--accent);">${g.veces} veces</span>`
        : g.veces === 2
          ? `<span class="pm-tag" style="background:var(--card-border); color:var(--text-dim);">${g.veces} veces</span>`
          : `${g.veces} vez`;

      let tendenciaHtml = "—";
      if (g.tendencia) {
        const { pctCambio, direccion } = g.tendencia;
        if (direccion === "subida") {
          tendenciaHtml = `<span style="color:var(--red); font-weight:700;">↑ +${pctCambio.toFixed(0)}%</span>`;
        } else if (direccion === "bajada") {
          tendenciaHtml = `<span style="color:var(--green); font-weight:700;">↓ ${pctCambio.toFixed(0)}%</span>`;
        } else {
          tendenciaHtml = `<span style="color:var(--text-dim);">→ estable</span>`;
        }
      }

      const variantesHtml = g.otrasVariantes.length > 0
        ? `<br><span class="hint" style="margin:2px 0 0; text-align:left; display:block;">(también anotado como: ${g.otrasVariantes.map(escapeHtml).join(", ")})</span>`
        : "";

      tr.innerHTML = `
        <td>${escapeHtml(g.concepto)}${variantesHtml}</td>
        <td>${vecesPill}</td>
        <td>${money(g.total)}</td>
        <td>${money(g.promedio)}</td>
        <td>${tendenciaHtml}</td>
        <td>${money(g.ultimo.monto)} <span class="hint" style="margin:0;">(${formatFechaCorta(g.ultimo.fecha)})</span></td>
        <td><button type="button" class="toggle-desglose agregar-fijo-btn" style="color:var(--accent); font-weight:700; font-size:13px; white-space:nowrap;">+ Fijo</button></td>
      `;
      tr.querySelector(".agregar-fijo-btn").addEventListener("click", () => precargarGastoFijo(g.concepto, g.promedio));
      repetidosBody.appendChild(tr);
    });
  }
}

checkAuth();
