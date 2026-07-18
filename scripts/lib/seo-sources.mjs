/**
 * Per-kilde katalogleverandører og kildeattribusjon for SEO-generatoren
 * (scripts/generate-seo-pages.mjs).
 *
 * Dette er generatorens utvidelsespunkt for flere kilder: én provider-funksjon
 * per kilde som bygger katalog-oppføringer i samme form som adapternes
 * getTables (id, label, paths[], subjectCode, perioder, …), slik at resten av
 * generatoren (hierarki, emnesider, tabellsider, sitemap, seo-map) er
 * kildeagnostisk. En ny kilde legges til med en branding-blokk i
 * AppConfig.sources.<kilde> og en provider her (+ dispatch i generatorens
 * enumerateAllTables).
 *
 * Katalogbyggingen er en bevisst nettverksfri reimplementering av adapternes
 * config-/katalogfil-deriverte logikk (js/sources/norges-bank-adapter.js
 * buildCatalogue, js/sources/fhi-adapter.js buildSourceCatalogue) — samme
 * «config.js er én kilde til sannhet»-konvensjon som generatorens
 * buildHierarchy-duplikat av MenuHierarchy. Endres katalogformen i en
 * adapter, må provideren her oppdateres tilsvarende.
 *
 * Ren ESM uten browser-globals — importeres direkte av
 * tests/unit/seo-sources.test.js.
 */

/** SSB-/FHI-periode → ISO 8601 for temporalCoverage: "2006" → "2006",
 *  "2006M01" → "2006-01", kvartal/uke/halvår ("2006K1" osv.) → året.
 *  Uparsbare verdier (tomme NB-perioder o.l.) → null, som gjør at
 *  temporalCoverage utelates i stedet for å emittere søppel. */
