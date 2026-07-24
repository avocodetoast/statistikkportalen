/**
 * Norges Bank-katalog: den hånd-kuraterte dataflow-lista + delte konstanter +
 * statiske søkeord. Skilt ut fra js/config.js fordi dette er kataloginnhold
 * (labels, beskrivelser, søkeord, emnetre-plasseringer + kuraterings-direktiver),
 * ikke app-innstillinger — det utgjorde alene ~420 linjer av config.
 *
 * Setter `window.NbCatalog = { dataflows, variableNames }`. Konsumeres av:
 *   - js/config.js — eksponerer dataflows/variableNames på AppConfig.sources.nb
 *     (så adapteren og øvrig kode leser dem på samme sted som før).
 *   - js/sources/norges-bank-adapter.js — buildCatalogue leser cfg.dataflows /
 *     cfg.variableNames.
 *   - scripts/lib/seo-sources.mjs (via node:vm) — buildNbCatalogue leser
 *     appConfig.sources.nb.{dataflows,variableNames}.
 *
 * LASTEREKKEFØLGE: må lastes FØR js/config.js (config refererer window.NbCatalog).
 * scripts/generate-seo-pages.mjs kjører denne filen i samme vm-sandkasse før
 * config.js — hold den som en ren browser-global uten avhengigheter.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Delt oppsett for Norges Banks REGNET-tabeller (Regionalt nettverk): den
  // fulle tabellen og de seks kuraterte tematabellene ligger alle på samme sted
  // i emnetreet og bruker samme dimensjonsetiketter. Definert her (og ikke
  // inline per rad) fordi de ellers ville vært repetert sju ganger.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Statiske søkeord per flow (holder getAllTables/katalogbyggingen nettverksfri).
  // Tospråklig. Tidligere duplisert i js/sources/norges-bank-adapter.js OG
  // scripts/lib/seo-sources.mjs — nå én kilde her.
  // ---------------------------------------------------------------------------
  const variableNames = {
    EXR: ['Valutakurser', 'Valuta', 'Basisvaluta', 'Kvoteringsvaluta', 'Kurs', 'Exchange rates', 'Currency'],
    IR: ['Styringsrenten', 'Styringsrente', 'Rente', 'Foliorente', 'Reserverente',
      'Døgnlånsrente', 'Policy rate', 'Key policy rate', 'Reserve rate', 'Overnight lending rate'],
    SHORT_RATES: ['NOWA', 'Interbankrente', 'Kortsiktige renter', 'Pengemarkedsrente', 'Rente',
      'Short-term interest rates', 'Interbank rate'],
    GOVT_GENERIC_RATES: ['Statsobligasjonsrenter', 'Statsobligasjon', 'Statsrente', 'Rente', 'Government bond yields'],
    GOVT_ZEROCOUPON: ['Nullkupongrenter', 'Statspapirer', 'Rentekurve', 'Statsobligasjon', 'Statskasseveksel', 'Zero coupon yields', 'Yield curve'],
    SEC: ['Statspapirer', 'Statsobligasjoner', 'Statskasseveksler', 'Kurser', 'Effektiv rente', 'ISIN', 'Government securities', 'Treasury bills'],
    GOVT_KEYFIGURES: ['Statsgjeld', 'Nøkkeltall', 'Utestående volum', 'Opplåning', 'Durasjon', 'Government debt', 'Key figures'],
    GOVT_PRIMARY_MARKET: ['Statspapirer', 'Auksjon', 'Emisjon', 'Førstehåndsmarkedet', 'Statsobligasjoner', 'Primary market', 'Auction'],
    GOVT_SECONDARY_MARKET: ['Statspapirer', 'Annenhåndsmarkedet', 'Omsetning', 'Motpart', 'Secondary market', 'Turnover'],
    GOVT_IRS: ['Rentebytteavtaler', 'Renteswap', 'Statsgjeld', 'Interest rate swaps'],
    LIQUIDITY_STATISTICS: ['Likviditet', 'Likviditetsstatistikk', 'Sentralbankreserver', 'Banksystemet', 'Liquidity statistics', 'Reserves'],
    LIQUIDITY_FORECAST: ['Likviditet', 'Likviditetsprognose', 'Strukturell likviditet', 'Prognose', 'Liquidity forecast', 'Structural liquidity'],
    MONEY_MARKET: ['Pengemarkedet', 'Pengemarkedsdata', 'RPD', 'Usikrede lån', 'Sikrede lån', 'Valutabytteavtaler', 'Money market', 'Repo'],
    FAUCTION: ['F-auksjoner', 'F-lån', 'F-innskudd', 'Auksjon', 'Markedsoperasjoner', 'F-auctions', 'F-loans', 'F-deposits'],
    CBC_TRANSACTIONS: ['Sentralbanksertifikater', 'Sertifikater', 'Transaksjoner', 'Central bank certificates', 'Transactions'],
    SETTLEMENT_STATISTICS: ['Oppgjørsstatistikk', 'Oppgjørssystem', 'NBO', 'Betalingsoppgjør', 'Settlement statistics', 'Payments'],
    FINANCIAL_INDICATORS: ['Finansielle indikatorer', 'FCI', 'Indeks', 'Finansielle forhold', 'Financial indicators', 'Financial conditions index'],
    REGNET: ['Regionalt nettverk', 'Forventninger', 'Produksjon', 'Sysselsetting', 'Bedriftsundersøkelse', 'Regional network', 'Expectations']
  };

  // ---------------------------------------------------------------------------
  // Dataflow-katalog. Kjerneutvalg av Norges Banks dataflows; flere aktiveres ved
  // å legge til rader her (se «Senere» i ROADMAP.md). `flow`/`version` er SDMX-
  // dataflow-id og -versjon; `tableId` er den namnerommede portal-id-en; `path`
  // er emnetre-segmentene: [subjektkode, ...node-id-er] med vilkårlig dybde
  // (subjekt + én eller flere noder i sourceNodes). Alternativt kan en rad angi
  // `paths: [[subjekt, ...noder], ...]` for å plassere tabellen under FLERE
  // emnestier (som SSBs multi-mappe-tabeller). Node-id-er kan være NB-egne
  // leaf-noder ELLER SSB-passthrough-id-er (bf03/renter/nk02/…) som gjør at
  // tabellen merges inn i SSBs egne mapper. Hver node-id må finnes i
  // AppConfig.sourceNodes (js/sources/source-topology.js), og hver subjektkode i
  // subjects.js (subjectNames + en subjectGroups-gruppe) — ellers rendres ikke
  // plasseringen.
  //
  // KURATERINGS-OPSJONER per rad (tolkes av norges-bank-adapter.js):
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
  // NB-tabellen inn i SSBs mappe — se sourceNodes i source-topology.js).
  // Rentetabeller → Pengepolitikk og pengemarked; statspapirer → Statsgjeld og
  // statspapirer; valuta → Valuta (under Finansmarkeder). Se ROADMAP for kartet.
  const dataflows = [
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
  ];

  window.NbCatalog = { dataflows: dataflows, variableNames: variableNames };
})();
