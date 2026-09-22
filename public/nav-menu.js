// Menú de navegación desplegable compartido por todas las páginas de escritorio.
// Reemplaza la fila larga de ~15 botones del topbar: acá solo se define la estructura
// una vez, agrupada por categoría, y cada página la monta en su <div id="app-nav">.
(function () {
  "use strict";

  var NAV_CATEGORIAS = [
    {
      label: "Ventas",
      items: [
        { href: "/", label: "Registro de Ventas" },
        { href: "/carga-historica.html", label: "Cargar Ventas Pasadas" },
        { href: "/tablero.html", label: "Tablero" },
        { href: "/ventas-perdidas.html", label: "Ventas Perdidas" },
        { href: "/ingresos-cliente.html", label: "Ingresos de Clientes" },
      ],
    },
    {
      label: "Ganancias",
      items: [
        { href: "/ganancias.html", label: "Panel de Ganancias" },
        { href: "/reportes.html", label: "Reportes" },
        { href: "/rentabilidad.html", label: "Rentabilidad" },
        { href: "/gastos.html", label: "Gastos" },
        { href: "/balance.html", label: "Situación Financiera" },
        { href: "/salario.html", label: "Mi Salario" },
        { href: "/comisiones-minoristas.html", label: "Comisiones Minoristas" },
      ],
    },
    {
      label: "Mayorista",
      items: [
        { href: "/pedidos-mayoristas.html", label: "Pedidos Mayoristas" },
        { href: "/recompra-mayoristas.html", label: "Recompra Mayoristas" },
      ],
    },
    {
      label: "Clientes y envíos",
      items: [
        { href: "/clientes.html", label: "Recompra de Clientes" },
        { href: "/envios.html", label: "Envíos Uber Moto" },
        { href: "/pagos.html", label: "Pagos Recibidos" },
      ],
    },
    {
      label: "Otros",
      items: [
        { href: "/anuncios.html", label: "Anuncios" },
        { href: "/compras-stock.html", label: "Compras de Stock" },
        { href: "/calendario-contenido.html", label: "Calendario de Contenido" },
        { href: "/inversiones.html", label: "Inversiones" },
      ],
    },
  ];

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function initNavMenu() {
    var mount = document.getElementById("app-nav");
    if (!mount) return;

    var actual = location.pathname === "" ? "/" : location.pathname;

    var groupsHtml = NAV_CATEGORIAS.map(function (cat) {
      var itemsHtml = cat.items
        .map(function (it) {
          var esActual = it.href === actual;
          return (
            '<a href="' + it.href + '"' + (esActual ? ' aria-current="page"' : "") + ">" +
            escapeHtml(it.label) +
            "</a>"
          );
        })
        .join("");
      return (
        '<div class="nav-group"><div class="nav-group-title">' +
        escapeHtml(cat.label) +
        "</div>" +
        itemsHtml +
        "</div>"
      );
    }).join("");

    mount.innerHTML =
      '<div class="nav-wrap" id="navWrap">' +
      '<button type="button" class="nav-menu-btn" id="navMenuBtn">☰ Menú <span class="nav-caret">▾</span></button>' +
      '<div class="nav-panel">' + groupsHtml + "</div>" +
      "</div>";

    var wrap = document.getElementById("navWrap");
    var btn = document.getElementById("navMenuBtn");

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      wrap.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) wrap.classList.remove("open");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") wrap.classList.remove("open");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNavMenu);
  } else {
    initNavMenu();
  }
})();
