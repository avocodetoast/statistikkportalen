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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Kilde-badge for en tabell-id i de statiske tabellistene. Speiler
 * sourceBadgeHTML() i js/utils.js — samme klasser, samme markup og samme
 * regel: standardkilden (SSB) merkes ikke, og en kilde uten egen branding
 * får ingen badge (fremfor å arve SSBs). Stylingen kommer fra
 * css/menu-navigator.css, som index.html-malen allerede laster.
 *
 * @param {string} id - Tabell-id
 * @param {Object} appConfig
 * @returns {string} HTML, eller '' når tabellen ikke skal merkes
 */
export function sourceBadgeHtml(id, appConfig) {
  const key = sourceKeyForId(id);
  if (key === 'ssb') return '';
  const branding = appConfig?.sources?.[key]?.branding;
  if (!branding) return '';
  const text = branding.shortName || branding.name;
  if (!text) return '';
  const title = branding.nameFull || branding.name || text;
  return `<span class="source-badge source-badge--${escapeHtml(key)}" data-tooltip="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

// Emnesubjektenes sortCode (kosmetisk — SSB-tabellene oppretter subjektnodene
// først i praksis). Union av adapternes SUBJECT_SORTCODE-konstanter.
const SUBJECT_SORTCODE = {
  bf: '0000006', nk: '0000066', os: '0000076', ei: '0000030', ut: '0000115',
  he: '0000034', be: '0000016', in: '0000042',
};

/** Path-segmenter [{id,label,sortCode}, …] for en plassering
 *  [subjektkode, ...node-id-er] med vilkårlig dybde (subjekt + én eller flere
 *  noder), med labels fra subjects.js og AppConfig.sourceNodes. Speiler
 *  buildCatalogue i norges-bank-adapter.js. */
function buildPathSegments(placement, subjectNames, sourceNodes, lang) {
  const [subjectId, ...nodeIds] = placement;
  return [
    {
      id: subjectId,
      label: pickLabel(subjectNames[subjectId], lang) || subjectId,
      sortCode: SUBJECT_SORTCODE[subjectId] || '0009999',
    },
    ...nodeIds.map((nodeId) => {
      const node = sourceNodes[nodeId] || {};
      return {
        id: nodeId,
        label: pickLabel(node.label, lang) || nodeId,
        sortCode: node.sortCode || '999',
      };
    }),
  ];
}

/**
 * Norges Bank-katalogen, nettverksfritt fra AppConfig.sources.nb.dataflows +
 * AppConfig.sourceNodes (speiler buildCatalogue i norges-bank-adapter.js).
 * Perioder/updated er tomme strenger — generatoren kan fylle dem etterpå via
 * en best-effort nettverksprobe (se fetchNbPeriods i generate-seo-pages.mjs).
 */
export function buildNbCatalogue(appConfig, subjectNames, lang) {
  const cfg = appConfig?.sources?.nb || {};
  const nodes = appConfig?.sourceNodes || {};
  // Statiske søkeord per flow: samme kilde som adapteren
  // (js/sources/nb-catalog.js → AppConfig.sources.nb.variableNames).
  const variableNames = cfg.variableNames || {};
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
      discontinued: flow.discontinued === true,
      // Speiler buildCatalogue i js/sources/norges-bank-adapter.js: flere rader
      // kan dele samme flow (REGNET-snittene), og overstyrer da frekvensbøtte
      // og søkeord per tabell.
      timeUnit: flow.timeUnit || 'Business',
      variableNames: (flow.keywords || variableNames[flow.flow] || []).slice(),
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
    const basePaths = placements.map(p => buildPathSegments(p, subjectNames, nodes, lang));
    const subjectCode = placements[0][0];
    const sourceTitle = catSource.title || source;

    // Kuraterte kategorier (register → kategori) fra katalogfila — speiler
    // pathsForCategory i fhi-adapter.js buildSourceCatalogue: tabeller med
    // `category` får et tredje path-segment under registernoden.
    const categories = catSource.categories || null;
    const pathsForCategory = (catId) => {
      if (!catId || !categories || !categories[catId]) return basePaths;
      const def = categories[catId];
      const seg = {
        id: 'fhi-' + source + '-' + catId,
        label: def.label || catId,
        sortCode: def.sortCode || '999',
      };
      return basePaths.map(p => p.concat([seg]));
    };

    for (const row of catSource.tables) {
      tables.push({
        id: 'fhi-' + source + '-' + row.tableId,
        // Uten kildesuffiks — kilden rendres som badge i tabellistene
        // (sourceBadgeHtml under), likt appen (js/sources/fhi-adapter.js).
        label: row.title || String(row.tableId),
        updated: row.updated || '',
        firstPeriod: row.firstPeriod || '',
        lastPeriod: row.lastPeriod || '',
        discontinued: false,
        sortCode: String(row.tableId).padStart(6, '0'),
        timeUnit: row.timeUnit || null,
        variableNames: row.variableNames || [],
        description: row.description || '',
        subjectCode,
        paths: pathsForCategory(row.category),
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
