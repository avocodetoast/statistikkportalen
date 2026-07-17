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
 *   getTables(options)                            → Promise<{tables:[], sourceMeta?}>
 *   getAllTables(options)                         → Promise<{tables:[], sourceMeta?}>
 *       sourceMeta (valgfri, konsumeres av fasaden — lekker ALDRI ut til
 *       callere): { fromCache:bool, stale:bool, fetchedAt:number,
 *       partial?:string[] (feilede FHI-delkilder), error?:string }.
 *       sourceMeta må ALDRI caches (ellers replays en stale fetchedAt).
 *       Katalogmetodene skal respektere options.useCache === false
 *       (bypass cache — brukes av reloadSource ved manuell «Oppdater»).
 *   getTableMetadata(id, useCache?, lang?)        → Promise<JSONStat2Meta>
 *   getTableData(id, valueCodes, lang?, codelistIds?) → Promise<JSONStat2Data>
 *   getCodeList(codelistId, useCache?, lang?)     → Promise<object>
 *   downloadTableData(id, valueCodes, options)    → Promise<void> (trigger nedlasting)
 *   saveSavedQuery(id, valueCodes, options?)      → Promise<object>
 *   getSavedQuery(id)                             → Promise<object>
 *   getSavedQueryData(id, lang?)                  → Promise<JSONStat2Data>
 *   getDefaultSelection(id, lang?)                → Promise<{selection:[]}>
 *   buildPostBody(valueCodes, options?)           → object  (synkron; SSB-only)
 *   buildApiQuery(id, valueCodes, options?)       → object  (synkron; NB/FHI —
 *       API-bygger-forhåndsvisning: { method:'GET'|'POST', url, body:object|null,
 *       metadataUrl }. options.meta = allerede lastet tabellmetadata (PÅKREVD;
 *       metoden er synkron og henter aldri selv), options.lang = API-språk.
 *       Valgfrie byggervalg (ukjente/ugyldige verdier faller tilbake til
 *       standard, så utelatte options gir NØYAKTIG samme kall som adapterens
 *       getTableData sender):
 *         options.format         — responsformat fra adapterens formatliste
 *                                  (jf. getApiBuilderOptions)
 *         options.maxRowCount    — (FHI) tall → verdien; undefined → standard
 *                                  50000; null → feltet utelates (ubegrenset)
 *         options.detail         — (NB) 'dataonly'|'serieskeysonly'|'nodata';
 *                                  undefined/'full' → parameter utelates
 *         options.includeHistory — (NB) true → &includeHistory=true
 *         options.bom            — (NB) true → &bom=true (UTF-8 BOM for CSV)
 *       Gates i UI-en på capabilities.supportsApiQuery; SSB kaster (bruker det
 *       dedikerte fullpanelet, jf. supportsGetUrlBuilder).)
 *   getApiBuilderOptions()                        → object  (synkron, VALGFRI —
 *       beskriver valgene API-byggeren skal tilby for kilden:
 *       { formats:[{value, label?|labelKey?},...], defaultFormat,
 *         csvFormats:[...], maxRowCount:{default}|null, nbAdvanced?:true }.
 *       labelKey oversettes med t() av visningen. Adaptere uten metoden
 *       (SSB) gir null via fasadens apiBuilderOptionsFor().)
 *   cleanupCache()                                → number
 *   clearCache()                                  → void|Promise<void>
 *   getCacheStats()                               → object|null
 *
 * En adapter som ikke støtter en metode (jf. capabilities) MÅ likevel definere
 * den — kast en Error eller returner en tom/degradert verdi. UI-en (Fase D)
 * gater knappene på capabilities, men fasaden kaller aldri en manglende metode.
 *
 * METADATA-UTVIDELSER (valgfrie — konsumeres generisk av variable-select)
 * -----------------------------------------------------------------------
 * getTableMetadata-resultatet kan bære disse; alle er no-op når de mangler:
 *   extension.validKeys              — { dims:[dimId...], keys:['B.USD.NOK.SP',...] }
 *                                      → krysfiltrering av verdilister
 *                                      (variable-select-status applyCrossFilter).
 *   extension.timePeriodsByFreq      — { freqDim, timeDim, byFreq:{frekvens:[perioder]} }
 *                                      → frekvensbevisst tidsperiodeliste
 *                                      (applyTimeFreqFilter); SDMX-tidskoder er
 *                                      frekvensspesifikke.
 *   dimension[id].extension.singleSelect — true → gjensidig utelukkende verdier;
 *                                      UI-en håndhever radio-adferd (ett valg,
 *                                      ingen «Velg alle»/Ctrl+A/drag-paint).
 *                                      Brukes av NB for FREQ.
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
 *     «Feil» betyr HELT uten data: en adapter med delkilder (FHI) kaster kun
 *     når ALLE delkilder feilet, og rapporterer delvise utfall via
 *     sourceMeta.partial. Stale-if-error: adaptere med katalogcache serverer
 *     en utløpt kopi (sourceMeta.stale=true) i stedet for å kaste når
 *     nettverket feiler men cachen finnes.
 *   • Norges Bank: HTTP 404 = TOMT resultat (tom tabell), ikke feil.
 *   • Bruk `logger.warn`/`logger.error`, aldri console.* direkte.
 *
 * KATALOGSTATUS / RELOAD (API-statusbadgen — js/source-status.js)
 * ---------------------------------------------------------------
 *   Fasaden sporer per-kilde-status for fulle getAllTables-aggregeringer
 *   (IKKE søk/pastDays) og eksponerer:
 *     api.getSourceStatus()            → [{ sourceId, status:'loading'|'ok'|
 *         'partial'|'error', tableCount, fromCache, stale, fetchedAt,
 *         lastAttemptAt, partial, error }] (aktiverte kilder, reg.rekkefølge)
 *     api.onSourceStatusChange(cb) / api.offSourceStatusChange(cb)
 *     api.reloadSource(sourceId, {force=true}) → { tables } for kilden;
 *         kaster ved feil. force omgår kildens katalogcache.
 *   BrowserState.reloadSource() bruker denne og merger resultatet inn i
 *   den aggregerte tabellisten (se browser-state.js applySourceTables).
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
    },

    // ---- Katalogstatus per kilde (grunnlag for API-statusbadgen) ----
    // sourceId → { sourceId, status:'loading'|'ok'|'partial'|'error',
    //              tableCount, fromCache, stale, fetchedAt, lastAttemptAt,
    //              partial (feilede FHI-delkilder), error }
    catalogueStatus: {},
    _statusListeners: [],

    /** Abonner på statusendringer; cb får hele snapshot-arrayen. */
    onStatusChange(cb) {
      if (typeof cb === 'function') this._statusListeners.push(cb);
    },
    offStatusChange(cb) {
      this._statusListeners = this._statusListeners.filter(l => l !== cb);
    },

    /** Merge inn et statuspatch og varsle lytterne (feiltolerant). */
    _setStatus(sourceId, patch) {
      const prev = this.catalogueStatus[sourceId] || { sourceId: sourceId };
      this.catalogueStatus[sourceId] = Object.assign({}, prev, patch);
      const snapshot = this.getStatusSnapshot();
      this._statusListeners.forEach(cb => {
        try { cb(snapshot); } catch (e) {
          logger.error('[SourceRegistry] Statuslytter kastet:', e);
        }
      });
    },

    /** Status for alle aktiverte kilder, i registreringsrekkefølge. */
    getStatusSnapshot() {
      return this.adapters
        .filter(a => this.isEnabled(a))
        .map(a => this.catalogueStatus[a.sourceId])
        .filter(Boolean)
        .map(s => Object.assign({}, s));
    }
  };

  /** Statuspatch for et vellykket katalogresultat ({tables, sourceMeta?}). */
  function statusPatchFromResult(result) {
    const tables = (result && Array.isArray(result.tables)) ? result.tables : [];
    const meta = (result && result.sourceMeta) || {};
    return {
      status: (meta.partial && meta.partial.length) ? 'partial' : 'ok',
      tableCount: tables.length,
      fromCache: !!meta.fromCache,
      stale: !!meta.stale,
      fetchedAt: meta.fetchedAt || Date.now(),
      partial: (meta.partial && meta.partial.length) ? meta.partial.slice() : null,
      error: meta.error || null
    };
  }

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

    // Katalogstatus spores KUN for fulle getAllTables-aggregeringer — søk
    // (query) og nylig-oppdaterte (pastDays) skal ikke flippe statusbadgen.
    const track = method === 'getAllTables' && !foreignSkip;

    const enabled = registry.adapters.filter(a => registry.isEnabled(a));
    if (track) {
      enabled.forEach(a => registry._setStatus(a.sourceId, {
        status: 'loading',
        lastAttemptAt: Date.now()
      }));
    }

    const settled = await Promise.allSettled(enabled.map(a => {
      if (foreignSkip && a.sourceId !== 'ssb') {
        return Promise.resolve({ sourceId: a.sourceId, tables: [] });
      }
      return Promise.resolve(a[method](opts)).then(
        r => ({
          sourceId: a.sourceId,
          tables: (r && Array.isArray(r.tables)) ? r.tables : [],
          sourceMeta: (r && r.sourceMeta) || null
        }),
        err => Promise.reject({ sourceId: a.sourceId, error: err })
      );
    }));

    // sourceMeta konsumeres her (→ katalogstatus) og lekker aldri ut til
    // callere — returverdien forblir nøyaktig { tables }.
    const tables = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        tables.push(...s.value.tables);
        if (track) {
          registry._setStatus(s.value.sourceId, statusPatchFromResult(s.value));
        }
      } else {
        const info = s.reason || {};
        logger.warn('[SourceRegistry] Kilde «' + (info.sourceId || '?') + '» feilet under ' +
                    method + ' (hoppes over):', info.error || s.reason);
        if (track && info.sourceId) {
          registry._setStatus(info.sourceId, {
            status: 'error',
            tableCount: 0,
            error: (info.error && info.error.message) || String(info.error || s.reason)
          });
        }
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
    // Synkron API-bygger-forhåndsvisning (NB/FHI) — se adapterkontrakten over.
    // UI-en gater på capabilities.supportsApiQuery; SSB-adapteren kaster.
    buildApiQuery(tableId, ...rest) {
      return requireAdapterForId(tableId, 'buildApiQuery').buildApiQuery(tableId, ...rest);
    },

    // ---- Cache → delt SSB-CacheManager (uendret oppførsel) ----
    cleanupCache(...a) { return requireSSB('cleanupCache').cleanupCache(...a); },
    clearCache(...a) { return requireSSB('clearCache').clearCache(...a); },
    getCacheStats(...a) { return requireSSB('getCacheStats').getCacheStats(...a); },

    // ---- Katalogstatus + per-kilde reload (API-statusbadgen) ----
    /** Snapshot av katalogstatus for alle aktiverte kilder. */
    getSourceStatus() { return registry.getStatusSnapshot(); },
    /** Abonner/avslutt abonnement på statusendringer (cb får snapshot-arrayen). */
    onSourceStatusChange(cb) { registry.onStatusChange(cb); },
    offSourceStatusChange(cb) { registry.offStatusChange(cb); },

    /**
     * Hent én kildes katalog på nytt (retry etter feil, eller manuell
     * refresh). force=true (default) omgår kildens katalogcache.
     * Returnerer { tables } for kilden; kaster ved feil (status settes til
     * 'error' først, så statuspanelet viser hva som gikk galt).
     */
    async reloadSource(sourceId, options) {
      const opts = options || {};
      const force = opts.force !== false;
      const adapter = registry.adapters.find(a => a.sourceId === sourceId);
      if (!adapter || !registry.isEnabled(adapter)) {
        throw new Error('[SourceRegistry] Ukjent eller deaktivert kilde: ' + sourceId);
      }
      registry._setStatus(sourceId, { status: 'loading', lastAttemptAt: Date.now() });
      try {
        // Samme options som BrowserState._doInit bruker for aggregeringen.
        const result = await adapter.getAllTables({
          lang: (typeof getCurrentApiLang === 'function' ? getCurrentApiLang() : 'no'),
          includeDiscontinued: true,
          useCache: !force
        });
        registry._setStatus(sourceId, statusPatchFromResult(result));
        return { tables: (result && Array.isArray(result.tables)) ? result.tables : [] };
      } catch (e) {
        registry._setStatus(sourceId, {
          status: 'error',
          tableCount: 0,
          error: (e && e.message) || String(e)
        });
        throw e;
      }
    },

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
    },
    /**
     * API-byggervalgene (formater m.m.) til kilden som eier tabell-id-en,
     * eller null når kilden ikke tilbyr noen (SSB — fullpanelet brukes der).
     */
    apiBuilderOptionsFor(tableId) {
      const adapter = registry.adapterForTableId(tableId);
      return (adapter && typeof adapter.getApiBuilderOptions === 'function')
        ? adapter.getApiBuilderOptions()
        : null;
    }
  };

  // Erstatt den rene SSBApi-instansen fra api.js med multi-kilde-fasaden.
  window.api = api;

  logger.log('[SourceRegistry] Fasade aktiv med kilder: ' +
             registry.adapters.map(a => a.sourceId).join(', '));
})();
