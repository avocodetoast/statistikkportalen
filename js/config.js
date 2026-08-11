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
 *
 * KILDEDATA ER SKILT UT: Norges Banks dataflow-katalog + søkeord ligger i
 * js/sources/nb-catalog.js (window.NbCatalog), og emnetre-nodene + FHIs
 * registerliste/plasseringer i js/sources/source-topology.js
 * (window.SourceTopology). Begge lastes FØR denne filen (se index.html og
 * loadAppConfig i scripts/generate-seo-pages.mjs); AppConfig eksponerer dem
 * videre på samme sti som før, så øvrig kode leser dem uendret.
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
    // Kildeuavhengig med hensikt: taglinen skal ikke måtte utvides hver gang en
    // kilde aktiveres. Kildelisten hører hjemme i «Kilder og vilkår»-dialogen
    // (js/app-terms.js), som bygger den fra sources-konfigurasjonen under.
    tagline: {
      nb: 'Et uoffisielt verktøy som gir deg bedre tilgang til norske åpne data',
      en: 'An unofficial tool giving you better access to Norwegian open data'
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
   * Forhåndsbygget katalogindeks (data/index/, bygget av
   * scripts/build-catalog-index.mjs).
   *
   * Slås den PÅ, henter BrowserState._doInit hele katalogen fra de
   * innsjekkede shard-filene i stedet for å spørre SSB/NB/FHI ved oppstart —
   * ett lite kall per kilde mot vår egen server i stedet for full
   * katalogaggregering. Kilder som mangler et brukbart shard hentes direkte
   * som før (api.getAllTables med options.onlySources), så en delvis indeks
   * degraderer per kilde og aldri for hele appen.
   */
  catalogIndex: {
    // AV = appen oppfører seg nøyaktig som før (indeksen lastes ikke i det
    // hele tatt). PÅ = indeksen forsøkes først, med fallback til direkte
    // kildehenting når manifestet eller alle shards er ubrukelige.
    //
    // PÅ betyr null eksterne API-kall ved sidelasting: hele katalogen kommer
    // fra data/index/, bygget av scripts/build-catalog-index.mjs (cron).
    // Over file:// er indeksen utilgjengelig, og appen faller tilbake til
    // direkte kildehenting — tregere, men fungerer.
    enabled: true,

    // Sti til manifestet, relativt til index.html. Shard-URL-ene løses
    // relativt til denne filens katalog — flytter du data/index/, er dette
    // det eneste stedet stien står.
    manifestPath: 'data/index/catalog-manifest.json',

    // Eldre enn dette regnes et shard som «stale»: katalogen serveres
    // fortsatt, men API-statusbadgen (js/source-status.js) blir gul og
    // panelet skriver «Data kan være utdatert». Hev verdien hvis indeksen
    // bygges sjeldnere enn hvert annet døgn. (48 timer)
    staleAfterMs: 48 * 60 * 60 * 1000,

    // Tidsavbrudd per manifest-/shard-hent. Løper det ut, degraderer den
    // kilden (eller hele indeksen, hvis det var manifestet) til direkte
    // kildehenting — appen henger aldri på indeksen.
    timeoutMs: 15000,

    // Bakgrunnssjekk mot serverens indeks (js/index-refresh.js): utløses når
    // fanen blir synlig igjen og ved navigering, og bytter dataene stille —
    // visningen re-rendres først ved neste navigering. AV = kun den manuelle
    // knappen «Se etter ny indeks» i statuspanelet, som før.
    autoCheck: true,

    // Minsteintervall som ALLE utløsere deler, så antall nettverkskall er
    // uavhengig av hvor mye brukeren klikker. 30 min er valgt mot driften:
    // manifestet serveres med max-age=300, og cron bygger maks 3x/døgn —
    // tettere sjekk gir ingenting. (30 minutter)
    autoCheckMs: 30 * 60 * 1000
  },

  /**
   * API request limits
   */
  limits: {
    // RESERVE for kilder uten oppføring i bySource under (og for instanser
    // uten sources-blokk, jf. config-sv.js). Muteres ikke lenger av /config —
    // det svaret er SSB-spesifikt og skrives i bySource.ssb (js/api.js).
    maxCells: 800000,

    // Reserve-advarselsterskel (75 % av maxCells). Se kommentaren over.
    cellWarningThreshold: 600000,

    // Supported export formats. Null until populated at runtime from config.dataFormats via the /config endpoint.
    dataFormats: null,

    // Requested page size per /tables batch request. Large to minimise API
    // round-trips; pagination handles the case where the API returns fewer
    // rows than requested. Not an API-imposed limit.
    tablePageBatchSize: 10000,

    // Maximum GET URL length before warning (SSB recommends < 2000 chars)
    maxGetUrlLength: 2000,

    // Celletak PER KILDE. Kun SSB har en ekte API-regel — Norges Bank og FHI
    // har INGEN cellegrense (målt 2026-08-02, se API-FINDINGS.md). Store uttak
    // der er trege, ikke ulovlige, og skal derfor advares mot, ikke sperres.
    //
    //   maxCells       HARD grense. null = Hent-knappen sperres aldri.
    //   warnCells      MYK: stor spørring, kan ta tid.
    //   slowWarnCells  MYK: vil trolig gå i tidsavbrudd.
    //   denseWarnCells MYK, mot det TETTE kryssproduktet (klientminne).
    //
    // Skriv null eksplisitt for ubrukte felter: cellLimitsFor() legger
    // oppføringen over reserven med Object.assign, som også kopierer undefined.
    bySource: {
      // Hard grense: SSB svarer 403 ved brudd. maxCells/warnCells overskrives i
      // runtime av /config (maxDataCells) — se _applyConfig i js/api.js.
      ssb: { maxCells: 800000, warnCells: 600000, slowWarnCells: null, denseWarnCells: null },

      // Norges Bank: ingen grense. Full EXR = 1 544 388 celler på 1,5 s / 7,4 MB;
      // MONEY_MARKET 3,1 mill. observasjoner / 61 MB på 11,2 s, HTTP 200.
      // warnCells måles mot ANSLÅTTE observasjoner (serier × perioder), ikke det
      // tette kryssproduktet — SDMX er sparsomt, og produktet ville gitt en
      // meningsløs advarsel på hver eneste NB-tabell.
      // denseWarnCells speiler MAX_DENSE_CELLS i sdmx-to-jsonstat.js: over det
      // klarer ikke klienten å bygge det tette JSON-Stat2-arrayet i det hele tatt.
      // HOLD DE TO I SYNK.
      nb: { maxCells: null, warnCells: 2000000, slowWarnCells: null, denseWarnCells: 20000000 },

      // FHI: ingen grense og ingen feilkode — bare tid. Målt: 0,6 mill. celler
      // → 2,5 s, 2,0 mill. → 39 s, 6,0 mill. → 116 s (~52 000 celler/s).
      // Med dataFetchTimeoutMs = 90 s rekker vi ~4,6 mill. celler; slowWarnCells
      // ligger like under. warnCells er satt over SSBs 800 000, slik at de 37
      // FHI-tabellene med kryssprodukt over det ikke advarer av seg selv.
      fhi: { maxCells: null, warnCells: 1000000, slowWarnCells: 4000000, denseWarnCells: null }
    }
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
    // freeze the browser. The "Velg alle" button always uses star regardless.
    selectAllStarThreshold: 500,

    // Error message auto-hide delay (milliseconds)
    errorAutoHideMs: 10000,

    // Show discontinued tables by default in search and topic views
    showDiscontinuedByDefault: false,

    // «Nylig oppdaterte tabeller» på forsiden: tabeller som oppdateres
    // tilnærmet hver virkedag (Norges Banks kurs-/renteserier, FREQ=B) fyller
    // listen hver dag og har lav signalverdi. Sett showHighFrequency: true for
    // å ta dem med igjen. highFrequencyTimeUnits er timeUnit-verdiene som
    // regnes som «daglige» (SSB bruker i praksis ikke 'Daily' i dag, men
    // verdien tas med for framtidig sikkerhet). Gjelder KUN forsidens
    // nylig-oppdatert-seksjon — søk/emnefiltre påvirkes ikke.
    // excludedTableIds er en KURATERT liste: enkelttabeller som aldri skal
    // vises der, uavhengig av showHighFrequency. Den finnes fordi timeUnit
    // alene ikke fanger tilfellet — en tabell kan ha en lang tidsperiode og
    // likevel oppdateres hver natt.
    //
    // MÅL, IKKE ANTA. Lista inneholdt en periode ti FHI-tabeller under
    // antagelsen om at «ukestall» betyr daglig påfyll. Det stemte ikke:
    // `updated` i data/sources/fhi-catalog.json er en ekte modifiedAt, fila er
    // innsjekket, og «git log -p» på den ga en tidsserie som viste at msis
    // skriver én gang i uka (torsdag ~10:36, onsdag ~02:36), sysvak natt til
    // lørdag, og at sysvak-324/484 ikke var rørt på nesten et år. Et
    // live-oppslag mot GET /{kilde}/table på en dag uten katalogbygg avgjør
    // saken: rykker modifiedAt fram, er tabellen daglig.
    recentUpdates: {
      showHighFrequency: false,
      highFrequencyTimeUnits: ['Business', 'Daily'],
      excludedTableIds: [
        // Årlig tidsdimensjon, men skrives hver natt kl. 04:07 — verifisert
        // ved at modifiedAt rykker fram ett døgn om gangen, også på dager
        // uten katalogbygg. Eneste FHI-tabellen som gjør dette.
        'fhi-ngs-665'
      ]
    },

    // Skjul metadata-halene i tabelltitler i listevisningen (søk, emner,
    // forsiden) — begge har allerede sin egen kolonne der:
    //
    //   1. Tidsperioden SSB ofte setter bakerst: "Konsumprisindeks 2010-2025"
    //      → "Konsumprisindeks". Fjernes KUN når suffikset faktisk matcher
    //      start-/sluttperioden i "Tidsperiode"-kolonnen (også flerårige
    //      intervaller som "(1990-2000)-(2024-2025)").
    //   2. FHIs frekvensmerke: "Influensa: antall og andel positive (ukestall)"
    //      → "Influensa: antall og andel positive". Perioden viser frekvensen
    //      (2024U40, 2025M10). MERK: de flerårige halene (", treårige tall")
    //      beholdes — de er aggregeringsvindu, ikke oppdateringstakt, og er for
    //      20 FHI-tabellpar det eneste som skiller to ellers like titler. Se
    //      BrowserState.stripFrequencyTail.
    //
    // Detaljsidene (variabelvelger, tabellvisning) viser alltid full tittel.
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
    // DEN ENE kilden til id→kilde-regelen er `idPrefix` på fremmedkildene.
    // Timeout (ms) for KATALOG- OG METADATAKALL mot fremmedkilder (NB/FHI) —
    // en hengende kilde skal feile innen dette og ikke blokkere app-
    // initialiseringen (BrowserState venter på hele katalogaggregeringen).
    fetchTimeoutMs: 15000,

    // Timeout (ms) for SELVE DATAUTTREKKET (kun getTableData). Et stort uttrekk
    // er ikke en hengende kilde: FHI leverer 2 mill. celler på 39 s og 6 mill.
    // på 116 s (målt 2026-08-02, se API-FINDINGS.md), NB 61 MB på 11 s. Med det
    // korte taket over var en FHI-tabell på 2 mill. celler uhentbar uansett hva
    // brukeren gjorde. 90 s rekker ~4,6 mill. FHI-celler — over det advarer
    // UI-et (limits.bySource.fhi.slowWarnCells) i stedet for å la fanen henge.
    dataFetchTimeoutMs: 90000,

    // Maks samtidige nettverkskall PER FREMMEDKILDE (kø i
    // js/sources/source-common.js). NB/FHI går utenom SSBs egen throttle, så
    // uten dette taket treffer en tvungen katalogoppfriskning kilden med hele
    // radlista på én gang.
    maxConcurrentRequests: 4,

    // Statistisk sentralbyrå (PxWebApi v2) — apiBaseUrl over.
    // displayName brukes i API-statuspanelet (source-status.js).
    ssb: {
      adapter: 'ssb',
      enabled: true,
      // SSBs fullstendige /tables-katalog er tyngre enn NB/FHI-metadata.
      // Samme tak gjelder alle SSBApi-kall; 30 s verner oppstarten uten å
      // avbryte normale, store katalogsvar ved 15-sekundersgrensen.
      fetchTimeoutMs: 30000,
      displayName: { nb: 'Statistisk sentralbyrå (SSB)', en: 'Statistics Norway (SSB)' }
    },

    // Norges Bank (SDMX REST). Selve dataflow-katalogen (kjerneutvalget av
    // dataflows med labels, plasseringer og kuraterings-opsjoner) er skilt ut i
    // js/sources/nb-catalog.js (window.NbCatalog) — flere aktiveres ved å legge
    // til rader der. Emnetre-nodene radene plasserer seg under ligger i
    // js/sources/source-topology.js (window.SourceTopology.sourceNodes), og hver
    // subjektkode må finnes i subjects.js (subjectNames + en subjectGroups-
    // gruppe). Her ligger bare adapter-oppsettet og attribusjonen.
    nb: {
      adapter: 'norges-bank',
      enabled: true,
      idPrefix: 'nb-',
      baseUrl: 'https://data.norges-bank.no/api',
      displayName: { nb: 'Norges Bank', en: 'Norges Bank' },
      // SEO-/attribusjonsinfo (samme form som det globale `source`-objektet
      // over) — brukes av scripts/generate-seo-pages.mjs og js/seo-head.js for
      // «Kilde:»-linjer og JSON-LD creator/license på nb-*-tabeller, og av
      // «Kilder og vilkår»-dialogen (js/app-terms.js). Norges Banks åpne data
      // er ikke CC-merket, men dekkes av NLOD (Norsk lisens for offentlige
      // data) — bruk er gratis mot kildehenvisning.
      // `shortName` er kilde-badgen i tabellistene (sourceBadgeHTML i utils.js
      // / sourceBadgeHtml i scripts/lib/seo-sources.mjs) og må være kort nok
      // til å stå bak en tabelltittel; `nameFull` er hover-teksten på badgen.
      branding: {
        name: 'Norges Bank',
        nameFull: 'Norges Bank',
        shortName: 'NB',
        url: 'https://www.norges-bank.no/',
        licenseUrl: 'https://data.norge.no/nlod',
        licenseName: 'NLOD'
      },
      // Dataflow-katalog + søkeord: js/sources/nb-catalog.js (window.NbCatalog),
      // lastet FØR denne filen. Se den filen for radformat og alle kuraterings-
      // opsjonene (slice/probeKey/collapseDims/dropDims/dimOrder/dimSort/…).
      dataflows: ((window.NbCatalog || {}).dataflows) || [],
      variableNames: ((window.NbCatalog || {}).variableNames) || {}
    },

    // Folkehelseinstituttet (åpent statistikk-API, JSON-Stat2 native).
    // Adapteren er generisk over `sourceIds`; registerliste og emnetre-
    // plasseringer (`paths`) ligger i js/sources/source-topology.js
    // (window.SourceTopology.fhi) — se den filen for hvordan flere kilder
    // aktiveres og hvordan plasseringer angis.
    fhi: {
      adapter: 'fhi',
      enabled: true,
      idPrefix: 'fhi-',
      baseUrl: 'https://statistikk-data.fhi.no/api/open/v1',
      displayName: { nb: 'Folkehelseinstituttet (FHI)', en: 'Norwegian Institute of Public Health (FHI)' },
      // SEO-/attribusjonsinfo for fhi-*-tabeller (jf. nb.branding over).
      // FHIs åpne statistikkdata er CC BY 4.0.
      branding: {
        name: 'FHI',
        nameFull: 'Folkehelseinstituttet',
        // Badge-tekst i tabellistene (jf. shortName-kommentaren under nb over)
        shortName: 'FHI',
        url: 'https://www.fhi.no/',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.no',
        licenseName: 'CC BY 4.0'
      },
      // Registerliste + emnetre-plasseringer: js/sources/source-topology.js
      // (window.SourceTopology.fhi), lastet FØR denne filen.
      sourceIds: (((window.SourceTopology || {}).fhi || {}).sourceIds) || [],
      paths: (((window.SourceTopology || {}).fhi || {}).paths) || {}
    }
  },

  // Emnetre-noder for fremmede kilder (NB/FHI): labels + sorteringskoder for de
  // syntetiske nodene (og SSB-passthrough-id-ene) tabellene plasseres under.
  // Flyttet til js/sources/source-topology.js (window.SourceTopology.sourceNodes),
  // lastet FØR denne filen — se den filen for node-format og passthrough-reglene.
  sourceNodes: ((window.SourceTopology || {}).sourceNodes) || {},

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
