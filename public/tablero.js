function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ---------- Duración: conversión a píxeles de la barra y de vuelta ----------

const PX_POR_MIN = 1.2;
const DURACION_MIN_MIN = 15;
const DURACION_MIN_MAX = 180;

function duracionAPx(min) {
  return Math.max(18, Math.min(216, min * PX_POR_MIN));
}
function pxADuracion(px) {
  const crudo = Math.round(px / PX_POR_MIN / 15) * 15;
  return Math.max(DURACION_MIN_MIN, Math.min(DURACION_MIN_MAX, crudo));
}
function rangoHorario(hora, duracionMin) {
  const [h, m] = hora.split(":").map(Number);
  const inicio = h * 60 + m;
  const fin = (inicio + duracionMin) % 1440;
  return `${hora}–${pad2(Math.floor(fin / 60))}:${pad2(fin % 60)}`;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const HOUR_HEIGHT = 50;
const CANVAS_W = 2600;
const CANVAS_H = 1300;
const STRIP_W = 64;

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

// ---------- Modal de creación / edición ----------

const modalOverlay = document.getElementById("tarea-modal-overlay");
const modalTitle = document.getElementById("tarea-modal-title");
const modalSubmit = document.getElementById("tarea-modal-submit");
const modalError = document.getElementById("tarea-modal-error");
const tareaForm = document.getElementById("tarea-form");
const campoNotas = document.getElementById("campo-notas");
const modalBorrar = document.getElementById("tarea-modal-borrar");
const fabBtn = document.getElementById("fab-nueva-tarea");

let idEnEdicion = null;
let posicionNuevaTarea = null; // {x,y} si se creó con doble clic en el lienzo
let idReciénCreado = null;

function abrirModal(tarea, fechaPorDefecto) {
  modalError.style.display = "none";
  idEnEdicion = tarea ? tarea.id : null;
  modalTitle.textContent = tarea ? "Editar tarea" : "Nueva tarea";
  modalSubmit.textContent = tarea ? "Guardar cambios" : "Crear tarea";
  modalBorrar.style.display = tarea ? "inline-block" : "none";

  document.getElementById("tarea-texto").value = tarea ? tarea.texto : "";
  document.getElementById("tarea-notas").value = (tarea && tarea.notas) || "";
  document.getElementById("tarea-fecha").value = (tarea && tarea.fecha) || fechaPorDefecto || "";
  document.getElementById("tarea-hora").value = (tarea && tarea.hora) || "";
  document.getElementById("tarea-duracion").value = (tarea && tarea.duracionMin) || 60;

  campoNotas.style.display = tarea && tarea.notas ? "block" : "none";

  modalOverlay.style.display = "flex";
  setTimeout(() => document.getElementById("tarea-texto").focus(), 50);
}

function cerrarModal() {
  modalOverlay.style.display = "none";
  idEnEdicion = null;
  posicionNuevaTarea = null;
}

modalBorrar.addEventListener("click", () => {
  if (!idEnEdicion) return;
  if (!confirm("¿Borrar esta tarea?")) return;
  const id = idEnEdicion;
  cerrarModal();
  borrarTarea(id);
});

document.getElementById("toggle-notas").addEventListener("click", () => {
  campoNotas.style.display = campoNotas.style.display === "none" ? "block" : "none";
});
document.getElementById("tarea-modal-cancelar").addEventListener("click", cerrarModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) cerrarModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalOverlay.style.display !== "none") cerrarModal();
});

fabBtn.addEventListener("click", () => {
  posicionNuevaTarea = null;
  abrirModal(null, diaSeleccionado);
});

tareaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  modalError.style.display = "none";

  const texto = document.getElementById("tarea-texto").value.trim();
  const notas = document.getElementById("tarea-notas").value.trim() || null;
  const fecha = document.getElementById("tarea-fecha").value || null;
  const hora = fecha ? (document.getElementById("tarea-hora").value || null) : null;
  const duracionMin = hora ? parseInt(document.getElementById("tarea-duracion").value, 10) : null;

  if (!texto) {
    modalError.textContent = "Anotá qué hay que hacer.";
    modalError.style.display = "block";
    return;
  }

  try {
    if (idEnEdicion) {
      await api("/api/tablero-tareas/" + encodeURIComponent(idEnEdicion), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, notas, fecha, hora, duracionMin }),
      });
      const t = tareasGlobal.find((x) => x.id === idEnEdicion);
      if (t) Object.assign(t, { texto, notas, fecha, hora, duracionMin });
      cerrarModal();
      renderTablero();
    } else {
      const body = { texto, notas, fecha, hora, duracionMin };
      if (posicionNuevaTarea) { body.boardX = posicionNuevaTarea.x; body.boardY = posicionNuevaTarea.y; }
      const row = await api("/api/tablero-tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      tareasGlobal.push(row);
      idReciénCreado = row.id;
      cerrarModal();
      renderTablero();
    }
  } catch (err) {
    modalError.textContent = err.message || "No se pudo guardar la tarea.";
    modalError.style.display = "block";
  }
});

// ---------- Estado ----------

let tareasGlobal = [];
let conexionesGlobal = [];
let diaSeleccionado = "";
let hoyISO = "";
let dragState = null;
let connectState = null;

function hoyLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sumarDias(fechaISO, delta) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function etiquetaDia(fecha) {
  const [y, m, d] = fecha.split("-").map(Number);
  const obj = new Date(y, m - 1, d);
  const diaLargo = DIAS_LARGO[obj.getDay()];
  const label = `${d} de ${MESES[m - 1].toLowerCase()}`;
  return fecha === hoyISO ? `Hoy, ${label}` : `${diaLargo.charAt(0).toUpperCase() + diaLargo.slice(1)} ${label}`;
}

// ---------- Pantalla completa: F11/YouTube real (esconde la barra del navegador).
// Safari de iOS no soporta la API de Fullscreen en un <div>, así que ahí se usa un
// respaldo por CSS (overlay fijo + pedido de rotar el teléfono). ----------

const fsWrap = document.getElementById("board-fullscreen-wrap");
const fsBtn = document.getElementById("board-fullscreen-toggle");
let enPantallaCompleta = false;

function solicitarFullscreenNativo() {
  if (fsWrap.requestFullscreen) return fsWrap.requestFullscreen();
  if (fsWrap.webkitRequestFullscreen) return fsWrap.webkitRequestFullscreen();
  return null;
}
function salirFullscreenNativo() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  return null;
}
function elementoEnFullscreenNativo() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function actualizarBotonFullscreen(activo) {
  enPantallaCompleta = activo;
  fsWrap.classList.toggle("is-fullscreen", activo);
  fsBtn.classList.toggle("active", activo);
  fsBtn.textContent = activo ? "⛶ Salir de pantalla completa" : "⛶ Pantalla completa";
}

fsBtn.addEventListener("click", async () => {
  const soportaNativo = !!(fsWrap.requestFullscreen || fsWrap.webkitRequestFullscreen);

  if (!enPantallaCompleta) {
    if (soportaNativo) {
      try {
        await solicitarFullscreenNativo();
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock("landscape").catch(() => {});
        }
        return; // el estado visual lo actualiza el evento fullscreenchange
      } catch (err) {
        // el navegador lo rechazó (poco común): seguimos al respaldo por CSS
      }
    }
    fsWrap.classList.add("is-fullscreen-fallback");
    actualizarBotonFullscreen(true);
    document.body.style.overflow = "hidden";
  } else {
    if (elementoEnFullscreenNativo()) {
      salirFullscreenNativo();
    } else {
      fsWrap.classList.remove("is-fullscreen-fallback");
      actualizarBotonFullscreen(false);
      document.body.style.overflow = "";
    }
  }
});

function onFullscreenChange() {
  const activo = elementoEnFullscreenNativo() === fsWrap;
  actualizarBotonFullscreen(activo);
}
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && enPantallaCompleta && !elementoEnFullscreenNativo()) fsBtn.click();
});

