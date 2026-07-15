/**
 * FHI source adapter — Statistikkportalen 2.0  (Fase C)
 * =======================================================
 *
 * Implementerer adapterkontrakten i js/sources/source-registry.js for FHIs
 * åpne statistikk-API (statistikk-data.fhi.no), som leverer JSON-Stat2
 * NATIVT (i motsetning til Norges Bank sin SDMX-JSON). Adapteren er GENERISK
 * over AppConfig.sources.fhi.sourceIds — en ny FHI-kilde (fra «senere»-lista:
 * msis, sysvak, npr, kpr, lmr, gs, hkr, abr, ngs, skast) koster kun én
 * konfiglinje der + en tilhørende rad i AppConfig.sourceNodes.
 *
 * KILDE / ÅPENT API
 * -----------------
 *   AppConfig.sources.fhi.baseUrl    // 'https://statistikk-data.fhi.no/api/open/v1'
 *   AppConfig.sources.fhi.sourceIds  // ['nokkel', 'mfr', 'daar']
 *   GET  /Common/source                          — kildetitler (13 stk, kun norsk)
 *   GET  /{source}/table                          — katalog: [{tableId,title,publishedAt,modifiedAt}]
 *   GET  /{source}/Table/{id}/dimension           — dimensjoner (nøstet via children[])
 *   GET  /{source}/Table/{id}/query               — prefylt spørring (brukes som defaultselection)
 *   POST /{source}/Table/{id}/data                — {dimensions:[{code,filter,values}], response:{format,maxRowCount}}
 *   API-et har INGEN lang-parameter — alt er kun på norsk.
 *
 * LIVE-FUNN SOM AVVIKER FRA DEN OPPRINNELIGE ANTAKELSEN «AAR→tid, GEO→geo»
 * -------------------------------------------------------------------------
 * Probing mot alle tre aktiverte kilder (nokkel/mfr/daar, ~40 tabeller) viste
 * at dimensjonskodene IKKE er stabile på tvers av kilder:
 *   - Tidsdimensjon:  AAR (nokkel), DAAR (daar), FODSELSTIDSPUNKT_2005/_2007/…
 *     (mfr — suffikset varierer per tabell/kohort!).
 *   - Geografidimensjon: GEO (nokkel), FYLKE (daar, «Bofylke»), MORS_BOSTED
 *     (mfr) — og mange tabeller (spesielt mfr) har INGEN geodimensjon i det
 *     hele tatt.
 *   - MEASURE_TYPE er derimot universelt i alle ~40 stikkprøvede tabeller.
 * Rollegjenkjenning gjøres derfor på LABEL/kode-heuristikk (norsk «år»/«aar»)
 * i stedet for eksakt kodenavn — se isTimeDim/isGeoDim under. Heuristikken må
 * unngå falske treff som «Dødsårsak» (AARSAK/dødsårsak inneholder «år» som
 * SUBSTRING, men er en kategori — ikke tid); den matcher derfor kun «år»/«aar»
 * når det IKKE er umiddelbart etterfulgt av en ny bokstav (suffiks-mønster:
 * «Skoleår», «Dødsår», «(år)» treffer — «årsak» gjør ikke).
 * role.geo/role.metric er kun kosmetiske (rolle-badge i variabelvelgeren);
 * role.time er derimot lastebærende (determineDefaultLayout, «Siste N»-knapp,
 * formathint) — se table-display.js/variable-select-render.js.
 *
 * ANDRE LIVE-API-KVIRKER
 * -----------------------
 *   - dimension.categories nøstes via children[] — IKKE bare for GEO: KJONN,
 *     ALDER, FYLKE, NARKOTIKA (og trolig flere) er også hierarkiske. Vi
 *     flater derfor ALLE dimensjoner generisk (depth-first, '¬'-prefiks per
 *     nivå — samme konvensjon som SSB og parseHierarchyLabel i
 *     variable-select-render.js forventer).
 *   - category.index i FHIs egen JSON-Stat2 er en ARRAY (posisjonsordnet),
 *     ikke et code→posisjon-objekt slik SSB/JSON-Stat2-spec (og app-koden,
 *     f.eks. table-display.js calculateFlatIndex/buildDimensionCombinations)
 *     forutsetter. Vi konverterer alltid til {code: posisjon}-objekt.
 *   - Undertrykte celler (personvern/manglende data) leveres INLINE i
 *     value[]-arrayen som strenger (".", "..", ":") — ikke via et eget
 *     status-kart slik SSB/JSON-Stat2-konvensjonen (og getDataStatus() i
 *     table-display.js) forutsetter. Vi trekker dem ut til et status-objekt
 *     (flatIndex → symbol) og setter value[i]=null, ellers ville
 *     formatNumber() fått en ren tekststreng som tallverdi.
 *   - data-responsens eget role-felt er upålitelig (typisk
 *     {time:null, geo:[], metric:[...]} selv når GEO/AAR faktisk er med) —
 *     vi stoler ALDRI på det og bruker egen rolleutledning fra metadata.
 *   - ALLE dimensjoner er obligatoriske i /data — utelates én, svarer API-et
 *     400 «Filter must be specified for dimension X». Det finnes ingen
 *     elimination-støtte. Metadata setter derfor aldri
 *     dimension.extension.elimination (default false/obligatorisk stemmer).
 *   - filter:'all' krever likevel en ikke-tom values-array (f.eks. ['*']) —
 *     values:[] gir 400 «At least one value needs to be specified».
 *   - filter:'top' plukker de FØRSTE N radene i /dimension-rekkefølgen, som
 *     for tidsdimensjoner er STIGENDE (eldst→nyest) — stikk motsatt av
 *     appens «Siste N»-knapp (som forventer nyeste N, jf. SSB/NB). Vi løser
 *     derfor top(N) på tidsdimensjonen SELV (de N siste kodene etter
 *     metadata-indeksrekkefølge, som er verifisert stigende) i stedet for å
 *     stole på API-ets 'top'-filter.
 *   - data-responsens dimensjonsrekkefølge (id/size) er ALLTID kanonisk
 *     /dimension-rekkefølge, uavhengig av rekkefølgen i POST-bodyen.
 *
 * CACHING: delt CacheManager, nøkkel-infiks 'fhi_'/'fhi-' (cache.js hopper
 * over SSB-oppdateringsplan-staleness for slike nøkler), ren 24 t TTL.
 * SPRÅK: FHI er kun norsk. meta.note settes (kun) når UI-språket er engelsk.
 */
