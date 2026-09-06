// Helpers compartidos por las páginas "app" para celular.

function money(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
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

// ---------- Toast ----------

let __toastTimer;
function toast(txt, ok) {
  const t = document.getElementById("toast");
  if (!t) return;
  const icon = document.getElementById("toastIcon");
  if (icon) icon.textContent = ok === false ? "!" : "✓";
  document.getElementById("toastText").textContent = txt;
  t.classList.toggle("bad", ok === false);
  t.classList.add("show");
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- Panel lateral (drawer) ----------

function initDrawer() {
  const openBtn = document.getElementById("open");
  const scrim = document.getElementById("scrim");
  if (!openBtn || !scrim) return;

  const openNav = () => { document.body.classList.add("nav-open"); buzz(8); };
  const closeNav = () => document.body.classList.remove("nav-open");
  openBtn.onclick = () => (document.body.classList.contains("nav-open") ? closeNav() : openNav());
  scrim.onclick = closeNav;

  const navDesktop = document.getElementById("navDesktop");
  if (navDesktop) {
    navDesktop.onclick = () => {
      try { sessionStorage.setItem("forzar-desktop", "1"); } catch (e) {}
      location.href = "/";
    };
  }

  let swipeX = null, swipeY = null;
  addEventListener("touchstart", (e) => { swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; }, { passive: true });
  addEventListener("touchend", (e) => {
    if (swipeX === null) return;
    const dx = e.changedTouches[0].clientX - swipeX;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeY);
    if (dy < 60) {
      if (swipeX < 26 && dx > 55) openNav();
      if (document.body.classList.contains("nav-open") && dx < -55) closeNav();
    }
    swipeX = null;
  }, { passive: true });
}

document.addEventListener("DOMContentLoaded", initDrawer);
