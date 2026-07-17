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
 *               // path: ['bf','nb-renter'] = én emnetre-plassering; alternativt
 *               // paths: [['bf','nb-renter'], …] for flere plasseringer.
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

  // Datatorg-beskrivelser per flow (norsk). Emitteres som `note` i metadata slik
  // at Tabellinfo viser dem (jf. table-metadata.js meta.note). Hentet fra Norges
  // Banks egne datasettbeskrivelser.
  const DESCRIPTIONS = {
    EXR: 'Norges Banks valutakurser. Kursene publiseres ca. kl. 16.00.',
    IR: 'Norges Banks styringsrente.',
    SHORT_RATES: 'NOWA – Norwegian Overnight Weighted Average.',
    GOVT_GENERIC_RATES: 'Generisk rente er den effektive renten på et statspapir som er nærmest den oppgitte løpetiden målt fra dagens dato.'
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
    // Timeout via AbortSignal slik at et hengende NB-API ikke blokkerer hele
    // app-initialiseringen (katalogaggregeringen venter på alle kilder). Verdien
    // leses fra AppConfig.sources.fetchTimeoutMs med 15 s fallback.
    const timeoutMs = (window.AppConfig && window.AppConfig.sources &&
      window.AppConfig.sources.fetchTimeoutMs) || 15000;
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json, */*' },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      // AbortSignal.timeout gir DOMException 'TimeoutError' (noen miljøer 'AbortError').
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new Error('[NBAdapter] Tidsavbrudd etter ' + timeoutMs + ' ms mot Norges Bank: ' + url);
      }
      throw e; // Ekte nettverksfeil.
    }
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

    const makeSubjectSeg = (subjectId) => ({
      id: subjectId,
      label: pickLabel(subjectNames[subjectId], lang) || subjectId,
      sortCode: SUBJECT_SORTCODE[subjectId] || '0009999'
    });
    const makeNodeSeg = (nodeId) => {
      const node = nodes[nodeId] || {};
      return {
        id: nodeId,
        label: pickLabel(node.label, lang) || nodeId,
        sortCode: node.sortCode || '999'
      };
    };

    return dataflows.map((flow, i) => {
      // En flow kan plasseres flere steder i emnetreet via `paths` (array av
      // [subjektkode, node-id]-par); legacy-formen `path` gir én plassering.
      // Emnesubjekt/node-id-ene må finnes i subjects.js/AppConfig.sourceNodes.
      const placements = (Array.isArray(flow.paths) && flow.paths.length)
        ? flow.paths
        : [flow.path];
      const subjectId = placements[0][0];

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
        paths: placements.map(p => [makeSubjectSeg(p[0]), makeNodeSeg(p[1])]),
        source: 'Norges Bank'
      };
    });
  }

  async function getTables(options) {
    const opts = options || {};
    // Server-søk / nylig-oppdaterte er SSB-only semantikk.
    if (opts.query || opts.pastDays) return { tables: [] };
    const force = opts.useCache === false;

    const tables = buildCatalogue(currentLang());
    // Fyll Tidsperiode/Sist oppdatert fra ett lite, cachet kall pr. flow (24 t).
    // Feiltolerant: hvis en probe feiler beholdes '' (degradér pent).
    await Promise.all(tables.map(async (entry) => {
      const flow = flowForId(entry.id);
      if (!flow) return;
      try {
        const period = await fetchCataloguePeriod(flow, force);
        if (period) {
          entry.firstPeriod = period.firstPeriod || '';
          entry.lastPeriod = period.lastPeriod || '';
          entry.updated = period.updated || '';
        }
      } catch (e) { /* behold tomme strenger */ }
    }));
    // Katalogen er config-bygget og kan ikke reelt feile — sourceMeta
    // rapporterer derfor alltid ferskt resultat (statuspanelet i
    // source-registry/source-status bruker dette).
    return {
      tables,
      sourceMeta: { fromCache: false, stale: false, fetchedAt: Date.now() }
    };
  }

  // ---- Metadata ----

  /** Finn config-raden for en tabell-id. */
  function flowForId(tableId) {
    return (cfg.dataflows || []).find(f => f.tableId === tableId) || null;
  }

  /**
   * Hent seriedim-navn + TIME_PERIOD-vindu via data-prober.
   *
   * SDMX-tidskoder er FREKVENSSPESIFIKKE (B → '2025-07-15', M → '2025-07',
   * A → '2025'), så tidsvinduet probes pr. frekvens som faktisk har data
   * (freqCodes fra serieskeysonly-proben). Uten freqCodes probes FREQ=B med
   * fallback til /all som før.
   *
   * Returnerer { dimLabels:{id:name}, timeValues:[{id,name}] (union, stigende),
   *              timeLabel, byFreq:{freqCode:[periodekoder]}|null }.
   */
  async function probeTime(flow, nSeriesDims, locale, freqCodes) {
    async function run(key) {
      const url = BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + key +
        '?format=sdmx-json&lastNObservations=' + TIME_PROBE_N + '&locale=' + locale;
      const { status, json } = await fetchSdmx(url);
      if (status === 404 || !json) return null;
      return json;
    }

    /** Trekk ut dim-navn + tidsverdier fra ett datasvar (dedupet, stigende, siste N). */
    function extract(json) {
      const struct = pickStructure(json);
      const dims = struct && struct.dimensions;
      const timeDim = dims && (dims.observation || [])[0];
      if (!timeDim) return null;
      const dimLabels = {};
      (dims.series || []).forEach(d => { dimLabels[d.id] = d.name || d.id; });
      dimLabels[timeDim.id] = timeDim.name || timeDim.id;
      const seen = {};
      (timeDim.values || []).forEach(v => { seen[v.id] = v.name || v.id; });
      const values = Object.keys(seen)
        .sort((a, b) => a.localeCompare(b))
        .slice(-TIME_PROBE_N)
        .map(pid => ({ id: pid, name: seen[pid] }));
      return { dimLabels, timeLabel: timeDim.name || null, values };
    }

    const tail = '.'.repeat(Math.max(0, nSeriesDims - 1));
    const result = { dimLabels: {}, timeValues: [], timeLabel: 'Tidsperiode', byFreq: null };

    // Frekvensbevisst probing: ett kall pr. faktisk frekvens, parallelt.
    const freqs = Array.isArray(freqCodes) ? freqCodes.filter(Boolean) : [];
    if (freqs.length) {
      const jsons = await Promise.all(freqs.map(f => run(f + tail).catch(() => null)));
      const byFreq = {};
      const union = {};
      jsons.forEach((json, i) => {
        if (!hasObservations(json)) return;
        const ex = extract(json);
        if (!ex || !ex.values.length) return;
        Object.assign(result.dimLabels, ex.dimLabels);
        if (ex.timeLabel && result.timeLabel === 'Tidsperiode') result.timeLabel = ex.timeLabel;
        byFreq[freqs[i]] = ex.values.map(v => v.id);
        ex.values.forEach(v => { union[v.id] = v.name; });
      });
      if (Object.keys(byFreq).length) {
        result.byFreq = byFreq;
        result.timeValues = Object.keys(union)
          .sort((a, b) => a.localeCompare(b))
          .map(pid => ({ id: pid, name: union[pid] }));
        return result;
      }
    }

    // Fallback: nøkkel «B» + tomme segmenter (FREQ er alltid dim 0); så /all.
    let json = null;
    try { json = await run('B' + tail); } catch (e) { json = null; }
    if (!hasObservations(json)) {
      try { json = await run('all'); } catch (e) { json = null; }
    }
    const ex = json ? extract(json) : null;
    if (ex) {
      result.dimLabels = ex.dimLabels;
      if (ex.timeLabel) result.timeLabel = ex.timeLabel;
      result.timeValues = ex.values;
    }
    return result;
  }

  function hasObservations(json) {
    const s = json && json.data && Array.isArray(json.data.dataSets) && json.data.dataSets[0] &&
      json.data.dataSets[0].series;
    return !!(s && Object.keys(s).length > 0);
  }

  /** SDMX-JSON kan ha data.structure (objekt) ELLER data.structures[0] (array). */
  function pickStructure(json) {
    const data = json && json.data;
    if (!data) return null;
    if (data.structure) return data.structure;
    if (Array.isArray(data.structures) && data.structures[0]) return data.structures[0];
    return null;
  }

  /**
   * Hent de FAKTISKE seriene via detail=serieskeysonly (bittelite svar, 3–8 KB).
   * Returnerer { dims:[dimId...], seriesValues:{dimId:[koder...]}, keys:['B.USD.NOK.SP',...] }
   * eller null. Kodebasert (ikke indeksbasert) slik at UI-krysfilteret kan matche
   * direkte mot dimensjonskoder. Cachet 24 t (språkuavhengig — kun koder).
   */
  async function fetchSeriesKeys(flow) {
    const cacheKey = 'nb-serieskeys-' + flow.flow;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const url = BASE + '/data/' + encodeURIComponent(flow.flow) +
      '/?detail=serieskeysonly&format=sdmx-json';
    let json = null;
    try {
      const res = await fetchSdmx(url);
      if (res.status === 404 || !res.json) return null;
      json = res.json;
    } catch (e) {
      return null; // Krysfilter er en forbedring, ikke kritisk — degradér stille.
    }

    const struct = pickStructure(json);
    const seriesDims = struct && struct.dimensions && struct.dimensions.series;
    const dataSet = json.data && Array.isArray(json.data.dataSets) ? json.data.dataSets[0] : null;
    if (!Array.isArray(seriesDims) || !dataSet || !dataSet.series) return null;

    const dims = seriesDims.map(d => d.id);
    const valueCodes = seriesDims.map(d => (d.values || []).map(v => v.id));
    const seriesValues = {};
    dims.forEach((id, i) => { seriesValues[id] = valueCodes[i]; });

    const keys = Object.keys(dataSet.series).map(k => {
      const idx = k.split(':').map(Number);
      return idx.map((n, i) => (valueCodes[i] ? valueCodes[i][n] : undefined)).join('.');
    });

    const result = { dims, seriesValues, keys };
    await cacheSet(cacheKey, result);
    return result;
  }

  /** Trekk ut årstallet (første 4 sifre) fra en SDMX-periodekode; NaN hvis ukjent. */
  function periodYear(code) {
    const m = String(code || '').match(/\d{4}/);
    return m ? parseInt(m[0], 10) : NaN;
  }

  /**
   * Katalog-tidsvindu + sist oppdatert for en flow via ETT kombinert kall
   * (firstNObservations=1&lastNObservations=1 → union av første og siste obs pr.
   * serie). Returnerer { firstPeriod, lastPeriod, updated } (år-strenger + ISO-dato)
   * eller null. Cachet 24 t (språkuavhengig). Kalles fra getTables (hver app-init)
   * — derfor cachet og feiltolerant.
   */
  async function fetchCataloguePeriod(flow, force) {
    const cacheKey = 'nb-catperiod-' + flow.flow;
    if (!force) {
      const cached = await cacheGet(cacheKey);
      if (cached) return cached;
    }

    const url = BASE + '/data/' + encodeURIComponent(flow.flow) +
      '/?format=sdmx-json&firstNObservations=1&lastNObservations=1';
    let json = null;
    try {
      const res = await fetchSdmx(url);
      if (res.status === 404 || !res.json) return null;
      json = res.json;
    } catch (e) {
      return null;
    }

    const struct = pickStructure(json);
    const obsDim = struct && struct.dimensions && Array.isArray(struct.dimensions.observation)
      ? struct.dimensions.observation[0] : null;
    const values = (obsDim && obsDim.values) ? obsDim.values.map(v => v.id) : [];
    if (values.length === 0) return null;

    let minY = Infinity, maxY = -Infinity;
    values.forEach(code => {
      const y = periodYear(code);
      if (!isNaN(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    });
    if (!isFinite(minY) || !isFinite(maxY)) return null;

    const result = {
      firstPeriod: String(minY),
      lastPeriod: String(maxY),
      updated: (json.meta && json.meta.prepared) || ''
    };
    await cacheSet(cacheKey, result);
    return result;
  }

  async function getTableMetadata(tableId, useCache, lang) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const locale = apiLang(lang || currentLang());
    // 'v3' = metadata-skjema med intervalPicker/timeBounds på tidsdimensjonen
    // (v2: timePeriodsByFreq + FREQ.singleSelect) — ny nøkkel så gamle
    // cacheoppføringer (uten utvidelsene) ikke serveres i 24 t.
    const cacheKey = 'table_' + tableId + '_meta_v3_' + locale;

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

    // 2) serieskeysonly-probe FØRST (de faktiske frekvensene styrer tidsprobene),
    //    deretter TIME_PERIOD-probe pr. frekvens (tidskodene er frekvensspesifikke:
    //    B → '2025-07-15', M → '2025-07', A → '2025').
    const seriesKeys = await fetchSeriesKeys(flow);
    const freqCodes = (seriesKeys && seriesKeys.seriesValues && seriesKeys.seriesValues.FREQ) || null;
    const probe = await probeTime(flow, nSeriesDims, locale, freqCodes);

    const meta = window.SdmxToJsonStat.structureToMetadata(dsdRes.json, flow, {
      lang: locale,
      source: 'Norges Bank',
      updated: (dsdRes.json.meta && dsdRes.json.meta.prepared) || null,
      dimLabels: probe.dimLabels,
      timeValues: probe.timeValues,
      timeLabel: probe.timeLabel,
      // Begrens kategoriene til verdier som faktisk finnes i ekte serier.
      seriesValues: seriesKeys ? seriesKeys.seriesValues : null
    });

    // Gyldige dimensjonskombinasjoner for generisk krysfiltrering i UI-en
    // (variable-select). dims i serieskeysonly-rekkefølge; keys kodebasert.
    if (seriesKeys && Array.isArray(seriesKeys.keys) && seriesKeys.keys.length) {
      meta.extension = meta.extension || {};
      meta.extension.validKeys = { dims: seriesKeys.dims, keys: seriesKeys.keys };
    }

    // Frekvens → tilgjengelige tidsperioder, for frekvensbevisst tidsliste i
    // UI-en (variable-select applyTimeFreqFilter): daglige datoer gir aldri
    // treff for FREQ=A/M, så tidslisten må følge valgt frekvens.
    if (probe.byFreq && meta.id.includes('FREQ')) {
      const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
      meta.extension = meta.extension || {};
      meta.extension.timePeriodsByFreq = { freqDim: 'FREQ', timeDim: timeId, byFreq: probe.byFreq };
    }

    // Intervallbasert tidsvelger (variable-select renderTimePickerCard):
    // SDMX-API-et er intervallbasert (startPeriod/endPeriod/lastNObservations),
    // så tidsdimensjonen får en fra–til/Siste N/alt-velger i stedet for
    // verdilisten (som uansett bare dekker de siste TIME_PROBE_N probede
    // periodene). Settes kun når timePeriodsByFreq finnes — uten frekvenskart
    // kan ikke velgeren utlede inputgranularitet, og verdilisten beholdes.
    // timeBounds (årstall fra katalogproben) gir min/max på fra/til-inputene;
    // feiltolerant — velgeren virker uten grenser.
    if (meta.extension && meta.extension.timePeriodsByFreq) {
      const timeId = meta.extension.timePeriodsByFreq.timeDim;
      if (meta.dimension[timeId]) {
        const timeExt = meta.dimension[timeId].extension =
          meta.dimension[timeId].extension || {};
        timeExt.intervalPicker = true;
        try {
          const period = await fetchCataloguePeriod(flow);
          if (period) {
            timeExt.timeBounds = {
              firstPeriod: period.firstPeriod || '',
              lastPeriod: period.lastPeriod || ''
            };
          }
        } catch (e) { /* uten grenser — velgeren degraderer pent */ }
      }
    }

    // FREQ er gjensidig utelukkende: SDMX-nøkkelen støtter riktignok 'A+M',
    // men periodene aligner aldri på tvers av frekvenser (2024 vs 2024-06 vs
    // 2024-06-28), så en kombinert tabell blir en nesten tom kryssmatrise —
    // og startPeriod/endPeriod kan ikke uttrykkes i én granularitet. UI-en
    // (variable-select) håndhever radio-adferd for singleSelect-dimensjoner.
    if (meta.dimension.FREQ) {
      meta.dimension.FREQ.extension = meta.dimension.FREQ.extension || {};
      meta.dimension.FREQ.extension.singleSelect = true;
    }

    // Datatorg-beskrivelse → Tabellinfo (meta.note er en streng-array).
    if (DESCRIPTIONS[flow.flow]) {
      meta.note = [DESCRIPTIONS[flow.flow]];
    }

    await cacheSet(cacheKey, meta);
    return meta;
  }

  // ---- Data ----

  /**
   * Oversett appens utvalg {DimCode: [koder]|'*'|'top(N)'|'range(a,b)'} til
   * SDMX-nøkkel + params. Ikke-tidsdimensjoner → nøkkelsegmenter (koder join
   * '+', '*'/mangler → tomt). TIME_PERIOD: 'top(N)' → lastNObservations=N;
   * 'range(from,to)' → startPeriod/endPeriod (tom side utelates — åpen ende);
   * eksplisitt liste → startPeriod/endPeriod (min/max); '*' → ingen
   * periodeparametre (full historikk).
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
      const range = m ? null : window.SdmxToJsonStat.parsePeriodRange(t);
      if (m) {
        params.lastNObservations = m[1];
      } else if (range) {
        // Intervallvelgeren (variable-select) — tom side = åpen ende.
        if (range.from) params.startPeriod = range.from;
        if (range.to) params.endPeriod = range.to;
      }
      // '*' / helt åpen range → ingen periodeparametre.
    } else if (Array.isArray(t) && t.length > 0) {
      const sorted = t.slice().sort((a, b) => String(a).localeCompare(String(b)));
      params.startPeriod = sorted[0];
      params.endPeriod = sorted[sorted.length - 1];
    }
    return { key, params };
  }

  // Responsformater Norges Banks SDMX-API faktisk støtter (verifisert mot
  // det levende API-et; XML-varianter avvises med 406). sdmx-json er det
  // appen selv konsumerer og dermed standardvalget i API-byggeren.
  const API_FORMATS = ['sdmx-json', 'csv', 'csv-ts', 'excel-both', 'excel-ts'];
  // detail-verdier utover standard 'full' (ugyldig verdi gir 400 fra API-et)
  const API_DETAIL_VALUES = ['dataonly', 'serieskeysonly', 'nodata'];

  /**
   * Bygg den fulle data-URL-en for et utvalg (delt mellom getTableData og
   * buildApiQuery slik at API-bygger-forhåndsvisningen aldri divergerer fra
   * det appen faktisk sender). builderOpts ({format, detail, includeHistory,
   * bom}) settes kun av API-byggeren — getTableData utelater dem og får
   * dermed alltid dagens sdmx-json-URL uendret.
   */
  function buildDataUrl(flow, meta, valueCodes, locale, builderOpts) {
    const bo = builderOpts || {};
    const format = API_FORMATS.includes(bo.format) ? bo.format : 'sdmx-json';
    const { key, params } = buildKeyAndParams(meta, valueCodes);
    const qs = ['format=' + format, 'locale=' + locale];
    Object.keys(params).forEach(k => qs.push(k + '=' + encodeURIComponent(params[k])));
    if (API_DETAIL_VALUES.includes(bo.detail)) qs.push('detail=' + bo.detail);
    if (bo.includeHistory === true) qs.push('includeHistory=true');
    if (bo.bom === true) qs.push('bom=true');
    return BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + key + '?' + qs.join('&');
  }

  /**
   * API-bygger-spørring (kontrakten i source-registry.js): synkron beskrivelse
   * av GET-kallet mot Norges Banks SDMX-API for gjeldende utvalg.
   * options.meta (allerede lastet tabellmetadata) er PÅKREVD — metoden er
   * synkron og kan ikke hente metadata selv; UI-en (variable-select) har den
   * alltid lastet før forhåndsvisningen oppdateres.
   *
   * NB: Fler-verdi tidsutvalg vises som start-/endPeriod-intervall — nøyaktig
   * det appen selv sender (ikke-sammenhengende perioder filtreres først
   * klientside etter henting, se getTableData/filterDatasetToTimeCodes).
   */
  function buildApiQuery(tableId, valueCodes, options) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const opts = options || {};
    if (!opts.meta || !Array.isArray(opts.meta.id)) {
      throw new Error('[NBAdapter] buildApiQuery krever options.meta (lastet tabellmetadata)');
    }
    const locale = apiLang(opts.lang || currentLang());
    return {
      method: 'GET',
      url: buildDataUrl(flow, opts.meta, valueCodes, locale, {
        format: opts.format,
        detail: opts.detail,
        includeHistory: opts.includeHistory,
        bom: opts.bom
      }),
      body: null,
      metadataUrl: BASE + '/datastructure/NB/DSD_' + encodeURIComponent(flow.flow) +
        '?references=codelist&format=sdmx-json'
    };
  }

  /** Radmajor-strides for en size-array: strides[i] = produkt(size[i+1..]). */
  function stridesFor(size) {
    const s = new Array(size.length);
    let acc = 1;
    for (let i = size.length - 1; i >= 0; i--) { s[i] = acc; acc *= size[i]; }
    return s;
  }

  /**
   * Filtrer et JSON-Stat2-datasett ned til NØYAKTIG de valgte tidskodene.
   *
   * SDMX REST støtter kun sammenhengende tidsintervaller (startPeriod/endPeriod),
   * så et ikke-sammenhengende tidsutvalg henter hele intervallet fra API-et.
   * Her fjernes periodene brukeren ikke valgte etter konvertering. Bygger om
   * Tid-dimensjonens category.index/label, size-arrayen OG den radmajor-flate
   * value-/status-arrayen konsistent. Returnerer datasettet uendret hvis alle
   * tilstedeværende koder beholdes (utvalget = «alle» eller komplett intervall).
   */
  function filterDatasetToTimeCodes(dataset, timeId, wantedCodes) {
    const dim = dataset.dimension && dataset.dimension[timeId];
    const dimPos = dataset.id.indexOf(timeId);
    if (!dim || !dim.category || !dim.category.index || dimPos < 0) return dataset;

    const oldIndex = dim.category.index;
    const oldLabel = (dim.category.label) || {};
    const wanted = new Set(wantedCodes.map(String));
    // Behold datasettets egen (stigende) rekkefølge; ta kun med valgte koder.
    const keptCodes = Object.keys(oldIndex)
      .filter(c => wanted.has(String(c)))
      .sort((a, b) => oldIndex[a] - oldIndex[b]);

    // Ingenting å fjerne → returner uendret (unødvendig ombygging unngås).
    if (keptCodes.length === Object.keys(oldIndex).length) return dataset;

    const oldSize = dataset.size;
    const newSize = oldSize.slice();
    newSize[dimPos] = keptCodes.length;
    const oldStrides = stridesFor(oldSize);
    const newStrides = stridesFor(newSize);

    // Gammel Tid-koordinat → ny Tid-koordinat (kun beholdte perioder).
    const oldToNewTime = {};
    keptCodes.forEach((c, newPos) => { oldToNewTime[oldIndex[c]] = newPos; });

    const oldValue = dataset.value || [];
    const oldStatus = dataset.status || null;
    const newTotal = newSize.reduce((a, b) => a * b, 1);
    const newValue = new Array(newTotal).fill(null);
    const newStatus = {};
    let hasStatus = false;

    for (let oldFlat = 0; oldFlat < oldValue.length; oldFlat++) {
      let newFlat = 0;
      let skip = false;
      for (let d = 0; d < oldSize.length; d++) {
        const coord = Math.floor(oldFlat / oldStrides[d]) % oldSize[d];
        let newCoord = coord;
        if (d === dimPos) {
          if (!(coord in oldToNewTime)) { skip = true; break; }
          newCoord = oldToNewTime[coord];
        }
        newFlat += newCoord * newStrides[d];
      }
      if (skip) continue;
      newValue[newFlat] = oldValue[oldFlat];
      if (oldStatus) {
        const s = oldStatus[String(oldFlat)];
        if (s !== undefined) { newStatus[String(newFlat)] = s; hasStatus = true; }
      }
    }

    // Bygg om Tid-kategorien (index/label) i beholdt rekkefølge.
    const newCatIndex = {};
    const newCatLabel = {};
    keptCodes.forEach((c, i) => { newCatIndex[c] = i; newCatLabel[c] = oldLabel[c] || c; });
    dim.category.index = newCatIndex;
    dim.category.label = newCatLabel;

    dataset.size = newSize;
    dataset.value = newValue;
    if (hasStatus) dataset.status = newStatus; else delete dataset.status;
    return dataset;
  }

  async function getTableData(tableId, valueCodes, lang, codelistIds) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const locale = apiLang(lang || currentLang());

    // Metadata trengs for dimensjonsrekkefølge (cachet).
    const meta = await getTableMetadata(tableId, true, locale);
    const url = buildDataUrl(flow, meta, valueCodes, locale);

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

    const dataset = window.SdmxToJsonStat.dataToJsonStat(json, {
      lang: locale,
      source: 'Norges Bank',
      label: meta.label,
      updated: (json.meta && json.meta.prepared) || meta.updated || null,
      metricDims: metricDims
    });

    // Fler-verdi tidsutvalg hentes som intervall (SDMX støtter kun intervaller);
    // filtrer bort perioder brukeren ikke valgte. Hopp over for '*' og top(N)
    // (hele intervallet/siste N ønskes), og filterfunksjonen no-op-er dessuten
    // når alt beholdes (komplett intervall).
    const dsTimeId = (dataset.role && dataset.role.time && dataset.role.time[0]) ||
      (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
    const timeSel = (valueCodes || {})[dsTimeId];
    if (Array.isArray(timeSel) && timeSel.length) {
      return filterDatasetToTimeCodes(dataset, dsTimeId, timeSel);
    }
    return dataset;
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
      // Forenklet API-bygger (data-URL + metadata-URL) via buildApiQuery —
      // gjenbruker samme URL-bygging som getTableData.
      supportsApiQuery: true,
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
    buildApiQuery: buildApiQuery,

    // Valgene API-byggeren (variable-select) skal tilby for denne kilden.
    // labelKey oversettes med t() av visningen; label brukes som den er.
    getApiBuilderOptions: () => ({
      formats: [
        { value: 'sdmx-json', label: 'SDMX-JSON' },
        { value: 'csv', label: 'CSV' },
        { value: 'csv-ts', labelKey: 'api.formatCsvTs' },
        { value: 'excel-both', label: 'Excel' },
        { value: 'excel-ts', labelKey: 'api.formatExcelTs' }
      ],
      defaultFormat: 'sdmx-json',
      csvFormats: ['csv', 'csv-ts'],
      maxRowCount: null,
      nbAdvanced: true
    }),

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
