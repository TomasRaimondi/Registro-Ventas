function formatMonedaCorta(n) {
  return "$" + Math.round(n || 0).toLocaleString("es-AR");
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

const vistaMonto = document.getElementById("vista-monto");
const vistaQr = document.getElementById("vista-qr");
const montoInput = document.getElementById("monto-input");
const montoForm = document.getElementById("monto-form");
const generarBtn = document.getElementById("generar-btn");
const errorHint = document.getElementById("monto-error");

function mostrarVistaMonto() {
  vistaQr.style.display = "none";
  vistaMonto.style.display = "block";
  montoInput.value = "";
  errorHint.style.display = "none";
  montoInput.focus();
}

function mostrarVistaQr(monto, qrDataUrl) {
  vistaMonto.style.display = "none";
  vistaQr.style.display = "block";
  document.getElementById("qr-monto").textContent = formatMonedaCorta(monto);
  document.getElementById("qr-imagen").src = qrDataUrl;
}

montoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const monto = parseFloat(montoInput.value);
  errorHint.style.display = "none";

  if (!Number.isFinite(monto) || monto <= 0) {
    errorHint.textContent = "Ingresá un monto válido.";
    errorHint.style.display = "block";
    return;
  }

  generarBtn.disabled = true;
  generarBtn.textContent = "Generando...";
  try {
    const { qrDataUrl } = await api("/api/mercadopago/cobro-qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monto }),
    });
    mostrarVistaQr(monto, qrDataUrl);
  } catch (err) {
    errorHint.textContent = err.message || "No se pudo generar el QR.";
    errorHint.style.display = "block";
  } finally {
    generarBtn.disabled = false;
    generarBtn.textContent = "Generar QR";
  }
});

document.getElementById("nuevo-cobro-btn").addEventListener("click", mostrarVistaMonto);

montoInput.focus();
