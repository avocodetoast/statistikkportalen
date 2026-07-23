/**
 * Norges Bank source adapter — Statistikkportalen 2.0  (Fase B)
 * ============================================================
 *
 * Implementerer adapterkontrakten i js/sources/source-registry.js for Norges
 * Banks SDMX REST v2.1-API (data.norges-bank.no). Registrerer seg ved å dytte
 * ETT adapterobjekt på window.SourceAdapters (laster FØR source-registry.js).
 *
 * KILDE / SDMX REST
 * -----------------
 * Base-URL og dataflows leses fra AppConfig.sources.nb:
 *   .baseUrl    // 'https://data.norges-bank.no/api'
 *   .enabled    // hopp over registrering hvis false
 *   .dataflows  // [{ flow, version, tableId, path, label:{nb,en},
 *               //    discontinued?, probeKey?, collapseDims?, slice?,
 *               //    timeUnit?, keywords?, description?, dimLabels? }]
 *               // path: [subjekt, ...noder] = én emnetre-plassering med
 *               //   vilkårlig dybde (f.eks. ['bf','bf03','renter','nb-pengepolitikk']
 *               //   der bf03/renter er SSB-passthrough-id-er); alternativt
 *               // paths: [[subjekt, ...noder], …] for flere plasseringer.
 *               // discontinued: true = avsluttet serie (GOVT_IRS).
 *               // probeKey: smal probenøkkel for tunge flows (se probeKeyFor).
 *               // collapseDims: {anchor, dims} = kjennetegns-dimensjoner som
 *               //   er funksjonelt avhengige av ankeret (GOVT_PRIMARY_MARKET:
 *               //   ISIN → MATURITY/COUPON/INSTR) kollapses inn i ankerets
 *               //   verdiliste (se applyCollapseDims). `labelStyle: 'suffix'`
 *               //   setter den kollapsede verdien i parentes bak ankernavnet
 *               //   («Sysselsettingsvekst (Inneværende kvartal)») i stedet for
 *               //   verdipapiretiketten navn–kupong–forfall.
 *               // slice: {DIM: 'kode'|['kode',…]} = kuratert «syntetisk»
 *               //   tabell. FLERE rader kan dele samme `flow` med hvert sitt
 *               //   snitt (REGNET → én tabell per tema). Enkeltkode-snitt
 *               //   PINNER dimensjonen: den fjernes helt fra tabellen, men
 *               //   koden står i API-nøkkelen (applySlice/applyPinnedDims).
 *               // timeUnit/keywords/description/dimLabels: per-tabell
 *               //   overstyringer for flows som er delt av flere rader
 *               //   (frekvensbøtte, søkeord, Tabellinfo-note, dim-etiketter).
 *               // dimOrder: [dimId, …] = kuratert kortrekkefølge når DSD-en
 *               //   er ulogisk (GOVT_SECONDARY_MARKET har ISIN før
 *               //   INSTRUMENT_TYPE). KUN presentasjon: den opprinnelige
 *               //   DSD-rekkefølgen festes i extension.fullDimId, som
 *               //   buildKeyAndParams bygger API-nøkkelen fra. Se orderDims i
 *               //   sdmx-to-jsonstat.js; må sendes til BÅDE
 *               //   structureToMetadata og dataToJsonStat, ellers kommer
 *               //   resultattabellen i en annen rekkefølge enn velgeren.
 *
 *   Datastruktur : GET /datastructure/NB/DSD_{FLOW}?references=codelist&format=sdmx-json
 *   Data         : GET /data/{FLOW}/{key}?format=sdmx-json&locale=no|en[&lastNObservations=|startPeriod=|endPeriod=]
 *
 * Nøkkel = punktseparerte dimensjonskoder i DSD-rekkefølge; '+' for flere verdier
 * i én dimensjon; tom segment = alle verdier. NB: FREQ er IKKE alltid første
 * dimensjon (GOVT_IRS: sist; GOVT_KEYFIGURES/SETTLEMENT_STATISTICS: midt i;
 * FAUCTION mangler FREQ helt) — probene slår opp posisjonen fra serieskeysonly.
 * Tunge flows (MONEY_MARKET m.fl.) angir `probeKey` i config: et smalt
 * nøkkelutsnitt som periode-/tidsprobene bruker i stedet for åpne kall.
 *
 * KATALOG er nettverksfri (bygges fra config); metadata gjør DSD-fetch +
 * TIME_PERIOD-probe; data gjør ett datakall. HTTP 404 (også «traff ingen
 * observasjoner») = TOMT resultat, ikke feil.
 *
 * SPRÅK: locale=no/en. Konvertering SDMX→JSON-Stat2 gjøres av window.SdmxToJsonStat.
 * CACHING: delt CacheManager, nøkkel-infiks 'nb_'/'nb-' (cache.js hopper over
 * SSB-oppdateringsplan-staleness), ren 24 t TTL.
 */
