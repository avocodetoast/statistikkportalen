/**
 * Norges Bank source adapter — Statistikkportalen 2.0  (Fase B)
 * ============================================================
 *
 * Implementerer adapterkontrakten i js/sources/source-registry.js for Norges
 * Banks SDMX REST v2.1-API (data.norges-bank.no). Registrerer seg ved å dytte
 * ETT adapterobjekt på window.SourceAdapters (laster FØR source-registry.js).
 *
 * KILDE / SDMX REST
 * -----------------
 * Base-URL og dataflows leses fra AppConfig.sources.nb:
 *   .baseUrl    // 'https://data.norges-bank.no/api'
 *   .enabled    // hopp over registrering hvis false
 *   .dataflows  // [{ flow, version, tableId, path, label:{nb,en} }]
 * Kjerneutvalg: EXR, IR, SHORT_RATES, GOVT_GENERIC_RATES.
 *
 *   Datastruktur : GET /datastructure/NB/DSD_{FLOW}?references=codelist&format=sdmx-json
 *   Data         : GET /data/{FLOW}/{key}?format=sdmx-json&locale=no|en[&lastNObservations=|startPeriod=|endPeriod=]
 *
 * Nøkkel = punktseparerte dimensjonskoder i DSD-rekkefølge; '+' for flere verdier
 * i én dimensjon; tom segment = alle verdier. FREQ er alltid første dimensjon.
 *
 * KATALOG er nettverksfri (bygges fra config); metadata gjør DSD-fetch +
 * TIME_PERIOD-probe; data gjør ett datakall. HTTP 404 (også «traff ingen
 * observasjoner») = TOMT resultat, ikke feil.
 *
 * SPRÅK: locale=no/en. Konvertering SDMX→JSON-Stat2 gjøres av window.SdmxToJsonStat.
 * CACHING: delt CacheManager, nøkkel-infiks 'nb_'/'nb-' (cache.js hopper over
 * SSB-oppdateringsplan-staleness), ren 24 t TTL.
 */
