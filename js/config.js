/**
 * Configuration file for SSB Statistikkbank Alternative
 *
 * This file contains all configurable settings for the application.
 * Modify these values to change the API endpoint or other settings.
 *
 * NB: scripts/generate-seo-pages.mjs leser også denne filen (via node:vm)
 * for API-endepunkt, appnavn og kildeinfo — hold strukturen kompatibel.
 */

const AppConfig = {
  /**
   * PxWebApi v2 base URL for the data source.
   * Default: https://data.ssb.no/api/pxwebapi/v2
   * For alternative environments, change this to the appropriate endpoint.
   */
  apiBaseUrl: 'https://data.ssb.no/api/pxwebapi/v2',

  /**
   * Instance-specific source information.
   * These values are used in the UI where the data source is named explicitly.
   */
  source: {
    name: 'SSB',
    nameFull: 'Statistisk sentralbyrå',
    url: 'https://www.ssb.no/',
    licenseUrl: 'https://www.ssb.no/diverse/lisens',
    licenseName: 'CC BY 4.0'
  },

  /**
   * Application branding.
   */
  app: {
    name: 'Statistikkportalen',
    tagline: {
      nb: 'Et uoffisielt verktøy som gir deg bedre tilgang til SSBs åpne data.',
      en: 'An unofficial tool giving you better access to Statistics Norway\'s open data.'
    }
  },

  /**
   * Instance-specific web analytics (Umami).
   * Injected into <head> at startup by the bootstrap snippet in index.html.
   * Set to null (or leave scriptUrl/websiteId empty) to disable analytics
   * entirely — useful for local development or instances without tracking.
   *
   * For a separate instance (e.g. the Swedish SCB portal), point scriptUrl
   * and websiteId at that instance's own Umami site.
   */
  analytics: {
    scriptUrl: 'https://stats.statistikkportalen.no/script.js',
    websiteId: 'e8e31e32-aa40-4865-8acb-3311b8a374e9',
    domains: 'statistikkportalen.no',
    doNotTrack: true
  },

  /**
   * Available UI languages.
   * code:    UI language code (used for translations.js lookup)
   * apiLang: Language code sent to the API (lang= parameter)
   * label:   Display name shown in the language selector
   *
   * The first entry is the default language.
   */
  languages: [
    { code: 'nb', apiLang: 'no', label: 'Norsk' },
    { code: 'en', apiLang: 'en', label: 'English' }
  ],

  /**
   * Default UI language code (must match a code in languages above).
   */
  defaultLanguage: 'nb',

  /**
   * Cache time-to-live (TTL) in milliseconds
   */
  cache: {
    // Table list cache duration (24 hours)
    tableListTTL: 24 * 60 * 60 * 1000,

    // Table metadata cache duration (7 days)
    metadataTTL: 7 * 24 * 60 * 60 * 1000,

    // Codelist cache duration (7 days)
    codelistTTL: 7 * 24 * 60 * 60 * 1000
  },

  /**
   * API request limits
   */
  limits: {
    // Maximum cells per request. Overridden at runtime by config.maxDataCells from the /config endpoint.
    maxCells: 800000,

    // Warning threshold (cells). Overridden at runtime to 75% of config.maxDataCells from the /config endpoint.
    cellWarningThreshold: 600000,

    // Supported export formats. Null until populated at runtime from config.dataFormats via the /config endpoint.
    dataFormats: null,

    // Requested page size per /tables batch request. Large to minimise API
    // round-trips; pagination handles the case where the API returns fewer
    // rows than requested. Not an API-imposed limit.
    tablePageBatchSize: 10000,

    // Maximum GET URL length before warning (SSB recommends < 2000 chars)
    maxGetUrlLength: 2000
  },

  /**
   * Export default settings
   */
  export: {
    // Default output format: csv, xlsx, px
    defaultFormat: 'xlsx',

    // Default display format: UseCodes, UseTexts, UseCodesAndTexts
    defaultDisplayFormat: 'UseTexts',

    // Include table title by default
    includeTitle: true,

    // Default CSV separator: SeparatorTab, SeparatorSpace, SeparatorSemicolon
    defaultCsvSeparator: 'SeparatorSemicolon',

    // Default layout: 'as-shown' (current stub/heading) or 'pivot-friendly' (all in stub)
    defaultLayout: 'as-shown'
  },

  /**
   * UI settings
   */
  ui: {
    // Debounce delay for search inputs (milliseconds)
    searchDebounceMs: 500,

    // Debounce delay for value filter inputs (milliseconds)
    filterDebounceMs: 150,

    // Maximum values to display in value list before truncation
    maxDisplayValues: 500,

    // Error message auto-hide delay (milliseconds)
    errorAutoHideMs: 10000,

    // Show discontinued tables by default in search and topic views
    showDiscontinuedByDefault: false,

    // Skjul tidsperioden som ofte står på slutten av SSB-tabelltitler i
    // listevisningen (søk, emner, forsiden), f.eks. "Konsumprisindeks 2010-2025"
    // → "Konsumprisindeks". Perioden vises uansett i egen "Tidsperiode"-kolonne.
    // Suffikset fjernes kun når det faktisk matcher start-/sluttperioden som
    // vises i kolonnen (også flerårige intervaller som "(1990-2000)-(2024-2025)").
    hidePeriodInTableTitles: true,

    // Antall stinivåer under et emne som vises som navigasjonskort før
    // tabellisten vises i emnevisningen. SSB: 2 (undertema + kategori).
    // Andre PxWebApi-instanser med grunnere hierarki kan bruke lavere verdi;
    // 0 viser tabellisten allerede på emnenivå.
    topicCardDepth: 2
  },

  /**
   * Source update schedule (Norwegian time / Europe/Oslo for SSB).
   * Metadata updates at 05:00 and 11:30 daily.
   * Data (statistics) updates at 08:00 daily.
   * Cache created before the most recent update is considered stale.
   */
  sourceUpdateTimes: [
    { hour: 5, minute: 0 },
    { hour: 8, minute: 0 },
    { hour: 11, minute: 30 }
  ],

  /**
   * Datakilder — Statistikkportalen 2.0 multi-kilde-hub.
   *
   * Hver kilde peker på en adapter (js/sources/{adapter}-adapter.js) som
   * eksponeres bak den delte `api`-fasaden (js/sources/source-registry.js).
   * SSB er standardkilden (fallback for alle tabell-id-er uten kildeprefiks);
   * Norges Bank og FHI eier tabell-id-er med prefiks `nb-` / `fhi-`.
   *
   * `enabled: false` på en kilde gjør at adapteren ikke aggregeres i katalogen
   * og at kildens tabeller ikke rutes — resten av portalen påvirkes ikke.
   */
  sources: {
    // Statistisk sentralbyrå (PxWebApi v2) — apiBaseUrl over.
    ssb: { adapter: 'ssb', enabled: true },

    // Norges Bank (SDMX REST). Kjerneutvalg av dataflows; flere aktiveres ved
    // å legge til rader her (se «Senere» i planen). `flow`/`version` er SDMX-
    // dataflow-id og -versjon; `tableId` er den namnerommede portal-id-en;
    // `path` er de to emnetre-segmentene (subjektkode + node i sourceNodes).
    nb: {
      adapter: 'norges-bank',
      enabled: true,
      baseUrl: 'https://data.norges-bank.no/api',
      dataflows: [
        { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
          path: ['bf', 'nb-valutakurser'],
          label: { nb: 'Valutakurser', en: 'Exchange rates' } },
        { flow: 'IR', version: '1.1', tableId: 'nb-IR',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Styringsrenten', en: 'Key policy rate' } },
        { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Kortsiktige renter (NOWA)', en: 'Short-term interest rates (NOWA)' } },
        { flow: 'GOVT_GENERIC_RATES', version: '1.0', tableId: 'nb-GOVT_GENERIC_RATES',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Statsobligasjonsrenter', en: 'Government bond yields' } }
      ]
    },

    // Folkehelseinstituttet (åpent statistikk-API, JSON-Stat2 native).
    // Adapteren er generisk over `sourceIds` — flere kilder aktiveres ved å
    // legge til en id her (se «Senere» i planen).
    fhi: {
      adapter: 'fhi',
      enabled: true,
      baseUrl: 'https://statistikk-data.fhi.no/api/open/v1',
      sourceIds: ['nokkel', 'mfr', 'daar']
    }
  },

  /**
   * Emnetre-noder for fremmede kilder (nivå 2 under en SSB-subjektkode).
   *
   * Fremmede tabeller får syntetiske `paths[]` på formen
   * `[{ id: <subjektkode>, ... }, { id: <node-id>, label, sortCode }]`, slik at
   * de glir inn i det eksisterende emnehierarkiet (menu-hierarchy.js) uten
   * viewendringer. sortCode `9xx` plasserer dem sist blant SSB-undertemaene.
   *
   * NB: FHI-labelene er kun norske (`nb`). Adaptere/UI som slår opp en label
   * for et annet språk MÅ falle tilbake til `nb` når `en` mangler.
   */
  sourceNodes: {
    'nb-renter':       { sortCode: '900', label: { nb: 'Renter og avkastning – Norges Bank', en: 'Interest rates – Norges Bank' } },
    'nb-valutakurser': { sortCode: '901', label: { nb: 'Valutakurser – Norges Bank',        en: 'Exchange rates – Norges Bank' } },
    'fhi-nokkel':      { sortCode: '990', label: { nb: 'Folkehelse – nøkkeltall (FHI)' } },
    'fhi-mfr':         { sortCode: '991', label: { nb: 'Medisinsk fødselsregister (FHI)' } },
    'fhi-daar':        { sortCode: '992', label: { nb: 'Dødsårsaksregisteret (FHI)' } }
  },

  /**
   * Debug logging
   * Set to true to enable console logging throughout the application.
   */
  debug: false
};

// Expose globally
window.AppConfig = AppConfig;

/**
 * Logger — wraps console methods and respects AppConfig.debug.
 * Use logger.log/warn/error/etc. instead of console.* throughout the app.
 */
const logger = {
  log:            (...args) => { if (AppConfig.debug) console.log(...args); },
  warn:           (...args) => { if (AppConfig.debug) console.warn(...args); },
  error:          (...args) => { if (AppConfig.debug) console.error(...args); },
  info:           (...args) => { if (AppConfig.debug) console.info(...args); },
  debug:          (...args) => { if (AppConfig.debug) console.debug(...args); },
  group:          (...args) => { if (AppConfig.debug) console.group(...args); },
  groupEnd:       ()        => { if (AppConfig.debug) console.groupEnd(); },
  groupCollapsed: (...args) => { if (AppConfig.debug) console.groupCollapsed(...args); },
  time:           (label)   => { if (AppConfig.debug) console.time(label); },
  timeEnd:        (label)   => { if (AppConfig.debug) console.timeEnd(label); }
};

window.logger = logger;
