function money(n) {
  return "$" + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase();
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

// ---------- Costos ----------

document.getElementById("costo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const producto = document.getElementById("costo-producto").value.trim();
  const costo = parseFloat(document.getElementById("costo-valor").value);
  if (!producto || isNaN(costo) || costo < 0) return;

  try {
    await api("/api/costos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto, costo }),
    });
    e.target.reset();
    renderAll();
  } catch (err) {
    alert("No se pudo guardar el costo.\n" + err.message);
  }
});

async function deleteCosto(producto) {
  try {
    await api("/api/costos/" + encodeURIComponent(producto), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el costo.\n" + err.message);
  }
}

// ---------- Gastos ----------

document.getElementById("gasto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const concepto = document.getElementById("gasto-concepto").value.trim();
  const monto = parseFloat(document.getElementById("gasto-monto").value);
  if (!concepto || isNaN(monto) || monto <= 0) return;

  try {
    await api("/api/gastos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concepto, monto }),
    });
    e.target.reset();
    renderAll();
  } catch (err) {
    alert("No se pudo registrar el gasto.\n" + err.message);
  }
});

async function deleteGasto(id) {
  try {
    await api("/api/gastos/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el gasto.\n" + err.message);
  }
}

// ---------- Render ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function renderAll() {
  let ventas, costos, gastos;
  try {
    [ventas, costos, gastos] = await Promise.all([
      api("/api/ventas"),
      api("/api/costos"),
      api("/api/gastos"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  let gananciaBruta = 0;
  let ventasConsideradas = 0;
  const sinCostoSet = new Set();

  ventas.forEach(v => {
    const key = normalizeNombre(v.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      gananciaBruta += v.precio - costoPorProducto[key];
      ventasConsideradas++;
    } else {
      sinCostoSet.add(v.producto);
    }
  });

  const gastoTotal = gastos.reduce((acc, g) => acc + g.monto, 0);
  const gananciaNeta = gananciaBruta - gastoTotal;

  document.getElementById("ganancia-bruta").textContent = money(gananciaBruta);
  document.getElementById("ventas-consideradas").textContent =
    `${ventasConsideradas} de ${ventas.length} ventas con costo cargado`;
  document.getElementById("gasto-total").textContent = money(gastoTotal);
  document.getElementById("ganancia-neta").textContent = money(gananciaNeta);

  const sinCostoCard = document.getElementById("sin-costo-card");
  const sinCostoList = document.getElementById("sin-costo-list");
  if (sinCostoSet.size > 0) {
    sinCostoCard.style.display = "block";
    sinCostoList.innerHTML = [...sinCostoSet].map(p => `<li>${escapeHtml(p)}</li>`).join("");
  } else {
    sinCostoCard.style.display = "none";
  }

  // Tabla de costos
  const costosBody = document.getElementById("costos-body");
  costosBody.innerHTML = "";
  if (costos.length === 0) {
    costosBody.innerHTML = `<tr class="empty-row"><td colspan="3">Todavía no cargaste ningún costo.</td></tr>`;
  } else {
    costos.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(c.producto)}</td>
        <td>${money(c.costo)}</td>
        <td><button class="del-btn" title="Eliminar" data-producto="${escapeHtml(c.producto)}">✕</button></td>
      `;
      costosBody.appendChild(tr);
    });
    costosBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteCosto(btn.dataset.producto));
    });
  }

  // Tabla de gastos
  const gastosBody = document.getElementById("gastos-body");
  gastosBody.innerHTML = "";
  if (gastos.length === 0) {
    gastosBody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no cargaste ningún gasto hoy.</td></tr>`;
  } else {
    [...gastos].reverse().forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${g.horaLabel}</td>
        <td>${escapeHtml(g.concepto)}</td>
        <td>${money(g.monto)}</td>
        <td><button class="del-btn" title="Eliminar" data-id="${g.id}">✕</button></td>
      `;
      gastosBody.appendChild(tr);
    });
    gastosBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteGasto(btn.dataset.id));
    });
  }
}

checkAuth();
setInterval(() => { if (appContent.style.display !== "none") renderAll(); }, 8000);
