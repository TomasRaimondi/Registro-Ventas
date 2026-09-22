"use strict";

var DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var TIPOS = ['Reel','Post','Story','Oferta'];
var ESTADOS = ['Idea','Grabando','Editando','Publicado'];

var FECHAS_COMERCIALES = [
  {fecha:'2026-10-18', label:'Día de la Madre', idea:'Combo o rutina pensada para mamás que entrenan'},
  {fecha:'2026-11-02', label:'CyberMonday (2 al 4 de nov.)', idea:'Descuentos mayorista y online, contenido de urgencia'},
  {fecha:'2026-11-27', label:'Black Friday', idea:'Ofertas fuertes, buen momento para liquidar stock'},
  {fecha:'2026-12-25', label:'Navidad', idea:'Ideas de regalo para alguien que entrena'},
  {fecha:'2027-01-06', label:'Día de Reyes', idea:'Última tanda de regalos fitness'},
  {fecha:'2027-01-15', label:'Temporada verano (ene-feb)', idea:'Contenido "objetivo verano" / definición'},
  {fecha:'2027-03-01', label:'Vuelta a clases', idea:'Arranque de rutina post-vacaciones'}
];

// ---------- Utilidades ----------

function todayDate(){ var d=new Date(); d.setHours(0,0,0,0); return d; }
function pad(n){ return String(n).length<2 ? '0'+n : String(n); }
function isoOf(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function parseISO(s){ if(!s) return null; var parts=s.split('-'); return new Date(Number(parts[0]),Number(parts[1])-1,Number(parts[2])); }
function monthLabel(d){ var m=MESES[d.getMonth()]; return m.charAt(0).toUpperCase()+m.slice(1)+' '+d.getFullYear(); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid(){ return 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

async function api(url, options) {
  var res = await fetch(url, Object.assign({ credentials: "same-origin" }, options || {}));
  if (!res.ok) {
    var err = await res.json().catch(function () { return {}; });
    var e = new Error(err.error || ("Error de red (" + res.status + ")"));
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Login ----------

var loginScreen = document.getElementById("login-screen");
var rootEl = document.getElementById("root");
var topnav = document.getElementById("topnav");
var logoutBtn = document.getElementById("logout-btn");

function showApp() {
  loginScreen.hidden = true;
  rootEl.hidden = false;
  topnav.hidden = false;
  cargarYRenderizar();
}

function showLogin() {
  loginScreen.hidden = false;
  rootEl.hidden = true;
  topnav.hidden = true;
}

document.getElementById("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  var password = document.getElementById("password").value;
  var errorHint = document.getElementById("login-error");
  errorHint.hidden = true;
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password }),
    });
    document.getElementById("password").value = "";
    showApp();
  } catch (err) {
    errorHint.textContent = err.message || "Contraseña incorrecta.";
    errorHint.hidden = false;
  }
});

logoutBtn.addEventListener("click", async function () {
  await api("/api/logout", { method: "POST" }).catch(function () {});
  showLogin();
});

async function checkAuth() {
  var r = await api("/api/auth-check");
  if (r.authenticated) showApp();
  else showLogin();
}

// ---------- Estado y persistencia (backend real, no artifact) ----------

var postsGlobal = [];
var toastTimer = null;

function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.hidden = true; }, 2600);
}

async function cargarYRenderizar() {
  try {
    postsGlobal = await api("/api/calendario-contenido");
  } catch (err) {
    if (err.status === 401) { showLogin(); return; }
    console.error(err);
    toast("No se pudo cargar el calendario.");
    return;
  }
  render();
}

async function upsertPost(post) {
  try {
    var saved = await api("/api/calendario-contenido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post),
    });
    var idx = -1;
    for (var i=0;i<postsGlobal.length;i++){ if (postsGlobal[i].id===saved.id){ idx=i; break; } }
    if (idx>=0) postsGlobal[idx]=saved; else postsGlobal.push(saved);
    render();
  } catch (err) {
    toast("No se pudo guardar. Probá de nuevo.");
  }
}

async function deletePost(id) {
  try {
    await api("/api/calendario-contenido/" + encodeURIComponent(id), { method: "DELETE" });
    postsGlobal = postsGlobal.filter(function(p){ return p.id!==id; });
    render();
  } catch (err) {
    toast("No se pudo eliminar. Probá de nuevo.");
  }
}

// ---------- Clases visuales ----------

function badgeClass(tipo){
  if(tipo==='Post') return 'badge-post';
  if(tipo==='Story') return 'badge-story';
  if(tipo==='Oferta') return 'badge-oferta';
  return 'badge-reel';
}
function estClass(estado){
  if(estado==='Grabando') return 'est-grabando';
  if(estado==='Editando') return 'est-editando';
  if(estado==='Publicado') return 'est-publicado';
  return 'est-idea';
}

