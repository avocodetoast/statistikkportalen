/**
 * Per-kilde radbygging ved BYGGETID — den delte inngangen til «gi meg alle
 * katalogradene for kilde X».
 *
 * HVORFOR EGEN MODUL: både scripts/generate-seo-pages.mjs og
 * scripts/build-catalog-index.mjs trenger nøyaktig de samme radene i nøyaktig
 * samme form (adapternes getTables-form: id, label, paths[], variableNames[],
 * perioder, …). Rutinene lå i SEO-generatoren; de er FLYTTET hit, ikke kopiert,
 * så det fortsatt bare finnes én implementasjon.
 *
 * Arbeidsdelingen mot scripts/lib/seo-sources.mjs: DEN eier selve
 * katalogformen per kilde (buildNbCatalogue/buildFhiCatalogue — den
 * nettverksfrie reimplementeringen av adapternes katalogbygging) og
 * SEO-attribusjonen. DENNE eier innhentingen rundt: SSBs paginerte /tables,
 * periodeberikelsen av NB-radene fra den innsjekkede nb-periods.json, lesingen
 * av fhi-catalog.json — og dispatchen på AppConfig.sources.<key>.adapter.
 * Her ligger også lesingen av appens egen js/config.js og js/subjects.js via
 * node:vm, som begge byggetidskonsumentene trenger («config.js er én kilde til
 * sannhet» — ingen av dem skal ha sin egen kopi av den).
 *
 * `fetch` er en parameter med globalThis.fetch som default, slik at tester kan
 * kjøre uten nettverk (CLAUDE.md: ingen testsuite treffer nettet).
 *
 * Ren ESM, ingen browser-globals.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildNbCatalogue, buildFhiCatalogue } from './seo-sources.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

// ---------------------------------------------------------------------------
// App-konfigurasjon (gjenbrukt fra appens egne filer via node:vm)
// ---------------------------------------------------------------------------

/** Kjør en browser-global appfil i en sandkasse og les ut window.{key}. */
function loadBrowserGlobal(file, key) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'js', file), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  const value = sandbox.window[key];
  if (!value) throw new Error(`Klarte ikke å lese ${key} fra js/${file}`);
  return value;
}