async function cargarTodo() {
  try {
    [tareasGlobal, conexionesGlobal] = await Promise.all([api("/api/tablero-tareas"), api("/api/tablero-conexiones")]);
  } catch (err) {
    console.error(err);
    return;
  }
  hoyISO = hoyLocalISO();
  diaSeleccionado = hoyISO;

  generarEstrellas();
  renderFranjaHoras();
  renderTablero();
}

document.getElementById("board-prev").addEventListener("click", () => {
  diaSeleccionado = sumarDias(diaSeleccionado, -1);
  renderTablero();
});
document.getElementById("board-next").addEventListener("click", () => {
  diaSeleccionado = sumarDias(diaSeleccionado, 1);
  renderTablero();
});

document.getElementById("board-canvas").addEventListener("dblclick", (e) => {
  if (e.target.closest(".task-node")) return;
  const rect = document.getElementById("board-canvas").getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x < STRIP_W + 20) return;
  posicionNuevaTarea = { x, y };
  abrirModal(null, diaSeleccionado);
});

// ---------- Fondo espacial ----------

function generarEstrellas() {
  const canvas = document.getElementById("board-canvas");
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 150; i++) {
    const s = document.createElement("div");
    s.className = "board-star";
    const size = Math.random() < 0.85 ? 1 + Math.random() * 1.2 : 2 + Math.random() * 1.6;
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.left = (Math.random() * CANVAS_W) + "px";
    s.style.top = (Math.random() * CANVAS_H) + "px";
    s.style.animationDuration = (2.5 + Math.random() * 3.5) + "s";
    s.style.animationDelay = (Math.random() * 4) + "s";
    frag.appendChild(s);
  }
  canvas.insertBefore(frag, canvas.firstChild);
}

function renderFranjaHoras() {
  const strip = document.getElementById("board-hour-strip");
  let html = "";
  for (let h = 0; h < 24; h++) {
    html += `<div class="board-hour-tick" style="top:${h * HOUR_HEIGHT}px;"><span class="lbl">${pad2(h)}:00</span></div>`;
  }
  strip.innerHTML = html;

  const canvas = document.getElementById("board-canvas");
  for (let h = 0; h < 24; h++) {
    const dot = document.createElement("div");
    dot.className = "board-hour-anchor";
    dot.dataset.hour = h;
    dot.style.top = (h * HOUR_HEIGHT) + "px";
    dot.title = pad2(h) + ":00";
    canvas.appendChild(dot);
  }
}

// ---------- Tareas visibles y posicionamiento ----------

function tareasVisibles() {
  return tareasGlobal.filter((t) => t.fecha === diaSeleccionado || !t.fecha);
}

function asignarPosicionesFaltantes(visibles) {
  let index = 0;
  visibles.forEach((t) => {
    if (t.boardX == null || t.boardY == null) {
      const col = index % 4;
      const fila = Math.floor(index / 4);
      t.boardX = STRIP_W + 140 + col * 300;
      t.boardY = 50 + fila * 150;
      api("/api/tablero-tareas/" + encodeURIComponent(t.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardX: t.boardX, boardY: t.boardY }),
      }).catch(() => {});
    }
    index++;
  });
}

// ---------- Render principal del tablero ----------

function renderTablero() {
  document.getElementById("board-dia-label").textContent = etiquetaDia(diaSeleccionado);

  const visibles = tareasVisibles();
  asignarPosicionesFaltantes(visibles);

  const wrap = document.getElementById("board-nodes");
  wrap.innerHTML = "";
  visibles.forEach((t) => wrap.appendChild(crearNodo(t)));
  idReciénCreado = null;

  dibujarConexiones();
}