export function isoPeriod(period) {
  const m = String(period || '').match(/^(\d{4})(?:M(\d{2}))?/);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/** Velg riktig språk fra en flerspråklig {nb,en}-label; tåler rene strenger.
 *  'no' behandles som 'nb' (API-språk vs. UI-språk). */
export function pickLabel(value, lang) {
  if (value && typeof value === 'object') {
    const l = String(lang || 'nb').toLowerCase() === 'no' ? 'nb' : String(lang || 'nb').toLowerCase();
    return value[l] || value.nb || Object.values(value)[0] || '';
  }
  return value || '';
}

/** Kildennøkkel i AppConfig.sources for en tabell-id — samme prefiksregel som
 *  fasaden i js/sources/source-registry.js (nb-* / fhi-* / ellers SSB). */
export function sourceKeyForId(id) {
  const s = String(id || '');
  if (s.startsWith('nb-')) return 'nb';
  if (s.startsWith('fhi-')) return 'fhi';
  return 'ssb';
}

/**
 * Branding-/attribusjonsobjekt ({name, nameFull, url, licenseUrl?, licenseName?})
 * for en tabell-id: AppConfig.sources.<kilde>.branding når det finnes, ellers
 * det globale AppConfig.source (SSB). Kilder uten branding degraderer altså til
 * global attribusjon i stedet for å feile. Manglende licenseUrl (Norges Bank)
 * gjør at generatoren utelater lisensfeltet/-lenken.
 */
export function sourceBrandingFor(id, appConfig) {
  const key = sourceKeyForId(id);
  const branding = appConfig?.sources?.[key]?.branding;
  return branding || appConfig.source;
}

// Emnesubjektenes sortCode (kosmetisk — SSB-tabellene oppretter subjektnodene
// først i praksis). Union av adapternes SUBJECT_SORTCODE-konstanter.
const SUBJECT_SORTCODE = { bf: '0000006', he: '0000004' };

/** Path-segmenter [{id,label,sortCode}, …] for en [subjektkode, node-id]-
 *  plassering, med labels fra subjects.js og AppConfig.sourceNodes. */
function buildPathSegments(placement, subjectNames, sourceNodes, lang) {
  const [subjectId, nodeId] = placement;
  const node = sourceNodes[nodeId] || {};
  return [
    {
      id: subjectId,
      label: pickLabel(subjectNames[subjectId], lang) || subjectId,
      sortCode: SUBJECT_SORTCODE[subjectId] || '0009999',
    },
    {
      id: nodeId,
      label: pickLabel(node.label, lang) || nodeId,
      sortCode: node.sortCode || '999',
    },
  ];
}

// Statiske søkeord per Norges Bank-dataflow (holder katalogbyggingen
// nettverksfri) — duplikat av VARIABLE_NAMES i js/sources/norges-bank-adapter.js.
const NB_VARIABLE_NAMES = {
  EXR: ['Valutakurser', 'Valuta', 'Basisvaluta', 'Kvoteringsvaluta', 'Kurs', 'Exchange rates', 'Currency'],
  IR: ['Styringsrenten', 'Styringsrente', 'Rente', 'Foliorente', 'Policy rate', 'Key policy rate'],
  SHORT_RATES: ['NOWA', 'Kortsiktige renter', 'Pengemarkedsrente', 'Rente', 'Short-term interest rates'],
  GOVT_GENERIC_RATES: ['Statsobligasjonsrenter', 'Statsobligasjon', 'Statsrente', 'Rente', 'Government bond yields'],
};

/**
 * Norges Bank-katalogen, nettverksfritt fra AppConfig.sources.nb.dataflows +
 * AppConfig.sourceNodes (speiler buildCatalogue i norges-bank-adapter.js).
 * Perioder/updated er tomme strenger — generatoren kan fylle dem etterpå via
 * en best-effort nettverksprobe (se fetchNbPeriods i generate-seo-pages.mjs).
 */
export function buildNbCatalogue(appConfig, subjectNames, lang) {
  const cfg = appConfig?.sources?.nb || {};
  const nodes = appConfig?.sourceNodes || {};
  return (cfg.dataflows || []).map((flow, i) => {
    // `paths` = flere emnetre-plasseringer; legacy `path` = én.
    const placements = (Array.isArray(flow.paths) && flow.paths.length)
      ? flow.paths
      : [flow.path];
    return {
      id: flow.tableId,
      label: pickLabel(flow.label, lang) || flow.tableId,
      sortCode: String(900 + i),
      updated: '',
      firstPeriod: '',
      lastPeriod: '',
      discontinued: false,
      timeUnit: 'Business',
      variableNames: (NB_VARIABLE_NAMES[flow.flow] || []).slice(),
      subjectCode: placements[0][0],
      paths: placements.map(p => buildPathSegments(p, subjectNames, nodes, lang)),
      source: 'Norges Bank',
    };
  });
}

/**
 * FHI-katalogen fra den innsjekkede data/sources/fhi-catalog.json (bygget av
 * scripts/update-fhi-catalog.mjs) + AppConfig.sources.fhi — speiler
 * buildSourceCatalogue i fhi-adapter.js, men uten den live tabellisten
 * (katalogfila har alt en tabellside trenger). sourceIds uten oppføring i
 * katalogfila hoppes over (ny kilde aktivert i config før katalogen er
 * regenerert) i stedet for å feile.
 */
export function buildFhiCatalogue(catalog, appConfig, subjectNames, lang) {
  const cfg = appConfig?.sources?.fhi || {};
  const nodes = appConfig?.sourceNodes || {};
  const tables = [];
  for (const source of cfg.sourceIds || []) {
    const catSource = catalog?.sources?.[source];
    if (!catSource || !Array.isArray(catSource.tables)) continue;

    const placements = (cfg.paths && Array.isArray(cfg.paths[source]) && cfg.paths[source].length)
      ? cfg.paths[source]
      : [['he', 'fhi-' + source]];
    const paths = placements.map(p => buildPathSegments(p, subjectNames, nodes, lang));
    const subjectCode = placements[0][0];
    const sourceTitle = catSource.title || source;

    for (const row of catSource.tables) {
      tables.push({
        id: 'fhi-' + source + '-' + row.tableId,
        label: (row.title || String(row.tableId)) + ' (FHI)',
        updated: row.updated || '',
        firstPeriod: row.firstPeriod || '',
        lastPeriod: row.lastPeriod || '',
        discontinued: false,
        sortCode: String(row.tableId).padStart(6, '0'),
        timeUnit: row.timeUnit || null,
        variableNames: row.variableNames || [],
        description: row.description || '',
        subjectCode,
        paths,
        source: 'FHI/' + sourceTitle,
      });
    }
  }
  return tables;
}

/** Kildenavn for forside-/beskrivelsestekster: det globale kildenavnet (SSB)
 *  først, deretter aktiverte kilder med egen branding, i config-rekkefølge.
 *  field='nameFull' (default) gir fulle navn, field='name' kortnavn. */
export function enabledSourceNames(appConfig, field = 'nameFull') {
  const pick = b => (field === 'name' ? (b.name || b.nameFull) : (b.nameFull || b.name));
  const names = [pick(appConfig.source)];
  for (const src of Object.values(appConfig.sources || {})) {
    if (src?.enabled === false || !src?.branding) continue;
    const name = pick(src.branding);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** «A», «A og B», «A, B og C» — norsk opplisting for løpende tekst. */
export function joinNamesNo(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}
