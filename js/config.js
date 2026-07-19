/**
 * Configuration file for Statistikkportalen (multi-source instance:
 * SSB + Norges Bank + FHI)
 *
 * This file contains all configurable settings for the application.
 * Modify these values to change the API endpoint or other settings.
 *
 * NB: scripts/generate-seo-pages.mjs leser også denne filen (via node:vm)
 * for API-endepunkt, appnavn og kildeinfo — inkludert `sources` (med
 * per-kilde `branding` for SEO-attribusjon) og `sourceNodes` — hold
 * strukturen kompatibel.
 */

const AppConfig = {
  /**
   * PxWebApi v2 base URL for the data source.
   * Default: https://data.ssb.no/api/pxwebapi/v2
   * For alternative environments, change this to the appropriate endpoint.
   */
  apiBaseUrl: 'https://data.ssb.no/api/pxwebapi/v2',

  /**
   * Instance-specific DEFAULT source information (the PxWebApi instance at
   * apiBaseUrl). Used in the UI where the data source is named explicitly,
   * as the fallback branding for sources without their own
   * `sources.<key>.branding`, and as the sole footer entry on single-source
   * instances (see listSourceBrandings in js/utils.js).
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
      nb: 'Et uoffisielt verktøy som gir deg bedre tilgang til åpne data fra SSB, Norges Bank og FHI.',
      en: 'An unofficial tool giving you better access to open data from Statistics Norway, Norges Bank and FHI.'
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
    codelistTTL: 7 * 24 * 60 * 60 * 1000,

    // Hvor lenge UTLØPTE katalogoppføringer (tables_*) beholdes som
    // stale-if-error-fallback: er en kilde nede, serveres den utløpte kopien
    // (merket «stale» i statuspanelet) i stedet for en tom katalog. Utenfor
    // vinduet fjernes de av cleanup() som vanlig. (7 dager)
    staleRetentionMs: 7 * 24 * 60 * 60 * 1000
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
    // Timeout (ms) for fremmedkilders nettverkskall (NB/FHI) — en hengende
    // kilde skal feile innen dette og ikke blokkere app-initialiseringen
    // (BrowserState venter på hele katalogaggregeringen).
    fetchTimeoutMs: 15000,

    // Statistisk sentralbyrå (PxWebApi v2) — apiBaseUrl over.
    // displayName brukes i API-statuspanelet (source-status.js).
    ssb: {
      adapter: 'ssb',
      enabled: true,
      displayName: { nb: 'Statistisk sentralbyrå (SSB)', en: 'Statistics Norway (SSB)' }
    },

    // Norges Bank (SDMX REST). Kjerneutvalg av dataflows; flere aktiveres ved
    // å legge til rader her (se «Senere» i planen). `flow`/`version` er SDMX-
    // dataflow-id og -versjon; `tableId` er den namnerommede portal-id-en;
    // `path` er de to emnetre-segmentene (subjektkode + node i sourceNodes).
    // Alternativt kan en rad angi `paths: [[subjekt, node], ...]` for å
    // plassere tabellen under FLERE emnestier (som SSBs multi-mappe-tabeller).
    // Hver node-id må finnes i sourceNodes under, og hver subjektkode i
    // subjects.js (subjectNames + en subjectGroups-gruppe) — ellers rendres
    // ikke plasseringen.
    nb: {
      adapter: 'norges-bank',
      enabled: true,
      baseUrl: 'https://data.norges-bank.no/api',
      displayName: { nb: 'Norges Bank', en: 'Norges Bank' },
      // SEO-/attribusjonsinfo (samme form som det globale `source`-objektet
      // over) — brukes av scripts/generate-seo-pages.mjs og js/seo-head.js for
      // «Kilde:»-linjer og JSON-LD creator/license på nb-*-tabeller. Norges
      // Banks åpne data er gratis å bruke med kildehenvisning, men er ikke
      // CC-merket — licenseUrl utelates derfor bevisst (ingen lisenslenke).
      branding: {
        name: 'Norges Bank',
        nameFull: 'Norges Bank',
        url: 'https://www.norges-bank.no/'
      },
      // `discontinued: true` merker en avsluttet serie i katalogen (GOVT_IRS).
      // `probeKey` begrenser adapterens katalogperiode-/tidsprober til et smalt
      // SDMX-nøkkelutsnitt for flows der et åpent probekall er for tungt
      // (MONEY_MARKET: 3,5/15,6 MB åpent → 60/465 kB med nøkkel). Streng =
      // samme nøkkel for begge prober; {period, time} = separate nøkler.
      // `collapseDims: {anchor, dims}` kollapser kjennetegns-dimensjoner som er
      // funksjonelt avhengige av ankeret (verifisert mot serieskeysonly:
      // GOVT_PRIMARY_MARKET har ISIN → MATURITY/COUPON/INSTR) inn i ankerets
      // verdiliste — de vises ikke som egne kort, og ankeretikettene berikes
      // («NGB 03/2033 – 3,625 % – forfall 13.03.2033»). Se applyCollapseDims i
      // norges-bank-adapter.js.
      dataflows: [
        { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
          paths: [['bf', 'nb-valutakurser'], ['ut', 'nb-valutakurser']],
          label: { nb: 'Valutakurser', en: 'Exchange rates' } },
        { flow: 'IR', version: '1.1', tableId: 'nb-IR',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Styringsrenten', en: 'Key policy rate' } },
        { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Kortsiktige renter (NOWA)', en: 'Short-term interest rates (NOWA)' } },
        { flow: 'GOVT_GENERIC_RATES', version: '1.0', tableId: 'nb-GOVT_GENERIC_RATES',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Statsobligasjonsrenter', en: 'Government bond yields' } },
        { flow: 'GOVT_ZEROCOUPON', version: '1.0', tableId: 'nb-GOVT_ZEROCOUPON',
          paths: [['bf', 'nb-renter'], ['bf', 'nb-statsgjeld']],
          label: { nb: 'Nullkupongrenter statspapirer', en: 'Zero coupon yields, government securities' } },
        { flow: 'SEC', version: '1.0', tableId: 'nb-SEC',
          path: ['bf', 'nb-statsgjeld'],
          label: { nb: 'Statspapirer – kurser og renter', en: 'Government securities – prices and yields' } },
        { flow: 'GOVT_KEYFIGURES', version: '1.0', tableId: 'nb-GOVT_KEYFIGURES',
          path: ['bf', 'nb-statsgjeld'],
          label: { nb: 'Nøkkeltall for statsgjelden', en: 'Key government debt indicators' } },
        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET',
          path: ['bf', 'nb-statsgjeld'],
          collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] },
          label: { nb: 'Statspapirer – førstehåndsmarkedet', en: 'Government securities – primary market' } },
        { flow: 'GOVT_SECONDARY_MARKET', version: '1.0', tableId: 'nb-GOVT_SECONDARY_MARKET',
          path: ['bf', 'nb-statsgjeld'],
          label: { nb: 'Statspapirer – annenhåndsmarkedet', en: 'Government securities – secondary market' } },
        { flow: 'GOVT_IRS', version: '1.0', tableId: 'nb-GOVT_IRS', discontinued: true,
          path: ['bf', 'nb-statsgjeld'],
          label: { nb: 'Rentebytteavtaler (historisk, t.o.m. 2014)', en: 'Interest rate swaps (historical, until 2014)' } },
        { flow: 'LIQUIDITY_STATISTICS', version: '1.0', tableId: 'nb-LIQUIDITY_STATISTICS',
          path: ['bf', 'nb-likviditet'],
          label: { nb: 'Likviditetsstatistikk', en: 'Liquidity statistics' } },
        { flow: 'LIQUIDITY_FORECAST', version: '1.0', tableId: 'nb-LIQUIDITY_FORECAST',
          path: ['bf', 'nb-likviditet'],
          probeKey: { period: 'D.STAT_S..', time: 'D.FCAST_CBC..' },
          label: { nb: 'Strukturell og total likviditet', en: 'Structural and total liquidity' } },
        { flow: 'MONEY_MARKET', version: '1.0', tableId: 'nb-MONEY_MARKET',
          path: ['bf', 'nb-likviditet'],
          probeKey: 'B.U..........',
          label: { nb: 'Pengemarkedsdata (RPD)', en: 'Money market data' } },
        { flow: 'FAUCTION', version: '1.0', tableId: 'nb-FAUCTION',
          path: ['bf', 'nb-likviditet'],
          probeKey: 'FDFLIR.ANN.',
          label: { nb: 'F-auksjoner', en: 'F-auctions' } },
        { flow: 'CBC_TRANSACTIONS', version: '1.0', tableId: 'nb-CBC_TRANSACTIONS',
          path: ['bf', 'nb-likviditet'],
          collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'INSTR'] },
          label: { nb: 'Sentralbanksertifikater – transaksjoner', en: 'Central bank certificates – transactions' } },
        { flow: 'SETTLEMENT_STATISTICS', version: '1.0', tableId: 'nb-SETTLEMENT_STATISTICS',
          path: ['bf', 'nb-likviditet'],
          label: { nb: 'Oppgjørsstatistikk', en: 'Settlement statistics' } },
        { flow: 'FINANCIAL_INDICATORS', version: '1.0', tableId: 'nb-FINANCIAL_INDICATORS',
          path: ['bf', 'nb-indikatorer'],
          label: { nb: 'Finansielle indikatorer (FCI)', en: 'Financial indicators (FCI)' } },
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET',
          path: ['bf', 'nb-indikatorer'],
          label: { nb: 'Regionalt nettverk', en: 'Regional network' } }
      ]
    },

    // Folkehelseinstituttet (åpent statistikk-API, JSON-Stat2 native).
    // Adapteren er generisk over `sourceIds` — flere kilder aktiveres ved å
    // legge til en id her (se «Senere» i planen).
    // Valgfri `paths: { <sourceId>: [[subjekt, node], ...] }` overstyrer
    // standardplasseringen (['he', 'fhi-<sourceId>']) med én eller flere
    // emnetre-plasseringer — samme krav til sourceNodes/subjects.js som for
    // Norges Bank-dataflows over.
    fhi: {
      adapter: 'fhi',
      enabled: true,
      baseUrl: 'https://statistikk-data.fhi.no/api/open/v1',
      displayName: { nb: 'Folkehelseinstituttet (FHI)', en: 'Norwegian Institute of Public Health (FHI)' },
      // SEO-/attribusjonsinfo for fhi-*-tabeller (jf. nb.branding over).
      // FHIs åpne statistikkdata er CC BY 4.0.
      branding: {
        name: 'FHI',
        nameFull: 'Folkehelseinstituttet',
        url: 'https://www.fhi.no/',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.no',
        licenseName: 'CC BY 4.0'
      },
      sourceIds: [
        'nokkel', 'mfr', 'daar',
        'msis', 'sysvak', 'npr', 'kpr', 'lmr',
        'gs', 'hkr', 'abr', 'ngs', 'skast'
      ]
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
    'nb-statsgjeld':   { sortCode: '902', label: { nb: 'Statsgjeld og statspapirer – Norges Bank', en: 'Government debt and securities – Norges Bank' } },
    'nb-likviditet':   { sortCode: '903', label: { nb: 'Likviditet og pengemarked – Norges Bank', en: 'Liquidity and money market – Norges Bank' } },
    'nb-indikatorer':  { sortCode: '904', label: { nb: 'Finansielle indikatorer og Regionalt nettverk – Norges Bank', en: 'Financial indicators and Regional network – Norges Bank' } },
    // FHI-registrene: 4-sifrede '99xx'-koder (leksikografisk etter alle
    // SSB-undertemaer og NB-nodene) med luft mellom for senere innskudd.
    'fhi-nokkel':      { sortCode: '9900', label: { nb: 'Folkehelse – nøkkeltall (FHI)' } },
    'fhi-mfr':         { sortCode: '9905', label: { nb: 'Medisinsk fødselsregister (FHI)' } },
    'fhi-daar':        { sortCode: '9910', label: { nb: 'Dødsårsaksregisteret (FHI)' } },
    'fhi-msis':        { sortCode: '9915', label: { nb: 'Smittsomme sykdommer – MSIS (FHI)' } },
    'fhi-sysvak':      { sortCode: '9920', label: { nb: 'Vaksinasjonsregisteret SYSVAK (FHI)' } },
    'fhi-npr':         { sortCode: '9925', label: { nb: 'Norsk pasientregister (FHI)' } },
    'fhi-kpr':         { sortCode: '9930', label: { nb: 'Kommunalt pasient- og brukerregister (FHI)' } },
    'fhi-lmr':         { sortCode: '9935', label: { nb: 'Legemiddelregisteret (FHI)' } },
    'fhi-gs':          { sortCode: '9940', label: { nb: 'Grossistbasert legemiddelstatistikk (FHI)' } },
    'fhi-hkr':         { sortCode: '9945', label: { nb: 'Hjerte- og karregisteret (FHI)' } },
    'fhi-abr':         { sortCode: '9950', label: { nb: 'Abortregisteret (FHI)' } },
    'fhi-ngs':         { sortCode: '9955', label: { nb: 'Mikrobiologisk genomovervåkning (FHI)' } },
    'fhi-skast':       { sortCode: '9960', label: { nb: 'Skadedyrstatistikken (FHI)' } }
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
