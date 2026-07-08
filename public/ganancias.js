function money(n) {
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
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
  const fechaInput = document.getElementById("salario-fecha");
  if (fechaInput && !fechaInput.value) {
    const now = new Date();
    fechaInput.value = now.toISOString().slice(0, 10);
  }
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

// ---------- Salario del empleado ----------

document.getElementById("salario-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fecha = document.getElementById("salario-fecha").value;
  const sueldo = parseFloat(document.getElementById("salario-sueldo").value) || 0;
  const comision = parseFloat(document.getElementById("salario-comision").value) || 0;
  const nota = document.getElementById("salario-nota").value.trim();

  if (!fecha) return;
  if (sueldo <= 0 && comision <= 0) {
    alert("Ingresá un sueldo o una comisión mayor a 0.");
    return;
  }

  try {
    await api("/api/salario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, sueldo, comision, nota }),
    });
    document.getElementById("salario-sueldo").value = "";
    document.getElementById("salario-comision").value = "";
    document.getElementById("salario-nota").value = "";
    renderAll();
  } catch (err) {
    alert("No se pudo registrar el salario.\n" + err.message);
  }
});

async function deleteSalario(id) {
  try {
    await api("/api/salario/" + encodeURIComponent(id), { method: "DELETE" });
    renderAll();
  } catch (err) {
    alert("No se pudo borrar el registro.\n" + err.message);
  }
}

// ---------- Render ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function renderAll() {
  let items, costos, gastos, salarios;
  try {
    [items, costos, gastos, salarios] = await Promise.all([
      api("/api/venta-items"),
      api("/api/costos"),
      api("/api/gastos"),
      api("/api/salario"),
    ]);
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    return;
  }

  const costoPorProducto = {};
  costos.forEach(c => { costoPorProducto[normalizeNombre(c.producto)] = c.costo; });

  let gananciaBruta = 0;
  let itemsConsiderados = 0;
  const sinCostoSet = new Set();

  items.forEach(it => {
    const key = normalizeNombre(it.producto);
    if (Object.prototype.hasOwnProperty.call(costoPorProducto, key)) {
      gananciaBruta += it.precio - costoPorProducto[key];
      itemsConsiderados++;
    } else {
      sinCostoSet.add(it.producto);
    }
  });

  const gastoTotal = gastos.reduce((acc, g) => acc + g.monto, 0);
  const gananciaNeta = gananciaBruta - gastoTotal;

  document.getElementById("ganancia-bruta").textContent = money(gananciaBruta);
  document.getElementById("ventas-consideradas").textContent =
    `${itemsConsiderados} de ${items.length} productos con costo cargado`;
  document.getElementById("gasto-total").textContent = money(gastoTotal);
  const gananciaNetaEl = document.getElementById("ganancia-neta");
  gananciaNetaEl.textContent = money(gananciaNeta);
  gananciaNetaEl.classList.toggle("value-positive", gananciaNeta > 0);
  gananciaNetaEl.classList.toggle("value-negative", gananciaNeta < 0);

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

  // Detalle de ventas de hoy (precio, costo y ganancia por producto)
  const detalleBody = document.getElementById("detalle-ventas-body");
  detalleBody.innerHTML = "";
  if (items.length === 0) {
    detalleBody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no hay ventas hoy.</td></tr>`;
  } else {
    [...items].reverse().forEach(it => {
      const key = normalizeNombre(it.producto);
      const tieneCosto = Object.prototype.hasOwnProperty.call(costoPorProducto, key);
      const costo = tieneCosto ? costoPorProducto[key] : null;
      const ganancia = tieneCosto ? it.precio - costo : null;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${it.horaLabel}</td>
        <td>${escapeHtml(it.producto)}</td>
        <td>${money(it.precio)}</td>
        <td>${tieneCosto ? money(costo) : "—"}</td>
        <td style="${ganancia !== null && ganancia < 0 ? 'color:#e15b5b;' : ''}">${ganancia !== null ? money(ganancia) : "—"}</td>
      `;
      detalleBody.appendChild(tr);
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

  // Tabla de salario
  const salarioBody = document.getElementById("salario-body");
  salarioBody.innerHTML = "";
  if (salarios.length === 0) {
    salarioBody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no cargaste ningún día.</td></tr>`;
  } else {
    [...salarios].reverse().forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.fecha}</td>
        <td>${s.sueldo > 0 ? money(s.sueldo) : "—"}</td>
        <td>${s.comision > 0 ? money(s.comision) : "—"}</td>
        <td>${s.nota ? escapeHtml(s.nota) : ""}</td>
        <td><button class="del-btn" title="Eliminar" data-id="${s.id}">✕</button></td>
      `;
      salarioBody.appendChild(tr);
    });
    salarioBody.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteSalario(btn.dataset.id));
    });
  }
}

checkAuth();
setInterval(() => { if (appContent.style.display !== "none") renderAll(); }, 8000);