function crearNodo(t) {
  const el = document.createElement("div");
  el.className = "task-node floaty" + (t.hecho ? " hecho" : "") + (t.id === idReciénCreado ? " just-created" : "");
  el.style.left = t.boardX + "px";
  el.style.top = t.boardY + "px";
  el.style.animationDelay = (Math.random() * 4).toFixed(2) + "s";
  el.style.animationDuration = (5 + Math.random() * 2.4).toFixed(2) + "s";
  el.dataset.id = t.id;

  const duracion = t.duracionMin || 60;
  el.innerHTML = `
    <span class="tn-check" aria-label="Marcar como hecha"></span>
    <div class="tn-body">
      <div class="tn-texto">${escapeHtml(t.texto)}</div>
      ${t.hora ? `<span class="tn-hora">${rangoHorario(t.hora, duracion)}</span>` : ""}
      ${t.hora ? `
        <div class="tn-duration-bar" title="Arrastrá para cambiar la duración">
          <div class="tn-duration-fill" style="width:${duracionAPx(duracion)}px"></div>
          <span class="tn-duration-handle"></span>
        </div>
      ` : ""}
    </div>
    <span class="tn-handle" title="Arrastrá para conectar con otra tarea"></span>
  `;

  attachNodeEvents(el, t);
  return el;
}

// ---------- Interacción: arrastrar nodo ----------

function attachNodeEvents(el, t) {
  const check = el.querySelector(".tn-check");
  const handle = el.querySelector(".tn-handle");
  const durHandle = el.querySelector(".tn-duration-handle");

  check.addEventListener("pointerdown", (e) => e.stopPropagation());
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHecho(t.id, !t.hecho);
  });

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    connectState = { fromId: t.id };
    document.addEventListener("pointermove", onConnectMove);
    document.addEventListener("pointerup", onConnectUp, { once: true });
  });

  if (durHandle) {
    durHandle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const fillEl = el.querySelector(".tn-duration-fill");
      const horaEl = el.querySelector(".tn-hora");
      const startX = e.clientX;
      const startPx = duracionAPx(t.duracionMin || 60);

      function onDurMove(ev) {
        const nuevoPx = Math.max(18, Math.min(216, startPx + (ev.clientX - startX)));
        fillEl.style.width = nuevoPx + "px";
        if (horaEl) horaEl.textContent = rangoHorario(t.hora, pxADuracion(nuevoPx));
      }
      async function onDurUp(ev) {
        document.removeEventListener("pointermove", onDurMove);
        const finalPx = Math.max(18, Math.min(216, startPx + (ev.clientX - startX)));
        const nuevoMin = pxADuracion(finalPx);
        t.duracionMin = nuevoMin;
        try {
          await api("/api/tablero-tareas/" + encodeURIComponent(t.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ duracionMin: nuevoMin }),
          });
        } catch (err) {
          console.error(err);
        }
        await recalcularSeguidilla(t.id);
        renderTablero();
      }
      document.addEventListener("pointermove", onDurMove);
      document.addEventListener("pointerup", onDurUp, { once: true });
    });
  }

  el.addEventListener("pointerdown", (e) => {
    if (e.target === check || e.target === handle || e.target === durHandle) return;
    e.preventDefault();
    dragState = {
      id: t.id,
      el,
      startX: e.clientX,
      startY: e.clientY,
      origX: t.boardX,
      origY: t.boardY,
      curX: t.boardX,
      curY: t.boardY,
      moved: false,
    };
    el.classList.add("dragging");
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragUp, { once: true });
  });
}

function onDragMove(e) {
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (!dragState.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    dragState.moved = true;
  }

  let nx = dragState.origX + dx;
  let ny = dragState.origY + dy;
  nx = Math.max(STRIP_W + 10, Math.min(CANVAS_W - 170, nx));
  ny = Math.max(6, Math.min(CANVAS_H - 60, ny));

  dragState.curX = nx;
  dragState.curY = ny;
  dragState.el.style.left = nx + "px";
  dragState.el.style.top = ny + "px";

  dibujarConexiones();
  resaltarAnchorCercano(ny);
}

