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

  document.getElementById("sueldo-acumulado").textContent = money(sueldoAcumulado);
  document.getElementById("comisiones-total").textContent = money(comisionesTotal);
  document.getElementById("dias-trabajados").textContent =
    diasTrabajados === 1 ? "Trabajaste 1 día" : `Trabajaste ${diasTrabajados} días`;

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
