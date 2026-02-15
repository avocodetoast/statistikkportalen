/**
 * Configuration file for SSB Statistikkbank Alternative
 *
 * This file contains all configurable settings for the application.
 * Modify these values to change the API endpoint or other settings.
 */

const AppConfig = {
  /**
   * SSB PxWebApi v2 base URL
   * Default: https://data.ssb.no/api/pxwebapi/v2
   * For testing or alternative environments, change this to the appropriate endpoint.
   */
  apiBaseUrl: 'https://data.ssb.no/api/pxwebapi/v2',

  /**
   * Default language for API requests
   * Options: 'no' (Norwegian), 'en' (English)
   */
  defaultLanguage: 'no',

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
    // Maximum cells per request (SSB API limit)
    maxCells: 800000,

    // Warning threshold (cells)
    cellWarningThreshold: 600000,

    // Maximum tables to fetch in one request
    maxTablePageSize: 10000,

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
    errorAutoHideMs: 10000
  },

  /**
   * SSB metadata update schedule (Norwegian time / Europe/Oslo)
   * Metadata updates at 05:00 and 11:30 daily.
   * Cache created before the most recent update is considered stale.
   */
  ssbUpdateTimes: [
    { hour: 5, minute: 0 },
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