async function onDragUp(e) {
  document.removeEventListener("pointermove", onDragMove);
  if (!dragState) return;
  const { id, el, moved } = dragState;
  el.classList.remove("dragging");

  if (!moved) {
    const t = tareasGlobal.find((x) => x.id === id);
    dragState = null;
    limpiarResaltadoAnchors();
    abrirModal(t);
    return;
  }

  const nx = dragState.curX;
  const ny = dragState.curY;
  const t = tareasGlobal.find((x) => x.id === id);
  const horaCercana = anchorCercano(ny);
  limpiarResaltadoAnchors();
  dragState = null;

  if (t) {
    t.boardX = nx;
    t.boardY = ny;
    const patchBody = { boardX: nx, boardY: ny };
    if (horaCercana) { t.hora = horaCercana; patchBody.hora = horaCercana; }
    try {
      await api("/api/tablero-tareas/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
    } catch (err) {
      console.error(err);
    }
    if (horaCercana) await recalcularSeguidilla(id);
  }

  if (horaCercana) renderTablero();
  else dibujarConexiones();
}

// Cuando una tarea agendada tiene otras conectadas "hacia adelante", cada una
// arranca justo cuando termina la anterior (arma la "seguidilla"). Si la tarea de
// origen no tiene horario, no se toca nada (la conexión sigue siendo solo organizativa).
async function recalcularSeguidilla(id, visitados) {
  visitados = visitados || new Set();
  if (visitados.has(id)) return;
  visitados.add(id);

  const t = tareasGlobal.find((x) => x.id === id);
  if (!t || !t.hora) return;

  const duracion = t.duracionMin || 60;
  const [h, m] = t.hora.split(":").map(Number);
  const finMin = (h * 60 + m + duracion) % 1440;
  const nuevaHora = pad2(Math.floor(finMin / 60)) + ":" + pad2(finMin % 60);

  const siguientesIds = conexionesGlobal.filter((c) => c.desdeId === id).map((c) => c.haciaId);
  for (const haciaId of siguientesIds) {
    const sig = tareasGlobal.find((x) => x.id === haciaId);
    if (!sig) continue;
    if (sig.hora !== nuevaHora) {
      sig.hora = nuevaHora;
      try {
        await api("/api/tablero-tareas/" + encodeURIComponent(haciaId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hora: nuevaHora }),
        });
      } catch (err) {
        console.error(err);
      }
    }
    await recalcularSeguidilla(haciaId, visitados);
  }
}

function anchorCercano(nodeTop) {
  const centerY = nodeTop + 20;
  for (let h = 0; h < 24; h++) {
    const anchorY = h * HOUR_HEIGHT;
    if (Math.abs(centerY - anchorY) <= 26) return pad2(h) + ":00";
  }
  return null;
}

function resaltarAnchorCercano(nodeTop) {
  const centerY = nodeTop + 20;
  let cercana = null;
  for (let h = 0; h < 24; h++) {
    if (Math.abs(centerY - h * HOUR_HEIGHT) <= 26) { cercana = h; break; }
  }
  document.querySelectorAll(".board-hour-anchor").forEach((dot) => {
    dot.classList.toggle("drop-target", Number(dot.dataset.hour) === cercana);
  });
}

function limpiarResaltadoAnchors() {
  document.querySelectorAll(".board-hour-anchor.drop-target").forEach((dot) => dot.classList.remove("drop-target"));
}

// ---------- Interacción: conectar dos tareas ----------

function onConnectMove(e) {
  if (!connectState) return;
  const canvas = document.getElementById("board-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const a = centroDeNodo(connectState.fromId);
  const svg = document.getElementById("board-lines");
  let temp = svg.querySelector(".conn-drag-line");
  if (!temp) {
    temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    temp.setAttribute("class", "conn-drag-line");
    svg.appendChild(temp);
  }
  if (a) temp.setAttribute("d", curvaEntre(a, { x, y }));

  const elDebajo = document.elementFromPoint(e.clientX, e.clientY);
  const nodoDebajo = elDebajo ? elDebajo.closest(".task-node") : null;
  document.querySelectorAll(".task-node.connect-target").forEach((n) => n.classList.remove("connect-target"));
  if (nodoDebajo && nodoDebajo.dataset.id !== connectState.fromId) nodoDebajo.classList.add("connect-target");
}

async function onConnectUp(e) {
  document.removeEventListener("pointermove", onConnectMove);
  if (!connectState) return;
  const fromId = connectState.fromId;
  connectState = null;

  document.querySelectorAll(".task-node.connect-target").forEach((n) => n.classList.remove("connect-target"));
  const svg = document.getElementById("board-lines");
  const temp = svg.querySelector(".conn-drag-line");
  if (temp) temp.remove();

  const elDebajo = document.elementFromPoint(e.clientX, e.clientY);
  const nodoDebajo = elDebajo ? elDebajo.closest(".task-node") : null;
  if (!nodoDebajo) return;
  const haciaId = nodoDebajo.dataset.id;
  if (!haciaId || haciaId === fromId) return;

  const yaExiste = conexionesGlobal.some(
    (c) => (c.desdeId === fromId && c.haciaId === haciaId) || (c.desdeId === haciaId && c.haciaId === fromId)
  );
  if (yaExiste) return;

  try {
    const row = await api("/api/tablero-conexiones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desdeId: fromId, haciaId }),
    });
    conexionesGlobal.push(row);
    await recalcularSeguidilla(fromId);
    renderTablero();
  } catch (err) {
    alert("No se pudo conectar.\n" + err.message);
  }
}

