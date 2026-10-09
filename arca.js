// Integración directa con los webservices de ARCA (ex-AFIP) para facturación electrónica:
// WSAA (autenticación) + WSFEv1 (factura electrónica). Sin intermediarios pagos: habla
// directo contra los servidores de ARCA usando el certificado propio de cada negocio.
//
// Los formatos de acá (XML del TRA, namespaces, nombres de campo) salen del WSDL real,
// bajado directo de los servidores de ARCA (no de documentación de terceros, que a veces
// queda desactualizada):
//   https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL
//   https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
//
// Cada negocio (tenant) tiene su propio certificado/clave — ARCA no permite facturar "en
// nombre de otro" sin que ese otro tenga su propio certificado dado de alta. Por eso todas
// las funciones de acá reciben el certificado/CUIT como parámetro, nunca como config global.

const { execFile } = require("node:child_process");
const { XMLParser } = require("fast-xml-parser");

const ENDPOINTS = {
  testing: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

function endpointsDe(ambiente) {
  const e = ENDPOINTS[ambiente];
  if (!e) throw new Error(`Ambiente ARCA inválido: "${ambiente}" (debe ser "testing" o "producción")`);
  return e;
}

// ---------- Firma CMS del TRA (Ticket de Requerimiento de Acceso) ----------
//
// ARCA exige el TRA firmado en formato CMS/PKCS#7 (sin detach), codificado en base64. Se
// usa el binario de openssl del sistema en vez de una librería de Node: es el mismo
// mecanismo que usan prácticamente todas las integraciones de ARCA en cualquier lenguaje,
// viene instalado en cualquier servidor Linux (incluido Render) y evita depender de un
// paquete de npm poco mantenido para la parte más delicada de todo esto.
function firmarCMS(xml, certPath, keyPath) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "openssl",
      ["smime", "-sign", "-signer", certPath, "-inkey", keyPath, "-nodetach", "-outform", "DER"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`No se pudo firmar el TRA con openssl: ${stderr ? stderr.toString() : err.message}`));
          return;
        }
        resolve(stdout.toString("base64"));
      }
    );
    child.stdin.write(xml);
    child.stdin.end();
  });
}

