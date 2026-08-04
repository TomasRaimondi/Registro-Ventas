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

function formatFecha(fecha) {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function getQuincena(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const half = d <= 15 ? 1 : 2;
  const key = (y * 12 + (m - 1)) * 2 + (half - 1);
  const ultimoDia = new Date(y, m, 0).getDate();
  const label = half === 1
    ? `1 al 15 de ${MESES[m - 1]} ${y}`
    : `16 al ${ultimoDia} de ${MESES[m - 1]} ${y}`;
  return { key, label };
}

function agruparPorQuincena(registros) {
  const mapa = new Map();
  registros.forEach(r => {
    const { key, label } = getQuincena(r.fecha);
    if (!mapa.has(key)) mapa.set(key, { label, sueldo: 0, comision: 0 });
    const acc = mapa.get(key);
    acc.sueldo += r.sueldo;
    acc.comision += r.comision;
  });
  return [...mapa.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

async function render() {
  let registros;
  try {
    registros = await fetch("/api/salario").then(r => r.json());
  } catch (err) {
    console.error("No se pudo cargar el salario:", err);
    return;
  }

  const sueldoAcumulado = registros.reduce((acc, r) => acc + r.sueldo, 0);
  const comisionesTotal = registros.reduce((acc, r) => acc + r.comision, 0);
  const diasTrabajados = new Set(registros.map(r => r.fecha)).size;

  document.getElementById("total-pagado").textContent = money(sueldoAcumulado + comisionesTotal);
  document.getElementById("sueldo-acumulado").textContent = money(sueldoAcumulado);
  document.getElementById("comisiones-total").textContent = money(comisionesTotal);
  document.getElementById("dias-trabajados").textContent =
    diasTrabajados === 1 ? "Trabajaste 1 día" : `Trabajaste ${diasTrabajados} días`;

  const quincenasBody = document.getElementById("quincenas-body");
  quincenasBody.innerHTML = "";
  const quincenas = agruparPorQuincena(registros);
  if (quincenas.length === 0) {
    quincenasBody.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no se cargó ningún día.</td></tr>`;
  } else {
    quincenas.forEach(q => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(q.label)}</td>
        <td>${q.sueldo > 0 ? money(q.sueldo) : "—"}</td>
        <td>${q.comision > 0 ? money(q.comision) : "—"}</td>
        <td><strong>${money(q.sueldo + q.comision)}</strong></td>
      `;
      quincenasBody.appendChild(tr);
    });
  }

  const body = document.getElementById("salario-body");
  body.innerHTML = "";
  if (registros.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">Todavía no se cargó ningún día.</td></tr>`;
    return;
  }

  [...registros].reverse().forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatFecha(r.fecha)}</td>
      <td>${r.sueldo > 0 ? money(r.sueldo) : "—"}</td>
      <td>${r.comision > 0 ? money(r.comision) : "—"}</td>
      <td>${r.nota ? escapeHtml(r.nota) : ""}</td>
    `;
    body.appendChild(tr);
  });
}

render();
setInterval(render, 15000);