(function () {
  'use strict';

  const logger = window.logger || console;

  const cfg = (window.AppConfig && window.AppConfig.sources && window.AppConfig.sources.nb) || null;
  if (!cfg) {
    logger.warn && logger.warn('[NBAdapter] AppConfig.sources.nb mangler — registrerer ikke.');
    return;
  }
  if (cfg.enabled === false) {
    return; // Kilden er avskrudd i config.
  }
  if (!window.SdmxToJsonStat) {
    logger.error && logger.error('[NBAdapter] window.SdmxToJsonStat ikke lastet — sjekk load-order (sdmx-to-jsonstat.js før denne).');
    return;
  }

  const BASE = (cfg.baseUrl || 'https://data.norges-bank.no/api').replace(/\/+$/, '');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL = (window.AppConfig.cache && window.AppConfig.cache.tableListTTL) || DAY_MS; // 24 t
  const TIME_PROBE_N = 60;

  // Statiske søkeord per flow (holder getAllTables nettverksfri). Tospråklig.
  const VARIABLE_NAMES = {
    EXR: ['Valutakurser', 'Valuta', 'Basisvaluta', 'Kvoteringsvaluta', 'Kurs', 'Exchange rates', 'Currency'],
    IR: ['Styringsrenten', 'Styringsrente', 'Rente', 'Foliorente', 'Policy rate', 'Key policy rate'],
    SHORT_RATES: ['NOWA', 'Kortsiktige renter', 'Pengemarkedsrente', 'Rente', 'Short-term interest rates'],
    GOVT_GENERIC_RATES: ['Statsobligasjonsrenter', 'Statsobligasjon', 'Statsrente', 'Rente', 'Government bond yields']
  };

  // Emnesubjektets sortCode (samsvarer med SSBs 'bf'-node; kosmetisk siden
  // SSB-tabeller oppretter subjektnoden først). '9xx'-nodene sist blant undertemaene.
  const SUBJECT_SORTCODE = { bf: '0000006' };

  // ---- Språk-/cache-hjelpere ----

  function apiLang(lang) {
    const l = String(lang || 'no').toLowerCase();
    return l === 'nb' ? 'no' : (l === 'en' ? 'en' : 'no');
  }
  function uiLabelLang(lang) {
    // config-labels bruker {nb,en}. 'no'→'nb'.
    const l = String(lang || 'nb').toLowerCase();
    return l === 'no' ? 'nb' : l;
  }
  /** Slå opp en {nb,en}-label for gjeldende språk med nb-fallback. */
  function pickLabel(labelObj, lang) {
    if (!labelObj) return '';
    const l = uiLabelLang(lang);
    return labelObj[l] || labelObj.nb || labelObj.en || '';
  }

  let _cache = null;
  function cache() {
    if (_cache) return _cache;
    // Gjenbruk SSBs delte CacheManager om mulig (samme localStorage/IndexedDB).
    const ssbCache = window.SourceRegistry && window.SourceRegistry.ssb &&
      window.SourceRegistry.ssb.instance && window.SourceRegistry.ssb.instance.cache;
    _cache = ssbCache || (typeof window.CacheManager === 'function' ? new window.CacheManager() : null);
    return _cache;
  }
  async function cacheGet(key) {
    const c = cache();
    if (!c) return null;
    try { return await c.get(key); } catch (e) { return null; }
  }
  async function cacheSet(key, value) {
    const c = cache();
    if (!c) return;
    try { await c.set(key, value, TTL); } catch (e) { /* ignorer cache-feil */ }
  }

  // ---- Fetch-hjelpere ----

  /** Hent JSON. Returnerer {status, json}; kaster kun på nettverksfeil. */
  async function fetchSdmx(url) {
    // Format velges via ?format=sdmx-json i URL-en. En spesifikk vnd.sdmx-Accept
    // kolliderer med format-parameteren og gir 406 på strukturendepunktet, så vi
    // holder oss til et generisk Accept.
    const res = await fetch(url, { headers: { Accept: 'application/json, */*' } });
    if (res.status === 404) return { status: 404, json: null };
    if (!res.ok) {
      // Norges Bank returnerer XML-feil; vi trenger bare statuskoden.
      throw new Error('[NBAdapter] HTTP ' + res.status + ' for ' + url);
    }
    const json = await res.json();
    return { status: res.status, json: json };
  }

  const currentLang = () =>
    (typeof window.getCurrentApiLang === 'function' ? window.getCurrentApiLang() : 'no');

  // ---- Katalog ----

  /** Bygg alle katalog-oppføringer fra config (nettverksfritt). */
  function buildCatalogue(lang) {
    const dataflows = cfg.dataflows || [];
    const nodes = (window.AppConfig && window.AppConfig.sourceNodes) || {};
    const subjectNames = (window.SubjectConfig && window.SubjectConfig.subjectNames) || {};

    return dataflows.map((flow, i) => {
      const subjectId = flow.path[0];
      const nodeId = flow.path[1];
      const node = nodes[nodeId] || {};

      const subjectSeg = {
        id: subjectId,
        label: pickLabel(subjectNames[subjectId], lang) || subjectId,
        sortCode: SUBJECT_SORTCODE[subjectId] || '0009999'
      };
      const nodeSeg = {
        id: nodeId,
        label: pickLabel(node.label, lang) || nodeId,
        sortCode: node.sortCode || '999'
      };

      return {
        id: flow.tableId,
        label: pickLabel(flow.label, lang) || flow.tableId,
        // Rekkefølge blant tabeller i noden (menu-hierarchy sorterer på table.sortCode).
        sortCode: String(900 + i),
        // NB: 'updated' MÅ være en streng (aldri null) — menu-hierarchy.js
        // _collectAllTables() sorterer via table.updated.localeCompare(...)
        // uten null-guard (samme landmine unngås defensivt i fhi-adapter.js).
        updated: '',
        firstPeriod: '',
        lastPeriod: '',
        discontinued: false,
        // FREQ=B for kjerneutvalget → daglige/virkedagsserier. 'Business' faller i
        // «Andre tabeller»/«Other»-bøtta i frekvensfilteret (ikke Monthly/Quarterly/Annual),
        // som degraderer pent (se browser-state.filterTables/calcFrequencyCounts).
        timeUnit: 'Business',
        variableNames: (VARIABLE_NAMES[flow.flow] || []).slice(),
        subjectCode: subjectId,
        paths: [[subjectSeg, nodeSeg]],
        source: 'Norges Bank'
      };
    });
  }

  async function getTables(options) {
    const opts = options || {};
    // Server-søk / nylig-oppdaterte er SSB-only semantikk.
    if (opts.query || opts.pastDays) return { tables: [] };
    return { tables: buildCatalogue(currentLang()) };
  }

  // ---- Metadata ----

  /** Finn config-raden for en tabell-id. */
  function flowForId(tableId) {
    return (cfg.dataflows || []).find(f => f.tableId === tableId) || null;
  }

  /**
   * Hent seriedim-navn + TIME_PERIOD-vindu via en FREQ=B data-probe.
   * Returnerer { dimLabels:{id:name}, timeValues:[{id,name}], timeLabel }.
   * Prøver FREQ=B (rene virkedagsperioder); faller tilbake til /all om tomt.
   */
  async function probeTime(flow, nSeriesDims, locale) {
    async function run(key) {
      const url = BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + key +
        '?format=sdmx-json&lastNObservations=' + TIME_PROBE_N + '&locale=' + locale;
      const { status, json } = await fetchSdmx(url);
      if (status === 404 || !json) return null;
      return json;
    }

    // Nøkkel «B» + tomme segmenter for resten (FREQ er alltid dim 0).
    const bKey = 'B' + '.'.repeat(Math.max(0, nSeriesDims - 1));
    let json = null;
    try { json = await run(bKey); } catch (e) { json = null; }
    if (!hasObservations(json)) {
      try { json = await run('all'); } catch (e) { json = null; }
    }

    const dimLabels = {};
    let timeValues = [];
    let timeLabel = 'Tidsperiode';
    const struct = json && json.data && json.data.structure && json.data.structure.dimensions;
    if (struct) {
      (struct.series || []).forEach(d => { dimLabels[d.id] = d.name || d.id; });
      const timeDim = (struct.observation || [])[0];
      if (timeDim) {
        timeLabel = timeDim.name || timeLabel;
        dimLabels[timeDim.id] = timeDim.name || timeDim.id;
        // Dedupe + sorter stigende + behold de nyeste TIME_PROBE_N.
        const seen = {};
        (timeDim.values || []).forEach(v => { seen[v.id] = v.name || v.id; });
        timeValues = Object.keys(seen)
          .sort((a, b) => a.localeCompare(b))
          .slice(-TIME_PROBE_N)
          .map(pid => ({ id: pid, name: seen[pid] }));
      }
    }
    return { dimLabels, timeValues, timeLabel };
  }

  function hasObservations(json) {
    const s = json && json.data && Array.isArray(json.data.dataSets) && json.data.dataSets[0] &&
      json.data.dataSets[0].series;
    return !!(s && Object.keys(s).length > 0);
  }

  async function getTableMetadata(tableId, useCache, lang) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const locale = apiLang(lang || currentLang());
    const cacheKey = 'table_' + tableId + '_meta_' + locale;

    if (useCache !== false) {
      const cached = await cacheGet(cacheKey);
      if (cached) return cached;
    }

    // 1) DSD + kodelister.
    const dsdUrl = BASE + '/datastructure/NB/DSD_' + encodeURIComponent(flow.flow) +
      '?references=codelist&format=sdmx-json';
    const dsdRes = await fetchSdmx(dsdUrl);
    if (dsdRes.status === 404 || !dsdRes.json) {
      throw new Error('[NBAdapter] Fant ikke datastruktur DSD_' + flow.flow);
    }
    const dsd = dsdRes.json.data && dsdRes.json.data.dataStructures &&
      dsdRes.json.data.dataStructures[0];
    const nSeriesDims = dsd && dsd.dataStructureComponents &&
      dsd.dataStructureComponents.dimensionList &&
      (dsd.dataStructureComponents.dimensionList.dimensions || []).length || 0;

    // 2) TIME_PERIOD-probe (+ friendly dim-navn).
    const probe = await probeTime(flow, nSeriesDims, locale);

    const meta = window.SdmxToJsonStat.structureToMetadata(dsdRes.json, flow, {
      lang: locale,
      source: 'Norges Bank',
      updated: (dsdRes.json.meta && dsdRes.json.meta.prepared) || null,
      dimLabels: probe.dimLabels,
      timeValues: probe.timeValues,
      timeLabel: probe.timeLabel
    });

    await cacheSet(cacheKey, meta);
    return meta;
  }

  // ---- Data ----

  /**
   * Oversett appens utvalg {DimCode: [koder]|'*'|'top(N)'} til SDMX-nøkkel + params.
   * Ikke-tidsdimensjoner → nøkkelsegmenter (koder join '+', '*'/mangler → tomt).
   * TIME_PERIOD: 'top(N)' → lastNObservations=N; eksplisitt liste →
   * startPeriod/endPeriod; '*' → ingen periodeparametre (full historikk).
   */
  function buildKeyAndParams(meta, valueCodes) {
    const sel = valueCodes || {};
    const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
    const seriesIds = meta.id.filter(d => d !== timeId); // DSD-rekkefølge (ekskl. tid)

    const segments = seriesIds.map(dimId => {
      const v = sel[dimId];
      if (v === '*' || v === undefined || v === null) return '';
      if (Array.isArray(v)) return v.join('+');
      if (typeof v === 'string') {
        // Enkeltkode eller top(N) (top(N) gir ikke mening for ikke-tidsdim → tom)
        if (/^top\(\d+\)$/i.test(v)) return '';
        return v;
      }
      return '';
    });
    const key = segments.join('.');

    const params = {};
    const t = sel[timeId];
    if (typeof t === 'string') {
      const m = t.match(/^top\((\d+)\)$/i);
      if (m) {
        params.lastNObservations = m[1];
      }
      // '*' → ingen periodeparametre.
    } else if (Array.isArray(t) && t.length > 0) {
      const sorted = t.slice().sort((a, b) => String(a).localeCompare(String(b)));
      params.startPeriod = sorted[0];
      params.endPeriod = sorted[sorted.length - 1];
    }
    return { key, params };
  }

  async function getTableData(tableId, valueCodes, lang, codelistIds) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const locale = apiLang(lang || currentLang());

    // Metadata trengs for dimensjonsrekkefølge (cachet).
    const meta = await getTableMetadata(tableId, true, locale);
    const { key, params } = buildKeyAndParams(meta, valueCodes);

    const qs = ['format=sdmx-json', 'locale=' + locale];
    Object.keys(params).forEach(k => qs.push(k + '=' + encodeURIComponent(params[k])));
    const url = BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + key + '?' + qs.join('&');

    const metricDims = (meta.role && meta.role.metric) || [];

    let json = null;
    try {
      const res = await fetchSdmx(url);
      if (res.status === 404) {
        return emptyDataFromSelection(meta, valueCodes);
      }
      json = res.json;
    } catch (e) {
      throw e; // Ekte feil (nettverk / 5xx) — ikke maskér som tom.
    }

    if (!hasObservations(json)) {
      return emptyDataFromSelection(meta, valueCodes);
    }

    return window.SdmxToJsonStat.dataToJsonStat(json, {
      lang: locale,
      source: 'Norges Bank',
      label: meta.label,
      updated: (json.meta && json.meta.prepared) || meta.updated || null,
      metricDims: metricDims
    });
  }

  /**
   * Bygg et tomt, men gyldig JSON-Stat2 dataset fra metadata + utvalg (404/ingen
   * data). value:[] → table-display viser «ingen data» uten å krasje
   * (buildDimensionCombinations nås aldri fordi displayData returnerer tidlig).
   */
  function emptyDataFromSelection(meta, valueCodes) {
    const sel = valueCodes || {};
    const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
    const id = [];
    const size = [];
    const dimension = {};

    meta.id.forEach(dimId => {
      const metaDim = meta.dimension[dimId] || { label: dimId, category: { index: {}, label: {} } };
      if (dimId === timeId) {
        id.push(dimId);
        size.push(0);
        dimension[dimId] = { label: metaDim.label, category: { index: {}, label: {} } };
        return;
      }
      const v = sel[dimId];
      let codes;
      if (Array.isArray(v) && v.length) {
        codes = v;
      } else {
        codes = Object.keys(metaDim.category.index); // '*' / mangler → alle
      }
      const index = {};
      const label = {};
      codes.forEach((code, i) => {
        index[code] = i;
        label[code] = (metaDim.category.label && metaDim.category.label[code]) || code;
      });
      id.push(dimId);
      size.push(codes.length);
      dimension[dimId] = { label: metaDim.label, category: { index: index, label: label } };
    });

    return {
      class: 'dataset',
      id: id,
      size: size,
      dimension: dimension,
      value: [],
      role: { time: [timeId] },
      source: 'Norges Bank',
      label: meta.label || '',
      updated: meta.updated || null
    };
  }

  // ---- Adapterobjekt ----

  const adapter = {
    sourceId: 'nb',

    capabilities: {
      supportsSavedQueries: false,
      supportsServerExport: false,
      supportsCodelists: false,
      supportsGetUrlBuilder: false,
      supportsDefaultSelection: false,
      supportsAggregation: false
    },

    ownsTableId: (id) => typeof id === 'string' && id.startsWith('nb-'),

    // Config + savedqueries rutes til SSB av fasaden — men må finnes for kontrakten.
    getConfig: async () => null,

    getTables: getTables,
    getAllTables: getTables,

    getTableMetadata: getTableMetadata,
    getTableData: getTableData,

    getCodeList: async () => { throw new Error('[NBAdapter] Norges Bank har ikke kodelister'); },
    downloadTableData: async () => { throw new Error('[NBAdapter] Server-eksport støttes ikke — bruk klientside CSV'); },
    saveSavedQuery: async () => { throw new Error('[NBAdapter] Norges Bank støtter ikke lagrede spørringer'); },
    getSavedQuery: async () => { throw new Error('[NBAdapter] Norges Bank støtter ikke lagrede spørringer'); },
    getSavedQueryData: async () => { throw new Error('[NBAdapter] Norges Bank støtter ikke lagrede spørringer'); },
    getDefaultSelection: async () => { throw new Error('[NBAdapter] Norges Bank har ingen defaultselection'); },

    // Cache delegeres til SSB av fasaden — disse kalles aldri via fasaden.
    cleanupCache: () => 0,
    clearCache: () => {},
    getCacheStats: () => null
  };

  (window.SourceAdapters = window.SourceAdapters || []).push(adapter);
})();
