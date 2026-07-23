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

/**
 * Delt oppsett for Norges Banks REGNET-tabeller (Regionalt nettverk): den
 * fulle tabellen og de seks kuraterte tematabellene ligger alle på samme sted
 * i emnetreet og bruker samme dimensjonsetiketter. Definert her (og ikke
 * inline per rad) fordi de ellers ville vært repetert sju ganger.
 * NB: må stå FØR AppConfig — filen leses også sandboxet av
 * scripts/generate-seo-pages.mjs via node:vm.
 */
const REGNET_PATHS = [
  ['nk', 'nk02', 'nb-regionalt-nettverk'],
  ['ei', 'ei02', 'nb-regionalt-nettverk']
];
// API-navnene («Regionalt nettverk næringer», «Regionalt nettverk tema») er
// lange og gjentar tabelltittelen; i en kuratert tabell holder det korte navn.
const REGNET_DIM_LABELS = {
  REGNET_SECTOR: { nb: 'Næring', en: 'Industry' },
  REGNET_TOPIC: { nb: 'Indikator', en: 'Indicator' },
  HORIZON: { nb: 'Tidshorisont', en: 'Horizon' },
  REGION: { nb: 'Region', en: 'Region' }
};

// Statsgjeld/statspapirer: ni rader (to fulle samletabeller + sju kuraterte
// snitt) deler samme kryssplassering, samme dim-etiketter og — for
// førstehåndsmarkedet — samme kjennetegnskollaps.
const GOVT_PATHS = [
  ['bf', 'bf04', 'verdipapirer', 'nb-statsgjeld'],
  ['os', 'os07', 'offogjeld', 'nb-statsgjeld'],
  ['os', 'os04', 'offogjeld', 'nb-statsgjeld']
];
// API-navnet på ISIN er «Lån», som er tvetydig i en statspapirtabell (og INSTR,
// som kollapses inn i ISIN, heter det samme).
const GOVT_DIM_LABELS = {
  ISIN: { nb: 'Statspapir', en: 'Security' }
};
// Papirtypen (statsobligasjoner/statskasseveksler) skal ALLTID stå foran lista
// over enkeltlån: den er det grove filteret som avgrenser en liste på 79–125
// ISIN-er, og er ubrukelig bak den. DSD-ene gjør ikke dette av seg selv —
// annenhåndsmarkedet har ISIN før INSTRUMENT_TYPE, og førstehåndsmarkedet
// skyver måleenhet og frekvens inn mellom dem. Rent presentasjon:
// API-nøkkelen bygges fortsatt i DSD-rekkefølge fra extension.fullDimId (se
// orderDims i sdmx-to-jsonstat.js).
const GOVT_PM_DIM_ORDER = ['FREQ', 'INSTRUMENT_TYPE', 'ISIN', 'ISSUE_TYPE', 'UNIT_MEASURE'];
const GOVT_SM_DIM_ORDER = ['FREQ', 'INSTRUMENT_TYPE', 'ISIN',
  'COUNTERPARTY_AREA', 'COUNTERPARTY_TYPE', 'UNIT_MEASURE'];
