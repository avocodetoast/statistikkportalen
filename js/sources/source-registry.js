/**
 * Source Registry — Statistikkportalen 2.0 multi-kilde-fasade
 * ==========================================================
 *
 * Bygger `window.api`-fasaden som ruter alle kall videre til riktig
 * kildeadapter (SSB / Norges Bank / FHI) basert på tabell-id-prefiks, og
 * aggregerer katalogen på tvers av kilder. Callsites bruker den bare globale
 * `api` (som løser til window.api-egenskapen); denne filen laster SIST blant
 * js/sources/* og ERSTATTER window.api med fasaden — se js/api.js for hvorfor
 * det virker (window.api er en egenskap, ikke en leksikalsk const).
 *
 * REGISTRERINGSKONTRAKT
 * ---------------------
 * Hver adapterfil (js/sources/{kilde}-adapter.js) laster FØR denne og dytter
 * ETT adapterobjekt på den delte lista:
 *
 *     (window.SourceAdapters = window.SourceAdapters || []).push(adapter);
 *
 * source-registry.js konsumerer window.SourceAdapters ved lasting. En stub-
 * adapter som ikke dytter noe, er helt trygg: da er kun de registrerte kildene
 * aktive (kun SSB → identisk oppførsel som i dag).
 *
 * ADAPTERKONTRAKT (påkrevde felt)
 * -------------------------------
 *   sourceId      : string   — 'ssb' | 'nb' | 'fhi'. Brukes for enabled-oppslag
 *                              i AppConfig.sources[<map>] og i logging.
 *   capabilities  : object   — booleans, se «Capabilities» under.
 *   ownsTableId(id): boolean — true hvis adapteren eier tabell-id-en. NB/FHI:
 *                              `id.startsWith('nb-')` / `id.startsWith('fhi-')`.
 *                              SSB er fallback og returnerer alltid true.
 *   instance      : object?  — (kun SSB) rå SSBApi-instans for delt cache-
 *                              delegering. Fremmede adaptere trenger ikke dette.
 *
 * ADAPTERKONTRAKT (API-flate — alle metoder, samme signatur som SSBApi)
 * --------------------------------------------------------------------
 *   getConfig()                                   → Promise<object|null>
 *   getTables(options)                            → Promise<{tables:[]}>
 *   getAllTables(options)                         → Promise<{tables:[]}>
 *   getTableMetadata(id, useCache?, lang?)        → Promise<JSONStat2Meta>
 *   getTableData(id, valueCodes, lang?, codelistIds?) → Promise<JSONStat2Data>
 *   getCodeList(codelistId, useCache?, lang?)     → Promise<object>
 *   downloadTableData(id, valueCodes, options)    → Promise<void> (trigger nedlasting)
 *   saveSavedQuery(id, valueCodes, options?)      → Promise<object>
 *   getSavedQuery(id)                             → Promise<object>
 *   getSavedQueryData(id, lang?)                  → Promise<JSONStat2Data>
 *   getDefaultSelection(id, lang?)                → Promise<{selection:[]}>
 *   buildPostBody(valueCodes, options?)           → object  (synkron; SSB-only)
 *   cleanupCache()                                → number
 *   clearCache()                                  → void|Promise<void>
 *   getCacheStats()                               → object|null
 *
 * En adapter som ikke støtter en metode (jf. capabilities) MÅ likevel definere
 * den — kast en Error eller returner en tom/degradert verdi. UI-en (Fase D)
 * gater knappene på capabilities, men fasaden kaller aldri en manglende metode.
 *
 * RUTING
 * ------
 *  • Id-baserte metoder (getTableMetadata, getTableData, getCodeList,
 *    downloadTableData, getDefaultSelection) → adapteren der ownsTableId(id) er
 *    true (fremmede kilder sjekkes først, SSB er fallback).
 *  • getConfig + savedquery-metodene (saveSavedQuery, getSavedQuery,
 *    getSavedQueryData) → KUN SSB-adapteren.
 *  • getTables/getAllTables → aggregerer alle *enabled* kilder med
 *    Promise.allSettled. Oppfylte resultater konkateneres i registrerings-
 *    rekkefølgen (= script-lasterekkefølgen i index.html: norges-bank → fhi
 *    → ssb, altså SSB SIST — rekkefølgen er uten betydning siden
 *    menu-hierarchy.js uansett sorterer emnetreet), avviste kilder logges med
 *    logger.warn — én kilde nede bryter ikke portalen. Når options.query
 *    eller options.pastDays er satt (server-søk / nylig oppdaterte tabeller —
 *    SSB-only semantikk) returnerer fremmede adaptere []; kun SSB besvarer
 *    disse.
 *  • Cache-metodene (cleanupCache, clearCache, getCacheStats) → delegeres til
 *    SSB-adapterens underliggende CacheManager (delt av alle kilder), så
 *    oppførselen er uendret. Fremmede kilder cacher under samme CacheManager
 *    med nøkkel-infiks 'nb_'/'nb-'/'fhi_'/'fhi-' (jf. cache.js-guarden).
 *
 * KATALOG-OPPFØRING (shape som menu-hierarchy.js / browser-state.js forventer)
 * ----------------------------------------------------------------------------
 *   {
 *     id:            string,   // namnerommet, f.eks. 'nb-IR', 'fhi-daar-344'
 *     label:         string,   // visningsnavn på gjeldende språk
 *     updated:       string,   // ISO-dato ('' hvis ukjent) — brukes til sortering
 *     firstPeriod:   string,   // f.eks. '2010' / '2010M01'
 *     lastPeriod:    string,
 *     discontinued:  boolean,
 *     timeUnit:      string,   // 'Annual' | 'Quarterly' | 'Monthly' | ...
 *     variableNames: string[], // for søk
 *     paths:         Array<Array<{ id, label, sortCode }>>, // syntetiske for NB/FHI
 *     source:        string    // proveniens, f.eks. 'Norges Bank', 'FHI/Dødsårsaksregisteret'
 *   }
 * Emneplassering: bygg `paths` fra AppConfig.sources.<kilde> + AppConfig.sourceNodes
 * (label + sortCode per node). Subjektsegmentet (path[0], f.eks. 'bf'/'he')
 * hentes fra SubjectConfig.subjectNames. FHI-labels er kun 'nb' — fall tilbake
 * til nb når 'en' mangler.
 *
 * JSON-STAT2 (metadata/data — shape som variable-select-render.js / table-display.js bruker)
 * ------------------------------------------------------------------------------------------
 *   { id:[dimIds], size:[int], dimension:{ <dimId>:{ label, category:{ index, label },
 *     extension?:{ elimination, ... } }, ... }, role:{ time:[...], geo:[...], metric:[...] },
 *     value:[...] , status?:{...} }
 *   Data må ha en flat `value`-array i rekkefølge diktert av `id`/`size`
 *   (row-major), og `role.time` satt for tidsdimensjonen (pivot-pipelinen i
 *   table-display.js er avhengig av role.time). Norges Bank-SDMX konverteres av
 *   js/sources/sdmx-to-jsonstat.js; FHI leverer JSON-Stat2 native.
 *
 * FEILHÅNDTERING
 * --------------
 *   • Katalog (getTables/getAllTables): kast ved feil — fasaden isolerer via
 *     allSettled og logger.warn, så én kilde nede tar ikke ned portalen.
 *   • Norges Bank: HTTP 404 = TOMT resultat (tom tabell), ikke feil.
 *   • Bruk `logger.warn`/`logger.error`, aldri console.* direkte.
 *
 * CACHING
 * -------
 *   • Bruk en delt CacheManager (samme prefiks 'ssb_') men med nøkkel-infiks
 *     som identifiserer kilden: 'tables_nb_no', 'table_nb-IR_no',
 *     'table_fhi-daar-344_no'. Guarden i cache.js hopper over SSB-
 *     oppdateringsplan-staleness for slike nøkler (ren TTL gjelder, 24 t).
 */
