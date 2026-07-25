/**
 * Byggetidsprobe for Norges Bank-katalogens tidsperioder.
 *
 * BAKGRUNN: js/sources/norges-bank-adapter.js hadde ingen billig vei til
 * «Tidsperiode»/«Sist oppdatert» for katalogen — feltene ble fylt av ETT
 * probekall per katalograd ved hver app-init. Med 31 kuraterte rader betød det
 * 31 samtidige kall mot data.norges-bank.no for hver kalde sidelasting (og for
 * hvert crawler-treff på de pre-rendrede SEO-sidene), som i tillegg blokkerte
 * BrowserState.init(). Probene kjøres derfor ved BYGGETID i stedet, og
 * resultatet sjekkes inn som data/sources/nb-periods.{json,js} — se
 * scripts/update-nb-periods.mjs.
 *
 * Selve proben speiler fetchCataloguePeriod() i adapteren:
 * `?firstNObservations=1&lastNObservations=1` gir unionen av første og siste
 * observasjon per serie i ett lite svar. HOLD DE TO I SYNC — særlig
 * probenøkkel-utledningen (probeKeyFor) og lesingen av observasjonsdimensjonen.
 *
 * Ingen npm-avhengigheter; krever Node 18+ (global fetch).
 */

/** Årstallet i en SDMX-periodekode ('2026-07-24' → 2026), eller NaN. */
function periodYear(code) {
  const m = /\d{4}/.exec(String(code || ''));
  return m ? Number(m[0]) : NaN;
}

/**
 * Periode-probenøkkelen for en config-rad — samme regel som probeKeyFor(flow,
 * 'period') i adapteren: streng = samme nøkkel for begge prober,
 * {period, time} = separate nøkler, mangler = åpen probe.
 */
function periodProbeKey(flow) {
  const pk = flow && flow.probeKey;
  if (!pk) return '';
  if (typeof pk === 'string') return pk;
  return pk.period || '';
}

/**
 * Hvilke prober katalogen trenger, én per config-rad.
 *
 * Nøkkelen i resultatfila er `tableId`, IKKE `flow`: flere rader kan dele
 * samme dataflow med hvert sitt snitt (REGNET ×7, GOVT_PRIMARY_MARKET ×6,
 * GOVT_SECONDARY_MARKET ×3) og har da ulike tidsvinduer. `probeId` grupperer
 * radene som ville sendt en IDENTISK forespørsel, slik at probeAll bare kaller
 * én gang per unike flow+nøkkel-par.
 *
 * @param {object} appConfig - AppConfig fra js/config.js
 * @returns {Array<{tableId:string, flow:string, probeKey:string, probeId:string, url:string}>}
 */
export function probeTargets(appConfig) {
  const cfg = (appConfig && appConfig.sources && appConfig.sources.nb) || {};
  const base = String(cfg.baseUrl || 'https://data.norges-bank.no/api').replace(/\/+$/, '');
  return (cfg.dataflows || []).map(flow => {
    const probeKey = periodProbeKey(flow);
    return {
      tableId: flow.tableId,
      flow: flow.flow,
      probeKey,
      probeId: flow.flow + '|' + probeKey,
      url: base + '/data/' + encodeURIComponent(flow.flow) + '/' + probeKey +
        '?format=sdmx-json&firstNObservations=1&lastNObservations=1'
    };
  });
}

/**
 * Les tidsvinduet ut av et SDMX-JSON probesvar.
 *
 * `firstCode`/`lastCode` er de EKSAKTE ytterperiodene (proben henter nettopp
 * første og siste observasjon) — tidsvelgeren i variable-select forhåndsutfyller
 * fra/til med dem, mens årstallene alene ville gitt «1. januar»/«31. desember».
 *
 * @returns {{firstPeriod:string,lastPeriod:string,firstCode:string,lastCode:string,updated:string}|null}
 */
export function parseProbeResponse(json) {
  if (!json) return null;
  // SDMX-JSON har enten data.structure (objekt) eller data.structures[0] (array).
  const data = json.data;
  const struct = (data && data.structure) ||
    (data && Array.isArray(data.structures) ? data.structures[0] : null);
  const obsDim = struct && struct.dimensions && Array.isArray(struct.dimensions.observation)
    ? struct.dimensions.observation[0] : null;
  const values = (obsDim && Array.isArray(obsDim.values)) ? obsDim.values.map(v => v.id) : [];
  if (values.length === 0) return null;

  let minY = Infinity, maxY = -Infinity;
  values.forEach(code => {
    const y = periodYear(code);
    if (!Number.isNaN(y)) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;

  const sorted = values.slice().sort();
  return {
    firstPeriod: String(minY),
    lastPeriod: String(maxY),
    firstCode: sorted[0],
    lastCode: sorted[sorted.length - 1],
    updated: (json.meta && json.meta.prepared) || ''
  };
}

/**
 * Kjør alle probene og bygg innholdet i data/sources/nb-periods.json.
 *
 * Kallene går SEKVENSIELT med `delayMs` pause — dette er et byggescript, ikke
 * en brukervei, og skal skalere skånsomt om katalogen vokser. En feilende probe
 * logges og hoppes over (raden får ingen oppføring og degraderer til tomme
 * periodefelt i appen) — aldri abort: en enkelt utilgjengelig dataflow skal
 * ikke stoppe hele regenereringen.
 *
 * @param {object} appConfig
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl] - injiserbar fetch (tester)
 * @param {number}   [opts.delayMs]   - pause mellom kall, default 250
 * @param {function} [opts.warn]      - advarselslogger
 * @param {function} [opts.log]       - fremdriftslogger
 * @returns {Promise<{generatedAt:string, tables:Object<string,object>}>}
 */
export async function probeAll(appConfig, opts = {}) {
  const doFetch = opts.fetchImpl || fetch;
  const delayMs = opts.delayMs === undefined ? 250 : opts.delayMs;
  const warn = opts.warn || (() => {});
  const log = opts.log || (() => {});

  const targets = probeTargets(appConfig);
  const byProbe = new Map(); // probeId → periodeobjekt | null
  const tables = {};

  let issued = 0;
  for (const target of targets) {
    if (!byProbe.has(target.probeId)) {
      if (issued > 0 && delayMs) await new Promise(r => setTimeout(r, delayMs));
      issued++;
      try {
        const res = await doFetch(target.url, { headers: { Accept: 'application/json, */*' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        byProbe.set(target.probeId, parseProbeResponse(await res.json()));
      } catch (err) {
        byProbe.set(target.probeId, null);
        warn(`Periodeprobe feilet for ${target.tableId} (${target.flow}): ${err.message} — ` +
             'raden får tomme periodefelt.');
      }
      log(`  ${target.flow}${target.probeKey ? '/' + target.probeKey : ''} → ${target.tableId}`);
    }

    const period = byProbe.get(target.probeId);
    if (period) tables[target.tableId] = period;
  }

  return { generatedAt: new Date().toISOString(), tables };
}
