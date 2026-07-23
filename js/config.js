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

    // «Nylig oppdaterte tabeller» på forsiden: tabeller som oppdateres
    // tilnærmet hver virkedag (Norges Banks kurs-/renteserier, FREQ=B) fyller
    // listen hver dag og har lav signalverdi. Sett showHighFrequency: true for
    // å ta dem med igjen. highFrequencyTimeUnits er timeUnit-verdiene som
    // regnes som «daglige» (SSB bruker i praksis ikke 'Daily' i dag, men
    // verdien tas med for framtidig sikkerhet). Gjelder KUN forsidens
    // nylig-oppdatert-seksjon — søk/emnefiltre påvirkes ikke.
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
    // `path` er emnetre-segmentene: [subjektkode, ...node-id-er] med vilkårlig
    // dybde (subjekt + én eller flere noder i sourceNodes). Alternativt kan en
    // rad angi `paths: [[subjekt, ...noder], ...]` for å plassere tabellen under
    // FLERE emnestier (som SSBs multi-mappe-tabeller). Node-id-er kan være NB-
    // egne leaf-noder ELLER SSB-passthrough-id-er (bf03/renter/nk02/…) som gjør
    // at tabellen merges inn i SSBs egne mapper. Hver node-id må finnes i
    // sourceNodes under, og hver subjektkode i subjects.js (subjectNames + en
    // subjectGroups-gruppe) — ellers rendres ikke plasseringen.
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
      // `shortName` er kilde-badgen i tabellistene (sourceBadgeHTML i utils.js
      // / sourceBadgeHtml i scripts/lib/seo-sources.mjs) og må være kort nok
      // til å stå bak en tabelltittel; `nameFull` er hover-teksten på badgen.
      branding: {
        name: 'Norges Bank',
        nameFull: 'Norges Bank',
        shortName: 'NB',
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
      // Plasseringene kryssplasserer hver tabell under flere tematiske leaf-noder
      // som ligger dypt inne i SSBs egne emnemapper (SSB-passthrough-id-ene merger
      // NB-tabellen inn i SSBs mappe — se sourceNodes-blokken). Rentetabeller →
      // Pengepolitikk og pengemarked; statspapirer → Statsgjeld og statspapirer;
      // valuta → Valuta (under Finansmarkeder). Se ROADMAP/planen for kartet.
      dataflows: [
        { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-valuta'],
            ['ut', 'nb-valuta'],
            ['bf', 'bf04', 'nb-valuta']
          ],
          label: { nb: 'Valutakurser', en: 'Exchange rates' } },
        { flow: 'IR', version: '1.1', tableId: 'nb-IR',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk'],
            ['bf', 'bf03', 'renter', 'nb-pengepolitikk']
          ],
          label: { nb: 'Styringsrenten', en: 'Key policy rate' } },
        { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk'],
            ['bf', 'bf03', 'renter', 'nb-pengepolitikk']
          ],
          label: { nb: 'Kortsiktige renter (NOWA)', en: 'Short-term interest rates (NOWA)' } },
        { flow: 'GOVT_GENERIC_RATES', version: '1.0', tableId: 'nb-GOVT_GENERIC_RATES',
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          label: { nb: 'Statsobligasjonsrenter', en: 'Government bond yields' } },
        { flow: 'GOVT_ZEROCOUPON', version: '1.0', tableId: 'nb-GOVT_ZEROCOUPON',
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          label: { nb: 'Nullkupongrenter statspapirer', en: 'Zero coupon yields, government securities' } },
        { flow: 'SEC', version: '1.0', tableId: 'nb-SEC',
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          label: { nb: 'Statspapirer – kurser og renter', en: 'Government securities – prices and yields' } },
        { flow: 'GOVT_KEYFIGURES', version: '1.0', tableId: 'nb-GOVT_KEYFIGURES',
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          label: { nb: 'Nøkkeltall for statsgjelden', en: 'Key government debt indicators' } },
        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET',
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] },
          label: { nb: 'Statspapirer – førstehåndsmarkedet', en: 'Government securities – primary market' } },
        { flow: 'GOVT_SECONDARY_MARKET', version: '1.0', tableId: 'nb-GOVT_SECONDARY_MARKET',
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          label: { nb: 'Statspapirer – annenhåndsmarkedet', en: 'Government securities – secondary market' } },
        { flow: 'GOVT_IRS', version: '1.0', tableId: 'nb-GOVT_IRS', discontinued: true,
          paths: [
            ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
            ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
            ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
          ],
          label: { nb: 'Rentebytteavtaler (historisk, t.o.m. 2014)', en: 'Interest rate swaps (historical, until 2014)' } },
        { flow: 'LIQUIDITY_STATISTICS', version: '1.0', tableId: 'nb-LIQUIDITY_STATISTICS',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          label: { nb: 'Likviditetsstatistikk', en: 'Liquidity statistics' } },
        { flow: 'LIQUIDITY_FORECAST', version: '1.0', tableId: 'nb-LIQUIDITY_FORECAST',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          probeKey: { period: 'D.STAT_S..', time: 'D.FCAST_CBC..' },
          label: { nb: 'Strukturell og total likviditet', en: 'Structural and total liquidity' } },
        { flow: 'MONEY_MARKET', version: '1.0', tableId: 'nb-MONEY_MARKET',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          probeKey: 'B.U..........',
          label: { nb: 'Pengemarkedsdata (RPD)', en: 'Money market data' } },
        { flow: 'FAUCTION', version: '1.0', tableId: 'nb-FAUCTION',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          probeKey: 'FDFLIR.ANN.',
          label: { nb: 'F-auksjoner', en: 'F-auctions' } },
        { flow: 'CBC_TRANSACTIONS', version: '1.0', tableId: 'nb-CBC_TRANSACTIONS',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'INSTR'] },
          label: { nb: 'Sentralbanksertifikater – transaksjoner', en: 'Central bank certificates – transactions' } },
        { flow: 'SETTLEMENT_STATISTICS', version: '1.0', tableId: 'nb-SETTLEMENT_STATISTICS',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          label: { nb: 'Oppgjørsstatistikk', en: 'Settlement statistics' } },
        { flow: 'FINANCIAL_INDICATORS', version: '1.0', tableId: 'nb-FINANCIAL_INDICATORS',
          path: ['bf', 'bf02', 'nb-fin-indikatorer'],
          label: { nb: 'Finansielle indikatorer (FCI)', en: 'Financial indicators (FCI)' } },
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET',
          paths: [
            ['nk', 'nk02', 'nb-regionalt-nettverk'],
            ['ei', 'ei02', 'nb-regionalt-nettverk']
          ],
          label: { nb: 'Regionalt nettverk', en: 'Regional network' } }
      ]
    },

    // Folkehelseinstituttet (åpent statistikk-API, JSON-Stat2 native).
    // Adapteren er generisk over `sourceIds` — flere kilder aktiveres ved å
    // legge til en id her (se «Senere» i planen).
    // Valgfri `paths: { <sourceId>: [[subjekt, ...noder], ...] }` overstyrer
    // standardplasseringen (['he', 'fhi-<sourceId>']) med én eller flere
    // emnetre-plasseringer av vilkårlig dybde (subjekt + én eller flere noder,
    // inkl. SSB-passthrough-id-er som he03/be06/fodte). Kategori-segmentet
    // (register → kategori, fra fhi-catalog.json) legges automatisk på ENDEN av
    // hver plassering. Samme krav til sourceNodes/subjects.js som for NB over.
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
        // Badge-tekst i tabellistene (jf. shortName-kommentaren under nb over)
        shortName: 'FHI',
        url: 'https://www.fhi.no/',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.no',
        licenseName: 'CC BY 4.0'
      },
      sourceIds: [
        'nokkel', 'mfr', 'daar',
        'msis', 'sysvak', 'npr', 'kpr', 'lmr',
        'gs', 'hkr', 'abr', 'ngs', 'skast'
      ],
      // Kryssplassering dypt inn i SSBs helse-/befolkningsmapper. Hver leaf-node
      // er registerets fhi-<sourceId>-node; grupperingsnodene (fhi-sykdommer/
      // fhi-pasientregister/fhi-legemidler) samler beslektede registre.
      paths: {
        nokkel: [['he', 'he03', 'fhi-nokkel']],
        mfr:    [['be', 'be01', 'fodte', 'fhi-mfr'], ['be', 'be06', 'fodte', 'fhi-mfr'], ['in', 'in03', 'fodte', 'fhi-mfr']],
        daar:   [['be', 'be06', 'dode', 'fhi-daar'], ['he', 'he03', 'fhi-daar']],
        msis:   [['he', 'he03', 'fhi-sykdommer', 'fhi-msis']],
        sysvak: [['he', 'he04', 'fhi-sysvak']],
        npr:    [['he', 'he04', 'fhi-pasientregister', 'fhi-npr']],
        kpr:    [['he', 'he04', 'fhi-pasientregister', 'fhi-kpr'], ['he', 'he04', 'helsetjko', 'fhi-kpr']],
        lmr:    [['he', 'he04', 'fhi-legemidler', 'fhi-lmr']],
        gs:     [['he', 'he04', 'fhi-legemidler', 'fhi-gs']],
        hkr:    [['he', 'he03', 'fhi-sykdommer', 'fhi-hkr']],
        abr:    [['he', 'he03', 'fhi-abr']],
        ngs:    [['he', 'he03', 'fhi-sykdommer', 'fhi-ngs']],
        skast:  [['he', 'he03', 'fhi-skast']]
      }
    }
  },

  /**
   * Emnetre-noder for fremmede kilder (nivå ≥ 2 under en SSB-subjektkode).
   *
   * Fremmede tabeller får syntetiske `paths[]` på formen
   * `[{ id: <subjektkode>, ... }, { id: <node-id>, label, sortCode }, ...]`, slik
   * at de glir inn i det eksisterende emnehierarkiet (menu-hierarchy.js) uten
   * viewendringer. En path kan ha vilkårlig dybde (subjekt + én eller flere
   * noder). `9xx`-noder plasserer NB-leaf-nodene sist blant SSB-undertemaene.
   *
   * SSB-PASSTHROUGH-NODER (bf02/bf03/renter/bf04/verdipapirer/nk02/os04/os07/
   * offogjeld/ei02): disse speiler SSBs egne mappe-id-er slik at NB-tabeller
   * MERGES inn i SSBs mapper (menu-hierarchy.js keyer tre-noder på `id`) i
   * stedet for å lage dublett-mapper. Label/sortCode her er kun fallback —
   * SSBs egne tabeller oppretter nodene først («først-sett vinner» i
   * _addPathToHierarchy), så SSBs faktiske (og språk-lokaliserte) verdier
   * brukes i praksis. Id-ene er verifisert mot data.ssb.no/api/pxwebapi/v2.
   *
   * NB: Passthrough-/FHI-labelene er kun norske (`nb`). Adaptere/UI som slår
   * opp en label for et annet språk MÅ falle tilbake til `nb` når `en` mangler
   * (for passthrough-nodene leverer SSBs egne data uansett `en`-labelen).
   */
  sourceNodes: {
    // Norges Bank – tematiske leaf-noder (kryssplasseres under flere SSB-mapper).
    'nb-finansmarkeder':    { sortCode: '905', label: { nb: 'Finansmarkeder', en: 'Financial markets' } },
    'nb-pengepolitikk':     { sortCode: '910', label: { nb: 'Pengepolitikk og pengemarked', en: 'Monetary policy and money market' } },
    'nb-valuta':            { sortCode: '911', label: { nb: 'Valuta', en: 'Currency' } },
    'nb-statsgjeld':        { sortCode: '912', label: { nb: 'Statsgjeld og statspapirer', en: 'Government debt and securities' } },
    'nb-fin-indikatorer':   { sortCode: '913', label: { nb: 'Norges Banks finansielle indikatorer', en: "Norges Bank's financial indicators" } },
    'nb-regionalt-nettverk':{ sortCode: '914', label: { nb: 'Regionalt nettverk', en: 'Regional network' } },
    // SSB-passthrough for NB (speiler SSBs egne folder-id-er — se blokk-
    // kommentaren over). nb+en; en-labelene er SSBs egne engelske mappenavn.
    'bf02':        { sortCode: '0000007', label: { nb: 'Finansielle indikatorer', en: 'Financial indicators' } },
    'bf03':        { sortCode: '0000008', label: { nb: 'Finansinstitusjoner og andre finansielle foretak', en: 'Financial institutions and other financial corporations' } },
    'renter':      { sortCode: '0000009', label: { nb: 'Renter i banker og kredittforetak', en: 'Interest rates in banks and mortgage companies' } },
    'bf04':        { sortCode: '0000009', label: { nb: 'Verdipapirmarkeder', en: 'Securities markets' } },
    'verdipapirer':{ sortCode: '0000010', label: { nb: 'Verdipapirer', en: 'Securities' } },
    'nk02':        { sortCode: '0000068', label: { nb: 'Konjunkturer', en: 'Business cycles' } },
    'os04':        { sortCode: '0000079', label: { nb: 'Offentlig forvaltning', en: 'General government' } },
    'os07':        { sortCode: '0000081', label: { nb: 'Statlige finanser', en: 'Central government finances' } },
    // 'offogjeld' finnes hos SSB under både os04 (0000080) og os07 (0000082) med
    // samme id; distinkte tre-noder (ulik forelder) + SSB-tabeller begge steder →
    // vår ene sortCode-verdi brukes ikke i praksis.
    'offogjeld':   { sortCode: '0000080', label: { nb: 'Offentlig forvaltnings fordringer og gjeld', en: 'General government, financial assets and liabilities' } },
    'ei02':        { sortCode: '0000032', label: { nb: 'Industri og bergverksdrift', en: 'Manufacturing, mining and quarrying' } },
    // SSB-passthrough for FHI: helse-/befolkningsmapper (samme merge-mønster).
    'he03':        { sortCode: '0000036', label: { nb: 'Helseforhold og levevaner', en: 'Health conditions and living habits' } },
    'he04':        { sortCode: '0000037', label: { nb: 'Helsetjenester', en: 'Health services' } },
    'helsetjko':   { sortCode: '0000038', label: { nb: 'Kommunehelsetenesta', en: 'Municipal health care service' } },
    'be01':        { sortCode: '0000017', label: { nb: 'Barn, familier og husholdninger', en: 'Children, families and households' } },
    'be06':        { sortCode: '0000021', label: { nb: 'Fødte og døde', en: 'Births and deaths' } },
    // 'fodte' finnes hos SSB under be01 (0000018), be06 (0000022) og in03 (0000046)
    // med samme id; distinkte tre-noder (ulik forelder) → vår ene sortCode brukes
    // ikke i praksis (SSB-tabeller finnes alle tre steder).
    'fodte':       { sortCode: '0000018', label: { nb: 'Fødte', en: 'Births' } },
    'dode':        { sortCode: '0000022', label: { nb: 'Døde', en: 'Deaths' } },
    'in03':        { sortCode: '0000045', label: { nb: 'Befolkning', en: 'Population' } },
    // FHI-grupperingsnoder (FHI-eide mellomnivåer under SSB-mappene).
    'fhi-sykdommer':       { sortCode: '9970', label: { nb: 'Sykdommer', en: 'Diseases' } },
    'fhi-pasientregister': { sortCode: '9971', label: { nb: 'Pasientregister', en: 'Patient registries' } },
    'fhi-legemidler':      { sortCode: '9972', label: { nb: 'Legemidler', en: 'Pharmaceuticals' } },
    // FHI-registrene (leaf-noder): rene navn (kilde vises per tabell), nb+en.
    // '99xx'-koder ordner søsken innen samme forelder (jf. grupperingsnodene).
    'fhi-nokkel':      { sortCode: '9900', label: { nb: 'Folkehelse – nøkkeltall', en: 'Public health – key figures' } },
    'fhi-mfr':         { sortCode: '9905', label: { nb: 'Medisinsk fødselsregister', en: 'Medical Birth Registry' } },
    'fhi-daar':        { sortCode: '9910', label: { nb: 'Dødsårsaksregisteret', en: 'Cause of Death Registry' } },
    'fhi-msis':        { sortCode: '9915', label: { nb: 'Smittsomme sykdommer', en: 'Communicable diseases' } },
    'fhi-hkr':         { sortCode: '9916', label: { nb: 'Hjerte- og karregisteret', en: 'Cardiovascular Disease Registry' } },
    'fhi-ngs':         { sortCode: '9917', label: { nb: 'Mikrobiologisk genomovervåkning', en: 'Microbial genomic surveillance' } },
    'fhi-sysvak':      { sortCode: '9920', label: { nb: 'Vaksinasjonsregisteret', en: 'Vaccination Registry' } },
    'fhi-npr':         { sortCode: '9925', label: { nb: 'Norsk pasientregister', en: 'Norwegian Patient Registry' } },
    'fhi-kpr':         { sortCode: '9930', label: { nb: 'Kommunalt pasient- og brukerregister', en: 'Municipal Patient and User Registry' } },
    'fhi-lmr':         { sortCode: '9935', label: { nb: 'Legemiddelregisteret', en: 'Norwegian Prescription Registry' } },
    'fhi-gs':          { sortCode: '9940', label: { nb: 'Grossistbasert legemiddelstatistikk', en: 'Wholesale-based drug statistics' } },
    'fhi-abr':         { sortCode: '9950', label: { nb: 'Abortregisteret', en: 'Abortion Registry' } },
    'fhi-skast':       { sortCode: '9960', label: { nb: 'Skadedyrstatistikken', en: 'Pest control statistics' } }
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