(function () {
  'use strict';

  const logger = window.logger || console;

  const cfg = (window.AppConfig && window.AppConfig.sources && window.AppConfig.sources.nb) || null;
  if (!cfg) {
    logger.warn && logger.warn('[NBAdapter] AppConfig.sources.nb mangler — registrerer ikke.');
    return;
  }
  if (cfg.enabled === false) {
    return; // Kilden er avskrudd i config.
  }
  if (!window.SdmxToJsonStat) {
    logger.error && logger.error('[NBAdapter] window.SdmxToJsonStat ikke lastet — sjekk load-order (sdmx-to-jsonstat.js før denne).');
    return;
  }

  const BASE = (cfg.baseUrl || 'https://data.norges-bank.no/api').replace(/\/+$/, '');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL = (window.AppConfig.cache && window.AppConfig.cache.tableListTTL) || DAY_MS; // 24 t
  const TIME_PROBE_N = 60;

  // Statiske søkeord per flow (holder getAllTables nettverksfri). Tospråklig.
  const VARIABLE_NAMES = {
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

  // Datatorg-beskrivelser per flow (norsk). Emitteres som `note` i metadata slik
  // at Tabellinfo viser dem (jf. table-metadata.js meta.note). Hentet fra Norges
  // Banks egne datasettbeskrivelser.
  const DESCRIPTIONS = {
    EXR: 'Norges Banks valutakurser. Kursene publiseres ca. kl. 16.00.',
    IR: 'Norges Banks styringsrente.',
    SHORT_RATES: 'NOWA – Norwegian Overnight Weighted Average.',
    GOVT_GENERIC_RATES: 'Generisk rente er den effektive renten på et statspapir som er nærmest den oppgitte løpetiden målt fra dagens dato.',
    GOVT_ZEROCOUPON: 'Nullkupongrenter for statspapirer, beregnet med Nelson-Siegel-Svensson-metoden.',
    SEC: 'Daglige kurser og effektive renter for statsobligasjoner og statskasseveksler (per ISIN).',
    GOVT_KEYFIGURES: 'Nøkkeltall for statsgjelden: utestående volum, opplåning, rentebytteavtaler og durasjon per kvartal.',
    GOVT_PRIMARY_MARKET: 'Emisjoner og auksjonsresultater for statsobligasjoner og statskasseveksler i førstehåndsmarkedet.',
    GOVT_SECONDARY_MARKET: 'Omsetning av statspapirer i annenhåndsmarkedet, fordelt på motpartstype og motpartsområde.',
    GOVT_IRS: 'Statens rentebytteavtaler 2005–2014. Ordningen er avsluttet og serien oppdateres ikke lenger.',
    LIQUIDITY_STATISTICS: 'Likviditeten i banksystemet: sentralbankreserver, autonome faktorer og Norges Banks markedsoperasjoner.',
    LIQUIDITY_FORECAST: 'Strukturell og total likviditet i banksystemet – statistikk og Norges Banks prognoser.',
    MONEY_MARKET: 'Pengemarkedsdata rapportert til Norges Bank (RPD): usikrede og sikrede lån og valutabytteavtaler.',
    FAUCTION: 'Kunngjøringer og resultater for Norges Banks F-låns- og F-innskuddsauksjoner.',
    CBC_TRANSACTIONS: 'Transaksjoner i Norges Banks sentralbanksertifikater per ISIN og handledag.',
    SETTLEMENT_STATISTICS: 'Oppgjørsstatistikk fra Norges Banks oppgjørssystem (NBO).',
    FINANCIAL_INDICATORS: 'Finansielle indikatorer (FCI): samleindeks og delindekser for finansielle forhold i Norge.',
    REGNET: 'Regionalt nettverk: indikatorer fra Norges Banks kvartalsvise bedriftsundersøkelse.'
  };

  // Emnesubjektenes sortCode (samsvarer med SSBs egne subjektnoder; kosmetisk
  // siden SSB-tabeller oppretter subjektnodene først). NB-tabellene plasseres nå
  // under flere subjekter (bf/nk/os/ei/ut). '9xx'-nodene sist blant undertemaene.
  const SUBJECT_SORTCODE = {
    bf: '0000006', nk: '0000066', os: '0000076', ei: '0000030', ut: '0000115'
  };

  // ---- Språk-/cache-hjelpere ----

  function apiLang(lang) {
    const l = String(lang || 'no').toLowerCase();
    return l === 'nb' ? 'no' : (l === 'en' ? 'en' : 'no');
  }
  // Delt med fhi-adapter.js — se js/sources/source-common.js.
  const pickLabel = window.SourceCommon.pickLabel;

  let _cache = null;
  function cache() {
    if (_cache) return _cache;
    // Gjenbruk SSBs delte CacheManager om mulig (samme localStorage/IndexedDB).
    const ssbCache = window.SourceRegistry && window.SourceRegistry.ssb &&
      window.SourceRegistry.ssb.instance && window.SourceRegistry.ssb.instance.cache;
    _cache = ssbCache || (typeof window.CacheManager === 'function' ? new window.CacheManager() : null);
    return _cache;
  }
  async function cacheGet(key) {
    const c = cache();
    if (!c) return null;
    try { return await c.get(key); } catch (e) { return null; }
  }
  async function cacheSet(key, value) {
    const c = cache();
    if (!c) return;
    try { await c.set(key, value, TTL); } catch (e) { /* ignorer cache-feil */ }
  }

  // ---- Fetch-hjelpere ----

  /** Hent JSON. Returnerer {status, json}; kaster kun på nettverksfeil. */
  async function fetchSdmx(url) {
    // Format velges via ?format=sdmx-json i URL-en. En spesifikk vnd.sdmx-Accept
    // kolliderer med format-parameteren og gir 406 på strukturendepunktet, så vi
    // holder oss til et generisk Accept.
    // Timeout via AbortSignal slik at et hengende NB-API ikke blokkerer hele
    // app-initialiseringen (katalogaggregeringen venter på alle kilder). Verdien
    // leses fra AppConfig.sources.fetchTimeoutMs med 15 s fallback.
    const timeoutMs = (window.AppConfig && window.AppConfig.sources &&
      window.AppConfig.sources.fetchTimeoutMs) || 15000;
    const res = await window.SourceCommon.fetchWithTimeout(url,
      { headers: { Accept: 'application/json, */*' } },
      { timeoutMs, timeoutErrorPrefix: '[NBAdapter] Tidsavbrudd' });
    if (res.status === 404) return { status: 404, json: null };
    if (!res.ok) {
      // Norges Bank returnerer XML-feil; vi trenger bare statuskoden.
      throw new Error('[NBAdapter] HTTP ' + res.status + ' for ' + url);
    }
    const json = await res.json();
    return { status: res.status, json: json };
  }

  const currentLang = () =>
    (typeof window.getCurrentApiLang === 'function' ? window.getCurrentApiLang() : 'no');

  // ---- Katalog ----

  /** Bygg alle katalog-oppføringer fra config (nettverksfritt). */
  function buildCatalogue(lang) {
    const dataflows = cfg.dataflows || [];
    const nodes = (window.AppConfig && window.AppConfig.sourceNodes) || {};
    const subjectNames = (window.SubjectConfig && window.SubjectConfig.subjectNames) || {};

    const makeSubjectSeg = (subjectId) => ({
      id: subjectId,
      label: pickLabel(subjectNames[subjectId], lang) || subjectId,
      sortCode: SUBJECT_SORTCODE[subjectId] || '0009999'
    });
    const makeNodeSeg = (nodeId) => {
      const node = nodes[nodeId] || {};
      return {
        id: nodeId,
        label: pickLabel(node.label, lang) || nodeId,
        sortCode: node.sortCode || '999'
      };
    };

    return dataflows.map((flow, i) => {
      // En flow kan plasseres flere steder i emnetreet via `paths` (array av
      // plasseringer). Hver plassering er [subjektkode, ...node-id-er] med
      // vilkårlig dybde: subjektet + én eller flere noder (SSB-passthrough-id-er
      // som f.eks. 'bf03'/'renter' + en NB-leaf-node). Legacy-formen `path` gir
      // én plassering. Subjektkoden må finnes i subjects.js og hver node-id i
      // AppConfig.sourceNodes.
      const placements = (Array.isArray(flow.paths) && flow.paths.length)
        ? flow.paths
        : [flow.path];
      const subjectId = placements[0][0];

      return {
        id: flow.tableId,
        label: pickLabel(flow.label, lang) || flow.tableId,
        // Rekkefølge blant tabeller i noden (menu-hierarchy sorterer på table.sortCode).
        sortCode: String(900 + i),
        // NB: 'updated' MÅ være en streng (aldri null) — menu-hierarchy.js
        // _collectAllTables() sorterer via table.updated.localeCompare(...)
        // uten null-guard (samme landmine unngås defensivt i fhi-adapter.js).
        updated: '',
        firstPeriod: '',
        lastPeriod: '',
        // FREQ=B for kjerneutvalget → daglige/virkedagsserier. 'Business' faller i
        // «Andre tabeller»/«Other»-bøtta i frekvensfilteret (ikke Monthly/Quarterly/Annual),
        // som degraderer pent (se browser-state.filterTables/calcFrequencyCounts).
        // Flows med én kjent, grovere frekvens (REGNET: kvartal) kan overstyre
        // via `timeUnit` på config-raden og havner da i riktig frekvensbøtte.
        timeUnit: flow.timeUnit || 'Business',
        // Avsluttede serier (GOVT_IRS) merkes i config-raden og filtreres/
        // merkes i UI-en som SSBs egne avsluttede tabeller.
        discontinued: flow.discontinued === true,
        // Søkeord: per-tabell `keywords` når flere rader deler samme flow
        // (Regionalt nettverk → én rad per tema), ellers flow-ordlista.
        variableNames: (flow.keywords || VARIABLE_NAMES[flow.flow] || []).slice(),
        subjectCode: subjectId,
        paths: placements.map(p => [makeSubjectSeg(p[0]), ...p.slice(1).map(makeNodeSeg)]),
        source: 'Norges Bank'
      };
    });
  }

  async function getTables(options) {
    const opts = options || {};
    // Server-søk / nylig-oppdaterte er SSB-only semantikk.
    if (opts.query || opts.pastDays) return { tables: [] };
    const force = opts.useCache === false;

    const tables = buildCatalogue(currentLang());
    // Fyll Tidsperiode/Sist oppdatert fra ett lite, cachet kall pr. flow (24 t).
    // Feiltolerant: hvis en probe feiler beholdes '' (degradér pent).
    await Promise.all(tables.map(async (entry) => {
      const flow = flowForId(entry.id);
      if (!flow) return;
      try {
        const period = await fetchCataloguePeriod(flow, force);
        if (period) {
          entry.firstPeriod = period.firstPeriod || '';
          entry.lastPeriod = period.lastPeriod || '';
          entry.updated = period.updated || '';
        }
      } catch (e) { /* behold tomme strenger */ }
    }));
    // Katalogen er config-bygget og kan ikke reelt feile — sourceMeta
    // rapporterer derfor alltid ferskt resultat (statuspanelet i
    // source-registry/source-status bruker dette).
    return {
      tables,
      sourceMeta: { fromCache: false, stale: false, fetchedAt: Date.now() }
    };
  }

  // ---- Metadata ----

  /** Finn config-raden for en tabell-id. */
  function flowForId(tableId) {
    return (cfg.dataflows || []).find(f => f.tableId === tableId) || null;
  }

  /**
   * Smal probenøkkel fra config (flow.probeKey) for tunge flows der et åpent
   * probekall er for stort (MONEY_MARKET: 3,5 MB katalogprobe / 15,6 MB
   * tidsprobe uten nøkkel). Streng = samme nøkkel for begge prober;
   * {period, time} = separate nøkler. null = ingen (åpne prober som før).
   * @param {'period'|'time'} kind
   */
  function probeKeyFor(flow, kind) {
    const pk = flow && flow.probeKey;
    if (!pk) return null;
    if (typeof pk === 'string') return pk;
    return pk[kind] || null;
  }

  /**
   * Hent seriedim-navn + TIME_PERIOD-vindu via data-prober.
   *
   * SDMX-tidskoder er FREKVENSSPESIFIKKE (B → '2025-07-15', M → '2025-07',
   * A → '2025'), så tidsvinduet probes pr. frekvens som faktisk har data
   * (freqCodes fra serieskeysonly-proben). Uten freqCodes probes FREQ=B med
   * fallback til /all som før.
   *
   * Returnerer { dimLabels:{id:name}, timeValues:[{id,name}] (union, stigende),
   *              timeLabel, byFreq:{freqCode:[periodekoder]}|null }.
   *
   * freqPos = FREQ-dimensjonens posisjon i serienøkkelen (fra serieskeysonly;
   * -1 = flowen har ingen FREQ-dimensjon, f.eks. FAUCTION). FREQ er IKKE
   * alltid først (GOVT_IRS: sist), så probenøklene bygges posisjonsbevisst.
   * Flows med config-satt `probeKey` probes med den smale nøkkelen i stedet
   * for åpne per-frekvens-nøkler (åpne kall er for tunge for disse).
   */
  async function probeTime(flow, nSeriesDims, locale, freqCodes, freqPos) {
    async function run(key) {
      const url = BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + key +
        '?format=sdmx-json&lastNObservations=' + TIME_PROBE_N + '&locale=' + locale;
      const { status, json } = await fetchSdmx(url);
      if (status === 404 || !json) return null;
      return json;
    }

    /** Trekk ut dim-navn + tidsverdier fra ett datasvar (dedupet, stigende, siste N). */
    function extract(json) {
      const struct = pickStructure(json);
      const dims = struct && struct.dimensions;
      const timeDim = dims && (dims.observation || [])[0];
      if (!timeDim) return null;
      const dimLabels = {};
      (dims.series || []).forEach(d => { dimLabels[d.id] = d.name || d.id; });
      dimLabels[timeDim.id] = timeDim.name || timeDim.id;
      const seen = {};
      (timeDim.values || []).forEach(v => { seen[v.id] = v.name || v.id; });
      const values = Object.keys(seen)
        .sort((a, b) => a.localeCompare(b))
        .slice(-TIME_PROBE_N)
        .map(pid => ({ id: pid, name: seen[pid] }));
      return { dimLabels, timeLabel: timeDim.name || null, values };
    }

    const pos = (typeof freqPos === 'number' && freqPos >= 0) ? freqPos
      : (freqPos === -1 ? -1 : 0); // udefinert (serieskeysonly feilet) → legacy-antakelse posisjon 0
    /** Nøkkel med én frekvenskode på FREQ-posisjonen, resten åpne segmenter. */
    function keyForFreq(f) {
      const segs = new Array(Math.max(1, nSeriesDims)).fill('');
      segs[pos] = f;
      return segs.join('.');
    }

    const result = { dimLabels: {}, timeValues: [], timeLabel: 'Tidsperiode', byFreq: null };
    const freqs = Array.isArray(freqCodes) ? freqCodes.filter(Boolean) : [];

    // Smal config-nøkkel (tunge flows): ett kall, ingen åpne segment-prober.
    // byFreq settes kun når flowen har nøyaktig én frekvens (gjelder alle
    // probeKey-flowene i dag) — uten byFreq beholdes verdiliste-UI-et.
    const timeProbeKey = probeKeyFor(flow, 'time');
    if (timeProbeKey) {
      let json = null;
      try { json = await run(timeProbeKey); } catch (e) { json = null; }
      if (hasObservations(json)) {
        const ex = extract(json);
        if (ex && ex.values.length) {
          result.dimLabels = ex.dimLabels;
          if (ex.timeLabel) result.timeLabel = ex.timeLabel;
          result.timeValues = ex.values;
          if (freqs.length === 1) {
            result.byFreq = {};
            result.byFreq[freqs[0]] = ex.values.map(v => v.id);
          }
          return result;
        }
      }
      // Nøkkelen ga ingenting (endret datastruktur?) — fall gjennom til de
      // generiske probene under i stedet for å gi opp.
    }

    // Frekvensbevisst probing: ett kall pr. faktisk frekvens, parallelt.
    if (freqs.length && pos >= 0) {
      const jsons = await Promise.all(freqs.map(f => run(keyForFreq(f)).catch(() => null)));
      const byFreq = {};
      const union = {};
      jsons.forEach((json, i) => {
        if (!hasObservations(json)) return;
        const ex = extract(json);
        if (!ex || !ex.values.length) return;
        Object.assign(result.dimLabels, ex.dimLabels);
        if (ex.timeLabel && result.timeLabel === 'Tidsperiode') result.timeLabel = ex.timeLabel;
        byFreq[freqs[i]] = ex.values.map(v => v.id);
        ex.values.forEach(v => { union[v.id] = v.name; });
      });
      if (Object.keys(byFreq).length) {
        result.byFreq = byFreq;
        result.timeValues = Object.keys(union)
          .sort((a, b) => a.localeCompare(b))
          .map(pid => ({ id: pid, name: union[pid] }));
        return result;
      }
    }

    // Fallback: nøkkel «B» på FREQ-posisjonen; flows uten FREQ (pos -1) går
    // rett på /all. Siste utvei er alltid /all.
    let json = null;
    if (pos >= 0) {
      try { json = await run(keyForFreq('B')); } catch (e) { json = null; }
    }
    if (!hasObservations(json)) {
      try { json = await run('all'); } catch (e) { json = null; }
    }
    const ex = json ? extract(json) : null;
    if (ex) {
      result.dimLabels = ex.dimLabels;
      if (ex.timeLabel) result.timeLabel = ex.timeLabel;
      result.timeValues = ex.values;
    }
    return result;
  }

  function hasObservations(json) {
    const s = json && json.data && Array.isArray(json.data.dataSets) && json.data.dataSets[0] &&
      json.data.dataSets[0].series;
    return !!(s && Object.keys(s).length > 0);
  }

  /** SDMX-JSON kan ha data.structure (objekt) ELLER data.structures[0] (array). */
  function pickStructure(json) {
    const data = json && json.data;
    if (!data) return null;
    if (data.structure) return data.structure;
    if (Array.isArray(data.structures) && data.structures[0]) return data.structures[0];
    return null;
  }

  /**
   * Hent de FAKTISKE seriene via detail=serieskeysonly (bittelite svar, 3–8 KB).
   * Returnerer { dims:[dimId...], seriesValues:{dimId:[koder...]}, keys:['B.USD.NOK.SP',...] }
   * eller null. Kodebasert (ikke indeksbasert) slik at UI-krysfilteret kan matche
   * direkte mot dimensjonskoder. Cachet 24 t (språkuavhengig — kun koder).
   */
  async function fetchSeriesKeys(flow, locale) {
    // 'serieskeys2': resultatet fikk keyTuples (kodearrayer) — de '.'-joinede
    // nøklene alene er tvetydige når koder selv inneholder punktum
    // (GOVT_PRIMARY_MARKET COUPON «0.00000000»). Locale i både kall og
    // cachenøkkel: proben er også ETIKETTKILDE (valueNames) — DSD-kodelistene
    // har ofte kun engelske navn, mens dataendepunktet lokaliserer.
    const loc = locale || 'no';
    const cacheKey = 'nb-serieskeys2-' + flow.flow + '_' + loc;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const url = BASE + '/data/' + encodeURIComponent(flow.flow) +
      '/?detail=serieskeysonly&format=sdmx-json&locale=' + encodeURIComponent(loc);
    let json = null;
    try {
      const res = await fetchSdmx(url);
      if (res.status === 404 || !res.json) return null;
      json = res.json;
    } catch (e) {
      return null; // Krysfilter er en forbedring, ikke kritisk — degradér stille.
    }

    const struct = pickStructure(json);
    const seriesDims = struct && struct.dimensions && struct.dimensions.series;
    const dataSet = json.data && Array.isArray(json.data.dataSets) ? json.data.dataSets[0] : null;
    if (!Array.isArray(seriesDims) || !dataSet || !dataSet.series) return null;

    const dims = seriesDims.map(d => d.id);
    const valueCodes = seriesDims.map(d => (d.values || []).map(v => v.id));
    const seriesValues = {};
    dims.forEach((id, i) => { seriesValues[id] = valueCodes[i]; });

    // Lokaliserte verdinavn per dim (kun der navnet er noe annet enn koden).
    const valueNames = {};
    seriesDims.forEach(d => {
      const map = {};
      (d.values || []).forEach(v => {
        if (typeof v.name === 'string' && v.name && v.name !== v.id) map[v.id] = v.name;
      });
      if (Object.keys(map).length) valueNames[d.id] = map;
    });

    const keyTuples = Object.keys(dataSet.series).map(k => {
      const idx = k.split(':').map(Number);
      return idx.map((n, i) => (valueCodes[i] ? valueCodes[i][n] : undefined));
    });
    const keys = keyTuples.map(t => t.join('.'));

    const result = { dims, seriesValues, keys, keyTuples, valueNames };
    await cacheSet(cacheKey, result);
    return result;
  }

  /** Trekk ut årstallet (første 4 sifre) fra en SDMX-periodekode; NaN hvis ukjent. */
  function periodYear(code) {
    const m = String(code || '').match(/\d{4}/);
    return m ? parseInt(m[0], 10) : NaN;
  }

  /**
   * Katalog-tidsvindu + sist oppdatert for en flow via ETT kombinert kall
   * (firstNObservations=1&lastNObservations=1 → union av første og siste obs pr.
   * serie). Returnerer { firstPeriod, lastPeriod, updated } (år-strenger + ISO-dato)
   * eller null. Cachet 24 t (språkuavhengig). Kalles fra getTables (hver app-init)
   * — derfor cachet og feiltolerant.
   */
  async function fetchCataloguePeriod(flow, force) {
    // Probenøkkelen er en del av cachenøkkelen: flere config-rader kan dele
    // samme flow med hvert sitt snitt (REGNET), og de har ulik historikk.
    const periodKey = probeKeyFor(flow, 'period') || '';
    // v2 = firstCode/lastCode i tillegg til årstallene.
    const cacheKey = 'nb-catperiod-v2-' + flow.flow + (periodKey ? '_' + periodKey : '');
    if (!force) {
      const cached = await cacheGet(cacheKey);
      if (cached) return cached;
    }

    // Tunge flows probes med den smale config-nøkkelen (se probeKeyFor) —
    // first/lastPeriod blir da utsnittets vindu, som i praksis dekker flowens
    // (utsnittene er valgt for å spenne hele historikken). For snittede rader
    // (`slice`) er det nettopp snittets vindu vi ønsker.
    const url = BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + periodKey +
      '?format=sdmx-json&firstNObservations=1&lastNObservations=1';
    let json = null;
    try {
      const res = await fetchSdmx(url);
      if (res.status === 404 || !res.json) return null;
      json = res.json;
    } catch (e) {
      return null;
    }

    const struct = pickStructure(json);
    const obsDim = struct && struct.dimensions && Array.isArray(struct.dimensions.observation)
      ? struct.dimensions.observation[0] : null;
    const values = (obsDim && obsDim.values) ? obsDim.values.map(v => v.id) : [];
    if (values.length === 0) return null;

    let minY = Infinity, maxY = -Infinity;
    values.forEach(code => {
      const y = periodYear(code);
      if (!isNaN(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    });
    if (!isFinite(minY) || !isFinite(maxY)) return null;

    // firstCode/lastCode: de EKSAKTE ytterperiodene (proben henter nettopp
    // første og siste observasjon). Tidsvelgeren forhåndsutfyller fra–til med
    // dem; årstallene alene ville gitt «1. januar» og «31. desember» — en
    // startdato før første observasjon og en sluttdato ut i framtiden.
    const sorted = values.slice().sort();
    const result = {
      firstPeriod: String(minY),
      lastPeriod: String(maxY),
      firstCode: sorted[0],
      lastCode: sorted[sorted.length - 1],
      updated: (json.meta && json.meta.prepared) || ''
    };
    await cacheSet(cacheKey, result);
    return result;
  }

  /**
   * Snitt en serieskeys-probe ned til et kuratert utsnitt (flow.slice).
   *
   * `slice` er {DIM: 'kode'} eller {DIM: ['kode', ...]}: tuplene filtreres til
   * seriene som matcher ALLE oppgitte dimensjoner, og seriesValues/keys bygges
   * på nytt fra dem. Fordi structureToMetadata allerede begrenser verdilistene
   * til seriesValues, arver hele metadataveien (verdilister, validKeys,
   * unfilterableDims, collapseDims) snittet gratis.
   *
   * Dimensjoner som er nevnt i snittet OG ender med nøyaktig én kode regnes som
   * PINNET: de fjernes senere helt fra tabellen (applyPinnedDims), men koden
   * legges inn i API-nøkkelen. Dimensjoner som tilfeldigvis har én verdi uten å
   * stå i snittet (typisk FREQ) pinnes ikke — de trengs videre i UI-en.
   *
   * Degraderer stille (uendret probe, ingen pinning) uten tupler, ved ukjente
   * dimensjonsnavn eller hvis snittet ikke treffer noen serier — en configfeil
   * skal gi den gamle, fulle tabellen, ikke en tom.
   *
   * @returns {{seriesKeys: object, pinned: object|null}}
   */
  function applySlice(seriesKeys, slice) {
    if (!seriesKeys || !slice) return { seriesKeys: seriesKeys, pinned: null };
    const dims = seriesKeys.dims || [];
    const tuples = Array.isArray(seriesKeys.keyTuples) ? seriesKeys.keyTuples : null;
    if (!tuples || !tuples.length) return { seriesKeys: seriesKeys, pinned: null };

    const spec = [];
    Object.keys(slice).forEach(dimId => {
      const pos = dims.indexOf(dimId);
      if (pos < 0) {
        logger.warn && logger.warn('[NBAdapter] slice: ukjent dimensjon ' + dimId + ' — ignorert');
        return;
      }
      const codes = Array.isArray(slice[dimId]) ? slice[dimId].slice() : [slice[dimId]];
      spec.push({ dimId: dimId, pos: pos, codes: codes });
    });
    if (!spec.length) return { seriesKeys: seriesKeys, pinned: null };

    const keptTuples = tuples.filter(t =>
      spec.every(s => s.codes.indexOf(t[s.pos]) !== -1));
    if (!keptTuples.length) {
      logger.warn && logger.warn('[NBAdapter] slice ga null serier — snittet ignoreres');
      return { seriesKeys: seriesKeys, pinned: null };
    }

    // Verdilistene rebygges fra de gjenværende tuplene (bevarer probens
    // rekkefølge, som structureToMetadata uansett omordner etter kodelista).
    const seriesValues = {};
    dims.forEach((id, i) => {
      const seen = [];
      keptTuples.forEach(t => { if (seen.indexOf(t[i]) === -1) seen.push(t[i]); });
      seriesValues[id] = seen;
    });

    const pinned = {};
    spec.forEach(s => {
      const vals = seriesValues[s.dimId];
      if (vals && vals.length === 1) pinned[s.dimId] = vals[0];
    });

    return {
      seriesKeys: {
        dims: dims.slice(),
        seriesValues: seriesValues,
        keyTuples: keptTuples,
        keys: keptTuples.map(t => t.join('.')),
        valueNames: seriesKeys.valueNames
      },
      pinned: Object.keys(pinned).length ? pinned : null
    };
  }

  /**
   * Full dimensjonsrekkefølge (alle DSD-dims inkl. tid) festet på metadata før
   * første splice. buildKeyAndParams trenger den for å emittere ett segment per
   * DSD-dimensjon også etter at kollapsede/pinnede dims er fjernet fra meta.id.
   */
  function ensureFullDimId(meta) {
    meta.extension = meta.extension || {};
    if (!Array.isArray(meta.extension.fullDimId)) {
      meta.extension.fullDimId = meta.id.slice();
    }
    return meta.extension.fullDimId;
  }

  /**
   * Fjern dimensjoner fra metadataobjektet (id/size/dimension/px.heading).
   * Delt av kollaps og pinning. Returnerer den fulle dimensjonsrekkefølgen fra
   * FØR noen splice (se ensureFullDimId).
   */
  function spliceDimsOut(meta, dimIds) {
    const fullId = ensureFullDimId(meta);
    const drop = {};
    dimIds.forEach(d => { drop[d] = true; });
    const before = meta.id.slice();
    const keepIdx = [];
    before.forEach((d, i) => { if (!drop[d]) keepIdx.push(i); });
    meta.id = keepIdx.map(i => before[i]);
    meta.size = keepIdx.map(i => meta.size[i]);
    dimIds.forEach(d => { delete meta.dimension[d]; });
    if (meta.extension && meta.extension.px && Array.isArray(meta.extension.px.heading)) {
      meta.extension.px.heading = meta.extension.px.heading.filter(d => !drop[d]);
    }
    return fullId;
  }

  /**
   * Rebygg validKeys fra serietuplene med kun de dimensjonene som fortsatt står
   * i tabellen. Tuppelbasert (ikke splitting av de '.'-joinede nøklene) fordi
   * koder selv kan inneholde punktum (GOVT_PRIMARY_MARKET COUPON «0.00000000»).
   */
  function rebuildValidKeys(meta, seriesKeys, dropDims) {
    if (!seriesKeys || !Array.isArray(seriesKeys.keyTuples)) return;
    const dims = seriesKeys.dims || [];
    const drop = {};
    (dropDims || []).forEach(d => { drop[d] = true; });
    const remainingDims = dims.filter(d => !drop[d]);
    const remainingPos = remainingDims.map(d => dims.indexOf(d));
    const seen = {};
    const keys = [];
    seriesKeys.keyTuples.forEach(tuple => {
      const k = remainingPos.map(p => tuple[p]).join('.');
      if (!seen[k]) { seen[k] = true; keys.push(k); }
    });
    meta.extension = meta.extension || {};
    meta.extension.validKeys = { dims: remainingDims, keys: keys };
  }

  /**
   * Fjern dimensjoner som er ren duplikat-identitet (flow.dropDims) helt ut av
   * tabellen. I motsetning til kollaps (applyCollapseDims) er det ingen
   * informasjon å berge inn i en ankeretikett, og i motsetning til pinning
   * (applyPinnedDims) er det ingen fast kode å sette i nøkkelen: segmentet står
   * tomt, altså «alle verdier».
   *
   * FAUCTION.AUCTION_ID er tilfellet dette finnes for: budfristen
   * (TIME_PERIOD, et tidsstempel ned til sekundet) identifiserer auksjonen
   * alene, mens auksjonsid-en tvang brukeren til å velge blant 1509 ugjennom-
   * trengelige idnumre. Forutsetningen — at de gjenværende dimensjonene pluss
   * tid er unike — kan IKKE verifiseres fra serienøklene (den hviler på tiden,
   * som ikke er en del av dem), så den må verifiseres mot data når en ny rad tar
   * opsjonen i bruk. Kolliderende serier havner i samme celle, og den siste
   * vinner.
   */
  function applyDropDims(meta, flow, seriesKeys) {
    const cfg = Array.isArray(flow.dropDims) ? flow.dropDims : null;
    if (!cfg || !cfg.length) return;
    const dimIds = cfg.filter(d => meta.dimension[d]);
    if (!dimIds.length) return;

    spliceDimsOut(meta, dimIds);

    // validKeys rebygges uten de droppede OG de allerede kollapsede/pinnede
    // dimene — ellers kryssfiltrerer UI-en mot segmenter som ikke finnes lenger.
    const collapsed = (meta.extension && meta.extension.collapsedDims) || null;
    const pinnedBy = (meta.extension && meta.extension.pinnedDims &&
      meta.extension.pinnedDims.byDim) || null;
    rebuildValidKeys(meta, seriesKeys, dimIds
      .concat(collapsed ? collapsed.dims : [])
      .concat(pinnedBy ? Object.keys(pinnedBy) : []));

    if (Array.isArray(meta.extension.unfilterableDims)) {
      const rest = meta.extension.unfilterableDims.filter(d => dimIds.indexOf(d) === -1);
      if (rest.length) meta.extension.unfilterableDims = rest;
      else delete meta.extension.unfilterableDims;
    }

    meta.extension.droppedDims = dimIds;
  }

  /**
   * Sorter verdilista til utvalgte dimensjoner på kode (flow.dimSort).
   * Norges Banks ukodede dimensjoner (FORECAST_DATE, LIQUIDITY_DETAILS) kommer
   * i tilfeldig rekkefølge fra API-et, som gir en uleselig verdiliste.
   *
   * UI-ets verdiliste (renderValueList) følger `category.label` sin
   * INNSETTINGSREKKEFØLGE, ikke index — begge bygges derfor om.
   */
  function applyDimSort(meta, flow) {
    const cfg = flow.dimSort;
    if (!cfg) return;
    Object.keys(cfg).forEach(dimId => {
      const dim = meta.dimension[dimId];
      if (!dim || !dim.category || !dim.category.index) return;
      const desc = String(cfg[dimId]).toLowerCase() === 'desc';
      const oldLabel = dim.category.label || {};
      const codes = Object.keys(dim.category.index).sort((a, b) => {
        const cmp = a < b ? -1 : (a > b ? 1 : 0);
        return desc ? -cmp : cmp;
      });
      const index = {};
      const label = {};
      codes.forEach((code, i) => {
        index[code] = i;
        label[code] = oldLabel[code] !== undefined ? oldLabel[code] : code;
      });
      dim.category.index = index;
      dim.category.label = label;
    });
  }

  /**
   * Fjern pinnede dimensjoner (fra flow.slice, se applySlice) helt ut av
   * tabellen: de har nøyaktig én gyldig kode, så et eget kort ville bare vært
   * støy — poenget med de kuraterte tabellene er at velgeren kun viser det som
   * faktisk varierer. Koden bæres videre i meta.extension.pinnedDims og settes
   * inn i API-nøkkelen av buildKeyAndParams, slik at API-byggerens URL
   * reproduserer nøyaktig det tabellen viser.
   */
  function applyPinnedDims(meta, pinned, seriesKeys) {
    if (!pinned) return;
    const dimIds = Object.keys(pinned).filter(d => meta.dimension[d]);
    if (!dimIds.length) return;

    const fullId = spliceDimsOut(meta, dimIds);

    // validKeys rebygges uten de pinnede OG de allerede kollapsede dimene.
    const collapsed = (meta.extension && meta.extension.collapsedDims) || null;
    rebuildValidKeys(meta, seriesKeys, dimIds.concat(collapsed ? collapsed.dims : []));

    if (Array.isArray(meta.extension.unfilterableDims)) {
      const rest = meta.extension.unfilterableDims.filter(d => dimIds.indexOf(d) === -1);
      if (rest.length) meta.extension.unfilterableDims = rest;
      else delete meta.extension.unfilterableDims;
    }

    const byDim = {};
    dimIds.forEach(d => { byDim[d] = pinned[d]; });
    meta.extension.pinnedDims = { byDim: byDim, fullId: fullId };
  }

  /**
   * Snittets kodebegrensning for de dimensjonene som fortsatt VISES (flerkode-
   * snitt). Nødvendig fordi «Velg alle» i UI-en gir utvalget '*', som ellers
   * blir et tomt nøkkelsegment = alle verdier i HELE flowen — uttaket ville da
   * sprengt ut over tabellens tema. buildKeyAndParams faller tilbake på disse
   * kodene når brukeren ikke har snevret inn selv.
   */
  function applySliceBounds(meta, slice, pinned) {
    if (!slice) return;
    const bounds = {};
    Object.keys(slice).forEach(dimId => {
      if (pinned && pinned[dimId] !== undefined) return; // pinnet — dekkes av pinnedDims
      if (!meta.dimension[dimId]) return;                // kollapset bort e.l.
      const codes = Array.isArray(slice[dimId]) ? slice[dimId].slice() : [slice[dimId]];
      if (codes.length) bounds[dimId] = codes;
    });
    if (Object.keys(bounds).length) {
      meta.extension = meta.extension || {};
      meta.extension.sliceDims = bounds;
    }
  }

  /**
   * Kollaps kjennetegns-dimensjoner (flow.collapseDims = {anchor, dims}) ut av
   * metadataobjektet: dimensjoner som er funksjonelt avhengige av ankeret
   * (GOVT_PRIMARY_MARKET: ISIN → MATURITY/COUPON/INSTR) er kjennetegn ved
   * verdipapiret, ikke selvstendige filtre — som egne kort tvinger de brukeren
   * til å velge samme papir flere ganger mens kryssfilteret gråer ut resten.
   *
   * Fjerner dimene fra meta.id/size/dimension/px.heading, beriker og sorterer
   * ankeretikettene (navn – kupong – forfall, synkende på forfall; eller
   * «anker (kollapset verdi)» med cfg.labelStyle === 'suffix'), rebygger
   * validKeys fra tuplene uten de kollapsede dimene, og registrerer
   * meta.extension.collapsedDims = {anchor, dims, fullId, byAnchor} som
   * buildKeyAndParams/getTableData trenger for å wildcarde og kollapse dem i
   * dataveien. Degraderer stille (ingen kollaps) uten serieskeys-tupler.
   */
  function applyCollapseDims(meta, flow, seriesKeys, locale) {
    const cfg = flow.collapseDims;
    if (!cfg || !cfg.anchor || !Array.isArray(cfg.dims) || !cfg.dims.length) return;
    if (!seriesKeys || !Array.isArray(seriesKeys.keyTuples) || !seriesKeys.keyTuples.length) return;
    const dims = seriesKeys.dims || [];
    const anchorPos = dims.indexOf(cfg.anchor);
    if (anchorPos < 0 || !meta.dimension[cfg.anchor]) return;
    const collapsePos = cfg.dims.map(d => dims.indexOf(d));
    if (collapsePos.some(p => p < 0)) return; // ukjent dim i config → ikke kollaps

    // Kjennetegn per ankerkode fra serietuplene. Kollapsen forutsetter at
    // ankeret BESTEMMER kjennetegnene; er avhengigheten ikke funksjonell ville
    // flere serier ha kollidert i samme celle og halve uttaket forsvunnet
    // stilltiende. Verifiser i stedet, og la dimensjonene stå ved avvik.
    const byAnchor = {};
    let functional = true;
    seriesKeys.keyTuples.forEach(tuple => {
      const a = tuple[anchorPos];
      if (a === undefined) return;
      const info = {};
      cfg.dims.forEach((d, i) => { info[d] = tuple[collapsePos[i]]; });
      if (!byAnchor[a]) { byAnchor[a] = info; return; }
      if (cfg.dims.some(d => byAnchor[a][d] !== info[d])) functional = false;
    });
    if (!functional) {
      logger.warn && logger.warn('[NBAdapter] collapseDims for ' + flow.tableId +
        ': ' + cfg.anchor + ' bestemmer ikke ' + cfg.dims.join('/') +
        ' — kollapsen droppes for å ikke miste serier.');
      return;
    }

    // Sortér ankeret på forfall synkende (lengst løpetid først); koder uten
    // forfall sist, alfabetisk. ISO-datoer sorterer leksikografisk.
    const anchorCat = meta.dimension[cfg.anchor].category;
    let codes = Object.keys(anchorCat.index)
      .sort((a, b) => anchorCat.index[a] - anchorCat.index[b]);
    if (cfg.dims.indexOf('MATURITY') !== -1) {
      codes = codes.slice().sort((a, b) => {
        const ma = (byAnchor[a] && byAnchor[a].MATURITY) || '';
        const mb = (byAnchor[b] && byAnchor[b].MATURITY) || '';
        if (ma !== mb) return mb < ma ? -1 : 1; // synkende; tom sist
        return a < b ? -1 : (a > b ? 1 : 0);
      });
    }

    // Verdietikettene til de kollapsede dimene må leses FØR de spleises ut.
    const collapsedValueLabels = {};
    cfg.dims.forEach(d => {
      const cat = meta.dimension[d] && meta.dimension[d].category;
      collapsedValueLabels[d] = (cat && cat.label) || {};
    });

    // Berik ankeretikettene og bygg index OG label på nytt i sortert
    // rekkefølge — verdilista i UI-en (renderValueList) følger labels
    // INNSETTINGSREKKEFØLGE, ikke index.
    //
    // Tre stiler:
    //   'security' (standard) — verdipapiretikett «navn – kupong – forfall».
    //   'suffix' — den kollapsede verdien i parentes bak ankernavnet:
    //     «Sysselsettingsvekst (Inneværende kvartal)». Uten dette forsvinner
    //     informasjonen helt: to indikatorer som bare skiller seg på horisont
    //     ville sett ut som samme størrelse målt på ulikt vis. SDMX-
    //     plassholdere (_X/_Z = Unspecified/Not Applicable) hoppes over — de
    //     betyr «gjelder ikke» og er ikke en opplysning å vise fram.
    //   'prefix' — FØRSTE kollapsede dimensjon foran ankernavnet, resten i
    //     parentes bak: «Banksystemets likviditet – Statens konti (Akkumulert
    //     likviditetsvirkning fra 1. januar)». For nestede kategorihierarkier
    //     (LIQUIDITY_MAIN → LIQUIDITY_DETAILS), der gruppen må stå først for at
    //     en sortert liste skal lese seg som en gruppert tabell, mens
    //     kjennetegn som måleenhet hører hjemme bak navnet. Rekkefølgen i
    //     cfg.dims bestemmer hva som blir prefiks.
    const style = cfg.labelStyle || 'security';
    const newIndex = {};
    const newLabel = {};
    codes.forEach((code, i) => {
      const info = byAnchor[code] || {};
      const clName = anchorCat.label[code];
      newIndex[code] = i;
      if (style === 'suffix' || style === 'prefix') {
        const base = (clName && clName !== code) ? clName : code;
        const labelFor = d => collapsedValueLabels[d][info[d]] || info[d];
        const shown = cfg.dims.filter(d => info[d] && !/^_[A-Z]$/.test(String(info[d])));
        if (!shown.length) { newLabel[code] = base; return; }
        if (style === 'suffix') {
          newLabel[code] = base + ' (' + shown.map(labelFor).join(', ') + ')';
          return;
        }
        // prefix: første dim foran, eventuelle øvrige i parentes bak.
        const lead = shown[0] === cfg.dims[0] ? labelFor(shown.shift()) + ' – ' : '';
        newLabel[code] = lead + base +
          (shown.length ? ' (' + shown.map(labelFor).join(', ') + ')' : '');
        return;
      }
      newLabel[code] = window.SdmxToJsonStat.formatSecurityLabel({
        name: (clName && clName !== code) ? clName : (info.INSTR || ''),
        maturity: info.MATURITY,
        coupon: info.COUPON,
        fallback: code
      }, locale);
    });
    anchorCat.index = newIndex;
    anchorCat.label = newLabel;

    // Splice de kollapsede dimene ut av metadataobjektet.
    const collapseSet = {};
    cfg.dims.forEach(d => { collapseSet[d] = true; });
    const fullId = spliceDimsOut(meta, cfg.dims);

    // Rebygg validKeys fra tuplene: kun gjenværende dims, dedupet. ('.'-join er
    // trygg igjen — de punktum-/skråstrek-holdige kjennetegnskodene er borte.)
    rebuildValidKeys(meta, seriesKeys, cfg.dims);

    // Kollapsede dims trenger ikke (og kan ikke) stå i unfilterableDims —
    // buildKeyAndParams wildcader dem via collapsedDims i stedet.
    if (Array.isArray(meta.extension.unfilterableDims)) {
      const rest = meta.extension.unfilterableDims.filter(d => !collapseSet[d]);
      if (rest.length) meta.extension.unfilterableDims = rest;
      else delete meta.extension.unfilterableDims;
    }

    meta.extension.collapsedDims = {
      anchor: cfg.anchor,
      dims: cfg.dims.slice(),
      fullId: fullId,
      byAnchor: byAnchor
    };
  }

  async function getTableMetadata(tableId, useCache, lang) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const locale = apiLang(lang || currentLang());
    // 'v10' = dropDims/dimSort/intervalPicker uten FREQ + eksakte timeBounds
    // (firstCode/lastCode) (v9: dimOrder — permutert meta.id + fullDimId satt
    // uten splice; v8: collapseDims.labelStyle:'suffix'; v7: sliceDims; v6:
    // slice/pinnedDims + fullDimId; v5: lokaliserte
    // verdinavn fra serieskeys-proben; v4: collapsedDims + configetikett-
    // tittel; v3: intervalPicker/timeBounds; v2: timePeriodsByFreq +
    // singleSelect) — ny nøkkel så gamle cacheoppføringer ikke serveres i 24 t.
    const cacheKey = 'table_' + tableId + '_meta_v10_' + locale;

    if (useCache !== false) {
      const cached = await cacheGet(cacheKey);
      if (cached) return cached;
    }

    // 1) DSD + kodelister.
    const dsdUrl = BASE + '/datastructure/NB/DSD_' + encodeURIComponent(flow.flow) +
      '?references=codelist&format=sdmx-json';
    const dsdRes = await fetchSdmx(dsdUrl);
    if (dsdRes.status === 404 || !dsdRes.json) {
      throw new Error('[NBAdapter] Fant ikke datastruktur DSD_' + flow.flow);
    }
    const dsd = dsdRes.json.data && dsdRes.json.data.dataStructures &&
      dsdRes.json.data.dataStructures[0];
    const nSeriesDims = dsd && dsd.dataStructureComponents &&
      dsd.dataStructureComponents.dimensionList &&
      (dsd.dataStructureComponents.dimensionList.dimensions || []).length || 0;

    // 2) serieskeysonly-probe FØRST (de faktiske frekvensene styrer tidsprobene),
    //    deretter TIME_PERIOD-probe pr. frekvens (tidskodene er frekvensspesifikke:
    //    B → '2025-07-15', M → '2025-07', A → '2025').
    // Snittet (flow.slice) legges på proben FØR alt annet: verdilister,
    // validKeys, unfilterableDims og collapseDims utledes alle av den, og
    // arver dermed snittet uten egen logikk hvert sted.
    const sliced = applySlice(await fetchSeriesKeys(flow, locale), flow.slice);
    const seriesKeys = sliced.seriesKeys;
    const pinned = sliced.pinned;
    const freqCodes = (seriesKeys && seriesKeys.seriesValues && seriesKeys.seriesValues.FREQ) || null;
    // FREQ-posisjonen i serienøkkelen (IKKE alltid 0 — se filhodet); -1 = flow
    // uten FREQ (FAUCTION); undefined = serieskeysonly feilet (legacy-antakelse 0).
    const freqPos = (seriesKeys && Array.isArray(seriesKeys.dims))
      ? seriesKeys.dims.indexOf('FREQ') : undefined;
    const probe = await probeTime(flow, nSeriesDims, locale, freqCodes, freqPos);

    // Kuraterte dimensjonsnavn fra config-raden vinner over API-navnet: i en
    // snittet tabell heter «Regionalt nettverk tema» heller «Indikator».
    const dimLabels = Object.assign({}, probe.dimLabels);
    Object.keys(flow.dimLabels || {}).forEach(dimId => {
      const label = pickLabel(flow.dimLabels[dimId], locale);
      if (label) dimLabels[dimId] = label;
    });

    const meta = window.SdmxToJsonStat.structureToMetadata(dsdRes.json, flow, {
      lang: locale,
      source: 'Norges Bank',
      updated: (dsdRes.json.meta && dsdRes.json.meta.prepared) || null,
      dimLabels: dimLabels,
      timeValues: probe.timeValues,
      timeLabel: probe.timeLabel,
      // Begrens kategoriene til verdier som faktisk finnes i ekte serier.
      seriesValues: seriesKeys ? seriesKeys.seriesValues : null,
      // Lokaliserte verdinavn fra proben — DSD-kodelistene er ofte engelsk-only.
      valueNames: (seriesKeys && seriesKeys.valueNames) || null,
      // Kuratert kortrekkefølge; DSD-rekkefølgen bevares i extension.fullDimId
      // så API-nøkkelen er uendret (se orderDims i sdmx-to-jsonstat.js).
      dimOrder: flow.dimOrder || null
    });

    // Gyldige dimensjonskombinasjoner for generisk krysfiltrering i UI-en
    // (variable-select). dims i serieskeysonly-rekkefølge; keys kodebasert.
    if (seriesKeys && Array.isArray(seriesKeys.keys) && seriesKeys.keys.length) {
      meta.extension = meta.extension || {};
      meta.extension.validKeys = { dims: seriesKeys.dims, keys: seriesKeys.keys };
    }

    // Dimensjoner der faktiske koder inneholder punktum eller skråstrek kan
    // ikke filtreres via nøkkelstien: punktum kolliderer med segmentskilletegnet
    // (GOVT_PRIMARY_MARKET COUPON «0.00000000»), og Tomcat avviser kodet
    // skråstrek med 400 (INSTR «NTB 03/2004») — begge verifisert live. Slike
    // dimensjoner får alltid tomt nøkkelsegment og filtreres i stedet
    // klientside etter henting (se buildKeyAndParams/getTableData).
    if (seriesKeys && seriesKeys.seriesValues) {
      const unfilterable = seriesKeys.dims.filter(dimId =>
        (seriesKeys.seriesValues[dimId] || []).some(c => /[./]/.test(String(c))));
      if (unfilterable.length) {
        meta.extension = meta.extension || {};
        meta.extension.unfilterableDims = unfilterable;
      }
    }

    // Kjennetegns-kollaps (flow.collapseDims) — etter validKeys/unfilterable
    // (begge rebygges/renskes her), før timePeriodsByFreq (uavhengig av
    // kollapsede dims).
    applyCollapseDims(meta, flow, seriesKeys, locale);

    // Pinnede snitt-dimensjoner fjernes til slutt (etter kollapsen, som selv
    // rebygger validKeys) — meta.extension.fullDimId bevarer DSD-rekkefølgen
    // begge trenger for nøkkelbyggingen.
    applyPinnedDims(meta, pinned, seriesKeys);
    applySliceBounds(meta, flow.slice, pinned);

    // Duplikat-identitetsdimensjoner (flow.dropDims) fjernes helt — etter
    // kollaps og pinning, som begge rebygger validKeys.
    applyDropDims(meta, flow, seriesKeys);

    // Dimensjoner som står igjen med nøyaktig én gyldig verdi (typisk FREQ i en
    // snittet tabell) er reelle, men uinteressante valg: UI-en velger dem
    // automatisk og skjuler kortet bak en «Automatisk valgt»-linje. Settes kun
    // for snittede tabeller, så øvrige NB-tabeller er uendret.
    if (flow.slice) {
      const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
      const single = meta.id.filter(d => d !== timeId && meta.dimension[d] &&
        Object.keys(meta.dimension[d].category.index || {}).length === 1);
      if (single.length) meta.extension.autoHiddenDims = single;
    }

    // Frekvens → tilgjengelige tidsperioder, for frekvensbevisst tidsliste i
    // UI-en (variable-select applyTimeFreqFilter): daglige datoer gir aldri
    // treff for FREQ=A/M, så tidslisten må følge valgt frekvens.
    if (probe.byFreq && meta.id.includes('FREQ')) {
      const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
      meta.extension = meta.extension || {};
      meta.extension.timePeriodsByFreq = { freqDim: 'FREQ', timeDim: timeId, byFreq: probe.byFreq };
    }

    // Intervallbasert tidsvelger (variable-select renderTimePickerCard):
    // SDMX-API-et er intervallbasert (startPeriod/endPeriod/lastNObservations),
    // så tidsdimensjonen får en fra–til/Siste N/alt-velger i stedet for
    // verdilisten (som uansett bare dekker de siste TIME_PROBE_N probede
    // periodene). Settes når frekvenskartet finnes (granulariteten følger da
    // valgt FREQ), ELLER når config-raden oppgir granulariteten selv
    // (`intervalPicker: {granularity}`) — nødvendig for flows uten FREQ-
    // dimensjon, som FAUCTION.
    // timeBounds gir min/max og forhåndsutfylling av fra/til-inputene:
    // firstCode/lastCode er de eksakte ytterperiodene fra katalogproben,
    // firstPeriod/lastPeriod årstallene deres. Feiltolerant — velgeren virker
    // uten grenser.
    const pickerGran = flow.intervalPicker && flow.intervalPicker.granularity;
    if (meta.extension && (meta.extension.timePeriodsByFreq || pickerGran)) {
      const timeId = (meta.extension.timePeriodsByFreq &&
        meta.extension.timePeriodsByFreq.timeDim) ||
        (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
      if (meta.dimension[timeId]) {
        const timeExt = meta.dimension[timeId].extension =
          meta.dimension[timeId].extension || {};
        timeExt.intervalPicker = true;
        if (pickerGran) timeExt.pickerGran = pickerGran;
        try {
          const period = await fetchCataloguePeriod(flow);
          if (period) {
            timeExt.timeBounds = {
              firstPeriod: period.firstPeriod || '',
              lastPeriod: period.lastPeriod || '',
              firstCode: period.firstCode || '',
              lastCode: period.lastCode || ''
            };
          }
        } catch (e) { /* uten grenser — velgeren degraderer pent */ }
      }
    }

    // FREQ er gjensidig utelukkende: SDMX-nøkkelen støtter riktignok 'A+M',
    // men periodene aligner aldri på tvers av frekvenser (2024 vs 2024-06 vs
    // 2024-06-28), så en kombinert tabell blir en nesten tom kryssmatrise —
    // og startPeriod/endPeriod kan ikke uttrykkes i én granularitet. UI-en
    // (variable-select) håndhever radio-adferd for singleSelect-dimensjoner.
    if (meta.dimension.FREQ) {
      meta.dimension.FREQ.extension = meta.dimension.FREQ.extension || {};
      meta.dimension.FREQ.extension.singleSelect = true;
    }

    // Sortering av verdilister (flow.dimSort) helt til slutt: kollaps og
    // pinning bygger selv om index/label, og ville ellers overstyrt sorteringen.
    applyDimSort(meta, flow);

    // Datatorg-beskrivelse → Tabellinfo (meta.note er en streng-array).
    // Per-tabell `description` når flere rader deler samme flow.
    const description = flow.description || DESCRIPTIONS[flow.flow];
    if (description) {
      meta.note = [description];
    }

    await cacheSet(cacheKey, meta);
    return meta;
  }

  // ---- Data ----

  /**
   * Oversett appens utvalg {DimCode: [koder]|'*'|'top(N)'|'range(a,b)'} til
   * SDMX-nøkkel + params. Ikke-tidsdimensjoner → nøkkelsegmenter (koder join
   * '+', '*'/mangler → tomt). TIME_PERIOD: 'top(N)' → lastNObservations=N;
   * 'range(from,to)' → startPeriod/endPeriod (tom side utelates — åpen ende);
   * eksplisitt liste → startPeriod/endPeriod (min/max); '*' → ingen
   * periodeparametre (full historikk).
   *
   * Koder percent-encodes (GOVT_IRS har motpartskoder med mellomrom).
   * Dimensjoner i meta.extension.unfilterableDims (koder med punktum/skråstrek
   * som ikke KAN stå i nøkkelstien — se getTableMetadata) får alltid tomt
   * segment; utvalget håndheves i stedet klientside i getTableData.
   */
  function buildKeyAndParams(meta, valueCodes) {
    const sel = valueCodes || {};
    const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
    // Kollapsede og pinnede dims står ikke i meta.id, men API-nøkkelen krever
    // fortsatt ett segment per DSD-dimensjon — bruk fullId når den finnes.
    const ext = meta.extension || {};
    const collapsed = ext.collapsedDims || null;
    const allIds = Array.isArray(ext.fullDimId) ? ext.fullDimId
      : ((collapsed && Array.isArray(collapsed.fullId)) ? collapsed.fullId : meta.id);
    const seriesIds = allIds.filter(d => d !== timeId); // DSD-rekkefølge (ekskl. tid)
    const unfilterable = ext.unfilterableDims || [];
    const collapsedDims = ((collapsed && collapsed.dims) || [])
      .concat(ext.droppedDims || []);
    // Snittets faste koder (flow.slice) — de er ikke synlige i UI-en, men MÅ
    // stå i nøkkelen, ellers ville uttaket sprengt ut over tabellens tema.
    const pinnedBy = (ext.pinnedDims && ext.pinnedDims.byDim) || {};
    // Snittets kodeliste for dims som fortsatt vises: «alle verdier» betyr alle
    // i SNITTET, ikke i hele flowen (se applySliceBounds).
    const sliceDims = ext.sliceDims || {};

    const segments = seriesIds.map(dimId => {
      if (pinnedBy[dimId] !== undefined) return encodeURIComponent(pinnedBy[dimId]);
      if (collapsedDims.indexOf(dimId) !== -1) return ''; // følger ankeret
      if (unfilterable.indexOf(dimId) !== -1) return ''; // filtreres klientside
      const v = sel[dimId];
      if (v === '*' || v === undefined || v === null) {
        return sliceDims[dimId] ? sliceDims[dimId].map(encodeURIComponent).join('+') : '';
      }
      if (Array.isArray(v)) return v.map(encodeURIComponent).join('+');
      if (typeof v === 'string') {
        // Enkeltkode eller top(N) (top(N) gir ikke mening for ikke-tidsdim → tom)
        if (/^top\(\d+\)$/i.test(v)) return '';
        return encodeURIComponent(v);
      }
      return '';
    });
    const key = segments.join('.');

    const params = {};
    const t = sel[timeId];
    if (typeof t === 'string') {
      const m = t.match(/^top\((\d+)\)$/i);
      const range = m ? null : window.SdmxToJsonStat.parsePeriodRange(t);
      if (m) {
        params.lastNObservations = m[1];
      } else if (range) {
        // Intervallvelgeren (variable-select) — tom side = åpen ende.
        if (range.from) params.startPeriod = range.from;
        if (range.to) params.endPeriod = range.to;
      }
      // '*' / helt åpen range → ingen periodeparametre.
    } else if (Array.isArray(t) && t.length > 0) {
      const sorted = t.slice().sort((a, b) => String(a).localeCompare(String(b)));
      params.startPeriod = sorted[0];
      params.endPeriod = sorted[sorted.length - 1];
    }
    return { key, params };
  }

  // Responsformater Norges Banks SDMX-API faktisk støtter (verifisert mot
  // det levende API-et; XML-varianter avvises med 406). sdmx-json er det
  // appen selv konsumerer og dermed standardvalget i API-byggeren.
  const API_FORMATS = ['sdmx-json', 'csv', 'csv-ts', 'excel-both', 'excel-ts'];
  // detail-verdier utover standard 'full' (ugyldig verdi gir 400 fra API-et)
  const API_DETAIL_VALUES = ['dataonly', 'serieskeysonly', 'nodata'];

  /**
   * Bygg den fulle data-URL-en for et utvalg (delt mellom getTableData og
   * buildApiQuery slik at API-bygger-forhåndsvisningen aldri divergerer fra
   * det appen faktisk sender). builderOpts ({format, detail, includeHistory,
   * bom}) settes kun av API-byggeren — getTableData utelater dem og får
   * dermed alltid dagens sdmx-json-URL uendret.
   */
  function buildDataUrl(flow, meta, valueCodes, locale, builderOpts) {
    const bo = builderOpts || {};
    const format = API_FORMATS.includes(bo.format) ? bo.format : 'sdmx-json';
    const { key, params } = buildKeyAndParams(meta, valueCodes);
    // En nøkkel med KUN tomme segmenter («..») avvises av API-et med 400 —
    // «alle serier» må uttrykkes som 'all' (verifisert mot SEC).
    const keyPath = /^\.*$/.test(key) ? 'all' : key;
    const qs = ['format=' + format, 'locale=' + locale];
    Object.keys(params).forEach(k => qs.push(k + '=' + encodeURIComponent(params[k])));
    if (API_DETAIL_VALUES.includes(bo.detail)) qs.push('detail=' + bo.detail);
    if (bo.includeHistory === true) qs.push('includeHistory=true');
    if (bo.bom === true) qs.push('bom=true');
    return BASE + '/data/' + encodeURIComponent(flow.flow) + '/' + keyPath + '?' + qs.join('&');
  }

  /**
   * API-bygger-spørring (kontrakten i source-registry.js): synkron beskrivelse
   * av GET-kallet mot Norges Banks SDMX-API for gjeldende utvalg.
   * options.meta (allerede lastet tabellmetadata) er PÅKREVD — metoden er
   * synkron og kan ikke hente metadata selv; UI-en (variable-select) har den
   * alltid lastet før forhåndsvisningen oppdateres.
   *
   * NB: Fler-verdi tidsutvalg vises som start-/endPeriod-intervall — nøyaktig
   * det appen selv sender (ikke-sammenhengende perioder filtreres først
   * klientside etter henting, se getTableData/filterDatasetToDimCodes).
   */
  function buildApiQuery(tableId, valueCodes, options) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const opts = options || {};
    if (!opts.meta || !Array.isArray(opts.meta.id)) {
      throw new Error('[NBAdapter] buildApiQuery krever options.meta (lastet tabellmetadata)');
    }
    const locale = apiLang(opts.lang || currentLang());
    return {
      method: 'GET',
      url: buildDataUrl(flow, opts.meta, valueCodes, locale, {
        format: opts.format,
        detail: opts.detail,
        includeHistory: opts.includeHistory,
        bom: opts.bom
      }),
      body: null,
      metadataUrl: BASE + '/datastructure/NB/DSD_' + encodeURIComponent(flow.flow) +
        '?references=codelist&format=sdmx-json'
    };
  }

  /** Radmajor-strides for en size-array: strides[i] = produkt(size[i+1..]). */
  function stridesFor(size) {
    const s = new Array(size.length);
    let acc = 1;
    for (let i = size.length - 1; i >= 0; i--) { s[i] = acc; acc *= size[i]; }
    return s;
  }

  /**
   * Filtrer et JSON-Stat2-datasett ned til NØYAKTIG de valgte kodene i ÉN
   * dimensjon (generisk — brukes for Tid og for nøkkel-ufiltrerbare dimensjoner).
   *
   * Tid: SDMX REST støtter kun sammenhengende intervaller (startPeriod/endPeriod),
   * så et ikke-sammenhengende tidsutvalg henter hele intervallet fra API-et.
   * Nøkkel-ufiltrerbare dimensjoner (meta.extension.unfilterableDims) hentes
   * alltid ufiltrert. Begge tilfeller kuttes her etter konvertering. Bygger om
   * dimensjonens category.index/label, size-arrayen OG den radmajor-flate
   * value-/status-arrayen konsistent. Returnerer datasettet uendret hvis alle
   * tilstedeværende koder beholdes (utvalget = «alle» eller komplett intervall).
   */
  function filterDatasetToDimCodes(dataset, timeId, wantedCodes) {
    const dim = dataset.dimension && dataset.dimension[timeId];
    const dimPos = dataset.id.indexOf(timeId);
    if (!dim || !dim.category || !dim.category.index || dimPos < 0) return dataset;

    const oldIndex = dim.category.index;
    const oldLabel = (dim.category.label) || {};
    const wanted = new Set(wantedCodes.map(String));
    // Behold datasettets egen (stigende) rekkefølge; ta kun med valgte koder.
    const keptCodes = Object.keys(oldIndex)
      .filter(c => wanted.has(String(c)))
      .sort((a, b) => oldIndex[a] - oldIndex[b]);

    // Ingenting å fjerne → returner uendret (unødvendig ombygging unngås).
    if (keptCodes.length === Object.keys(oldIndex).length) return dataset;

    const oldSize = dataset.size;
    const newSize = oldSize.slice();
    newSize[dimPos] = keptCodes.length;
    const oldStrides = stridesFor(oldSize);
    const newStrides = stridesFor(newSize);

    // Gammel Tid-koordinat → ny Tid-koordinat (kun beholdte perioder).
    const oldToNewTime = {};
    keptCodes.forEach((c, newPos) => { oldToNewTime[oldIndex[c]] = newPos; });

    const oldValue = dataset.value || [];
    const oldStatus = dataset.status || null;
    const newTotal = newSize.reduce((a, b) => a * b, 1);
    const newValue = new Array(newTotal).fill(null);
    const newStatus = {};
    let hasStatus = false;

    for (let oldFlat = 0; oldFlat < oldValue.length; oldFlat++) {
      let newFlat = 0;
      let skip = false;
      for (let d = 0; d < oldSize.length; d++) {
        const coord = Math.floor(oldFlat / oldStrides[d]) % oldSize[d];
        let newCoord = coord;
        if (d === dimPos) {
          if (!(coord in oldToNewTime)) { skip = true; break; }
          newCoord = oldToNewTime[coord];
        }
        newFlat += newCoord * newStrides[d];
      }
      if (skip) continue;
      newValue[newFlat] = oldValue[oldFlat];
      if (oldStatus) {
        const s = oldStatus[String(oldFlat)];
        if (s !== undefined) { newStatus[String(newFlat)] = s; hasStatus = true; }
      }
    }

    // Bygg om Tid-kategorien (index/label) i beholdt rekkefølge.
    const newCatIndex = {};
    const newCatLabel = {};
    keptCodes.forEach((c, i) => { newCatIndex[c] = i; newCatLabel[c] = oldLabel[c] || c; });
    dim.category.index = newCatIndex;
    dim.category.label = newCatLabel;

    dataset.size = newSize;
    dataset.value = newValue;
    if (hasStatus) dataset.status = newStatus; else delete dataset.status;
    return dataset;
  }

  async function getTableData(tableId, valueCodes, lang, codelistIds) {
    const flow = flowForId(tableId);
    if (!flow) throw new Error('[NBAdapter] Ukjent tabell: ' + tableId);
    const locale = apiLang(lang || currentLang());

    // Metadata trengs for dimensjonsrekkefølge (cachet).
    const meta = await getTableMetadata(tableId, true, locale);
    const url = buildDataUrl(flow, meta, valueCodes, locale);

    const metricDims = (meta.role && meta.role.metric) || [];

    let json = null;
    try {
      const res = await fetchSdmx(url);
      if (res.status === 404) {
        return emptyDataFromSelection(meta, valueCodes);
      }
      json = res.json;
    } catch (e) {
      throw e; // Ekte feil (nettverk / 5xx) — ikke maskér som tom.
    }

    if (!hasObservations(json)) {
      return emptyDataFromSelection(meta, valueCodes);
    }

    const collapsed = (meta.extension && meta.extension.collapsedDims) || null;
    const pinnedBy = (meta.extension && meta.extension.pinnedDims &&
      meta.extension.pinnedDims.byDim) || null;
    // Kjennetegns-dims (funksjonelt avhengige av ankeret), snittets pinnede
    // dims OG droppede duplikat-identitetsdims fjernes fra datasettet — alle er
    // alt borte fra metadata/UI (applyCollapseDims/applyPinnedDims/
    // applyDropDims), og en konstant enkeltverdi-dimensjon i resultattabellen
    // ville bare vært støy.
    const dropDims = (collapsed ? collapsed.dims : [])
      .concat(pinnedBy ? Object.keys(pinnedBy) : [])
      .concat((meta.extension && meta.extension.droppedDims) || []);
    const dataset = window.SdmxToJsonStat.dataToJsonStat(json, {
      lang: locale,
      source: 'Norges Bank',
      label: meta.label,
      updated: (json.meta && json.meta.prepared) || meta.updated || null,
      metricDims: metricDims,
      collapseDims: dropDims.length ? dropDims : undefined,
      // Samme kortrekkefølge som metadata, ellers ville tabellen kommet ut med
      // dimensjonene i DSD-rekkefølge mens velgeren viste en annen.
      dimOrder: flow.dimOrder || null
    });

    // Datasvarets ankeretiketter er rå koder/API-navn — kopier de berikede
    // etikettene (navn – kupong – forfall) fra metadata.
    if (collapsed && dataset.dimension[collapsed.anchor] && meta.dimension[collapsed.anchor]) {
      const metaLabels = meta.dimension[collapsed.anchor].category.label || {};
      const dsLabels = dataset.dimension[collapsed.anchor].category.label || {};
      Object.keys(dsLabels).forEach(code => {
        if (metaLabels[code]) dsLabels[code] = metaLabels[code];
      });
    }

    // Fler-verdi tidsutvalg hentes som intervall (SDMX støtter kun intervaller);
    // filtrer bort perioder brukeren ikke valgte. Hopp over for '*' og top(N)
    // (hele intervallet/siste N ønskes), og filterfunksjonen no-op-er dessuten
    // når alt beholdes (komplett intervall).
    const dsTimeId = (dataset.role && dataset.role.time && dataset.role.time[0]) ||
      (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
    const timeSel = (valueCodes || {})[dsTimeId];
    let result = dataset;
    if (Array.isArray(timeSel) && timeSel.length) {
      result = filterDatasetToDimCodes(result, dsTimeId, timeSel);
    }

    // Dimensjoner som ikke kan filtreres via nøkkelstien (punktum-/skråstrek-
    // koder, se getTableMetadata) hentes ufiltrert — håndhev brukerens utvalg
    // klientside her.
    const unfilterable = (meta.extension && meta.extension.unfilterableDims) || [];
    unfilterable.forEach(dimId => {
      const v = (valueCodes || {})[dimId];
      const wanted = Array.isArray(v) ? v
        : (typeof v === 'string' && v !== '*' && !/^top\(\d+\)$/i.test(v) ? [v] : null);
      if (wanted && wanted.length) {
        result = filterDatasetToDimCodes(result, dimId, wanted);
      }
    });
    return result;
  }

  /**
   * Bygg et tomt, men gyldig JSON-Stat2 dataset fra metadata + utvalg (404/ingen
   * data). value:[] → table-display viser «ingen data» uten å krasje
   * (buildDimensionCombinations nås aldri fordi displayData returnerer tidlig).
   */
  function emptyDataFromSelection(meta, valueCodes) {
    const sel = valueCodes || {};
    const timeId = (meta.role && meta.role.time && meta.role.time[0]) || 'TIME_PERIOD';
    const id = [];
    const size = [];
    const dimension = {};

    meta.id.forEach(dimId => {
      const metaDim = meta.dimension[dimId] || { label: dimId, category: { index: {}, label: {} } };
      if (dimId === timeId) {
        id.push(dimId);
        size.push(0);
        dimension[dimId] = { label: metaDim.label, category: { index: {}, label: {} } };
        return;
      }
      const v = sel[dimId];
      let codes;
      if (Array.isArray(v) && v.length) {
        codes = v;
      } else {
        codes = Object.keys(metaDim.category.index); // '*' / mangler → alle
      }
      const index = {};
      const label = {};
      codes.forEach((code, i) => {
        index[code] = i;
        label[code] = (metaDim.category.label && metaDim.category.label[code]) || code;
      });
      id.push(dimId);
      size.push(codes.length);
      dimension[dimId] = { label: metaDim.label, category: { index: index, label: label } };
    });

    return {
      class: 'dataset',
      id: id,
      size: size,
      dimension: dimension,
      value: [],
      role: { time: [timeId] },
      source: 'Norges Bank',
      label: meta.label || '',
      updated: meta.updated || null
    };
  }

  // ---- Adapterobjekt ----

  const adapter = {
    sourceId: 'nb',

    capabilities: {
      supportsSavedQueries: false,
      supportsServerExport: false,
      supportsCodelists: false,
      supportsGetUrlBuilder: false,
      // Forenklet API-bygger (data-URL + metadata-URL) via buildApiQuery —
      // gjenbruker samme URL-bygging som getTableData.
      supportsApiQuery: true,
      supportsDefaultSelection: false,
      supportsAggregation: false
    },

    ownsTableId: (id) => typeof id === 'string' && id.startsWith('nb-'),

    // Config + savedqueries rutes til SSB av fasaden — men må finnes for kontrakten.
    getConfig: async () => null,

    getTables: getTables,
    getAllTables: getTables,

    getTableMetadata: getTableMetadata,
    getTableData: getTableData,
    buildApiQuery: buildApiQuery,

    // Valgene API-byggeren (variable-select) skal tilby for denne kilden.
    // labelKey oversettes med t() av visningen; label brukes som den er.
    getApiBuilderOptions: () => ({
      formats: [
        { value: 'sdmx-json', label: 'SDMX-JSON' },
        { value: 'csv', label: 'CSV' },
        { value: 'csv-ts', labelKey: 'api.formatCsvTs' },
        { value: 'excel-both', label: 'Excel' },
        { value: 'excel-ts', labelKey: 'api.formatExcelTs' }
      ],
      defaultFormat: 'sdmx-json',
      csvFormats: ['csv', 'csv-ts'],
      maxRowCount: null,
      nbAdvanced: true
    }),

    getCodeList: async () => { throw new Error('[NBAdapter] Norges Bank har ikke kodelister'); },
    downloadTableData: async () => { throw new Error('[NBAdapter] Server-eksport støttes ikke — bruk klientside CSV'); },
    saveSavedQuery: async () => { throw new Error('[NBAdapter] Norges Bank støtter ikke lagrede spørringer'); },
    getSavedQuery: async () => { throw new Error('[NBAdapter] Norges Bank støtter ikke lagrede spørringer'); },
    getSavedQueryData: async () => { throw new Error('[NBAdapter] Norges Bank støtter ikke lagrede spørringer'); },
    getDefaultSelection: async () => { throw new Error('[NBAdapter] Norges Bank har ingen defaultselection'); },

    // Cache delegeres til SSB av fasaden — disse kalles aldri via fasaden.
    cleanupCache: () => 0,
    clearCache: () => {},
    getCacheStats: () => null
  };

  (window.SourceAdapters = window.SourceAdapters || []).push(adapter);
})();
