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
 * Katalogradene bygges av samme avhengighetsfrie browserfil som adapterne,
 * lastet via node:vm, slik at nettleser og katalog aldri kan drive fra hverandre.
 *
 * Ren ESM uten browser-globals — importeres direkte av
 * tests/unit/seo-sources.test.js.
 */

import { buildNbRows, buildFhiRows } from './catalog-shared.mjs';

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

/** Kildenøkkel i AppConfig.sources for en tabell-id, avledet fra idPrefix. */
export function sourceKeyForId(id, appConfig) {
  const s = String(id || '');
  for (const [key, source] of Object.entries(appConfig?.sources || {})) {
    if (source && typeof source === 'object' && source.idPrefix && s.startsWith(source.idPrefix)) {
      return key;
    }
  }
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
  const key = sourceKeyForId(id, appConfig);
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
  const key = sourceKeyForId(id, appConfig);
  if (key === 'ssb') return '';
  const branding = appConfig?.sources?.[key]?.branding;
  if (!branding) return '';
  const text = branding.shortName || branding.name;
  if (!text) return '';
  const title = branding.nameFull || branding.name || text;
  return `<span class="source-badge source-badge--${escapeHtml(key)}" data-tooltip="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

/**
 * Norges Bank-katalogen, nettverksfritt fra AppConfig.sources.nb.dataflows +
 * AppConfig.sourceNodes (speiler buildCatalogue i norges-bank-adapter.js).
 * Perioder/updated er tomme strenger — generatoren fyller dem etterpå fra den
 * innsjekkede data/sources/nb-periods.json (se applyNbPeriods i
 * generate-seo-pages.mjs), samme fil appen selv laster.
 */
export function buildNbCatalogue(appConfig, subjectNames, lang) {
  const cfg = appConfig?.sources?.nb || {};
  return buildNbRows({
    dataflows: cfg.dataflows || [],
    variableNames: cfg.variableNames || {},
    subjectNames,
    sourceNodes: appConfig?.sourceNodes || {},
    lang,
    pickLabel,
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
  const tables = [];
  for (const source of cfg.sourceIds || []) {
    const catSource = catalog?.sources?.[source];
    if (!catSource || !Array.isArray(catSource.tables)) continue;

    const placements = (cfg.paths && Array.isArray(cfg.paths[source]) && cfg.paths[source].length)
      ? cfg.paths[source]
      : [['he', 'fhi-' + source]];
    tables.push(...buildFhiRows({
      source,
      rows: catSource.tables,
      catalogRows: catSource.tables,
      categories: catSource.categories || null,
      placements,
      subjectNames,
      sourceNodes: appConfig?.sourceNodes || {},
      lang,
      pickLabel,
      sourceTitle: catSource.title || source,
    }));
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