// ---------- Modal de alta/edición ----------

function openModal(post){
  var isEdit = !!(post && postsGlobal.some(function(p){ return p.id===post.id; }));
  var p = post || {id:uid(), fecha:'', tipo:'Reel', tema:'', estado:'Idea', notas:''};

  var tipoOptions = TIPOS.map(function(t){ return '<option value="'+t+'"'+(t===p.tipo?' selected':'')+'>'+t+'</option>'; }).join('');
  var estadoOptions = ESTADOS.map(function(e){ return '<option value="'+e+'"'+(e===p.estado?' selected':'')+'>'+e+'</option>'; }).join('');

  var html = ''
    + '<div class="overlay" id="overlay">'
    + '<div class="modal">'
    + '<h2>'+(isEdit?'Editar contenido':'Nuevo contenido')+'</h2>'
    + '<div class="two-col">'
    + '<div class="field"><label>Fecha</label><input type="date" id="f-fecha" value="'+esc(p.fecha)+'"></div>'
    + '<div class="field"><label>Tipo</label><select id="f-tipo">'+tipoOptions+'</select></div>'
    + '</div>'
    + '<div class="field"><label>Tema / gancho</label><input type="text" id="f-tema" value="'+esc(p.tema)+'" placeholder="Ej: 3 beneficios de la creatina"></div>'
    + '<div class="field"><label>Estado</label><select id="f-estado">'+estadoOptions+'</select></div>'
    + '<div class="field"><label>Notas</label><textarea id="f-notas" placeholder="Guion, referencias, lo que haga falta">'+esc(p.notas)+'</textarea></div>'
    + '<div class="modal-actions">'
    + '<button class="btn btn-ghost" id="btn-cancel">Cancelar</button>'
    + '<button class="btn btn-accent" id="btn-save">Guardar</button>'
    + '</div>'
    + (isEdit ? '<button class="modal-delete" id="btn-delete">Eliminar este contenido</button>' : '')
    + '</div>'
    + '</div>';

  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstChild);

  var overlay = document.getElementById('overlay');
  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeModal(); });
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-save').addEventListener('click', function(){
    var tema = document.getElementById('f-tema').value.trim();
    if(!tema){ toast('Poné al menos un tema o gancho.'); return; }
    var newPost = {
      id: p.id,
      fecha: document.getElementById('f-fecha').value,
      tipo: document.getElementById('f-tipo').value,
      tema: tema,
      estado: document.getElementById('f-estado').value,
      notas: document.getElementById('f-notas').value.trim()
    };
    upsertPost(newPost);
    closeModal();
  });
  if(isEdit){
    document.getElementById('btn-delete').addEventListener('click', function(){
      deletePost(p.id);
      closeModal();
    });
  }
}

function closeModal(){
  var overlay = document.getElementById('overlay');
  if(overlay) overlay.remove();
}