// Fecha en el formato que pide ARCA: ISO 8601 con el offset de Argentina (-03:00), sin
// milisegundos. new Date().toISOString() da UTC con "Z" — se convierte a mano.
function fechaArgentinaISO(date) {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

function crearTRA(service) {
  const ahora = new Date();
  const uniqueId = Math.floor(ahora.getTime() / 1000);
  const generationTime = fechaArgentinaISO(new Date(ahora.getTime() - 10 * 60 * 1000));
  const expirationTime = fechaArgentinaISO(new Date(ahora.getTime() + 10 * 60 * 1000));
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

async function soapCall(url, soapActionNs, operationXml) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    ${operationXml}
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: soapActionNs },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) {
    // ARCA suele responder un SOAP Fault con el motivo real (certificado no confiable,
    // CUIT sin relación con el servicio, etc.) — se muestra ese mensaje en vez del XML
    // crudo, que es ilegible para quien use el sistema.
    const fault = xmlParser.parse(text)?.Envelope?.Body?.Fault;
    if (fault) {
      throw new Error(`ARCA rechazó la solicitud: ${fault.faultstring || fault.faultcode || "sin detalle"}`);
    }
    throw new Error(`ARCA respondió HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return xmlParser.parse(text);
}

// ---------- WSAA: pide el Ticket de Acceso (token + sign), válido 12hs ----------
//
// Se cachea en memoria por certificado+ambiente (no por tenant: si dos tenants comparten
// certificado -algo raro pero posible- comparten también el TA, que es válido igual).
const cacheTA = new Map();

async function obtenerTA({ certPath, keyPath, ambiente }) {
  const key = `${certPath}|${ambiente}`;
  const cacheado = cacheTA.get(key);
  if (cacheado && cacheado.vencimiento > Date.now() + 60 * 1000) {
    return cacheado;
  }

  const tra = crearTRA("wsfe");
  const cms = await firmarCMS(tra, certPath, keyPath);

  const resultado = await soapCall(
    endpointsDe(ambiente).wsaa,
    "",
    `<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><in0>${cms}</in0></loginCms>`
  );

  const envelope = resultado?.Envelope ?? resultado;
  const loginCmsReturn = envelope?.Body?.loginCmsResponse?.loginCmsReturn;
  if (!loginCmsReturn) {
    throw new Error("WSAA no devolvió loginCmsReturn: " + JSON.stringify(resultado).slice(0, 500));
  }

  // loginCmsReturn es el XML de LoginTicketResponse como texto plano (no anidado), hay
  // que parsearlo de nuevo.
  const respuesta = xmlParser.parse(loginCmsReturn);
  const credenciales = respuesta?.loginTicketResponse?.credentials;
  if (!credenciales || !credenciales.token || !credenciales.sign) {
    throw new Error("WSAA no devolvió token/sign: " + loginCmsReturn.slice(0, 500));
  }

  const ta = {
    token: String(credenciales.token),
    sign: String(credenciales.sign),
    vencimiento: Date.now() + 12 * 60 * 60 * 1000,
  };
  cacheTA.set(key, ta);
  return ta;
}

// ---------- WSFEv1 ----------

// Sin autenticación: sirve para probar que la conexión y el armado del sobre SOAP andan
// bien, sin necesitar certificado todavía.
async function dummy({ ambiente }) {
  const resultado = await soapCall(
    endpointsDe(ambiente).wsfe,
    "http://ar.gov.afip.dif.FEV1/FEDummy",
    `<FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" />`
  );
  const r = resultado?.Envelope?.Body?.FEDummyResponse?.FEDummyResult;
  if (!r) throw new Error("WSFEv1 no devolvió resultado de FEDummy: " + JSON.stringify(resultado).slice(0, 500));
  return { appServer: r.AppServer, dbServer: r.DbServer, authServer: r.AuthServer };
}

function authXml({ token, sign, cuit }) {
  return `<Auth><Token>${token}</Token><Sign>${sign}</Sign><Cuit>${cuit}</Cuit></Auth>`;
}

// Último número de comprobante autorizado para un punto de venta + tipo: para saber qué
// número sigue (CbteDesde/CbteHasta = ese + 1).
async function compUltimoAutorizado({ ta, cuit, ptoVta, cbteTipo, ambiente }) {
  const resultado = await soapCall(
    endpointsDe(ambiente).wsfe,
    "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
    `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">
      ${authXml({ ...ta, cuit })}
      <PtoVta>${ptoVta}</PtoVta>
      <CbteTipo>${cbteTipo}</CbteTipo>
    </FECompUltimoAutorizado>`
  );
  const r = resultado?.Envelope?.Body?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;
  if (!r) throw new Error("WSFEv1 no devolvió resultado de FECompUltimoAutorizado: " + JSON.stringify(resultado).slice(0, 500));
  const errores = normalizarArray(r.Errors?.Err);
  if (errores.length) throw new Error("ARCA rechazó la consulta: " + errores.map((e) => `[${e.Code}] ${e.Msg}`).join(" | "));
  return Number(r.CbteNro) || 0;
}

function normalizarArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Pide el CAE (Código de Autorización Electrónico) de UN comprobante. "item" trae:
// cbteTipo, docTipo, docNro, importeTotal, importeNeto, importeIva, alicuotasIva
// ([{id, baseImp, importe}]), condicionIVAReceptorId.
async function caeSolicitar({ ta, cuit, ptoVta, cbteTipo, cbteNro, item, ambiente }) {
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const ivaXml = (item.alicuotasIva || [])
    .map((a) => `<AlicIva><Id>${a.id}</Id><BaseImp>${a.baseImp.toFixed(2)}</BaseImp><Importe>${a.importe.toFixed(2)}</Importe></AlicIva>`)
    .join("");

  const resultado = await soapCall(
    endpointsDe(ambiente).wsfe,
    "http://ar.gov.afip.dif.FEV1/FECAESolicitar",
    `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
      ${authXml({ ...ta, cuit })}
      <FeCAEReq>
        <FeCabReq>
          <CantReg>1</CantReg>
          <PtoVta>${ptoVta}</PtoVta>
          <CbteTipo>${cbteTipo}</CbteTipo>
        </FeCabReq>
        <FeDetReq>
          <FECAEDetRequest>
            <Concepto>1</Concepto>
            <DocTipo>${item.docTipo}</DocTipo>
            <DocNro>${item.docNro}</DocNro>
            <CbteDesde>${cbteNro}</CbteDesde>
            <CbteHasta>${cbteNro}</CbteHasta>
            <CbteFch>${hoy}</CbteFch>
            <ImpTotal>${item.importeTotal.toFixed(2)}</ImpTotal>
            <ImpTotConc>0.00</ImpTotConc>
            <ImpNeto>${item.importeNeto.toFixed(2)}</ImpNeto>
            <ImpOpEx>0.00</ImpOpEx>
            <ImpTrib>0.00</ImpTrib>
            <ImpIVA>${item.importeIva.toFixed(2)}</ImpIVA>
            <MonId>PES</MonId>
            <MonCotiz>1</MonCotiz>
            <CondicionIVAReceptorId>${item.condicionIVAReceptorId}</CondicionIVAReceptorId>
            ${item.alicuotasIva && item.alicuotasIva.length ? `<Iva>${ivaXml}</Iva>` : ""}
          </FECAEDetRequest>
        </FeDetReq>
      </FeCAEReq>
    </FECAESolicitar>`
  );

  const r = resultado?.Envelope?.Body?.FECAESolicitarResponse?.FECAESolicitarResult;
  if (!r) throw new Error("WSFEv1 no devolvió resultado de FECAESolicitar: " + JSON.stringify(resultado).slice(0, 500));

  const erroresGenerales = normalizarArray(r.Errors?.Err);
  if (erroresGenerales.length) {
    throw new Error("ARCA rechazó la solicitud: " + erroresGenerales.map((e) => `[${e.Code}] ${e.Msg}`).join(" | "));
  }

  const det = normalizarArray(r.FeDetResp?.FECAEDetResponse)[0];
  if (!det) throw new Error("ARCA no devolvió el detalle del comprobante: " + JSON.stringify(r).slice(0, 500));

  if (det.Resultado !== "A") {
    const obs = normalizarArray(det.Observaciones?.Obs).map((o) => `[${o.Code}] ${o.Msg}`).join(" | ");
    throw new Error(`ARCA no autorizó el comprobante (Resultado=${det.Resultado}): ${obs || "sin detalle"}`);
  }

  return {
    cae: String(det.CAE),
    caeFchVto: String(det.CAEFchVto),
    cbteNro,
    ptoVta,
    cbteTipo,
  };
}

// ---------- Punto de entrada de alto nivel ----------
//
// Orquesta todo: autentica, pide el próximo número, pide el CAE. "tenant.arca" trae
// {cuit, puntoVenta, certPath, keyPath, ambiente}.
async function facturar(tenantArca, item) {
  const ta = await obtenerTA({ certPath: tenantArca.certPath, keyPath: tenantArca.keyPath, ambiente: tenantArca.ambiente });
  const ultimo = await compUltimoAutorizado({
    ta, cuit: tenantArca.cuit, ptoVta: tenantArca.puntoVenta, cbteTipo: item.cbteTipo, ambiente: tenantArca.ambiente,
  });
  const cbteNro = ultimo + 1;
  return caeSolicitar({
    ta, cuit: tenantArca.cuit, ptoVta: tenantArca.puntoVenta, cbteTipo: item.cbteTipo, cbteNro, item, ambiente: tenantArca.ambiente,
  });
}

module.exports = { dummy, obtenerTA, compUltimoAutorizado, caeSolicitar, facturar };