(function () {
  'use strict';

  const logger = window.logger || console;

  const registry = {
    adapters: [],

    /** Registrer én adapter (idempotent på sourceId). */
    register(adapter) {
      if (!adapter || typeof adapter.sourceId !== 'string') {
        logger.warn('[SourceRegistry] Ignorerte ugyldig adapter (mangler sourceId)');
        return;
      }
      if (this.adapters.some(a => a.sourceId === adapter.sourceId)) {
        logger.warn('[SourceRegistry] Adapter «' + adapter.sourceId + '» er allerede registrert — hopper over');
        return;
      }
      this.adapters.push(adapter);
    },

    /** SSB-adapteren (fallback + kilde for config/savedquery/cache). */
    get ssb() {
      return this.adapters.find(a => a.sourceId === 'ssb') || null;
    },

    /** Map en sourceId til AppConfig.sources-nøkkelen for enabled-oppslag. */
    _configKeyFor(sourceId) {
      // sources: { ssb, nb, fhi }. sourceId matcher nøkkelen direkte.
      return sourceId;
    },

    /** Er kilden aktivert i AppConfig.sources? Default true om ukonfigurert. */
    isEnabled(adapter) {
      const cfg = (window.AppConfig && window.AppConfig.sources) || {};
      const entry = cfg[this._configKeyFor(adapter.sourceId)];
      return !entry || entry.enabled !== false;
    },

    /** Finn adapteren som eier en tabell-id (fremmede først, SSB fallback). */
    adapterForTableId(tableId) {
      // Ikke-SSB-adaptere prøves først slik at mest spesifikke eier vinner.
      const foreign = this.adapters.find(
        a => a.sourceId !== 'ssb' && this.isEnabled(a) && a.ownsTableId(tableId)
      );
      if (foreign) return foreign;
      const ssb = this.ssb;
      if (ssb) return ssb;
      // Siste utvei: hvilken som helst adapter som påstår eierskap.
      return this.adapters.find(a => a.ownsTableId(tableId)) || null;
    }
  };

  // Konsumer adaptere som ble dyttet på window.SourceAdapters før denne filen.
  (window.SourceAdapters || []).forEach(a => registry.register(a));

  window.SourceRegistry = registry;

  // ---- Hjelpere ----

  /** Kaster en tydelig feil hvis ingen adapter kan håndtere id-en. */
  function requireAdapterForId(tableId, method) {
    const adapter = registry.adapterForTableId(tableId);
    if (!adapter) {
      throw new Error('[SourceRegistry] Ingen kilde kan håndtere «' + tableId + '» (' + method + ')');
    }
    return adapter;
  }

  /** Kaster hvis SSB-adapteren mangler (kreves for config/savedquery/cache). */
  function requireSSB(method) {
    const ssb = registry.ssb;
    if (!ssb) {
      throw new Error('[SourceRegistry] SSB-adapteren er ikke registrert (' + method + ')');
    }
    return ssb;
  }

  /**
   * Aggreger katalogen på tvers av alle aktiverte kilder.
   * Bruker Promise.allSettled: avviste kilder logges, oppfylte konkateneres i
   * registreringsrekkefølgen (= script-lasterekkefølgen i index.html:
   * norges-bank → fhi → ssb, altså SSB SIST — rekkefølgen er funksjonelt
   * likegyldig, menu-hierarchy.js sorterer uansett emnetreet). Fremmede kilder
   * som ikke støtter server-søk/nylig-oppdaterte (options.query /
   * options.pastDays) returnerer [] og hoppes effektivt over.
   */
  async function aggregateTables(method, options) {
    const opts = options || {};
    const foreignSkip = !!(opts.query || opts.pastDays);

    const enabled = registry.adapters.filter(a => registry.isEnabled(a));
    const settled = await Promise.allSettled(enabled.map(a => {
      if (foreignSkip && a.sourceId !== 'ssb') {
        return Promise.resolve({ sourceId: a.sourceId, tables: [] });
      }
      return Promise.resolve(a[method](opts)).then(
        r => ({ sourceId: a.sourceId, tables: (r && Array.isArray(r.tables)) ? r.tables : [] }),
        err => Promise.reject({ sourceId: a.sourceId, error: err })
      );
    }));

    const tables = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        tables.push(...s.value.tables);
      } else {
        const info = s.reason || {};
        logger.warn('[SourceRegistry] Kilde «' + (info.sourceId || '?') + '» feilet under ' +
                    method + ' (hoppes over):', info.error || s.reason);
      }
    }
    return { tables };
  }

  // ---- Fasaden ----

  const api = {
    // Delt CacheManager-referanse (samme som SSBApi bruker) — praktisk for
    // introspeksjon; cache-metodene under delegerer også hit.
    get cache() { return registry.ssb ? registry.ssb.instance.cache : null; },

    // Beholder SSBApis baseUrl for diagnostikk/logging (index.html logger den).
    get baseUrl() { return registry.ssb ? registry.ssb.instance.baseUrl : (window.AppConfig && window.AppConfig.apiBaseUrl); },

    // ---- Katalog (aggregert) ----
    getTables(options) { return aggregateTables('getTables', options); },
    getAllTables(options) { return aggregateTables('getAllTables', options); },

    // ---- Config + savedqueries → KUN SSB ----
    getConfig(...a) { return requireSSB('getConfig').getConfig(...a); },
    // Synkron ren hjelper for API-bygger-panelet (SSB-only). Beholdt på fasaden
    // for uendret oppførsel; ikke id-basert (ingen tableId i signaturen).
    buildPostBody(...a) { return requireSSB('buildPostBody').buildPostBody(...a); },
    saveSavedQuery(...a) { return requireSSB('saveSavedQuery').saveSavedQuery(...a); },
    getSavedQuery(...a) { return requireSSB('getSavedQuery').getSavedQuery(...a); },
    getSavedQueryData(...a) { return requireSSB('getSavedQueryData').getSavedQueryData(...a); },

    // ---- Id-baserte metoder → rutes via ownsTableId ----
    getTableMetadata(tableId, ...rest) {
      return requireAdapterForId(tableId, 'getTableMetadata').getTableMetadata(tableId, ...rest);
    },
    getTableData(tableId, ...rest) {
      return requireAdapterForId(tableId, 'getTableData').getTableData(tableId, ...rest);
    },
    getCodeList(codelistId, ...rest) {
      // Kodelist-id-er (vs_*/agg_*) eies av SSB via fallback-ownsTableId, så
      // dette lander på SSB i dag. Ruting via ownsTableId (i stedet for hard
      // SSB-binding) lar en fremmed kilde med prefiks-namnerommede kodelister
      // (f.eks. 'fhi-...') plukkes opp senere uten fasadeendring.
      return requireAdapterForId(codelistId, 'getCodeList').getCodeList(codelistId, ...rest);
    },
    downloadTableData(tableId, ...rest) {
      return requireAdapterForId(tableId, 'downloadTableData').downloadTableData(tableId, ...rest);
    },
    getDefaultSelection(tableId, ...rest) {
      return requireAdapterForId(tableId, 'getDefaultSelection').getDefaultSelection(tableId, ...rest);
    },

    // ---- Cache → delt SSB-CacheManager (uendret oppførsel) ----
    cleanupCache(...a) { return requireSSB('cleanupCache').cleanupCache(...a); },
    clearCache(...a) { return requireSSB('clearCache').clearCache(...a); },
    getCacheStats(...a) { return requireSSB('getCacheStats').getCacheStats(...a); },

    // ---- Introspeksjon (Fase D: capability-gates i UI) ----
    /** Capabilities-objektet til kilden som eier tabell-id-en. */
    capabilitiesFor(tableId) {
      const adapter = registry.adapterForTableId(tableId);
      return adapter ? adapter.capabilities : null;
    },
    /** sourceId ('ssb'|'nb'|'fhi') for kilden som eier tabell-id-en. */
    sourceFor(tableId) {
      const adapter = registry.adapterForTableId(tableId);
      return adapter ? adapter.sourceId : null;
    }
  };

  // Erstatt den rene SSBApi-instansen fra api.js med multi-kilde-fasaden.
  window.api = api;

  logger.log('[SourceRegistry] Fasade aktiv med kilder: ' +
             registry.adapters.map(a => a.sourceId).join(', '));
})();