async function borrarConexion(id) {
  if (!confirm("¿Borrar esta conexión?")) return;
  conexionesGlobal = conexionesGlobal.filter((c) => c.id !== id);
  dibujarConexiones();
  try {
    await api("/api/tablero-conexiones/" + encodeURIComponent(id), { method: "DELETE" });
  } catch (err) {
    alert("No se pudo borrar la conexión.\n" + err.message);
  }
}

// ---------- Dibujo de conexiones (SVG) ----------

function centroDeNodo(id) {
  const t = tareasGlobal.find((x) => x.id === id);
  if (!t) return null;
  let x = t.boardX ?? 0;
  let y = t.boardY ?? 0;
  if (dragState && dragState.id === id) { x = dragState.curX; y = dragState.curY; }
  return { x: x + 90, y: y + 24 };
}

function curvaEntre(a, b) {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

function dibujarConexiones() {
  const svg = document.getElementById("board-lines");
  svg.setAttribute("width", CANVAS_W);
  svg.setAttribute("height", CANVAS_H);
  svg.innerHTML = "";

  const visiblesIds = new Set(tareasVisibles().map((t) => t.id));

  conexionesGlobal.forEach((c) => {
    if (!visiblesIds.has(c.desdeId) || !visiblesIds.has(c.haciaId)) return;
    const a = centroDeNodo(c.desdeId);
    const b = centroDeNodo(c.haciaId);
    if (!a || !b) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", curvaEntre(a, b));
    path.setAttribute("class", "conn-line");
    path.dataset.id = c.id;
    path.addEventListener("click", () => borrarConexion(c.id));
    svg.appendChild(path);
  });

  tareasVisibles().forEach((t) => {
    if (!t.hora) return;
    const h = parseInt(t.hora.split(":")[0], 10);
    const anchorPoint = { x: 58, y: h * HOUR_HEIGHT };
    const centro = centroDeNodo(t.id);
    if (!centro) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", curvaEntre(anchorPoint, centro));
    path.setAttribute("class", "conn-time-line");
    svg.appendChild(path);
  });
}

// ---------- Acciones sobre una tarea ----------

async function toggleHecho(id, hecho) {
  const t = tareasGlobal.find((x) => x.id === id);
  if (t) t.hecho = hecho;
  const el = document.querySelector(`.task-node[data-id="${id}"]`);
  if (el) {
    el.classList.toggle("hecho", hecho);
    if (hecho) {
      el.classList.add("just-done");
      setTimeout(() => el.classList.remove("just-done"), 550);
    }
  }
  try {
    await api("/api/tablero-tareas/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hecho }),
    });
  } catch (err) {
    if (t) t.hecho = !hecho;
    renderTablero();
    alert("No se pudo actualizar la tarea.\n" + err.message);
  }
}

async function borrarTarea(id) {
  tareasGlobal = tareasGlobal.filter((x) => x.id !== id);
  conexionesGlobal = conexionesGlobal.filter((c) => c.desdeId !== id && c.haciaId !== id);
  renderTablero();
  try {
    await api("/api/tablero-tareas/" + encodeURIComponent(id), { method: "DELETE" });
  } catch (err) {
    alert("No se pudo borrar la tarea.\n" + err.message);
    cargarTodo();
  }
}

cargarTodo();
