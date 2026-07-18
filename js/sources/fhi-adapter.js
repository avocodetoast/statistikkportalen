/**
 * FHI source adapter — Statistikkportalen 2.0  (Fase C, katalog-berikelse Fase G)
 * =================================================================================
 *
 * Implementerer adapterkontrakten i js/sources/source-registry.js for FHIs
 * åpne statistikk-API (statistikk-data.fhi.no), som leverer JSON-Stat2
 * NATIVT (i motsetning til Norges Bank sin SDMX-JSON). Adapteren er GENERISK
 * over AppConfig.sources.fhi.sourceIds — en ny FHI-kilde (fra «senere»-lista:
 * msis, sysvak, npr, kpr, lmr, gs, hkr, abr, ngs, skast) koster kun én
 * konfiglinje der + en tilhørende rad i AppConfig.sourceNodes.
 *
 * PREGENERERT KATALOG (Fase G)
 * -----------------------------
 * FHI-API-et mangler et vennlig tittelfelt (mange tabeller heter kun et
 * internt kodenavn, f.eks. «D10b_selvmord») og gjør det for dyrt å slå opp
 * tidsperiode for alle ~240 tabeller ved hvert sideoppslag (krever ett
 * /dimension-kall PER TABELL). scripts/update-fhi-catalog.mjs løser begge
 * ved BYGGETID og skriver data/sources/fhi-catalog.json (utledet tittel,
 * beskrivelse, first/lastPeriod, timeUnit, variableNames per tabell). Denne
 * fila hentes RELATIVT til siden (`fetch('data/sources/fhi-catalog.json')`,
 * fungerer fra index.html i repo-roten), caches kun i minnet (se
 * getCatalog/_catalogPromise), og brukes av getTables (buildSourceCatalogue)
 * og getTableMetadata (buildMetadataCore) til å berike katalogoppføringer og
 * metadata-tittel/-note. Mangler fila (aldri kjørt scriptet, eller
 * utilgjengelig fra siden som laster adapteren), faller alt tilbake til
 * dagens rå API-tittel/tomme periodefelt — se getCatalog sin warn-logging.
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

  // Timeout for nettverkskall mot FHI-API-et — en hengende FHI-server skal
  // ikke blokkere app-initialiseringen (BrowserState venter på hele
  // katalogaggregeringen i source-registry.js). Delt nøkkel med
  // norges-bank-adapter.js.
  const FETCH_TIMEOUT_MS = (window.AppConfig.sources && window.AppConfig.sources.fetchTimeoutMs) || 15000;

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

  // ---- Pregenerert katalog (data/sources/fhi-catalog.json, se
  // scripts/update-fhi-catalog.mjs) — tittel/periode-berikelse bygget ved
  // byggetid, IKKE live-hentet (240 tabeller × 2 kall er for dyrt per
  // sideoppslag). Hentes relativt til siden (index.html ligger i repo-roten,
  // så 'data/...' er korrekt) og caches KUN i minnet (ren lokal statisk fil,
  // ingen grunn til IndexedDB/localStorage-runde). Mangler filen (aldri
  // kjørt scriptet, eller kjøring feilet/filen er utilgjengelig fra siden som
  // laster adapteren — f.eks. en SEO-underside på annet stinivå), faller vi
  // tilbake til dagens live /table-liste uten berikelse; se getTables/
  // buildMetadataCore.

  let _catalogPromise = null;
  function getCatalog() {
    if (_catalogPromise) return _catalogPromise;
    _catalogPromise = fetch('data/sources/fhi-catalog.json', {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(json => {
        if (!json || typeof json !== 'object' || !json.sources) {
          throw new Error('Uventet format (mangler sources)');
        }
        return json;
      })
      .catch(e => {
        logger.warn(
          '[FHIAdapter] Klarte ikke laste data/sources/fhi-catalog.json ' +
          '(kjør «node scripts/update-fhi-catalog.mjs» for å generere den) — ' +
          'faller tilbake til live /table-liste uten tittel-/periodeberikelse:', e
        );
        return null;
      });
    return _catalogPromise;
  }

  /** Slå opp én tabells katalogoppføring (eller null om katalog/rad mangler). */
  async function getCatalogEntry(source, rawId) {
    const catalog = await getCatalog();
    const src = catalog && catalog.sources && catalog.sources[source];
    if (!src || !Array.isArray(src.tables)) return null;
    return src.tables.find(t => String(t.tableId) === String(rawId)) || null;
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
    const opts = Object.assign({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }, options || {});
    const res = await fetch(url, opts);
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
  // Eksakte dimensjonsnavn fra nye kilder som ikke inneholder et fritt «år»-
  // token: «Årgang»/Argang (hkr — 'år' etterfulgt av bokstav), «Sesong»/season
  // (msis/ngs), year/«Årstall» (sysvak), «Måned» (ngs) og «Uke»/week
  // (sysvak/msis ukestall). EKSAKT match (ikke substring) slik at f.eks. mfr
  // «Fødselsmåned» (sekundærdimensjon ved siden av årsdimensjonen) ikke
  // feilklassifiseres.
  const TIME_EXACT = /^(årgang|aargang|argang|sesong|season|year|årstall|måned|maaned|month|uke|week)$/i;
  const GEO_PATTERN = /geografi|fylke|kommune|bosted|region/i;

  function isTimeDim(code, label) {
    const c = String(code || '').trim();
    const l = String(label || '').trim();
    return TIME_PATTERN.test(c) || TIME_PATTERN.test(l) ||
      TIME_EXACT.test(c) || TIME_EXACT.test(l);
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

  /**
   * Hent tabell-listen for én delkilde med cache- og stale-håndtering.
   * !force + fersk cache → cachet liste. Ellers nettverk; ved nettverksfeil
   * serveres en (utløpt) cachet kopi som stale fallback hvis den finnes,
   * ellers kastes feilen (fanges per delkilde av allSettled i getTables).
   * @returns {Promise<{list:Array, fromCache:boolean, stale:boolean, fetchedAt:number}>}
   */
  async function fetchSourceTableList(source, force) {
    const key = 'tables_fhi_' + source;
    const c = cache();
    let entry = null;
    if (c && typeof c.getEntry === 'function') {
      try { entry = await c.getEntry(key); } catch (e) { entry = null; }
    }
    if (!force && entry && entry.fresh) {
      return { list: entry.value, fromCache: true, stale: false, fetchedAt: entry.stored };
    }
    try {
      const rows = await fetchJson(BASE + '/' + encodeURIComponent(source) + '/table', { headers: JSON_HEADERS });
      const list = rows || [];
      await cacheSet(key, list);
      return { list: list, fromCache: false, stale: false, fetchedAt: Date.now() };
    } catch (e) {
      if (entry && Array.isArray(entry.value)) {
        logger.warn('[FHIAdapter] Kilde «' + source + '» nede — serverer eldre cachet liste (' +
                    entry.value.length + ' tabeller):', e);
        return { list: entry.value, fromCache: true, stale: true, fetchedAt: entry.stored };
      }
      throw e;
    }
  }

  async function getSourceTableList(source) {
    return (await fetchSourceTableList(source, false)).list;
  }

  async function buildSourceCatalogue(source, titleMap, lang, force) {
    const fetched = await fetchSourceTableList(source, force); // kaster ved nettverksfeil uten cache → fanges av allSettled i getTables
    const rows = fetched.list;
    const catalog = await getCatalog(); // null hvis fila mangler/feiler — se getCatalog
    const catSource = (catalog && catalog.sources && catalog.sources[source]) || null;
    const catRows = (catSource && catSource.tables) || [];
    const catById = new Map(catRows.map(t => [String(t.tableId), t]));
    // Kuraterte kategorier (register → kategori, se data/sources/fhi-curation.json
    // og scripts/lib/fhi-curation.mjs): {katId: {label, sortCode}}. Tabeller med
    // `category` i katalogen får et TREDJE path-segment under registernoden;
    // tabeller uten (og hele kilden når katalogfila mangler) beholder dagens
    // 2-segments plassering rett under registernoden.
    const catCategories = (catSource && catSource.categories) || null;

    const nodes = (window.AppConfig && window.AppConfig.sourceNodes) || {};
    const subjectNames = (window.SubjectConfig && window.SubjectConfig.subjectNames) || {};

    // En delkilde kan plasseres flere steder i emnetreet via
    // AppConfig.sources.fhi.paths[source] = [[subjektkode, node-id], …];
    // default er én plassering under 'he' med den kildespesifikke noden.
    // Subjektkoder må finnes i subjects.js (subjectNames + en gruppe) og
    // node-id-er i AppConfig.sourceNodes, ellers rendres ikke plasseringen.
    const placements = (cfg.paths && Array.isArray(cfg.paths[source]) && cfg.paths[source].length)
      ? cfg.paths[source]
      : [[SUBJECT_ID, 'fhi-' + source]];
    const subjectCode = placements[0][0];

    const basePaths = placements.map(p => {
      const subjId = p[0];
      const nodeId = p[1];
      const node = nodes[nodeId] || {};
      return [
        {
          id: subjId,
          label: pickLabel(subjectNames[subjId], lang) || subjId,
          sortCode: SUBJECT_SORTCODE[subjId] || '0009999'
        },
        {
          id: nodeId,
          label: pickLabel(node.label, lang) || nodeId,
          sortCode: node.sortCode || '999'
        }
      ];
    });
    /** Paths for én tabell: basePaths + ev. kategorisegment (nb-only labels). */
    function pathsForCategory(catId) {
      if (!catId || !catCategories || !catCategories[catId]) return basePaths;
      const def = catCategories[catId];
      const seg = {
        id: 'fhi-' + source + '-' + catId,
        label: def.label || catId,
        sortCode: def.sortCode || '999'
      };
      return basePaths.map(p => p.concat([seg]));
    }
    const sourceTitle = titleMap[source] || source;

    const tables = (rows || []).map(row => {
      // Katalogoppføringen (data/sources/fhi-catalog.json) gir en tittel
      // utledet fra tabellens metadata-sammendrag der API-tittelen bare er et
      // internt kodenavn (f.eks. «D10b_selvmord» → «Dødsfall med
      // underliggende dødsårsak selvmord»), pluss first/lastPeriod og
      // timeUnit fra en /dimension-analyse gjort ved byggetid — se
      // scripts/update-fhi-catalog.mjs. Uten katalogen (fila mangler/feiler
      // å laste) faller alt dette tilbake til den rå API-tittelen og tomme
      // periodefelt, akkurat som før katalogen fantes.
      const cat = catById.get(String(row.tableId));
      const title = (cat && cat.title) || row.title || String(row.tableId);

      return {
        id: 'fhi-' + source + '-' + row.tableId,
        label: title + ' (FHI)',
        // NB: 'updated' MÅ være en streng (aldri null) — menu-hierarchy.js
        // _collectAllTables() sorterer via table.updated.localeCompare(...)
        // uten null-guard.
        updated: row.modifiedAt || row.publishedAt || (cat && cat.updated) || '',
        firstPeriod: (cat && cat.firstPeriod) || '',
        lastPeriod: (cat && cat.lastPeriod) || '',
        discontinued: false,
        // sortCode brukes av menu-hierarchy.groupTables()/search-view.js for å
        // sortere tabeller innad i en gruppe (samme udokumenterte-men-påkrevde
        // felt som norges-bank-adapter.js setter defensivt). Zero-padded FHI
        // tableId gir stabil, leksikografisk korrekt rekkefølge.
        sortCode: String(row.tableId).padStart(6, '0'),
        // 'Annual' når katalogen har fastslått at samtlige perioder i
        // tidsdimensjonen er enkeltår (se deriveTimeInfo i byggescriptet);
        // ellers null (5-årige glidende snitt, skoleår, fødselskohorter …) —
        // browser-state.calcFrequencyCounts/filterTables degraderer null
        // pent til «Andre tabeller» i stedet for å gjette feil.
        timeUnit: (cat && cat.timeUnit) || null,
        variableNames: (cat && cat.variableNames) || [],
        // Brukes av browser-state.renderTableListHTML som hover-tooltip på
        // tabellenken (rendrer kun når feltet er satt) — utledet fra samme
        // metadata-sammendrag som tittelen, se byggescriptet.
        description: (cat && cat.description) || '',
        // Kreves av browser-state.js (_filterNonQuery/calcSubjectCounts) og
        // search-view.js (_searchGroupBySubject) for emnefilter/-gruppering —
        // udokumentert i source-registry.js sin katalog-kontrakt, men satt av
        // norges-bank-adapter.js (jf. subjectCode der) og av SSBs eget API.
        // Uten dette havner FHI-tabeller i «other»-bøtta og filtrerte søk på
        // emnet «Helse og samfunn» ekskluderer dem feilaktig.
        subjectCode: subjectCode,
        paths: pathsForCategory(cat && cat.category),
        source: 'FHI/' + sourceTitle
      };
    });

    return {
      tables: tables,
      meta: { fromCache: fetched.fromCache, stale: fetched.stale, fetchedAt: fetched.fetchedAt }
    };
  }

  async function getTables(options) {
    const opts = options || {};
    // Server-søk / nylig-oppdaterte er SSB-only semantikk.
    if (opts.query || opts.pastDays) return { tables: [] };
    const force = opts.useCache === false;

    const lang = currentLang();
    const titleMap = await getSourceTitles();

    // Promise.allSettled PER FHI-kilde (nokkel/mfr/daar …) — én kilde nede
    // (f.eks. mfr) skal ikke hindre at nokkel/daar vises i katalogen.
    const settled = await Promise.allSettled(
      SOURCE_IDS.map(source => buildSourceCatalogue(source, titleMap, lang, force))
    );

    const tables = [];
    const metas = [];
    const failed = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        tables.push.apply(tables, r.value.tables);
        metas.push(r.value.meta);
      } else {
        failed.push(SOURCE_IDS[i]);
        logger.warn('[FHIAdapter] Kilde «' + SOURCE_IDS[i] + '» feilet under getTables (hoppes over):', r.reason);
      }
    });

    // Adapterkontrakten (source-registry.js): en kilde HELT uten data skal
    // kaste, slik at fasadens allSettled ser kilden som feilet i stedet for
    // en stille tom katalog.
    if (SOURCE_IDS.length > 0 && failed.length === SOURCE_IDS.length) {
      const reasons = settled
        .map((r, i) => SOURCE_IDS[i] + ': ' + ((r.reason && r.reason.message) || r.reason))
        .join('; ');
      throw new Error('[FHIAdapter] Alle FHI-kilder feilet: ' + reasons);
    }

    const sourceMeta = {
      fromCache: metas.length > 0 && metas.every(m => m.fromCache),
      stale: metas.some(m => m.stale),
      fetchedAt: metas.reduce((max, m) => Math.max(max, m.fetchedAt || 0), 0) || Date.now()
    };
    if (failed.length) sourceMeta.partial = failed;
    return { tables: tables, sourceMeta: sourceMeta };
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

    // Pregenerert katalog (se getCatalog) foretrekkes for tittelen — utledet
    // fra metadata-sammendraget der API-tittelen bare er et internt kodenavn
    // (se scripts/update-fhi-catalog.mjs) — og gir en beskrivelse som legges
    // inn som en metadata-note under (append, ikke erstatning — se
    // getTableMetadata som ev. legger til EN-språknoten i tillegg).
    let description = null;
    try {
      const catEntry = await getCatalogEntry(source, rawId);
      if (catEntry) {
        if (catEntry.title) title = catEntry.title;
        if (catEntry.description) description = catEntry.description;
      }
    } catch (e) {
      logger.warn('[FHIAdapter] Klarte ikke slå opp katalogoppføring for ' + source + '/' + rawId + ':', e);
    }

    const titles = await getSourceTitles();
    const sourceTitle = titles[source] || source;

    const heading = id.filter(c => role.time.indexOf(c) === -1);
    const stub = id.filter(c => role.time.indexOf(c) !== -1);

    const meta = {
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
    if (description) meta.note = [description];
    return meta;
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
    // meta.note kan allerede inneholde en katalog-utledet beskrivelse (satt i
    // buildMetadataCore, cachet sammen med resten av metadataene) — den
    // beholdes ALLTID (også når lang='en', beskrivelsen finnes kun på norsk
    // uansett), EN-språknoten LEGGES TIL i tillegg, den erstatter ikke.
    const out = Object.assign({}, meta);
    const baseNotes = Array.isArray(meta.note) ? meta.note.slice() : [];
    if (uiLabelLang(lang) === 'en') {
      out.note = baseNotes.concat([EN_LANGUAGE_NOTE]);
    } else if (baseNotes.length) {
      out.note = baseNotes;
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

  // Responsformater FHIs API faktisk støtter (verifisert mot det levende
  // API-et; andre verdier avvises med 422). json-stat2 er det appen selv
  // konsumerer og dermed standardvalget i API-byggeren.
  const API_FORMATS = ['json-stat2', 'csv2', 'csv3', 'parquet'];
  const DEFAULT_MAX_ROW_COUNT = 50000;

  /**
   * Bygg POST-bodyen for et utvalg (delt mellom getTableData og buildApiQuery
   * slik at API-bygger-forhåndsvisningen aldri divergerer fra det appen
   * faktisk sender). responseOptions ({format, maxRowCount}) settes kun av
   * API-byggeren — getTableData utelater dem og får dermed alltid dagens
   * json-stat2-body uendret. maxRowCount: null utelater feltet (API-et
   * tolker det som ubegrenset); ugyldige verdier faller tilbake til standard.
   */
  function buildDataBody(meta, valueCodes, responseOptions) {
    const sel = valueCodes || {};
    const ro = responseOptions || {};
    const response = { format: API_FORMATS.includes(ro.format) ? ro.format : 'json-stat2' };
    if (ro.maxRowCount !== null) {
      response.maxRowCount = Number.isInteger(ro.maxRowCount) && ro.maxRowCount > 0
        ? ro.maxRowCount
        : DEFAULT_MAX_ROW_COUNT;
    }
    return {
      dimensions: meta.id.map(dimCode => buildDimensionRequest(dimCode, sel[dimCode], meta)),
      response: response
    };
  }

  /**
   * API-bygger-spørring (kontrakten i source-registry.js): synkron beskrivelse
   * av POST-kallet mot FHIs åpne API for gjeldende utvalg. options.meta
   * (allerede lastet tabellmetadata) er PÅKREVD — metoden er synkron og kan
   * ikke hente metadata selv; UI-en (variable-select) har den alltid lastet
   * før forhåndsvisningen oppdateres. FHI har ingen lang-parameter, så
   * options.lang ignoreres.
   */
  function buildApiQuery(tableId, valueCodes, options) {
    const parsed = parseId(tableId);
    if (!parsed) throw new Error('[FHIAdapter] Ukjent tabell-id: ' + tableId);
    const opts = options || {};
    if (!opts.meta || !Array.isArray(opts.meta.id)) {
      throw new Error('[FHIAdapter] buildApiQuery krever options.meta (lastet tabellmetadata)');
    }
    const base = BASE + '/' + encodeURIComponent(parsed.source) +
      '/Table/' + encodeURIComponent(parsed.rawId);
    return {
      method: 'POST',
      url: base + '/data',
      body: buildDataBody(opts.meta, valueCodes, {
        format: opts.format,
        maxRowCount: opts.maxRowCount
      }),
      metadataUrl: base + '/dimension'
    };
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
    const body = buildDataBody(meta, valueCodes);

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
      // Forenklet API-bygger (POST-endepunkt + JSON-body + metadata-URL) via
      // buildApiQuery — gjenbruker samme body-bygging som getTableData.
      supportsApiQuery: true,
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
    buildApiQuery: buildApiQuery,
    getDefaultSelection: getDefaultSelection,

    // Valgene API-byggeren (variable-select) skal tilby for denne kilden.
    getApiBuilderOptions: () => ({
      formats: [
        { value: 'json-stat2', label: 'JSON-stat2' },
        { value: 'csv2', label: 'CSV2' },
        { value: 'csv3', label: 'CSV3' },
        { value: 'parquet', label: 'Parquet' }
      ],
      defaultFormat: 'json-stat2',
      csvFormats: ['csv2', 'csv3'],
      maxRowCount: { default: DEFAULT_MAX_ROW_COUNT }
    }),

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
