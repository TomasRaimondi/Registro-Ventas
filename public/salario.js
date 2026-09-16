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

// Junta el sueldo/bono mayorista (cargados a mano, un registro por día) con el bono
// minorista (calculado solo, una fila por venta que comisiona) en un solo mapa por
// fecha, para poder agruparlos juntos por quincena y por día.
function agruparPorFecha(registros, comisiones) {
  const mapa = new Map();
  registros.forEach(r => {
    if (!mapa.has(r.fecha)) mapa.set(r.fecha, { fecha: r.fecha, sueldo: 0, bonoMayorista: 0, bonoMinorista: 0, notas: [] });
    const acc = mapa.get(r.fecha);
    acc.sueldo += r.sueldo;
    acc.bonoMayorista += r.comision;
    if (r.nota) acc.notas.push(r.nota);
  });
  comisiones.forEach(c => {
    if (!mapa.has(c.fecha)) mapa.set(c.fecha, { fecha: c.fecha, sueldo: 0, bonoMayorista: 0, bonoMinorista: 0, notas: [] });
    mapa.get(c.fecha).bonoMinorista += c.comision;
  });
  return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function agruparPorQuincena(porFecha) {
  const mapa = new Map();
  porFecha.forEach(r => {
    const { key, label } = getQuincena(r.fecha);
    if (!mapa.has(key)) mapa.set(key, { label, sueldo: 0, bonoMinorista: 0, bonoMayorista: 0 });
    const acc = mapa.get(key);
    acc.sueldo += r.sueldo;
    acc.bonoMinorista += r.bonoMinorista;
    acc.bonoMayorista += r.bonoMayorista;
  });
  return [...mapa.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

async function render() {
  let registros, comisiones;
  try {
    [registros, comisiones] = await Promise.all([
      fetch("/api/salario").then(r => r.json()),
      fetch("/api/comisiones-minoristas").then(r => r.json()),
    ]);
  } catch (err) {
    console.error("No se pudo cargar el salario:", err);
    return;
  }

  const porFecha = agruparPorFecha(registros, comisiones);

  const sueldoAcumulado = porFecha.reduce((acc, r) => acc + r.sueldo, 0);
  const bonoMinoristaTotal = porFecha.reduce((acc, r) => acc + r.bonoMinorista, 0);
  const bonoMayoristaTotal = porFecha.reduce((acc, r) => acc + r.bonoMayorista, 0);
  const diasTrabajados = new Set(registros.map(r => r.fecha)).size;

  document.getElementById("total-pagado").textContent = money(sueldoAcumulado + bonoMinoristaTotal + bonoMayoristaTotal);
  document.getElementById("sueldo-acumulado").textContent = money(sueldoAcumulado);
  document.getElementById("comisiones-total").textContent = money(bonoMinoristaTotal + bonoMayoristaTotal);
  document.getElementById("dias-trabajados").textContent =
    diasTrabajados === 1 ? "Trabajaste 1 día" : `Trabajaste ${diasTrabajados} días`;

  const quincenasBody = document.getElementById("quincenas-body");
  quincenasBody.innerHTML = "";
  const quincenas = agruparPorQuincena(porFecha);
  if (quincenas.length === 0) {
    quincenasBody.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no se cargó ningún día.</td></tr>`;
  } else {
    quincenas.forEach(q => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(q.label)}</td>
        <td>${q.sueldo > 0 ? money(q.sueldo) : "—"}</td>
        <td style="color:var(--green);">${q.bonoMinorista > 0 ? money(q.bonoMinorista) : "—"}</td>
        <td>${q.bonoMayorista > 0 ? money(q.bonoMayorista) : "—"}</td>
        <td><strong>${money(q.sueldo + q.bonoMinorista + q.bonoMayorista)}</strong></td>
      `;
      quincenasBody.appendChild(tr);
    });
  }

  const body = document.getElementById("salario-body");
  body.innerHTML = "";
  if (porFecha.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">Todavía no se cargó ningún día.</td></tr>`;
    return;
  }

  [...porFecha].reverse().forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatFecha(r.fecha)}</td>
      <td>${r.sueldo > 0 ? money(r.sueldo) : "—"}</td>
      <td style="color:var(--green);">${r.bonoMinorista > 0 ? money(r.bonoMinorista) : "—"}</td>
      <td>${r.bonoMayorista > 0 ? money(r.bonoMayorista) : "—"}</td>
      <td>${r.notas.length ? escapeHtml(r.notas.join(", ")) : ""}</td>
    `;
    body.appendChild(tr);
  });
}

render();
setInterval(render, 15000);