(function () {
  'use strict';

  const logger = window.logger || console;

  const cfg = (window.AppConfig && window.AppConfig.sources && window.AppConfig.sources.fhi) || null;
  if (!cfg) {
    logger.warn && logger.warn('[FHIAdapter] AppConfig.sources.fhi mangler — registrerer ikke.');
    return;
  }
  if (cfg.enabled === false) {
    return; // Kilden er avskrudd i config.
  }

  const BASE = (cfg.baseUrl || 'https://statistikk-data.fhi.no/api/open/v1').replace(/\/+$/, '');
  const SOURCE_IDS = Array.isArray(cfg.sourceIds) ? cfg.sourceIds.slice() : [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL = (window.AppConfig.cache && window.AppConfig.cache.tableListTTL) || DAY_MS; // 24 t

  const NOT_SIGN = '¬'; // SSB-hierarkiprefiks (se ARCHITECTURE.md)
  const SUBJECT_ID = 'he'; // Helse

  // Emnesubjektets sortCode — kun kosmetisk (SSB-tabeller under 'he' oppretter
  // subjektnoden i emnetreet først; jf. tilsvarende resonnement i
  // norges-bank-adapter.js). Satt likevel defensivt for å unngå
  // undefined.localeCompare() dersom FHI mot formodning skulle bli
  // registrert/aggregert før noen SSB-tabell under 'he'.
  const SUBJECT_SORTCODE = { he: '0000004' };

  const EN_LANGUAGE_NOTE =
    'FHI data is only available in Norwegian. Dimension and category names ' +
    'below are shown in Norwegian even though the interface language is English.';

  // ---- Språk-/cache-hjelpere ----

  function uiLabelLang(lang) {
    const l = String(lang || (typeof getCurrentApiLang === 'function' ? getCurrentApiLang() : 'no')).toLowerCase();
    return l === 'no' ? 'nb' : l;
  }
  /** Slå opp en {nb,en}-label for gjeldende språk med nb-fallback (FHI-noder har kun nb). */
  function pickLabel(labelObj, lang) {
    if (!labelObj) return '';
    const l = uiLabelLang(lang);
    return labelObj[l] || labelObj.nb || labelObj.en || '';
  }

  let _cache = null;
  function cache() {
    if (_cache) return _cache;
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

  const currentLang = () =>
    (typeof window.getCurrentApiLang === 'function' ? window.getCurrentApiLang() : 'no');

  // ---- Fetch-hjelper ----

  /**
   * Hent JSON. Kaster en Error med lesbar melding på feil (RFC 7807-lignende
   * respons: detail / errors{} / title — FHI bruker alle tre avhengig av
   * feiltype, se f.eks. 400 «RequestInvalidProperty»/«RequestMissingProperty»
   * og 422 «One or more validation errors occurred»).
   */
  async function fetchJson(url, options) {
    const res = await fetch(url, options || {});
    if (!res.ok) {
      let message = '';
      try {
        const body = await res.json();
        if (body && body.detail) {
          message = body.detail;
        } else if (body && body.errors && typeof body.errors === 'object') {
          const parts = [];
          Object.keys(body.errors).forEach(k => {
            const v = body.errors[k];
            if (Array.isArray(v)) parts.push.apply(parts, v);
            else if (v) parts.push(String(v));
          });
          message = parts.join(' ');
        }
        if (!message && body && body.title) message = body.title;
      } catch (e) {
        // Responsen var ikke JSON — fall gjennom til generisk melding.
      }
      throw new Error(message || ('[FHIAdapter] HTTP ' + res.status + ' for ' + url));
    }
    return res.json();
  }

  const JSON_HEADERS = { Accept: 'application/json' };

  // ---- Tabell-id-namnerom: 'fhi-{source}-{tableId}' ----

  function parseId(tableId) {
    if (typeof tableId !== 'string') return null;
    const m = /^fhi-(.+)-(\d+)$/.exec(tableId);
    if (!m) return null;
    return { source: m[1], rawId: m[2] };
  }

  // ---- Rollegjenkjenning (se «LIVE-FUNN» i filhodet) ----

  // «år»/«aar» som selvstendig/suffiks-token, ikke som del av et annet ord
  // (unngår falskt treff i f.eks. «Dødsårsak»/«AARSAK»).
  const TIME_PATTERN = /(år|aar)(?![a-zæøåA-ZÆØÅ])/i;
  const GEO_PATTERN = /geografi|fylke|kommune|bosted|region/i;

  function isTimeDim(code, label) {
    return TIME_PATTERN.test(String(code || '')) || TIME_PATTERN.test(String(label || ''));
  }
  function isGeoDim(code, label) {
    if (String(code || '').toUpperCase() === 'GEO') return true;
    return GEO_PATTERN.test(String(label || ''));
  }
  function isMetricDim(code) {
    return String(code || '').toUpperCase() === 'MEASURE_TYPE';
  }

  // ---- Depth-first flatning av nøstede kategorier (GEO, KJONN, ALDER, FYLKE, …) ----

  /** @returns {Array<{code:string,label:string,depth:number}>} */
  function flattenCategories(categories, depth) {
    const d = depth || 0;
    let result = [];
    (categories || []).forEach(cat => {
      const code = String(cat.value);
      const label = cat.label != null ? String(cat.label) : code;
      result.push({ code: code, label: label, depth: d });
      if (cat.children && cat.children.length) {
        result = result.concat(flattenCategories(cat.children, d + 1));
      }
    });
    return result;
  }

  function prefixLabel(label, depth) {
    return depth > 0 ? (NOT_SIGN.repeat(depth) + ' ' + label) : label;
  }

  // ---- Common/source (kildetitler, cached) ----

  async function getSourceTitles() {
    const key = 'fhi_common_source';
    const cached = await cacheGet(key);
    if (cached) return cached;
    try {
      const list = await fetchJson(BASE + '/Common/source', { headers: JSON_HEADERS });
      const map = {};
      (list || []).forEach(s => { if (s && s.id) map[s.id] = s.title || s.id; });
      await cacheSet(key, map);
      return map;
    } catch (e) {
      logger.warn('[FHIAdapter] Klarte ikke hente /Common/source (bruker kilde-id som fallback):', e);
      return {};
    }
  }

  // ---- Katalog per kilde (cached) ----

  async function getSourceTableList(source) {
    const key = 'tables_fhi_' + source;
    const cached = await cacheGet(key);
    if (cached) return cached;
    const rows = await fetchJson(BASE + '/' + encodeURIComponent(source) + '/table', { headers: JSON_HEADERS });
    const list = rows || [];
    await cacheSet(key, list);
    return list;
  }

  async function buildSourceCatalogue(source, titleMap, lang) {
    const rows = await getSourceTableList(source); // kaster ved nettverksfeil → fanges av allSettled i getTables
    const nodes = (window.AppConfig && window.AppConfig.sourceNodes) || {};
    const subjectNames = (window.SubjectConfig && window.SubjectConfig.subjectNames) || {};
    const nodeId = 'fhi-' + source;
    const node = nodes[nodeId] || {};

    const subjectSeg = {
      id: SUBJECT_ID,
      label: pickLabel(subjectNames[SUBJECT_ID], lang) || SUBJECT_ID,
      sortCode: SUBJECT_SORTCODE[SUBJECT_ID] || '0009999'
    };
    const nodeSeg = {
      id: nodeId,
      label: pickLabel(node.label, lang) || nodeId,
      sortCode: node.sortCode || '999'
    };
    const sourceTitle = titleMap[source] || source;

    return (rows || []).map(row => ({
      id: 'fhi-' + source + '-' + row.tableId,
      label: (row.title || String(row.tableId)) + ' (FHI)',
      // NB: 'updated' MÅ være en streng (aldri null) — menu-hierarchy.js
      // _collectAllTables() sorterer via table.updated.localeCompare(...)
      // uten null-guard.
      updated: row.modifiedAt || row.publishedAt || '',
      firstPeriod: '',
      lastPeriod: '',
      discontinued: false,
      // sortCode brukes av menu-hierarchy.groupTables()/search-view.js for å
      // sortere tabeller innad i en gruppe (samme udokumenterte-men-påkrevde
      // felt som norges-bank-adapter.js setter defensivt). Zero-padded FHI
      // tableId gir stabil, leksikografisk korrekt rekkefølge.
      sortCode: String(row.tableId).padStart(6, '0'),
      // Tidsenhet kan ikke fastslås billig på katalog-nivå: den reelle
      // periodelengden varierer sterkt på tvers av FHI-tabeller (5-årige
      // glidende snitt, kalenderår, skoleår, fødselskohorter …), og å
      // fastslå den ekte enheten per tabell krever et eget /dimension-kall
      // PER RAD (urealistisk for et katalogbygg over ~100+ tabeller per
      // kilde). Vi lar frekvensfilteret degradere pent til «Andre tabeller»
      // (jf. browser-state.calcFrequencyCounts/filterTables, som allerede
      // håndterer null/ukjent timeUnit) i stedet for å gjette feil.
      timeUnit: null,
      variableNames: [],
      // Kreves av browser-state.js (_filterNonQuery/calcSubjectCounts) og
      // search-view.js (_searchGroupBySubject) for emnefilter/-gruppering —
      // udokumentert i source-registry.js sin katalog-kontrakt, men satt av
      // norges-bank-adapter.js (jf. subjectCode der) og av SSBs eget API.
      // Uten dette havner FHI-tabeller i «other»-bøtta og filtrerte søk på
      // emnet «Helse og samfunn» ekskluderer dem feilaktig.
      subjectCode: SUBJECT_ID,
      paths: [[subjectSeg, nodeSeg]],
      source: 'FHI/' + sourceTitle
    }));
  }

  async function getTables(options) {
    const opts = options || {};
    // Server-søk / nylig-oppdaterte er SSB-only semantikk.
    if (opts.query || opts.pastDays) return { tables: [] };

    const lang = currentLang();
    const titleMap = await getSourceTitles();

    // Promise.allSettled PER FHI-kilde (nokkel/mfr/daar …) — én kilde nede
    // (f.eks. mfr) skal ikke hindre at nokkel/daar vises i katalogen.
    const settled = await Promise.allSettled(
      SOURCE_IDS.map(source => buildSourceCatalogue(source, titleMap, lang))
    );

    const tables = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        tables.push.apply(tables, r.value);
      } else {
        logger.warn('[FHIAdapter] Kilde «' + SOURCE_IDS[i] + '» feilet under getTables (hoppes over):', r.reason);
      }
    });
    return { tables: tables };
  }

  // ---- Metadata ----

  async function buildMetadataCore(source, rawId) {
    const dimJson = await fetchJson(
      BASE + '/' + encodeURIComponent(source) + '/Table/' + encodeURIComponent(rawId) + '/dimension',
      { headers: JSON_HEADERS }
    );
    const dims = (dimJson && dimJson.dimensions) || [];

    const id = [];
    const size = [];
    const dimension = {};
    const role = { time: [], geo: [], metric: [] };
    const depthByDim = {};

    dims.forEach(dim => {
      const code = dim.code;
      const flat = flattenCategories(dim.categories || []);
      const index = {};
      const label = {};
      const depths = {};
      flat.forEach((entry, i) => {
        index[entry.code] = i;
        label[entry.code] = prefixLabel(entry.label, entry.depth);
        depths[entry.code] = entry.depth;
      });

      id.push(code);
      size.push(flat.length);
      // Ingen extension.elimination settes: FHI krever ALLE dimensjoner i
      // /data (verifisert — se filhodet), så default (ingen elimination →
      // "Obligatorisk"-merke i variabelvelgeren) er korrekt oppførsel, ikke
      // en forenkling.
      dimension[code] = { label: dim.label || code, category: { index: index, label: label } };
      depthByDim[code] = depths;

      if (isTimeDim(code, dim.label)) role.time.push(code);
      if (isGeoDim(code, dim.label)) role.geo.push(code);
      if (isMetricDim(code)) role.metric.push(code);
    });

    // Query-mal (kilde for getDefaultSelection) — hentes og caches sammen med
    // metadata siden begge trengs ved første tabellbesøk uansett.
    try {
      const queryTemplate = await fetchJson(
        BASE + '/' + encodeURIComponent(source) + '/Table/' + encodeURIComponent(rawId) + '/query',
        { headers: JSON_HEADERS }
      );
      await cacheSet('table_fhi-' + source + '-' + rawId + '_query', queryTemplate);
    } catch (e) {
      logger.warn('[FHIAdapter] Klarte ikke hente query-mal for ' + source + '/' + rawId + ':', e);
    }

    // Tabelltittel + sist oppdatert finnes ikke i /dimension — slås opp i den
    // (cachede) katalog-listen for kilden.
    let title = rawId;
    let updated = null;
    try {
      const rows = await getSourceTableList(source);
      const row = (rows || []).find(r => String(r.tableId) === String(rawId));
      if (row) {
        title = row.title || title;
        updated = row.modifiedAt || row.publishedAt || null;
      }
    } catch (e) {
      logger.warn('[FHIAdapter] Klarte ikke slå opp tabelltittel for ' + source + '/' + rawId + ':', e);
    }

    const titles = await getSourceTitles();
    const sourceTitle = titles[source] || source;

    const heading = id.filter(c => role.time.indexOf(c) === -1);
    const stub = id.filter(c => role.time.indexOf(c) !== -1);

    return {
      id: id,
      size: size,
      label: title,
      source: 'FHI/' + sourceTitle,
      updated: updated,
      dimension: dimension,
      role: role,
      extension: { px: { heading: heading, stub: stub } },
      // Internt felt — IKKE del av JSON-Stat2-kontrakten. Gjenbrukes av
      // getTableData for å ¬-prefikse dataresponsens etiketter konsistent
      // med metadata, uten et ekstra /dimension-kall.
      _fhiDepth: depthByDim
    };
  }

  async function getTableMetadata(tableId, useCache, lang) {
    const parsed = parseId(tableId);
    if (!parsed) throw new Error('[FHIAdapter] Ukjent tabell-id: ' + tableId);
    const { source, rawId } = parsed;
    if (SOURCE_IDS.indexOf(source) === -1) {
      throw new Error('[FHIAdapter] Ukjent FHI-kilde: ' + source);
    }
    const cacheKey = 'table_fhi-' + source + '-' + rawId + '_meta';

    let meta = null;
    if (useCache !== false) {
      meta = await cacheGet(cacheKey);
    }
    if (!meta) {
      meta = await buildMetadataCore(source, rawId);
      await cacheSet(cacheKey, meta);
    }

    // Språknote regnes ut PER KALL (ikke persistert i cachen) slik at bytte
    // av UI-språk ikke krever et nytt nettverkskall eller gir en stale note.
    const out = Object.assign({}, meta);
    if (uiLabelLang(lang) === 'en') {
      out.note = [EN_LANGUAGE_NOTE];
    } else {
      delete out.note;
    }
    return out;
  }

  // ---- Data ----

  /**
   * Oversett appens utvalg for én dimensjon til et FHI query-dimensjonsobjekt.
   * '*'/mangler → filter 'all' (krever values:['*'], se filhodet).
   * 'top(N)' på tidsdimensjonen → løses selv til filter 'item' med de N siste
   * kodene (se filhodet: API-ets eget 'top'-filter gir eldst-først).
   * 'top(N)' på andre dimensjoner (ingen UI-vei dit i dag) → sendes literal
   * som filter 'top' (API-ets egen semantikk, dokumentert som pass-through).
   * Array → filter 'item'. Tom array → behandles som '*' (defensivt; UI-en
   * lar ikke «Hent data» aktiveres med en tom obligatorisk dimensjon).
   */
  function buildDimensionRequest(dimCode, v, meta) {
    if (v === '*' || v === undefined || v === null) {
      return { code: dimCode, filter: 'all', values: ['*'] };
    }
    if (typeof v === 'string') {
      const m = /^top\((\d+)\)$/i.exec(v);
      if (m) {
        const n = parseInt(m[1], 10);
        const isTime = (meta.role && meta.role.time || []).indexOf(dimCode) !== -1;
        if (isTime) {
          const dim = meta.dimension[dimCode];
          const codes = dim
            ? Object.keys(dim.category.index).sort((a, b) => dim.category.index[a] - dim.category.index[b])
            : [];
          const last = codes.slice(-n);
          return { code: dimCode, filter: 'item', values: last.length ? last : ['*'] };
        }
        return { code: dimCode, filter: 'top', values: [String(n)] };
      }
      return { code: dimCode, filter: 'item', values: [v] };
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return { code: dimCode, filter: 'all', values: ['*'] };
      return { code: dimCode, filter: 'item', values: v.slice() };
    }
    return { code: dimCode, filter: 'all', values: ['*'] };
  }

  /**
   * Normaliser FHIs native JSON-Stat2-respons til formen app-koden forventer:
   * category.index som objekt (ikke array), ¬-prefikserte etiketter
   * (konsistent med metadata), egenutledet role (ikke API-ets upålitelige
   * role-felt), og undertrykte celler flyttet fra value[] til et status-kart.
   */
  function normalizeDataset(json, meta) {
    const flagSymbols = new Set(
      (json.extension && json.extension.flags && json.extension.flags.index) || ['..', '.', ':']
    );
    const depthByDim = meta._fhiDepth || {};
    const ids = json.id || meta.id || [];
    const dimension = {};

    ids.forEach(dimCode => {
      const src = (json.dimension && json.dimension[dimCode]) || { label: dimCode, category: { index: [], label: {} } };
      const idxSrc = src.category && src.category.index;
      const labelSrc = (src.category && src.category.label) || {};
      const depths = depthByDim[dimCode] || {};

      let codes;
      if (Array.isArray(idxSrc)) {
        codes = idxSrc;
      } else if (idxSrc && typeof idxSrc === 'object') {
        codes = Object.keys(idxSrc).sort((a, b) => idxSrc[a] - idxSrc[b]);
      } else {
        codes = [];
      }

      const index = {};
      const label = {};
      codes.forEach((code, i) => {
        index[code] = i;
        const raw = labelSrc[code] != null ? labelSrc[code] : code;
        label[code] = prefixLabel(raw, depths[code] || 0);
      });

      const dim = { label: src.label || dimCode, category: { index: index, label: label } };
      if (src.category && src.category.unit) dim.category.unit = src.category.unit;
      dimension[dimCode] = dim;
    });

    // Se filhodet: FHI koder undertrykte celler inline i value[] som strenger
    // (".", "..", ":") i stedet for et eget status-kart. Vi flytter dem over
    // slik getDataStatus()/formatNumber() i table-display.js håndterer dem
    // riktig (suppression-symbol + tooltip, ikke tallformatert tekst).
    const rawValues = Array.isArray(json.value) ? json.value : [];
    const value = new Array(rawValues.length);
    const status = {};
    rawValues.forEach((v, i) => {
      if (typeof v === 'string' && flagSymbols.has(v)) {
        status[String(i)] = v;
        value[i] = null;
      } else {
        value[i] = v;
      }
    });

    return {
      class: 'dataset',
      id: ids,
      size: json.size || meta.size || [],
      dimension: dimension,
      value: value,
      status: status,
      // Egenutledet i metadata-fasen (label-/kodeheuristikk) — API-ets eget
      // role-felt i dataresponsen er upålitelig (se filhodet), så vi bruker
      // aldri json.role.
      role: {
        time: ((meta.role && meta.role.time) || []).slice(),
        geo: ((meta.role && meta.role.geo) || []).slice(),
        metric: ((meta.role && meta.role.metric) || []).slice()
      },
      source: meta.source,
      label: json.label || meta.label || '',
      updated: json.updated || meta.updated || null
    };
  }

  async function getTableData(tableId, valueCodes, lang, codelistIds) {
    const parsed = parseId(tableId);
    if (!parsed) throw new Error('[FHIAdapter] Ukjent tabell-id: ' + tableId);
    const { source, rawId } = parsed;

    const meta = await getTableMetadata(tableId, true, lang); // cachet — trengs for dimensjonsrekkefølge/roller
    const sel = valueCodes || {};

    const dimensions = meta.id.map(dimCode => buildDimensionRequest(dimCode, sel[dimCode], meta));
    const body = {
      dimensions: dimensions,
      response: { format: 'json-stat2', maxRowCount: 50000 }
    };

    const json = await fetchJson(
      BASE + '/' + encodeURIComponent(source) + '/Table/' + encodeURIComponent(rawId) + '/data',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
      }
    );

    return normalizeDataset(json, meta);
  }

  // ---- Default selection (fra cachet query-mal) ----

  async function getDefaultSelection(tableId, lang) {
    const parsed = parseId(tableId);
    if (!parsed) throw new Error('[FHIAdapter] Ukjent tabell-id: ' + tableId);
    const { source, rawId } = parsed;
    const cacheKey = 'table_fhi-' + source + '-' + rawId + '_query';

    let tmpl = await cacheGet(cacheKey);
    if (!tmpl) {
      tmpl = await fetchJson(
        BASE + '/' + encodeURIComponent(source) + '/Table/' + encodeURIComponent(rawId) + '/query',
        { headers: JSON_HEADERS }
      );
      await cacheSet(cacheKey, tmpl);
    }
    const dims = (tmpl && tmpl.dimensions) || [];
    return {
      selection: dims.map(d => ({ variableCode: d.code, valueCodes: (d.values || []).slice() }))
    };
  }

  // ---- Adapterobjekt ----

  const adapter = {
    sourceId: 'fhi',

    capabilities: {
      supportsSavedQueries: false,
      supportsServerExport: false,
      supportsCodelists: false,
      supportsGetUrlBuilder: false,
      supportsDefaultSelection: true,
      supportsAggregation: false
    },

    ownsTableId: (id) => typeof id === 'string' && id.startsWith('fhi-'),

    // Config + savedqueries rutes til SSB av fasaden — men må finnes for kontrakten.
    getConfig: async () => null,

    getTables: getTables,
    getAllTables: getTables,

    getTableMetadata: getTableMetadata,
    getTableData: getTableData,
    getDefaultSelection: getDefaultSelection,

    getCodeList: async () => { throw new Error('[FHIAdapter] FHI har ikke kodelister'); },
    downloadTableData: async () => { throw new Error('[FHIAdapter] Server-eksport støttes ikke — bruk klientside CSV'); },
    saveSavedQuery: async () => { throw new Error('[FHIAdapter] FHI støtter ikke lagrede spørringer'); },
    getSavedQuery: async () => { throw new Error('[FHIAdapter] FHI støtter ikke lagrede spørringer'); },
    getSavedQueryData: async () => { throw new Error('[FHIAdapter] FHI støtter ikke lagrede spørringer'); },

    // Cache delegeres til SSB av fasaden — disse kalles aldri via fasaden.
    cleanupCache: () => 0,
    clearCache: () => {},
    getCacheStats: () => null
  };

  (window.SourceAdapters = window.SourceAdapters || []).push(adapter);
})();