export function loadAppConfig() {
  // config.js refererer window.NbCatalog (js/sources/nb-catalog.js) og
  // window.SourceTopology (js/sources/source-topology.js) for kildekatalogen og
  // emnetre-topologien. Kjør dem i SAMME sandkasse før config.js, slik at
  // referansene resolver (speiler <script>-rekkefølgen i index.html). AppConfig
  // kommer da ut ferdig utfylt med sources.nb.dataflows/variableNames,
  // sources.fhi.sourceIds/paths og sourceNodes — som før.
  const sandbox = { window: {} };
  for (const file of ['sources/nb-catalog.js', 'sources/source-topology.js', 'config.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(REPO_ROOT, 'js', file), 'utf8'), sandbox);
  }
  const cfg = sandbox.window.AppConfig;
  if (!cfg || !cfg.apiBaseUrl || !cfg.app?.name || !cfg.source) {
    throw new Error('AppConfig fra js/config.js mangler apiBaseUrl, app.name eller source');
  }
  return cfg;
}

/** Velg riktig språk fra en flerspråklig {språk: tekst}-label (js/subjects.js).
 *  Tåler også en ren streng for bakoverkompatibilitet. */
function pickLabel(value, lang) {
  if (value && typeof value === 'object') {
    return value[lang] || value.nb || Object.values(value)[0] || '';
  }
  return value;
}

/** UI-språkkoden for standardspråket (SSB: 'nb'). */
export function uiLang(appConfig) {
  return appConfig.defaultLanguage || appConfig.languages?.[0]?.code || 'nb';
}

/**
 * Leser SubjectConfig fra js/subjects.js og løser de flerspråklige
 * meny-labelene (group.label / subjectNames) ned til standardspråkets streng,
 * slik at konsumentene kan behandle dem som rene strenger.
 */
export function loadSubjectConfig(appConfig) {
  const cfg = loadBrowserGlobal('subjects.js', 'SubjectConfig');
  if (!cfg.subjectGroups || !cfg.subjectNames) {
    throw new Error('SubjectConfig fra js/subjects.js mangler subjectGroups/subjectNames');
  }
  const lang = uiLang(appConfig);
  const subjectGroups = {};
  for (const [id, group] of Object.entries(cfg.subjectGroups)) {
    subjectGroups[id] = { ...group, label: pickLabel(group.label, lang) };
  }
  const subjectNames = {};
  for (const [code, name] of Object.entries(cfg.subjectNames)) {
    subjectNames[code] = pickLabel(name, lang);
  }
  return { ...cfg, subjectGroups, subjectNames };
}

/** Adaptere det finnes en provider for her. En kilde i AppConfig.sources med
 *  et ukjent adapter-navn skal hoppes over med en tydelig advarsel, ikke
 *  behandles som en feilende kilde. */
const KNOWN_ADAPTERS = new Set(['ssb', 'norges-bank', 'fhi']);

export function isKnownAdapter(adapter) {
  return KNOWN_ADAPTERS.has(adapter);
}

/** API-språkkoden for standardspråket (SSB: 'no'). Flyttet hit sammen med
 *  fetchTablesPage, som er den eneste bruken. */
export function apiLang(appConfig) {
  const langs = appConfig.languages || [];
  return (langs.find(l => l.code === appConfig.defaultLanguage) || langs[0])?.apiLang || 'no';
}

/** Standard logging: samme «[SEO] …»-prefiks som før flyttingen, slik at
 *  SEO-generatorens output er uendret. build-catalog-index.mjs sender sitt
 *  eget prefiks. */
function loggers({ prefix = '[SEO]', log = console.log, warn = console.warn } = {}) {
  return {
    log: msg => log(`${prefix} ${msg}`),
    warn: msg => warn(`${prefix} ${msg}`),
  };
}

/**
 * Én side av PxWebApi-ets /tables.
 *
 * @param {object} appConfig
 * @param {number} pageNumber - 1-basert sidenummer.
 * @param {function} [fetchImpl] - fetch-implementasjon (injiserbar for test).
 */
export async function fetchTablesPage(appConfig, pageNumber, fetchImpl = globalThis.fetch) {
  const params = new URLSearchParams({
    lang: apiLang(appConfig),
    pageSize: String(appConfig.limits?.tablePageBatchSize || 10000),
    includeDiscontinued: 'true',
  });
  if (pageNumber > 1) params.set('pageNumber', String(pageNumber));
  const url = `${appConfig.apiBaseUrl}/tables?${params}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`API-feil ${res.status} for ${url}`);
  return res.json();
}

/**
 * Hele SSB-katalogen, side for side. Kaster ved færre enn minTables tabeller —
 * sanity-terskelen som skiller «SSB har fjernet noen tabeller» fra «API-et
 * svarte 200 med en avkortet liste». Kallerne har ikke lov til å skrive noe
 * når denne kaster.
 *
 * @param {object} appConfig
 * @param {number} minTables
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl] - fetch-implementasjon (injiserbar for test).
 */
export async function fetchAllTables(appConfig, minTables, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const { log } = loggers(opts);
  const first = await fetchTablesPage(appConfig, 1, fetchImpl);
  const tables = first.tables ? [...first.tables] : [];
  const totalPages = first.page ? first.page.totalPages : 1;
  log(`Hentet side 1/${totalPages} (${tables.length} tabeller)`);
  for (let p = 2; p <= totalPages; p++) {
    const page = await fetchTablesPage(appConfig, p, fetchImpl);
    tables.push(...(page.tables || []));
    log(`Hentet side ${p}/${totalPages} (totalt ${tables.length} tabeller)`);
  }
  if (tables.length < minTables) {
    throw new Error(`Bare ${tables.length} tabeller fra API-et (forventet minst ${minTables}) — avbryter uten å røre webroot.`);
  }
  return tables;
}

/**
 * Tidsperiode/oppdatert-dato for Norges Bank-katalogen fra den innsjekkede
 * data/sources/nb-periods.json (skrevet av scripts/update-nb-periods.mjs) —
 * samme fil appen selv leser, så SEO-sidene, indeksen og portalen viser samme
 * vindu. Nettverksfritt, som FHI-katalogen. Mangler fila eller en rad, bygges
 * raden uten tidsperiode (temporalCoverage utelates) — aldri abort.
 *
 * Muterer `entries` på plass, som før flyttingen.
 */
export function applyNbPeriods(entries, opts = {}) {
  const { warn } = loggers(opts);
  const file = path.join(REPO_ROOT, 'data', 'sources', 'nb-periods.json');
  if (!fs.existsSync(file)) {
    warn(`Fant ikke ${path.relative(REPO_ROOT, file)} — Norges Bank-sidene bygges ` +
         'uten tidsperiode. Kjør «node scripts/update-nb-periods.mjs».');
    return;
  }
  const baked = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = baked.tables || {};
  const missing = [];
  for (const entry of entries) {
    const period = byId[entry.id];
    if (!period) { missing.push(entry.id); continue; }
    entry.firstPeriod = period.firstPeriod || '';
    entry.lastPeriod = period.lastPeriod || '';
    entry.updated = period.updated || '';
  }
  if (missing.length) {
    warn(`Uten tidsperiode i nb-periods.json: ${missing.join(', ')} — ` +
         'kjør «node scripts/update-nb-periods.mjs» på nytt.');
  }
}

/** Den innsjekkede FHI-katalogen (bygget av scripts/update-fhi-catalog.mjs). */
export function readFhiCatalog() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'sources', 'fhi-catalog.json'), 'utf8'));
}

/**
 * Alle katalograder for ÉN kilde, dispatchet på AppConfig.sources[key].adapter.
 * Dette er utvidelsespunktet for nye kilder: legg til en gren her og en
 * provider i scripts/lib/seo-sources.mjs.
 *
 * @param {string} sourceKey - Nøkkel i AppConfig.sources ('ssb' | 'nb' | 'fhi').
 * @param {object} opts
 * @param {object} opts.appConfig
 * @param {object} opts.subjectConfig - Fra generatorens loadSubjectConfig (subjectNames).
 * @param {string} opts.lang - Språket labels velges på ('no'/'nb'/'en').
 * @param {number} [opts.minTables] - Sanity-terskel for SSB.
 * @param {function} [opts.fetchImpl] - fetch-implementasjon (injiserbar for test).
 * @param {string} [opts.prefix] - Loggprefiks.
 * @returns {Promise<object[]>} katalograder
 */
export async function buildSourceRows(sourceKey, opts = {}) {
  const { appConfig, subjectConfig, lang, minTables = 0 } = opts;
  const adapter = appConfig?.sources?.[sourceKey]?.adapter;

  if (adapter === 'ssb') {
    return fetchAllTables(appConfig, minTables, opts);
  }
  if (adapter === 'norges-bank') {
    const rows = buildNbCatalogue(appConfig, subjectConfig.subjectNames, lang);
    applyNbPeriods(rows, opts);
    return rows;
  }
  if (adapter === 'fhi') {
    return buildFhiCatalogue(readFhiCatalog(), appConfig, subjectConfig.subjectNames, lang);
  }
  throw new Error(`Kilden «${sourceKey}» har ukjent adapter «${adapter}» — legg til en gren i scripts/lib/catalog-sources.mjs.`);
}