function armDelete(btn, id){
  if(btn.dataset.armed==='1'){
    deletePost(id);
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = '¿Eliminar?';
  btn.classList.add('danger-armed');
  setTimeout(function(){
    if(btn && btn.isConnected){
      btn.dataset.armed='0';
      btn.textContent='×';
      btn.classList.remove('danger-armed');
    }
  }, 2600);
}

// ---------- Render ----------

function renderRow(p){
  var row = document.createElement('div');
  row.className = 'row';

  var dateCol = document.createElement('div');
  if(p.fecha){
    var d = parseISO(p.fecha);
    dateCol.className = 'row-date';
    dateCol.innerHTML = '<div class="wd">'+DIAS[d.getDay()]+'</div><div class="dn">'+d.getDate()+'</div>';
  } else {
    dateCol.className = 'row-date nofecha';
    dateCol.innerHTML = '<div class="wd">Sin</div><div class="wd">fecha</div>';
  }
  row.appendChild(dateCol);

  var main = document.createElement('div');
  main.className = 'row-main';

  var top = document.createElement('div');
  top.className = 'row-top';
  top.innerHTML = '<span class="badge '+badgeClass(p.tipo)+'">'+p.tipo+'</span><span class="tema">'+esc(p.tema)+'</span>';
  top.addEventListener('click', function(){ openModal(p); });
  main.appendChild(top);

  var bottom = document.createElement('div');
  bottom.className = 'row-bottom';

  var sel = document.createElement('select');
  sel.className = 'estado '+estClass(p.estado);
  ESTADOS.forEach(function(e){
    var opt = document.createElement('option');
    opt.value = e; opt.textContent = e;
    if(e===p.estado) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', function(){
    upsertPost({id:p.id, fecha:p.fecha, tipo:p.tipo, tema:p.tema, estado:sel.value, notas:p.notas});
  });
  bottom.appendChild(sel);

  if(p.notas){
    var notas = document.createElement('div');
    notas.className = 'notas-hint';
    notas.textContent = p.notas;
    bottom.appendChild(notas);
  } else {
    var spacer = document.createElement('div');
    spacer.className = 'notas-hint';
    bottom.appendChild(spacer);
  }

  var del = document.createElement('button');
  del.className = 'icon-btn';
  del.type = 'button';
  del.textContent = '×';
  del.setAttribute('aria-label','Eliminar');
  del.dataset.armed = '0';
  del.addEventListener('click', function(){ armDelete(del, p.id); });
  bottom.appendChild(del);

  main.appendChild(bottom);
  row.appendChild(main);
  return row;
}

function render(){
  var root = rootEl;
  root.innerHTML = '';

  var posts = postsGlobal.slice();

  var header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = ''
    + '<div class="header-row">'
    + '<div><h1>Calendario de contenido</h1><p>Platense Fit — Instagram</p></div>'
    + '<button class="btn btn-accent" id="btn-new">+ Nuevo</button>'
    + '</div>';
  root.appendChild(header);
  header.querySelector('#btn-new').addEventListener('click', function(){ openModal(null); });

  var hoy = todayDate();
  var hoyISO = isoOf(hoy);
  var upcoming = FECHAS_COMERCIALES.filter(function(f){ return f.fecha >= hoyISO; }).slice(0,6);
  if(upcoming.length){
    var refSection = document.createElement('div');
    var chipsHtml = '<div class="section-title">Fechas para tener en cuenta</div><div class="chips">';
    upcoming.forEach(function(f){
      var d = parseISO(f.fecha);
      chipsHtml += '<button class="chip" data-fecha="'+f.fecha+'" data-label="'+esc(f.label)+'" data-idea="'+esc(f.idea)+'">'
        + '<div class="chip-date">'+d.getDate()+' '+MESES[d.getMonth()].slice(0,3)+'</div>'
        + '<div class="chip-label">'+esc(f.label)+'</div>'
        + '<div class="chip-idea">'+esc(f.idea)+'</div>'
        + '</button>';
    });
    chipsHtml += '</div>';
    refSection.innerHTML = chipsHtml;
    root.appendChild(refSection);
    var chipBtns = refSection.querySelectorAll('.chip');
    for(var ci=0; ci<chipBtns.length; ci++){
      chipBtns[ci].addEventListener('click', function(){
        openModal({id:uid(), fecha:this.dataset.fecha, tipo:'Oferta', tema:this.dataset.label+': '+this.dataset.idea, estado:'Idea', notas:''});
      });
    }
  }

  var sinFecha = posts.filter(function(p){ return !p.fecha; });
  if(sinFecha.length){
    var sfSection = document.createElement('div');
    sfSection.className = 'month-group';
    var sfTitle = document.createElement('div');
    sfTitle.className = 'section-title';
    sfTitle.textContent = 'Ideas sin fecha';
    sfSection.appendChild(sfTitle);
    var sfList = document.createElement('div');
    sfList.className = 'list';
    sinFecha.forEach(function(p){ sfList.appendChild(renderRow(p)); });
    sfSection.appendChild(sfList);
    root.appendChild(sfSection);
  }

  var conFecha = posts.filter(function(p){ return !!p.fecha; }).sort(function(a,b){ return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
  if(conFecha.length){
    var currentKey = null;
    var currentList = null;
    var currentGroup = null;
    conFecha.forEach(function(p){
      var d = parseISO(p.fecha);
      var key = d.getFullYear()+'-'+d.getMonth();
      if(key!==currentKey){
        currentKey = key;
        currentGroup = document.createElement('div');
        currentGroup.className = 'month-group';
        var lbl = document.createElement('div');
        lbl.className = 'month-label';
        lbl.textContent = monthLabel(d);
        currentGroup.appendChild(lbl);
        currentList = document.createElement('div');
        currentList.className = 'list';
        currentGroup.appendChild(currentList);
        root.appendChild(currentGroup);
      }
      currentList.appendChild(renderRow(p));
    });
  }

  if(!posts.length){
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Todavía no hay contenido planeado. Tocá "+ Nuevo" para cargar la primera idea.';
    root.appendChild(empty);
  }
}

checkAuth();
