const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const TIPOS = ['Reel','Post','Story','Oferta'];
const ESTADOS = ['Idea','Grabando','Editando','Publicado'];

const FECHAS_COMERCIALES = [
  { fecha: '2026-10-18', label: 'Día de la Madre', idea: 'Combo o rutina pensada para mamás que entrenan' },
  { fecha: '2026-11-02', label: 'CyberMonday (2 al 4 de nov.)', idea: 'Descuentos mayorista y online, contenido de urgencia' },
  { fecha: '2026-11-27', label: 'Black Friday', idea: 'Ofertas fuertes, buen momento para liquidar stock' },
  { fecha: '2026-12-25', label: 'Navidad', idea: 'Ideas de regalo para alguien que entrena' },
  { fecha: '2027-01-06', label: 'Día de Reyes', idea: 'Última tanda de regalos fitness' },
  { fecha: '2027-01-15', label: 'Temporada verano (ene-feb)', idea: 'Contenido "objetivo verano" / definición' },
  { fecha: '2027-03-01', label: 'Vuelta a clases', idea: 'Arranque de rutina post-vacaciones' },
];

function todayDate() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function pad(n) { return String(n).length < 2 ? "0" + n : String(n); }
function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseISO(s) { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function monthLabel(d) { const m = MESES[d.getMonth()]; return m.charAt(0).toUpperCase() + m.slice(1) + " " + d.getFullYear(); }
function uid() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function badgeClass(tipo) {
  if (tipo === "Post") return "tipo-post";
  if (tipo === "Story") return "tipo-story";
  if (tipo === "Oferta") return "tipo-oferta";
  return "tipo-reel";
}
function estClass(estado) {
  if (estado === "Grabando") return "est-grabando";
  if (estado === "Editando") return "est-editando";
  if (estado === "Publicado") return "est-publicado";
  return "est-idea";
}

// ---------- Login ----------

const loginCard = document.getElementById("login-card");
const appContent = document.getElementById("app-content");
const logoutBtn = document.getElementById("logout-btn");

function showApp() {
  loginCard.style.display = "none";
  appContent.style.display = "block";
  logoutBtn.style.display = "flex";
  cargarYRenderizar();
}

function showLogin() {
  loginCard.style.display = "flex";
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

// "Ver versión de escritorio" de esta página puntual: movil-shared.js pone un handler
// genérico que manda siempre a "/", acá lo pisamos para ir al calendario de escritorio.
const navDesktopBtn = document.getElementById("navDesktop");
if (navDesktopBtn) {
  navDesktopBtn.onclick = () => {
    try { sessionStorage.setItem("forzar-desktop", "1"); } catch (e) {}
    location.href = "/calendario-contenido.html";
  };
}

// ---------- Datos y persistencia ----------

let postsGlobal = [];

async function cargarYRenderizar() {
  try {
    postsGlobal = await api("/api/calendario-contenido");
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    toast("No se pudo cargar el calendario.", false);
    return;
  }
  render();
}

async function upsertPost(post) {
  try {
    const saved = await api("/api/calendario-contenido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post),
    });
    const idx = postsGlobal.findIndex((p) => p.id === saved.id);
    if (idx >= 0) postsGlobal[idx] = saved; else postsGlobal.push(saved);
    render();
    toast("Guardado");
  } catch (err) {
    toast("No se pudo guardar. Probá de nuevo.", false);
  }
}

async function deletePost(id) {
  try {
    await api("/api/calendario-contenido/" + encodeURIComponent(id), { method: "DELETE" });
    postsGlobal = postsGlobal.filter((p) => p.id !== id);
    render();
    toast("Eliminado");
  } catch (err) {
    toast("No se pudo eliminar. Probá de nuevo.", false);
  }
}

// ---------- Modal de alta/edición ----------

function openModal(post) {
  const isEdit = !!(post && postsGlobal.some((p) => p.id === post.id));
  const p = post || { id: uid(), fecha: "", tipo: "Reel", tema: "", estado: "Idea", notas: "" };

  const tipoOptions = TIPOS.map((t) => `<option value="${t}"${t === p.tipo ? " selected" : ""}>${t}</option>`).join("");
  const estadoOptions = ESTADOS.map((e) => `<option value="${e}"${e === p.estado ? " selected" : ""}>${e}</option>`).join("");

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal-scrim" id="modalScrim"></div>
    <div class="modal">
      <button type="button" class="modal-close" id="modalClose" aria-label="Cerrar">×</button>
      <h2>${isEdit ? "Editar contenido" : "Nuevo contenido"}</h2>
      <div class="m-two-col">
        <div class="m-field"><label>Fecha</label><input type="date" id="f-fecha" value="${p.fecha || ""}"></div>
        <div class="m-field"><label>Tipo</label><select id="f-tipo">${tipoOptions}</select></div>
      </div>
      <div class="m-field"><label>Tema / gancho</label><input type="text" id="f-tema" value="${escapeHtml(p.tema)}" placeholder="Ej: 3 beneficios de la creatina"></div>
      <div class="m-field"><label>Estado</label><select id="f-estado">${estadoOptions}</select></div>
      <div class="m-field"><label>Notas</label><textarea id="f-notas" placeholder="Guion, referencias, lo que haga falta">${escapeHtml(p.notas)}</textarea></div>
      <div class="m-actions">
        <button type="button" class="ghost-btn" id="btnCancel">Cancelar</button>
        <button type="button" class="submit" id="btnSave">Guardar</button>
      </div>
      ${isEdit ? '<button type="button" class="m-delete" id="btnDelete">Eliminar este contenido</button>' : ""}
    </div>
  `;
  document.body.appendChild(wrap);

  const cerrar = () => wrap.remove();
  document.getElementById("modalScrim").addEventListener("click", cerrar);
  document.getElementById("modalClose").addEventListener("click", cerrar);
  document.getElementById("btnCancel").addEventListener("click", cerrar);
  document.getElementById("btnSave").addEventListener("click", () => {
    const tema = document.getElementById("f-tema").value.trim();
    if (!tema) { toast("Poné al menos un tema o gancho.", false); return; }
    upsertPost({
      id: p.id,
      fecha: document.getElementById("f-fecha").value,
      tipo: document.getElementById("f-tipo").value,
      tema,
      estado: document.getElementById("f-estado").value,
      notas: document.getElementById("f-notas").value.trim(),
    });
    cerrar();
  });
  if (isEdit) {
    document.getElementById("btnDelete").addEventListener("click", () => {
      deletePost(p.id);
      cerrar();
    });
  }
}

// ---------- Render ----------

function renderRow(p) {
  const row = document.createElement("div");
  row.className = "cont-row";

  let fechaHtml;
  if (p.fecha) {
    const d = parseISO(p.fecha);
    fechaHtml = `<div class="cont-date"><div class="wd">${DIAS[d.getDay()]}</div><div class="dn">${d.getDate()}</div></div>`;
  } else {
    fechaHtml = `<div class="cont-date nofecha"><div class="wd">Sin</div><div class="wd">fecha</div></div>`;
  }

  row.innerHTML = fechaHtml + `
    <div class="cont-main">
      <div class="cont-top">
        <span class="tipo-badge ${badgeClass(p.tipo)}">${p.tipo}</span>
        <span class="cont-tema">${escapeHtml(p.tema)}</span>
      </div>
      <div class="cont-bottom">
        <select class="estado-select ${estClass(p.estado)}" data-id="${p.id}"></select>
        ${p.notas ? `<span class="cont-notas">${escapeHtml(p.notas)}</span>` : '<span class="cont-notas"></span>'}
        <button type="button" class="cont-del" data-id="${p.id}" aria-label="Eliminar">×</button>
      </div>
    </div>
  `;

  const sel = row.querySelector("select");
  ESTADOS.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e; opt.textContent = e;
    if (e === p.estado) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => {
    sel.className = "estado-select " + estClass(sel.value);
    upsertPost({ id: p.id, fecha: p.fecha, tipo: p.tipo, tema: p.tema, estado: sel.value, notas: p.notas });
  });

  row.querySelector(".cont-top").addEventListener("click", () => openModal(p));
  row.querySelector(".cont-del").addEventListener("click", (e) => { e.stopPropagation(); deletePost(p.id); });

  return row;
}

function render() {
  const posts = postsGlobal.slice();

  document.getElementById("btn-new").onclick = () => openModal(null);

  // Fechas comerciales próximas
  const hoy = todayDate();
  const hoyISO = isoOf(hoy);
  const upcoming = FECHAS_COMERCIALES.filter((f) => f.fecha >= hoyISO).slice(0, 6);
  const fechasCard = document.getElementById("fechas-card");
  const chipsScroll = document.getElementById("chips-scroll");
  if (upcoming.length) {
    fechasCard.style.display = "block";
    chipsScroll.innerHTML = "";
    upcoming.forEach((f) => {
      const d = parseISO(f.fecha);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip-mini";
      chip.innerHTML = `<div class="cd">${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}</div><div class="cl">${escapeHtml(f.label)}</div><div class="ci">${escapeHtml(f.idea)}</div>`;
      chip.addEventListener("click", () => {
        openModal({ id: uid(), fecha: f.fecha, tipo: "Oferta", tema: f.label + ": " + f.idea, estado: "Idea", notas: "" });
      });
      chipsScroll.appendChild(chip);
    });
  } else {
    fechasCard.style.display = "none";
  }

  // Ideas sin fecha
  const sinFecha = posts.filter((p) => !p.fecha);
  const sinFechaCard = document.getElementById("sinfecha-card");
  const sinFechaList = document.getElementById("sinfecha-list");
  if (sinFecha.length) {
    sinFechaCard.style.display = "block";
    sinFechaList.innerHTML = "";
    sinFecha.forEach((p) => sinFechaList.appendChild(renderRow(p)));
  } else {
    sinFechaCard.style.display = "none";
  }

  // Con fecha, agrupados por mes
  const mesesContainer = document.getElementById("meses-container");
  mesesContainer.innerHTML = "";
  const conFecha = posts.filter((p) => !!p.fecha).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  let currentKey = null;
  let currentCard = null;
  conFecha.forEach((p) => {
    const d = parseISO(p.fecha);
    const key = d.getFullYear() + "-" + d.getMonth();
    if (key !== currentKey) {
      currentKey = key;
      currentCard = document.createElement("div");
      currentCard.className = "card";
      const lbl = document.createElement("div");
      lbl.className = "month-lbl";
      lbl.textContent = monthLabel(d);
      currentCard.appendChild(lbl);
      mesesContainer.appendChild(currentCard);
    }
    currentCard.appendChild(renderRow(p));
  });

  document.getElementById("empty-card").style.display = posts.length ? "none" : "block";
}

checkAuth();
