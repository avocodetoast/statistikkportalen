/**
 * Configuration file for using the application with SCBs PxWebApi
 * Replace config.js with this file to connect to SCBs API
 * To update the front page menu, also replace subjects.js with the subjects-sv.js file
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
  apiBaseUrl: 'https://statistikdatabasen.scb.se/api/v2',

  /**
   * Instance-specific source information.
   * These values are used in the UI where the data source is named explicitly.
   */
  source: {
    name: 'SCB',
    nameFull: 'Statistiska centralbyrån',
    url: 'https://www.scb.se/',
    licenseUrl: 'https://www.scb.se/vara-tjanster/oppna-data/',
    licenseName: 'CC0'
  },

  /**
   * Application branding.
   */
  app: {
    name: 'Statistikportalen',
    tagline: {
      sv: 'Ett inofficiellt verktyg som ger dig bättre tillgång till SCB:s öppna data.',
      en: 'An unofficial tool giving you better access to SCB\'s open data.'
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
    websiteId: '4625f0dc-ca98-4b4b-b189-b09e00907a41',
    domains: 'statistikportalen.se',
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
     { code: 'sv', apiLang: 'sv', label: 'Svenska' },
    { code: 'en', apiLang: 'en', label: 'English' }
  ],

  /**
   * Default UI language code (must match a code in languages above).
   */
  defaultLanguage: 'sv',

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

    // Ctrl+A on an unfiltered value list larger than this switches to the star
    // (wildcard '*') selection instead of marking every value — marking tens of
    // thousands of items individually would materialize a huge code list and
    // freeze the browser. The "Välj alla" button always uses star regardless.
    selectAllStarThreshold: 500,

    // Error message auto-hide delay (milliseconds)
    errorAutoHideMs: 10000,

    // Show discontinued tables by default in search and topic views
    showDiscontinuedByDefault: false,

    // «Nylig oppdaterte tabeller» på forsiden: skjul tabeller som oppdateres
    // tilnærmet hver virkedag (se js/config.js for full forklaring). Gjelder
    // KUN forsidens nylig-oppdatert-seksjon — søk/emnefiltre påvirkes ikke.
    recentUpdates: {
      showHighFrequency: false,
      highFrequencyTimeUnits: ['Business', 'Daily']
    },

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
    // SCB har et grunnere hierarki enn SSB - bruker 1 i stedet for 2 her
    topicCardDepth: 1
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