// ISIN bestemmer forfallsdato, kupong og lånenavn — verifisert funksjonelt mot
// serieskeysonly. Som egne kort ville de tvunget brukeren til å velge samme
// papir tre ganger til; kollapset havner de i ankeretiketten i stedet
// («NGB 03/2033 – 3,625 % – forfall 13.03.2033»).
const GOVT_PM_COLLAPSE = { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] };

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
      // `slice: {DIM: 'kode' | ['kode', ...]}` lager en KURATERT tabell over et
      // utsnitt av flowen — flere rader kan dele samme `flow` med hvert sitt
      // snitt (REGNET → én tabell per tema, som SSBs egne emnetabeller).
      // Enkeltkode-snitt PINNER dimensjonen: den forsvinner helt fra
      // variabelvelgeren og resultattabellen, men koden står i API-nøkkelen, så
      // API-byggerens URL reproduserer nøyaktig det tabellen viser.
      // Flerkode-snitt snevrer bare verdilista. Snittet legges på
      // serieskeysonly-proben, så verdilister/validKeys/kollaps arver det (se
      // applySlice/applyPinnedDims i norges-bank-adapter.js). Sett også
      // `probeKey` til samme utsnitt, ellers arver alle radene flowens
      // samlede tidsvindu.
      // `timeUnit`/`keywords`/`description`/`dimLabels` overstyrer per tabell
      // (frekvensbøtte i filteret, søkeord, Tabellinfo-note, dim-etiketter) —
      // nødvendig når flere rader deler flow og dermed flow-ordlistene.
      // `dimOrder: [dimId, …]` setter rekkefølgen dimensjonskortene vises i når
      // DSD-rekkefølgen er ulogisk (GOVT_SECONDARY_MARKET lister 79 enkeltlån
      // FØR papirtypen som avgrenser dem). Kun presentasjon — API-nøkkelen
      // bygges fra extension.fullDimId, som holder DSD-rekkefølgen.
      // `dropDims: [dimId, …]` fjerner en dimensjon HELT fra velgeren og
      // resultattabellen; nøkkelsegmentet står tomt (= alle verdier). For dims
      // som bare er duplikat-identitet (FAUCTION: AUCTION_ID, når budfristen
      // allerede identifiserer auksjonen). Bruk kun når kombinasjonen av de
      // gjenværende dimensjonene er unik — ellers taper celler stilltiende.
      // `dimSort: {dimId: 'asc'|'desc'}` sorterer verdilista på kode når API-et
      // leverer den i tilfeldig rekkefølge (uKodede dims som FORECAST_DATE).
      // `intervalPicker: {granularity}` gir tidsdimensjonen fra–til-velgeren i
      // flows UTEN FREQ-dimensjon (der frekvenskartet ellers utleder den).
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
          label: { nb: 'Norges Banks styringsrente, reserverente og døgnlånsrente',
            en: 'Norges Bank\'s key policy rate, reserve rate and overnight lending rate' } },
        { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk'],
            ['bf', 'bf03', 'renter', 'nb-pengepolitikk']
          ],
          label: { nb: 'Interbankrente, NOWA', en: 'Interbank rate, NOWA' } },
        { flow: 'GOVT_GENERIC_RATES', version: '1.0', tableId: 'nb-GOVT_GENERIC_RATES',
          paths: GOVT_PATHS,
          label: { nb: 'Statsobligasjonsrenter', en: 'Government bond yields' } },
        { flow: 'GOVT_ZEROCOUPON', version: '1.0', tableId: 'nb-GOVT_ZEROCOUPON',
          paths: GOVT_PATHS,
          label: { nb: 'Nullkupongrenter statspapirer', en: 'Zero coupon yields, government securities' } },
        { flow: 'SEC', version: '1.0', tableId: 'nb-SEC',
          paths: GOVT_PATHS,
          label: { nb: 'Statspapirer – kurser og renter', en: 'Government securities – prices and yields' } },
        { flow: 'GOVT_KEYFIGURES', version: '1.0', tableId: 'nb-GOVT_KEYFIGURES',
          paths: GOVT_PATHS,
          label: { nb: 'Nøkkeltall for statsgjelden', en: 'Key government debt indicators' } },

        // Førstehåndsmarkedet: den fulle samletabellen + fem kuraterte snitt.
        // Nøkkelen er INSTRUMENT_TYPE.UNIT_MEASURE.FREQ.ISIN.ISSUE_TYPE.MATURITY.
        // COUPON.INSTR (åtte segmenter — de tre siste er kollapset inn i ISIN og
        // står derfor alltid tomme). ISSUE_TYPE er delelinja: måleenhetene følger
        // emisjonsformen, så bare tilbakekjøpsauksjonene har vektet snittkurs,
        // vektet snittrente, laveste aksepterte rente og høyeste aksepterte pris.
        // Tetthet ISIN × UNIT_MEASURE per snitt (probet 2026-07-23): AU 99,3 %,
        // OWN 98,9 %, BB 88,4 %, SYN 100 %, RFQ 100 % — mot 67 % samlet.
        // INSTRUMENT_TYPE er funksjonelt bestemt av ISIN, men beholdes bevisst
        // som filter: «vis bare statsobligasjoner» er nyttig, og utgråingen den
        // utløser er meningsbærende (ikke en artefakt av sparsomhet).
        //
        // Titlene deler prefiks («Statslån, førstehåndsmarkedet») slik at den
        // fulle tabellen og snittene sorterer og leses som én familie. Radenes
        // rekkefølge ER sorteringen i emnetreet (sortCode = 900 + radindeks) og
        // følger livsløpet: utstedelse → syndikering → RFQ → tilbakekjøp →
        // egenbeholdning. Ingen `timeUnit` på GOVT-radene: alle NB-tabellene i
        // denne noden må havne i SAMME frekvensbøtte, ellers deler
        // MenuHierarchy.groupTables noden i «Månedstall» + «Andre tabeller».
        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET',
          paths: GOVT_PATHS,
          dimOrder: GOVT_PM_DIM_ORDER,
          collapseDims: GOVT_PM_COLLAPSE,
          dimLabels: GOVT_DIM_LABELS,
          label: { nb: 'Statslån, førstehåndsmarkedet',
            en: 'Government debt securities, primary market' } },

        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET-AU',
          paths: GOVT_PATHS,
          dimOrder: GOVT_PM_DIM_ORDER,
          slice: { ISSUE_TYPE: 'AU' },
          probeKey: '..B..AU...',
          collapseDims: GOVT_PM_COLLAPSE,
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statspapirer', 'Utstedelsesauksjon', 'Auksjon', 'Emisjon',
            'Statsobligasjoner', 'Statskasseveksler', 'Tildelt volum', 'Budvolum', 'Dekningsgrad',
            'Government securities', 'Issuing auction', 'Allotment', 'Bid to cover'],
          description: 'Resultater fra Statens utstedelsesauksjoner av statsobligasjoner og statskasseveksler: tildelt volum, budvolum, dekningsgrad, effektiv rente og utestående volum per lån.',
          label: { nb: 'Statslån, førstehåndsmarkedet. Utstedelsesauksjoner',
            en: 'Government debt securities, primary market. Issuing auctions' } },

        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET-SYN',
          paths: GOVT_PATHS,
          dimOrder: GOVT_PM_DIM_ORDER,
          slice: { ISSUE_TYPE: 'SYN' },
          probeKey: '..B..SYN...',
          collapseDims: GOVT_PM_COLLAPSE,
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statsobligasjoner', 'Syndikering', 'Emisjon', 'Nytt lån',
            'Statspapirer', 'Government bonds', 'Syndication', 'New issue'],
          description: 'Statsobligasjoner lagt ut ved syndikering: tildelt volum, kurs, effektiv rente, durasjon og år til forfall per lån.',
          label: { nb: 'Statslån, førstehåndsmarkedet. Syndikeringer',
            en: 'Government debt securities, primary market. Syndications' } },

        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET-RFQ',
          paths: GOVT_PATHS,
          dimOrder: GOVT_PM_DIM_ORDER,
          slice: { ISSUE_TYPE: 'RFQ' },
          probeKey: '..B..RFQ...',
          collapseDims: GOVT_PM_COLLAPSE,
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statsobligasjoner', 'RFQ', 'Request for quote', 'Pristilbud',
            'Emisjon', 'Statspapirer', 'Government bonds'],
          description: 'Statsobligasjoner lagt ut ved forespørsel om pristilbud (request for quote). Salgsformen er så langt brukt én gang, for ett enkelt lån i 2019.',
          label: { nb: 'Statslån, førstehåndsmarkedet. Salg ved pristilbud (RFQ)',
            en: 'Government debt securities, primary market. Request for quote sales' } },

        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET-BB',
          paths: GOVT_PATHS,
          dimOrder: GOVT_PM_DIM_ORDER,
          slice: { ISSUE_TYPE: 'BB' },
          probeKey: '..B..BB...',
          collapseDims: GOVT_PM_COLLAPSE,
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statsobligasjoner', 'Tilbakekjøp', 'Tilbakekjøpsauksjon',
            'Auksjon', 'Vektet snittkurs', 'Vektet snittrente', 'Statspapirer',
            'Government bonds', 'Buyback auction', 'Weighted average price'],
          description: 'Resultater fra Statens tilbakekjøpsauksjoner av statsobligasjoner: tilbakekjøpt volum, vektet snittkurs og -rente, laveste aksepterte rente og høyeste aksepterte pris.',
          label: { nb: 'Statslån, førstehåndsmarkedet. Tilbakekjøpsauksjoner',
            en: 'Government debt securities, primary market. Buyback auctions' } },

        { flow: 'GOVT_PRIMARY_MARKET', version: '1.0', tableId: 'nb-GOVT_PRIMARY_MARKET-OWN',
          paths: GOVT_PATHS,
          dimOrder: GOVT_PM_DIM_ORDER,
          slice: { ISSUE_TYPE: 'OWN' },
          probeKey: '..B..OWN...',
          collapseDims: GOVT_PM_COLLAPSE,
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statspapirer', 'Egenbeholdning', 'Statens egenbeholdning',
            'Utestående volum', 'Statsobligasjoner', 'Statskasseveksler',
            'Government securities', 'Own holdings', 'Outstanding volume'],
          description: 'Endringer i statens egenbeholdning av statsobligasjoner og statskasseveksler, med utestående volum, durasjon og år til forfall per lån.',
          label: { nb: 'Statslån, førstehåndsmarkedet. Statens egenbeholdning',
            en: 'Government debt securities, primary market. Government\'s own holdings' } },

        // Annenhåndsmarkedet: den fulle samletabellen + to snitt på måleenhet.
        // Nøkkelen er FREQ.ISIN.INSTRUMENT_TYPE.COUNTERPARTY_AREA.
        // COUNTERPARTY_TYPE.UNIT_MEASURE. Snittet løfter tettheten fra 10,1 % til
        // 31,8 % (omsetning) og 21,9 % (repo), og snevrer samtidig motpartslistene
        // (repo bruker 4 av 6 regioner og 9 av 11 motpartstyper). Resten av
        // sparsomheten er ekte: ikke alle lån handles med alle motpartstyper i
        // alle regioner, så kryssfilteret vil fortsatt gråe ut mye — korrekt.
        // Ingen collapseDims her: flowen har ikke MATURITY/COUPON/INSTR, og
        // ISIN-kodelista gir allerede lesbare etiketter («NGB 09/2029»).
        { flow: 'GOVT_SECONDARY_MARKET', version: '1.0', tableId: 'nb-GOVT_SECONDARY_MARKET',
          paths: GOVT_PATHS,
          dimOrder: GOVT_SM_DIM_ORDER,
          dimLabels: GOVT_DIM_LABELS,
          label: { nb: 'Statslån, annenhåndsmarkedet',
            en: 'Government debt securities, secondary market' } },

        { flow: 'GOVT_SECONDARY_MARKET', version: '1.0', tableId: 'nb-GOVT_SECONDARY_MARKET-VOL',
          paths: GOVT_PATHS,
          dimOrder: GOVT_SM_DIM_ORDER,
          slice: { UNIT_MEASURE: 'V' },
          probeKey: 'M.....V',
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statspapirer', 'Annenhåndsmarkedet', 'Omsetning', 'Motpart',
            'Motpartstype', 'Statsobligasjoner', 'Statskasseveksler',
            'Government securities', 'Secondary market', 'Turnover', 'Counterparty'],
          description: 'Omsetning av statsobligasjoner og statskasseveksler i annenhåndsmarkedet, fordelt på motpartstype og motpartens region.',
          label: { nb: 'Statslån, annenhåndsmarkedet. Omsetning etter motpart',
            en: 'Government debt securities, secondary market. Turnover by counterparty' } },

        { flow: 'GOVT_SECONDARY_MARKET', version: '1.0', tableId: 'nb-GOVT_SECONDARY_MARKET-REPO',
          paths: GOVT_PATHS,
          dimOrder: GOVT_SM_DIM_ORDER,
          slice: { UNIT_MEASURE: 'V_R' },
          probeKey: 'M.....V_R',
          dimLabels: GOVT_DIM_LABELS,
          keywords: ['Statslån', 'Statspapirer', 'Repo', 'Gjenkjøpsavtaler', 'Annenhåndsmarkedet',
            'Motpart', 'Motpartstype', 'Statsobligasjoner',
            'Government securities', 'Repo', 'Repurchase agreements', 'Counterparty'],
          description: 'Omsetning av statspapirer i gjenkjøpsavtaler (repo) i annenhåndsmarkedet, fordelt på motpartstype og motpartens region.',
          label: { nb: 'Statslån, annenhåndsmarkedet. Gjenkjøpsavtaler (repo) etter motpart',
            en: 'Government debt securities, secondary market. Repurchase agreements by counterparty' } },

        { flow: 'GOVT_IRS', version: '1.0', tableId: 'nb-GOVT_IRS', discontinued: true,
          paths: GOVT_PATHS,
          label: { nb: 'Rentebytteavtaler (historisk, t.o.m. 2014)', en: 'Interest rate swaps (historical, until 2014)' } },
        // Underkategoriene (LIQUIDITY_DETAILS, 39 stk.) ligger fullstendig nestet
        // under hovedkategoriene (LIQUIDITY_MAIN, 5 stk.) — verifisert mot
        // serieskeysonly: hver detalj forekommer under nøyaktig én hovedkategori.
        // To kort ville tvunget brukeren til å velge samme informasjon to ganger,
        // så hovedkategorien kollapses inn i detaljetiketten som prefiks.
        // Kodene (tab1_linje01 … tab5_linje03) sorterer nøyaktig som Norges Banks
        // egen oppstilling på norges-bank.no/tema/statistikk/bankenes-likviditet.
        { flow: 'LIQUIDITY_STATISTICS', version: '1.0', tableId: 'nb-LIQUIDITY_STATISTICS',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          collapseDims: { anchor: 'LIQUIDITY_DETAILS', dims: ['LIQUIDITY_MAIN'], labelStyle: 'prefix' },
          // Måleenhet og instrumenttype er begge funksjonelt bestemt av
          // detaljlinja (verifisert mot serieskeysonly: hver linje har nøyaktig
          // én kombinasjon), så de er ikke reelle valg — de fjernes, og et tomt
          // nøkkelsegment henter linjas ene eksisterende kombinasjon. Da blir
          // tabellen ett kategorifelt × tid, som Norges Banks egen oppstilling.
          dropDims: ['UNIT_MEASURE', 'INSTRUMENT_TYPE'],
          dimSort: { LIQUIDITY_DETAILS: 'asc' },
          dimLabels: { LIQUIDITY_DETAILS: { nb: 'Likviditetsstatistikk', en: 'Liquidity statistics' } },
          keywords: ['Likviditet', 'Likviditetsstatistikk', 'Banksystemets likviditet',
            'Sentralbankreserver', 'Folioinnskudd', 'F-lån', 'F-innskudd', 'D-lån',
            'Statens konti', 'Liquidity in the banking system', 'Liquidity statistics', 'Reserves'],
          label: { nb: 'Likviditeten i banksystemet', en: 'Liquidity in the banking system' } },

        // Vintage-datasett: hver observasjon er merket med prognosedatoen den ble
        // publisert på. Prognoseår og prognosedato kommer begge usortert fra
        // API-et og sorteres synkende, slik at nyeste vintage ligger øverst.
        // Prognoseåret er året prognosen GJELDER, ikke året datoen ligger i, og
        // kan derfor ikke kollapses inn i datoen: ni desemberdatoer bærer
        // prognoser for både inneværende og neste år (f.eks. 2025-12-15 → 2025
        // og 2026) — verifisert mot serieskeysonly.
        { flow: 'LIQUIDITY_FORECAST', version: '1.0', tableId: 'nb-LIQUIDITY_FORECAST',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          probeKey: { period: 'D.STAT_S..', time: 'D.FCAST_CBC..' },
          dimSort: { FORECAST_DATE: 'desc', FORECAST_YEAR: 'desc' },
          keywords: ['Likviditet', 'Strukturell likviditet', 'Total likviditet',
            'Likviditetsprognose', 'Prognose', 'Sentralbankreserver', 'Banksystemet',
            'Structural liquidity', 'Total liquidity', 'Liquidity forecast'],
          label: { nb: 'Likviditeten i banksystemet, strukturell og total likviditet',
            en: 'Liquidity in the banking system, structural and total liquidity' } },
        { flow: 'MONEY_MARKET', version: '1.0', tableId: 'nb-MONEY_MARKET',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          probeKey: 'B.U..........',
          label: { nb: 'Pengemarkedsdata (RPD)', en: 'Money market data' } },
        // Hver observasjon ER én auksjon, tidfestet til budfristen: tidsaksen
        // (TIME_PERIOD, «Budfrist») er et tidsstempel ned til sekundet og
        // identifiserer auksjonen alene. AUCTION_ID er dermed ren duplikat-
        // identitet — 1509 ugjennomtrengelige idnumre som brukeren måtte velge
        // fra for å få ut noe — og fjernes med `dropDims`. Forutsetningen (én
        // auksjon per instrumenttype × måleenhet × budfrist) er verifisert mot
        // hele historikken: 11 812 celler, én kollisjon (to annonseringsrader
        // 2020-04-16T15:00, begge uten verdi).
        // Flowen har ingen FREQ-dimensjon, så tidsvelgeren får granulariteten
        // fra `intervalPicker` i stedet for fra frekvenskartet. API-et filtrerer
        // datoer mot tidsstempel-aksen og tar med hele sluttdøgnet (verifisert).
        { flow: 'FAUCTION', version: '1.0', tableId: 'nb-FAUCTION',
          paths: [
            ['bf', 'nb-finansmarkeder', 'nb-pengepolitikk'],
            ['nk', 'nk02', 'nb-pengepolitikk']
          ],
          probeKey: 'FDFLIR.ANN.',
          dropDims: ['AUCTION_ID'],
          intervalPicker: { granularity: 'day' },
          keywords: ['F-auksjoner', 'F-lån', 'F-innskudd', 'Auksjon', 'Budfrist',
            'Markedsoperasjoner', 'Likviditetspolitikk', 'Tildelingsrente',
            'F-auctions', 'F-loans', 'F-deposits'],
          description: 'Resultater fra Norges Banks F-auksjoner (F-lån og F-innskudd): budvolum, tildelt volum og tildelingsrenter. Hver observasjon er én auksjon, tidfestet til auksjonens budfrist.',
          label: { nb: 'Norges Banks F-auksjoner', en: 'Norges Bank\'s F-auctions' } },
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
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          label: { nb: 'Regionalt nettverk, alle indikatorer', en: 'Regional network, all indicators' } },

        // Kuraterte tematabeller over REGNET (se `slice`-kommentaren over).
        // Snittene er verifisert mot serieskeysonly: hver av dem er et FULLT
        // rektangel, så kryssfilteret gråer ikke ut noe inne i tabellene.
        // REGNET-nøkkelen er FREQ.REGNET_TOPIC.REGNET_SECTOR.REGION.HORIZON;
        // `_X`/`_Z` er SDMX-plassholderne Unspecified/Not Applicable, som er
        // nettopp de pinnede kodene brukeren aldri skal se.
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-PROD', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          slice: { REGNET_TOPIC: 'PROD', REGION: '_X' },
          probeKey: 'Q.PROD.._X.',
          dimLabels: REGNET_DIM_LABELS,
          keywords: ['Regionalt nettverk', 'Produksjonsvekst', 'Produksjon', 'Næring', 'Forventninger',
            'Regional network', 'Production growth', 'Output'],
          description: 'Produksjonsvekst siste og neste kvartal, slik bedriftene i Norges Banks regionale nettverk rapporterer den. Annualisert vekst i prosent.',
          label: { nb: 'Regionalt nettverk, produksjonsvekst, etter næring',
            en: 'Regional network, production growth, by industry' } },

        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-INVPLAN', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          slice: { REGNET_TOPIC: 'INVPLAN', REGION: '_X' },
          probeKey: 'Q.INVPLAN.._X.',
          dimLabels: REGNET_DIM_LABELS,
          keywords: ['Regionalt nettverk', 'Investeringsplaner', 'Investeringer', 'Næring',
            'Regional network', 'Investment plans', 'Investment'],
          description: 'Bedriftenes investeringsplaner for inneværende og neste år, fra Norges Banks regionale nettverk.',
          label: { nb: 'Regionalt nettverk, investeringsplaner, etter næring',
            en: 'Regional network, investment plans, by industry' } },

        // Sysselsettingsvekst (inneværende kvartal) og -planer (neste kvartal)
        // er samme størrelse på to horisonter. HORIZON er funksjonelt bestemt
        // av temaet og kollapses derfor bort — indikatornavnet bærer horisonten.
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-SYSS', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          slice: { REGNET_TOPIC: ['SYSS', 'SYSSPLAN'], REGION: '_X' },
          collapseDims: { anchor: 'REGNET_TOPIC', dims: ['HORIZON'], labelStyle: 'suffix' },
          probeKey: 'Q.SYSS+SYSSPLAN.._X.',
          dimLabels: REGNET_DIM_LABELS,
          keywords: ['Regionalt nettverk', 'Sysselsetting', 'Sysselsettingsvekst', 'Sysselsettingsplaner',
            'Bemanning', 'Næring', 'Regional network', 'Employment growth', 'Employment plans'],
          description: 'Sysselsettingsvekst siste kvartal og sysselsettingsplaner for neste kvartal, fra Norges Banks regionale nettverk.',
          label: { nb: 'Regionalt nettverk, sysselsettingsvekst og -planer, etter næring',
            en: 'Regional network, employment growth and plans, by industry' } },

        // Tre nåsituasjons-/kvartalsindikatorer med hver sin faste horisont →
        // HORIZON kollapses bort, indikator blir dimensjonen. Årslønnsvekst er
        // holdt UTENFOR: den har to horisonter (i år / neste år), og en kollaps
        // ville da ikke vært funksjonell (adapteren avviser den, se
        // applyCollapseDims) — derfor egen tabell under.
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-KAPASITET', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          slice: { REGNET_TOPIC: ['KAPUTN', 'LONNSOM', 'TILG_ARBKR_BEGR'], REGION: '_X' },
          collapseDims: { anchor: 'REGNET_TOPIC', dims: ['HORIZON'], labelStyle: 'suffix' },
          probeKey: 'Q.KAPUTN+LONNSOM+TILG_ARBKR_BEGR.._X.',
          dimLabels: REGNET_DIM_LABELS,
          keywords: ['Regionalt nettverk', 'Kapasitetsutnytting', 'Kapasitetsutnyttelse', 'Lønnsomhet',
            'Knapphet på arbeidskraft', 'Arbeidskraft', 'Næring',
            'Regional network', 'Capacity utilisation', 'Profitability', 'Labour supply'],
          description: 'Andel bedrifter med kapasitetsproblemer, vurdering av lønnsomheten og andel bedrifter som melder om knapphet på arbeidskraft — fra Norges Banks regionale nettverk.',
          label: { nb: 'Regionalt nettverk, kapasitetsutnytting, lønnsomhet og knapphet på arbeidskraft, etter næring',
            en: 'Regional network, capacity utilisation, profitability and labour supply constraints, by industry' } },

        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-ARSLONN', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          slice: { REGNET_TOPIC: 'ARSLONN', REGION: '_X' },
          probeKey: 'Q.ARSLONN.._X.',
          dimLabels: REGNET_DIM_LABELS,
          keywords: ['Regionalt nettverk', 'Årslønnsvekst', 'Lønnsvekst', 'Lønn', 'Næring',
            'Regional network', 'Annual wage growth', 'Wages'],
          description: 'Bedriftenes anslag på årslønnsveksten for inneværende og neste år, fra Norges Banks regionale nettverk.',
          label: { nb: 'Regionalt nettverk, årslønnsvekst, etter næring',
            en: 'Regional network, annual wage growth, by industry' } },

        // Regionalindikatoren står sist: den er den eneste av tematabellene som
        // er fordelt på region i stedet for næring, og passer derfor dårlig
        // midt i næringstabellene. Rekkefølgen her ER sorteringen i emnetreet
        // (buildCatalogue setter sortCode = 900 + radindeks).
        { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-REGION', timeUnit: 'Quarterly',
          paths: REGNET_PATHS,
          slice: { REGNET_TOPIC: 'REGIONALINDIKATOR', REGNET_SECTOR: '_Z', HORIZON: '_X' },
          probeKey: 'Q.REGIONALINDIKATOR._Z.._X',
          dimLabels: REGNET_DIM_LABELS,
          keywords: ['Regionalt nettverk', 'Regionalindikator', 'Region', 'Landsdel', 'Aktivitet',
            'Regional network', 'Regional indicator'],
          description: 'Regionalindikatoren for hver av Norges Banks regioner: samlet vurdering av aktiviteten i regionen.',
          label: { nb: 'Regionalt nettverk, regionalindikator, etter region',
            en: 'Regional network, regional indicator, by region' } }
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
