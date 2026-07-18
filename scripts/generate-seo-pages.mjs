#!/usr/bin/env node
/**
 * SEO-sidegenerator for Statistikkportalen.
 *
 * Genererer statiske, crawlbare emnesider (pene URL-er som
 * /okonomi/nasjonalregnskap-og-konjunkturer/nasjonalregnskap/) og én side per
 * tabell, også avsluttede (/table/{id}/) i webroot, pluss sitemap.xml, robots.txt og
 * seo-map.json (rute → kanonisk URL, brukes av js/seo-head.js). Hver side er
 * et fullt app-skall basert på den deployede index.html: crawlere ser statisk
 * innhold (brodsmuler, underemner, tabelliste) og JSON-LD strukturerte data
 * (BreadcrumbList + DataCatalog/Dataset for Google Dataset Search), mens
 * appen ved lasting bytter URL til den kanoniske hash-ruten (#topic/... eller
 * #variables/{id}) via window.__SEO_TOPIC_PATH__ / window.__SEO_TABLE_ID__
 * (se bootstrap-snutten i index.html).
 *
 * Tabellsidene er Dataset-enes kanoniske landingssider: Google ignorerer
 * #-fragmenter, så Dataset.url må peke på en ekte URL med markup — aldri
 * /#variables/{id}. hreflang genereres ikke (engelsk finnes kun som
 * klientside-språkbytte, ikke som egne URL-er).
 *
 * Tabellsider berikes med innhold fra lokale metadatafiler i
 * data/table-metadata/{id}.json — eksakte responser fra /tables/{id}/metadata,
 * lastet ned av et eget oppdaterings-script (katalog overstyres med
 * --metadata-dir, kontrakt i data/table-metadata/README.md). Tabeller uten
 * gyldig fil får nøyaktig samme innhold som før fra /tables-listen alene.
 * Metadatafilene kan være gamle: tidsperiode og oppdatert-dato hentes derfor
 * ALLTID fra den ferske /tables-listen, aldri fra metadatafilen.
 *
 * Sidedybden speiler appen (topic-view.js): nivåer t.o.m. AppConfig.ui
 * .topicCardDepth får egne sider med lenker til undersidene, mens første nivå
 * under kortene blir én samlet oversiktsside med hele undertreet som
 * seksjoner — ingen dypere sider genereres.
 *
 * Forsiden (index.html) får også statisk innhold i #content som speiler appens
 * egen forside (søkefelt + emnegrid), pluss en SEO-tekstseksjon. Visningene i
 * appen beholder pre-rendret innhold som plassholder under første datalasting
 * (seoContentMatchesRoute i js/utils.js), så siden ikke blinker ved oppstart.
 * Originalinnholdet bevares base64-kodet i en markør-kommentar, slik at
 * scriptet kan gjenopprette en uberørt mal ved neste kjøring.
 *
 * API-endepunkt, sidestørrelse, appnavn og kildeinfo leses fra appens egne
 * js/config.js og js/subjects.js (via node:vm) — én kilde til sannhet, og
 * scriptet fungerer uendret for andre PxWebApi-instanser.
 *
 * FLERKILDE (Statistikkportalen 2.0): i tillegg til SSB enumereres alle
 * aktiverte kilder i AppConfig.sources via providere i
 * scripts/lib/seo-sources.mjs — Norges Bank nettverksfritt fra config
 * (tidsperioder probes best-effort, skru av med --no-probe-nb-periods) og
 * FHI fra den innsjekkede data/sources/fhi-catalog.json. Tabeller med
 * nb-/fhi-prefiks får dermed egne /table/{id}/-sider og inngår i emnesider,
 * sitemap og
 * seo-map.json. Kildeattribusjon (JSON-LD creator/license, «Kilde:»-linjer)
 * slås opp per tabell-id via AppConfig.sources.<kilde>.branding med det
 * globale AppConfig.source som fallback. En feilende fremmed kilde logges og
 * hoppes over; SSB-feil avbryter fortsatt hele kjøringen.
 *
 * Kjøres periodisk på serveren (cron), f.eks. ukentlig:
 *   15 4 * * 0 cd /sti/til/repo && node scripts/generate-seo-pages.mjs \
 *     --webroot /sti/til/webroot --site https://statistikkportalen.no >> seo-gen.log 2>&1
 *
 * Krever Node 18+ (global fetch). Ingen npm-avhengigheter.
 *
 * Sikkerhet: scriptet sletter kun filer/mapper det selv har skrevet, sporet i
 * {webroot}/.seo-manifest.json. Ved API-feil eller mistenkelig lite data
 * avbrytes kjøringen uten å røre webroot.
 *
 * NB: tre-byggingen i buildHierarchy() er en duplikat av
 * MenuHierarchy._addPathToHierarchy() i js/menu-hierarchy.js — endres
 * tre-strukturen der, må den oppdateres her også.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  isoPeriod, sourceBrandingFor, buildNbCatalogue, buildFhiCatalogue,
  enabledSourceNames, joinNamesNo,
} from './lib/seo-sources.mjs';

const MIN_TABLE_COUNT = 5000; // sanity-terskel for SSB-katalogen: færre tabeller = trolig API-feil (overstyres med --min-tables)
const NB_PROBE_DELAY_MS = 1000; // pause mellom periodeprobe-kall mot Norges Bank (skånsomt om dataflow-listen vokser)

// Navn som aldri kan brukes som mappe på toppnivå i webroot
const RESERVED_TOP_LEVEL = new Set([
  'js', 'css', 'scripts', 'assets', 'img', 'images', 'fonts',
  'index.html', 'test.html', 'api-explorer.html',
  'robots.txt', 'sitemap.xml', 'favicon.ico',
  'table', 'seo-map.json',
]);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    webroot: null, site: null, dryRun: false, minTables: MIN_TABLE_COUNT,
    metadataDir: path.join(REPO_ROOT, 'data', 'table-metadata'),
    probeNbPeriods: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--webroot') args.webroot = argv[++i];
    else if (a === '--site') args.site = argv[++i];
    else if (a === '--min-tables') args.minTables = parseInt(argv[++i], 10);
    else if (a === '--metadata-dir') args.metadataDir = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-probe-nb-periods') args.probeNbPeriods = false;
    else {
      console.error(`Ukjent argument: ${a}`);
      process.exit(2);
    }
  }
  if (!args.webroot || !args.site || !Number.isFinite(args.minTables) || !args.metadataDir) {
    console.error('Bruk: node scripts/generate-seo-pages.mjs --webroot <sti> --site <https://...> [--metadata-dir <sti>] [--min-tables <antall>] [--no-probe-nb-periods] [--dry-run]');
    process.exit(2);
  }
  args.webroot = path.resolve(args.webroot);
  args.metadataDir = path.resolve(args.metadataDir);
  args.site = args.site.replace(/\/+$/, '');
  return args;
}

// ---------------------------------------------------------------------------
// Datainnhenting
// ---------------------------------------------------------------------------

async function fetchTablesPage(appConfig, pageNumber) {
  const params = new URLSearchParams({
    lang: apiLang(appConfig),
    pageSize: String(appConfig.limits?.tablePageBatchSize || 10000),
    includeDiscontinued: 'true',
  });
  if (pageNumber > 1) params.set('pageNumber', String(pageNumber));
  const url = `${appConfig.apiBaseUrl}/tables?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API-feil ${res.status} for ${url}`);
  return res.json();
}

async function fetchAllTables(appConfig, minTables) {
  const first = await fetchTablesPage(appConfig, 1);
  const tables = first.tables ? [...first.tables] : [];
  const totalPages = first.page ? first.page.totalPages : 1;
  console.log(`[SEO] Hentet side 1/${totalPages} (${tables.length} tabeller)`);
  for (let p = 2; p <= totalPages; p++) {
    const page = await fetchTablesPage(appConfig, p);
    tables.push(...(page.tables || []));
    console.log(`[SEO] Hentet side ${p}/${totalPages} (totalt ${tables.length} tabeller)`);
  }
  if (tables.length < minTables) {
    throw new Error(`Bare ${tables.length} tabeller fra API-et (forventet minst ${minTables}) — avbryter uten å røre webroot.`);
  }
  return tables;
}

/**
 * Best-effort tidsperiode/oppdatert-dato for Norges Bank-katalogen: samme
 * lette endepunkt som fetchCataloguePeriod i js/sources/norges-bank-adapter.js
 * (firstNObservations=1&lastNObservations=1 → første og siste obs per serie).
 * Kallene går sekvensielt med NB_PROBE_DELAY_MS pause, så proben skalerer
 * skånsomt om dataflow-listen vokser. Feil per flow logges og gir tomme
 * periodefelter (temporalCoverage utelates) — aldri abort.
 */
async function fetchNbPeriods(appConfig, entries) {
  const nbCfg = appConfig.sources?.nb || {};
  const base = String(nbCfg.baseUrl || 'https://data.norges-bank.no/api').replace(/\/+$/, '');
  const flowById = new Map((nbCfg.dataflows || []).map(f => [f.tableId, f]));
  let first = true;
  for (const entry of entries) {
    const flow = flowById.get(entry.id);
    if (!flow) continue;
    if (!first) await new Promise(resolve => setTimeout(resolve, NB_PROBE_DELAY_MS));
    first = false;
    const url = `${base}/data/${encodeURIComponent(flow.flow)}/?format=sdmx-json&firstNObservations=1&lastNObservations=1`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json, */*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // SDMX-JSON kan ha data.structure (objekt) eller data.structures[0] (array)
      const struct = json?.data?.structure ||
        (Array.isArray(json?.data?.structures) ? json.data.structures[0] : null);
      const obsDim = struct?.dimensions?.observation?.[0];
      const years = (obsDim?.values || [])
        .map(v => String(v.id || '').match(/\d{4}/)?.[0])
        .filter(Boolean)
        .map(Number);
      if (years.length === 0) throw new Error('ingen tidsverdier i svaret');
      entry.firstPeriod = String(Math.min(...years));
      entry.lastPeriod = String(Math.max(...years));
      entry.updated = json.meta?.prepared || '';
    } catch (err) {
      console.warn(`[SEO] Periodeprobe mot Norges Bank feilet for ${entry.id} (${err.message}) — siden bygges uten tidsperiode.`);
    }
  }
}

/**
 * Alle tabeller fra alle aktiverte kilder i AppConfig.sources, dispatchet på
 * adapter-feltet (utvidelsespunktet for nye kilder — providere i
 * scripts/lib/seo-sources.mjs). SSB hentes først og beholder de harde
 * feilgarantiene (API-feil eller < --min-tables avbryter uten å røre webroot);
 * fremmede kilder er feilisolerte som i source-registry.js — en kilde som
 * feiler logges og hoppes over, resten av kjøringen fortsetter.
 */
async function enumerateAllTables(appConfig, subjectConfig, args) {
  const tables = await fetchAllTables(appConfig, args.minTables);
  const lang = uiLang(appConfig);

  for (const [key, src] of Object.entries(appConfig.sources || {})) {
    if (src?.enabled === false || !src?.adapter || src.adapter === 'ssb') continue;
    try {
      let sourceTables = [];
      if (src.adapter === 'norges-bank') {
        sourceTables = buildNbCatalogue(appConfig, subjectConfig.subjectNames, lang);
        if (args.probeNbPeriods) await fetchNbPeriods(appConfig, sourceTables);
      } else if (src.adapter === 'fhi') {
        const catalogPath = path.join(REPO_ROOT, 'data', 'sources', 'fhi-catalog.json');
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        sourceTables = buildFhiCatalogue(catalog, appConfig, subjectConfig.subjectNames, lang);
      } else {
        console.warn(`[SEO] Kilden «${key}» har ukjent adapter «${src.adapter}» — hopper over (legg til en provider i scripts/lib/seo-sources.mjs).`);
        continue;
      }
      console.log(`[SEO] Kilde «${key}»: ${sourceTables.length} tabeller.`);
      tables.push(...sourceTables);
    } catch (err) {
      console.warn(`[SEO] Kilden «${key}» feilet (${err.message}) — hopper over.`);
    }
  }
  return tables;
}

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

function loadAppConfig() {
  const cfg = loadBrowserGlobal('config.js', 'AppConfig');
  if (!cfg.apiBaseUrl || !cfg.app?.name || !cfg.source) {
    throw new Error('AppConfig fra js/config.js mangler apiBaseUrl, app.name eller source');
  }
  return cfg;
}

/** Velg riktig språk fra en flerspråklig {språk: tekst}-label (js/subjects.js).
 *  Tåler også en ren streng for bakoverkompatibilitet. */
function pickLabel(value, uiLang) {
  if (value && typeof value === 'object') {
    return value[uiLang] || value.nb || Object.values(value)[0] || '';
  }
  return value;
}

/** UI-språkkoden for standardspråket (SSB: 'nb'). */
function uiLang(appConfig) {
  return appConfig.defaultLanguage || appConfig.languages?.[0]?.code || 'nb';
}

/**
 * Leser SubjectConfig fra js/subjects.js og løser de flerspråklige
 * meny-labelene (group.label / subjectNames) ned til standardspråkets streng,
 * slik at resten av scriptet kan behandle dem som rene strenger.
 */
function loadSubjectConfig(appConfig) {
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

/** API-språkkoden for standardspråket (SSB: 'no'). */
function apiLang(appConfig) {
  const langs = appConfig.languages || [];
  return (langs.find(l => l.code === appConfig.defaultLanguage) || langs[0])?.apiLang || 'no';
}

// ---------------------------------------------------------------------------
// Hierarki (duplikat av MenuHierarchy._addPathToHierarchy i js/menu-hierarchy.js)
// ---------------------------------------------------------------------------

function buildHierarchy(tables) {
  const hierarchy = {};
  for (const table of tables) {
    if (!table.paths || table.paths.length === 0) continue;
    for (const tablePath of table.paths) {
      if (tablePath.length === 0) continue;
      const subjectCode = tablePath[0].id;
      if (!hierarchy[subjectCode]) {
        hierarchy[subjectCode] = {
          id: subjectCode,
          label: tablePath[0].label,
          sortCode: tablePath[0].sortCode,
          children: {},
          tables: [],
        };
      }
      let node = hierarchy[subjectCode];
      for (let i = 1; i < tablePath.length; i++) {
        const seg = tablePath[i];
        if (!node.children[seg.id]) {
          node.children[seg.id] = {
            id: seg.id,
            label: seg.label,
            sortCode: seg.sortCode,
            children: {},
            tables: [],
          };
        }
        node = node.children[seg.id];
      }
      node.tables.push(table);
    }
  }
  return hierarchy;
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

function slugify(label) {
  return label
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fjern diakritiske tegn (é→e, ü→u)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Unik slug innenfor én foreldermappe; kollisjoner får -{id}-suffiks. */
function uniqueSlug(label, nodeId, usedSlugs) {
  let slug = slugify(label) || nodeId.toLowerCase();
  if (usedSlugs.has(slug)) slug = `${slug}-${slugify(nodeId)}`;
  let candidate = slug;
  let n = 2;
  while (usedSlugs.has(candidate)) candidate = `${slug}-${n++}`;
  usedSlugs.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Sidetre: gruppe → emne → underemner (alle dybder)
// ---------------------------------------------------------------------------

function dedupeActiveTables(tables) {
  const seen = new Set();
  const out = [];
  for (const t of tables) {
    if (t.discontinued) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function subtreeStats(node, stats = { ids: new Set(), discontinued: new Set(), lastUpdated: null }) {
  for (const t of node.tables) {
    (t.discontinued ? stats.discontinued : stats.ids).add(t.id);
    if (!t.discontinued && t.updated && (!stats.lastUpdated || t.updated > stats.lastUpdated)) {
      stats.lastUpdated = t.updated;
    }
  }
  for (const child of Object.values(node.children)) subtreeStats(child, stats);
  return stats;
}

/**
 * Bygger flat liste av sider som skal genereres. Hver side:
 * { dir, url, hashPath, label, breadcrumbs, children, tables,
 *   sections, discontinuedCount, activeCount, totalCount, lastUpdated }
 *
 * Som i appen (topic-view.js): nivåer t.o.m. cardDepth får egne sider med
 * lenker til undersidene (kort), mens første nivå under kortene blir én samlet
 * oversiktsside med hele undertreet som seksjoner — ingen dypere sider.
 */
function buildPages(subjectConfig, hierarchy, cardDepth) {
  const pages = [];

  const bySortCode = (a, b) => String(a.sortCode).localeCompare(String(b.sortCode));
  const byUpdatedDesc = (a, b) => String(b.updated || '').localeCompare(String(a.updated || ''));

  // Hele undertreet som nestede seksjoner (for oversiktssidene under kort-nivåene)
  function buildSections(childNodes) {
    const sections = [];
    for (const child of [...childNodes].sort(bySortCode)) {
      const childStats = subtreeStats(child);
      if (childStats.ids.size === 0) continue;
      sections.push({
        label: child.label,
        tableCount: childStats.ids.size,
        tables: dedupeActiveTables(child.tables).sort(byUpdatedDesc),
        children: buildSections(Object.values(child.children)),
      });
    }
    return sections;
  }

  function addNode(node, label, dir, hashPath, breadcrumbs) {
    const stats = subtreeStats(node);
    const activeCount = stats.ids.size;
    const totalCount = stats.ids.size + stats.discontinued.size;
    const childNodes = Object.values(node.children).sort(bySortCode);

    if (activeCount === 0 && childNodes.length === 0) return null; // tom node — hopp over

    // Under kort-nivåene: samlet oversiktsside med hele undertreet, ingen undersider
    const isOverview = hashPath.length > cardDepth;

    const children = [];
    let sections = [];
    if (isOverview) {
      sections = buildSections(childNodes);
    } else {
      const usedSlugs = new Set();
      for (const child of childNodes) {
        const childStats = subtreeStats(child);
        if (childStats.ids.size === 0 && Object.keys(child.children).length === 0) continue;
        const slug = uniqueSlug(child.label, child.id, usedSlugs);
        const childPage = addNode(
          child, child.label, `${dir}/${slug}`, [...hashPath, child.id],
          [...breadcrumbs, { label, dir }]
        );
        if (childPage) children.push({ label: child.label, dir: childPage.dir, tableCount: childPage.totalCount });
      }
    }

    const page = {
      dir,
      hashPath,
      label,
      breadcrumbs,
      children,
      sections,
      tables: dedupeActiveTables(node.tables).sort(byUpdatedDesc),
      discontinuedCount: isOverview
        ? stats.discontinued.size
        : node.tables.filter(t => t.discontinued).length,
      activeCount,
      totalCount,
      lastUpdated: stats.lastUpdated,
    };
    pages.push(page);
    return page;
  }

  const usedTopSlugs = new Set(RESERVED_TOP_LEVEL);
  for (const group of Object.values(subjectConfig.subjectGroups)) {
    // Gruppe-id-ene (arbeid, befolkning, ...) er allerede stabile ascii-slugs
    const groupSlug = uniqueSlug(group.id, group.id, usedTopSlugs);
    const usedSubjectSlugs = new Set();
    const groupChildren = [];
    let groupLastUpdated = null;
    let groupActive = 0;
    let groupTotal = 0;

    for (const subjectCode of group.subjects) {
      const node = hierarchy[subjectCode];
      if (!node) continue;
      const label = subjectConfig.subjectNames[subjectCode] || node.label;
      const slug = uniqueSlug(label, subjectCode, usedSubjectSlugs);
      const subjectPage = addNode(
        node, label, `${groupSlug}/${slug}`, [subjectCode],
        [{ label: group.label, dir: groupSlug }]
      );
      if (!subjectPage) continue;
      groupChildren.push({ label, dir: subjectPage.dir, tableCount: subjectPage.totalCount });
      groupActive += subjectPage.activeCount;
      groupTotal += subjectPage.totalCount;
      if (subjectPage.lastUpdated && (!groupLastUpdated || subjectPage.lastUpdated > groupLastUpdated)) {
        groupLastUpdated = subjectPage.lastUpdated;
      }
    }

    if (groupChildren.length === 0) continue;
    pages.push({
      dir: groupSlug,
      hashPath: [group.id],
      label: group.label,
      breadcrumbs: [],
      children: groupChildren,
      sections: [],
      tables: [],
      discontinuedCount: 0,
      activeCount: groupActive,
      totalCount: groupTotal,
      lastUpdated: groupLastUpdated,
      isGroup: true,
    });
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Canonical: samme node (delsubtre) kan nås via flere stier → identiske sider
// på ulike URL-er. Vi beholder alle sidene, men lar duplikatene canonicalisere
// mot den første (primære) URL-en med samme innhold, så Google forstår originalen.
// ---------------------------------------------------------------------------

/** Innholdssignatur for en side — utelater brødsmuler og URL/dir (kun synlig
 *  hovedinnhold teller), slik at to sider med samme innhold på ulike stier matcher. */
function pageSignature(page) {
  const ser = (secs) => (secs || []).map(s => ({
    label: s.label,
    tableCount: s.tableCount,
    tables: s.tables.map(t => t.id).sort(),
    children: ser(s.children),
  }));
  return JSON.stringify({
    label: page.label,
    tables: page.tables.map(t => t.id).sort(),
    children: page.children.map(c => [c.label, c.tableCount]),
    sections: ser(page.sections),
    discontinuedCount: page.discontinuedCount,
  });
}

/** Setter page.canonicalDir på hver side: første side med en gitt signatur er
 *  primær (selv-refererende canonical), senere duplikater peker til den. */
function assignCanonicals(pages) {
  const firstBySig = new Map();
  for (const page of pages) {            // pages er i deterministisk genereringsrekkefølge
    const sig = pageSignature(page);     // (subjectGroups-rekkefølge + sortCode) = "første sti"
    if (!firstBySig.has(sig)) firstBySig.set(sig, page.dir);
    page.canonicalDir = firstBySig.get(sig);
  }
  const dupes = pages.filter(p => p.canonicalDir !== p.dir).length;
  if (dupes) console.log(`[SEO] ${dupes} duplikatsider får canonical mot primær sti.`);
  return pages;
}

// ---------------------------------------------------------------------------
// HTML-generering
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

// Forside-injeksjonen rammes inn av markører med originalinnholdet
// base64-kodet, slik at malen kan gjenopprettes uberørt ved neste kjøring
// (index.html er både deployet forside og mal for undersidene).
const ROOT_CONTENT_RE = /(<div id="content">)[\s\S]*?<!-- seo-root:start orig="([A-Za-z0-9+/=]*)" -->[\s\S]*?<!-- seo-root:end -->[\s\S]*?(<\/div>)/;
const ROOT_JSONLD_RE = /\n?[ \t]*<script type="application\/ld\+json" id="seo-root-jsonld">[\s\S]*?<\/script>/;
const ROOT_SEO_PATH_RE = /\n?[ \t]*<script>window\.__SEO_TOPIC_PATH__=\[\];<\/script>/;

function stripRootInjection(html) {
  const m = html.match(ROOT_CONTENT_RE);
  if (m) html = html.replace(ROOT_CONTENT_RE, () => `${m[1]}${Buffer.from(m[2], 'base64').toString('utf8')}${m[3]}`);
  return html.replace(ROOT_JSONLD_RE, '').replace(ROOT_SEO_PATH_RE, '');
}

function loadTemplate(webroot) {
  const templatePath = path.join(webroot, 'index.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Fant ikke ${templatePath} — webroot må inneholde den deployede appen.`);
  }
  const template = stripRootInjection(fs.readFileSync(templatePath, 'utf8'));
  if (!template.includes('__SEO_TOPIC_PATH__')) {
    throw new Error('Deployet index.html mangler __SEO_TOPIC_PATH__-bootstrapen — deploy appversjonen med SEO-støtte (v1.4.1+) først.');
  }
  if (!template.includes('__SEO_TABLE_ID__')) {
    throw new Error('Deployet index.html mangler __SEO_TABLE_ID__-bootstrapen — deploy appversjonen med tabellside-støtte (v1.4.4+) først.');
  }
  return template;
}

/** Erstatt med regex og feil høylytt hvis ankeret ikke finnes i malen. */
function mustReplace(html, regex, replacement, what) {
  if (!regex.test(html)) {
    throw new Error(`Fant ikke anker for ${what} i index.html-malen — malen har endret seg, oppdater scriptet.`);
  }
  return html.replace(regex, replacement);
}

// Google trunkerer snippets rundt 155–160 tegn — hele beskrivelsen må holde seg innenfor
const MAX_DESCRIPTION_LENGTH = 155;

/** Fjern id-prefiks fra tabelletiketter («13760: Befolkning…» → «Befolkning…»),
 *  samme regel som extractTableTitle() i js/utils.js. */
function cleanLabel(label) {
  return String(label || '').replace(/^\d+:\s*/, '');
}

/** Kommaseparert liste med så mange hele elementer som får plass i budsjettet;
 *  tom streng hvis ikke engang det første elementet får plass. */
function fitList(items, budget) {
  let out = '';
  for (const item of items) {
    const next = out ? `${out}, ${item}` : item;
    if (next.length > budget) {
      if (out) out += '…';
      break;
    }
    out = next;
  }
  return out;
}

function buildDescription(page, appConfig) {
  const n = page.activeCount;
  // Kildenavn fra sidens faktiske tabeller — en emneside kan blande kilder
  // (SSB + Norges Bank/FHI). Rene kort-sider uten tabellister får det globale
  // kildenavnet som før.
  const names = [...new Set(collectPageTables(page).map(t => {
    const src = sourceBrandingFor(t.id, appConfig);
    return src.nameFull || src.name;
  }))];
  const sourceName = names.length ? joinNamesNo(names) : (appConfig.source.nameFull || appConfig.source.name);
  let desc = `Statistikk om ${page.label.toLowerCase()}: ${n} ${n === 1 ? 'tabell' : 'tabeller'} fra ${sourceName}.`;
  const childLabels = page.children.length > 0
    ? page.children.map(c => c.label)
    : (page.sections || []).map(s => s.label);
  // «Omfatter A, B, …» — droppes helt hvis ikke engang det første navnet får plass
  const childPart = fitList(childLabels, MAX_DESCRIPTION_LENGTH - desc.length - ' Omfatter .'.length);
  if (childPart) desc += ` Omfatter ${childPart}.`;
  return desc;
}

function buildTableDescription(t, appConfig, meta = null) {
  const src = sourceBrandingFor(t.id, appConfig);
  const sourceName = src.nameFull || src.name;
  const periodPart = t.firstPeriod && t.lastPeriod
    ? ` med tall for perioden ${t.firstPeriod}–${t.lastPeriod}` : '';
  let desc = `${t.discontinued ? 'Avsluttet statistikktabell' : 'Statistikktabell'} ${t.id} fra ${sourceName}${periodPart}.`;
  const names = Array.isArray(t.variableNames) ? [...t.variableNames] : [];
  if (meta) {
    // Statistikkvariabelens verdilabels bak variabelnavnene — fitList kutter mot budsjettet
    for (const label of contentsValueLabels(meta)) {
      if (!names.includes(label)) names.push(label);
    }
  }
  const varPart = fitList(names, MAX_DESCRIPTION_LENGTH - desc.length - ' Variabler: .'.length);
  if (varPart) desc += ` Variabler: ${varPart}.`;
  return desc;
}

/**
 * Gyldig ISO-dato (YYYY-MM-DD) fra en API-tidsverdi, ellers null.
 * SSB-data inneholder enkelte åpenbart ugyldige datoer (f.eks. tabell 04197
 * med updated "0003-10-13") som Google avviser i sitemap/JSON-LD — slike
 * droppes heller enn å emitteres.
 */
function isoDate(value) {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  if (year < 1900 || year > new Date().getFullYear() + 1) return null;
  return s;
}

function formatDateNo(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function tableListHtml(tables) {
  const items = tables.map(t => {
    const updated = isoDate(t.updated) ? ` <small>(oppdatert ${escapeHtml(formatDateNo(t.updated))})</small>` : '';
    // Pen URL (ikke /#variables/) så crawlere oppdager tabellsidene
    return `<li><a href="/table/${escapeAttr(t.id)}/">${escapeHtml(t.label)}</a>${updated}</li>`;
  });
  return `<ul>${items.join('\n')}</ul>`;
}

/** Nestede undertre-seksjoner på oversiktssider: overskrift + tabelliste per nivå. */
function sectionsHtml(sections, level) {
  const h = Math.min(level, 4);
  const parts = [];
  for (const s of sections) {
    parts.push(`<h${h}>${escapeHtml(s.label)} <small>(${s.tableCount} ${s.tableCount === 1 ? 'tabell' : 'tabeller'})</small></h${h}>`);
    if (s.tables.length > 0) parts.push(tableListHtml(s.tables));
    if (s.children.length > 0) parts.push(sectionsHtml(s.children, level + 1));
  }
  return parts.join('\n      ');
}

function buildContentHtml(page, appConfig) {
  const parts = [];

  // Brodsmuler (pene URL-er oppover, gjeldende side som tekst) — samme
  // klasser/separator som appens egne brodsmuler (js/topic-view.js)
  const crumbs = [`<a class="breadcrumb-link" href="/">${escapeHtml(appConfig.app.name)}</a>`];
  for (const crumb of page.breadcrumbs) {
    crumbs.push(`<a class="breadcrumb-link" href="/${escapeAttr(crumb.dir)}/">${escapeHtml(crumb.label)}</a>`);
  }
  crumbs.push(`<span class="breadcrumb-current" aria-current="page">${escapeHtml(page.label)}</span>`);
  parts.push(`<nav class="breadcrumbs" aria-label="Brodsmulesti">${crumbs.join('<span class="breadcrumb-sep">/</span>')}</nav>`);

  parts.push(`<h1>${escapeHtml(page.label)}</h1>`);
  parts.push(`<p>${escapeHtml(buildDescription(page, appConfig))}</p>`);
  if (isoDate(page.lastUpdated)) {
    parts.push(`<p><small>Nyeste tabelloppdatering: ${escapeHtml(formatDateNo(page.lastUpdated))}.</small></p>`);
  }

  if (page.children.length > 0) {
    parts.push('<h2>Underemner</h2>');
    const items = page.children.map(c =>
      `<li><a href="/${escapeAttr(c.dir)}/">${escapeHtml(c.label)}</a> (${formatCount(c.tableCount)} ${c.tableCount === 1 ? 'tabell' : 'tabeller'})</li>`
    );
    parts.push(`<ul>${items.join('\n')}</ul>`);
  }

  if (page.tables.length > 0) {
    parts.push('<h2>Tabeller</h2>');
    parts.push(tableListHtml(page.tables));
  }

  if ((page.sections || []).length > 0) {
    parts.push(sectionsHtml(page.sections, 2));
  }

  if (page.discontinuedCount > 0) {
    parts.push(`<p><small>${page.discontinuedCount} avsluttede tabeller vises ikke her, men er tilgjengelige i portalen.</small></p>`);
  }

  return parts.join('\n      ');
}

/** Alle tabeller en side viser (direkte + i undertre-seksjoner), dedupet på id. */
function collectPageTables(page) {
  const out = new Map();
  for (const t of page.tables) out.set(t.id, t);
  (function walk(sections) {
    for (const s of sections || []) {
      for (const t of s.tables) if (!out.has(t.id)) out.set(t.id, t);
      walk(s.children);
    }
  })(page.sections);
  return [...out.values()];
}

// isoPeriod (periode → ISO 8601 for temporalCoverage) importeres fra
// scripts/lib/seo-sources.mjs, der den har enhetstester.

/**
 * Ett Dataset-objekt (schema.org) for en tabell. url peker alltid på tabellens
 * egen statiske side /table/{id}/ — Dataset-ets kanoniske landingsside.
 */
function datasetJsonLd(t, site, appConfig) {
  const source = sourceBrandingFor(t.id, appConfig);
  const creator = {
    '@type': 'Organization',
    name: source.nameFull || source.name,
    url: source.url,
  };
  const periodPart = t.firstPeriod && t.lastPeriod
    ? ` med tall for perioden ${t.firstPeriod}–${t.lastPeriod}` : '';
  const coverage = isoPeriod(t.firstPeriod) && isoPeriod(t.lastPeriod)
    ? `${isoPeriod(t.firstPeriod)}/${isoPeriod(t.lastPeriod)}` : null;
  return {
    '@type': 'Dataset',
    name: t.label,
    description: `${t.label}. ${t.discontinued ? 'Avsluttet statistikktabell' : 'Statistikktabell'} ${t.id} fra ${creator.name}${periodPart}.`,
    identifier: t.id,
    url: `${site}/table/${t.id}/`,
    isAccessibleForFree: true,
    ...(coverage ? { temporalCoverage: coverage } : {}),
    ...(Array.isArray(t.variableNames) && t.variableNames.length ? { keywords: t.variableNames } : {}),
    ...(isoDate(t.updated) ? { dateModified: isoDate(t.updated) } : {}),
    ...(source.licenseUrl ? { license: source.licenseUrl } : {}),
    creator,
  };
}

/**
 * Strukturerte data (schema.org JSON-LD): CollectionPage + BreadcrumbList for
 * alle sider, pluss DataCatalog med Dataset per tabell (trigget av Google
 * Dataset Search) på sider som lister tabeller.
 */
function buildJsonLd(page, site, appConfig) {
  const url = `${site}/${page.dir}/`;
  const graph = [];

  graph.push({
    '@type': 'CollectionPage',
    name: `${page.label} – ${appConfig.app.name}`,
    url,
    description: buildDescription(page, appConfig),
    inLanguage: 'no',
    ...(isoDate(page.lastUpdated) ? { dateModified: isoDate(page.lastUpdated) } : {}),
    isPartOf: { '@type': 'WebSite', name: appConfig.app.name, url: `${site}/` },
  });

  const crumbItems = [
    { name: appConfig.app.name, item: `${site}/` },
    ...page.breadcrumbs.map(c => ({ name: c.label, item: `${site}/${c.dir}/` })),
    { name: page.label, item: url },
  ];
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: crumbItems.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.item,
    })),
  });

  const allTables = collectPageTables(page);
  if (allTables.length > 0) {
    // Ingen license på katalognivå — en emneside kan blande kilder med ulike
    // lisenser; hvert Dataset bærer sin egen kildes license fra datasetJsonLd.
    graph.push({
      '@type': 'DataCatalog',
      name: `${page.label} – ${appConfig.app.name}`,
      url,
      dataset: allTables.map(t => datasetJsonLd(t, site, appConfig)),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

function renderPage(template, page, site, appConfig) {
  // Duplikatsider canonicaliserer mot den primære URL-en med samme innhold
  const canonicalUrl = `${site}/${page.canonicalDir || page.dir}/`;
  const title = `${page.label} – ${appConfig.app.name}`;
  const description = buildDescription(page, appConfig);

  let html = template;

  html = mustReplace(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`, '<title>');
  html = mustReplace(
    html,
    /<meta name="description" content="[^"]*" id="meta-description">/,
    `<meta name="description" content="${escapeAttr(description)}" id="meta-description">`,
    'meta description'
  );
  html = mustReplace(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`, 'canonical');
  html = mustReplace(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`, 'og:title');
  html = mustReplace(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`, 'og:description');
  html = mustReplace(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`, 'og:url');

  // Relative asset-stier → absolutte (sidene ligger 1–4 mapper dypt)
  html = html.replace(/href="css\//g, 'href="/css/').replace(/src="js\//g, 'src="/js/');

  // JSON-LD strukturerte data ("<" escapes så "</script>" i labels ikke kan bryte ut).
  // id="seo-jsonld" lar appen (js/seo-head.js) fjerne den ved navigering bort.
  const jsonLd = JSON.stringify(buildJsonLd(page, site, appConfig)).replace(/</g, '\\u003c');
  html = mustReplace(
    html,
    /<\/head>/,
    `  <script type="application/ld+json" id="seo-jsonld">${jsonLd}</script>\n</head>`,
    '</head> (JSON-LD)'
  );

  // Embed topic-path før første app-script
  html = mustReplace(
    html,
    /(<script src="\/js\/version\.js")/,
    `<script>window.__SEO_TOPIC_PATH__=${JSON.stringify(page.hashPath)};</script>\n  $1`,
    'script-injeksjon (js/version.js)'
  );

  // Statisk crawlbart innhold i #content
  matchContentDiv(html);
  html = html.replace(CONTENT_DIV_RE, `$1\n      ${buildContentHtml(page, appConfig)}\n    $3`);

  return html;
}

const CONTENT_DIV_RE = /(<div id="content">)([\s\S]*?)(<\/div>)/;

function matchContentDiv(html) {
  const match = html.match(CONTENT_DIV_RE);
  if (!match) throw new Error('Fant ikke <div id="content"> i malen.');
  if (match[2].length > 500) {
    throw new Error('<div id="content"> i malen har uventet mye innhold — strukturen kan ha endret seg, oppdater scriptet.');
  }
  return match;
}

// ---------------------------------------------------------------------------
// Lokale tabellmetadata (data/table-metadata/{id}.json)
//
// Et eget oppdaterings-script laster ned eksakte responser fra
// GET /tables/{id}/metadata?lang=no (JSON-Stat2) til katalogen — se
// data/table-metadata/README.md for kontrakten. Generatoren leser filene
// per tabellside (lazy, aldri alle i minnet) og skriver aldri i katalogen.
// ---------------------------------------------------------------------------

/** Les og valider en lokal metadatafil; null (med warn ved korrupt fil) gir fallback. */
function loadLocalMetadata(metadataDir, id) {
  const filePath = path.join(metadataDir, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!meta || typeof meta !== 'object' || !meta.dimension || !meta.label) {
      console.warn(`[SEO] Metadatafilen for ${id} mangler dimension/label — bruker fallback.`);
      return null;
    }
    return meta;
  } catch (err) {
    console.warn(`[SEO] Klarte ikke å lese metadatafilen for ${id} (${err.message}) — bruker fallback.`);
    return null;
  }
}

/** Fjern SSBs «¬»-hierarkimarkører fra en verdilabel (duplikat av
 *  parseHierarchyLabel i js/variable-select-render.js — endres regelen der,
 *  må den oppdateres her også). */
function stripHierarchyPrefix(label) {
  return String(label || '').replace(/^¬+\s*/, '');
}

/** Notat → HTML: escape først, deretter markdown-lenker [tekst](url) → <a>
 *  (duplikat av convertMarkdownLinks i js/table-metadata.js). */
function noteHtml(note) {
  return escapeHtml(note).replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>'
  );
}

/** Notat → ren tekst for JSON-LD: markdown-lenker reduseres til lenketeksten. */
function noteText(note) {
  return String(note || '').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
}

/** Klass-/VarDok-URN → nettleservennlig URL (duplikat av _urnToUrl i
 *  js/table-metadata.js, alltid norsk utgave). */
function urnToUrl(href) {
  if (!href) return null;
  if (String(href).startsWith('http')) return href;
  const klass = String(href).match(/^urn:ssb:classification:klass:(\d+)$/);
  if (klass) return `https://www.ssb.no/klass/klassifikasjoner/${klass[1]}`;
  const vardok = String(href).match(/^urn:ssb:conceptvariable:vardok:(\d+)$/);
  if (vardok) return `https://www.ssb.no/a/metadata/conceptvariable/vardok/${vardok[1]}/nb`;
  return null;
}

/** Verdikodene i en JSON-Stat2-category i definert rekkefølge
 *  (category.index kan være array eller {kode: posisjon}-objekt). */
function orderedCodes(category) {
  const index = category?.index;
  if (Array.isArray(index)) return index;
  if (index && typeof index === 'object') {
    return Object.keys(index).sort((a, b) => index[a] - index[b]);
  }
  return Object.keys(category?.label || {});
}

/** Dimensjonskodene i metadataenes egen rekkefølge. */
function dimensionCodes(meta) {
  return Array.isArray(meta.id) ? meta.id : Object.keys(meta.dimension || {});
}

/** Verdilabels for statistikkvariabelen (ContentsCode) — de mest søkbare
 *  termene, brukt i meta description og JSON-LD keywords. */
function contentsValueLabels(meta) {
  const metric = new Set(meta.role?.metric || []);
  const out = [];
  for (const code of dimensionCodes(meta)) {
    if (!metric.has(code) && code !== 'ContentsCode') continue;
    const dim = meta.dimension?.[code];
    for (const vc of orderedCodes(dim?.category)) {
      out.push(stripHierarchyPrefix(dim.category?.label?.[vc] ?? vc));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tabellsider (/table/{id}/): Dataset-enes kanoniske landingssider
// ---------------------------------------------------------------------------

/**
 * Én side per tabell — også avsluttede (historiske tall er søkbare og
 * tilgjengelige i portalen). Brødsmule-forelderen er den dypeste emnesiden
 * langs tabellens første sti (paths[0], konsistent med appens
 * buildNavigationBreadcrumb) — emnesider finnes bare t.o.m. cardDepth+1,
 * mens tabellstiene kan gå dypere.
 */
function buildTableEntries(tables, pages) {
  const pageByHashPath = new Map(pages.map(p => [p.hashPath.join('/'), p]));
  const entries = new Map();
  for (const t of tables) {
    if (entries.has(t.id)) continue;
    if (!/^[\w-]+$/.test(t.id)) {
      console.warn(`[SEO] Hopper over tabell med uventet id: ${JSON.stringify(t.id)}`);
      continue;
    }
    let crumbPage = null;
    const firstPath = (t.paths && t.paths[0]) || [];
    for (let len = firstPath.length; len > 0 && !crumbPage; len--) {
      crumbPage = pageByHashPath.get(firstPath.slice(0, len).map(seg => seg.id).join('/')) || null;
    }
    entries.set(t.id, { id: t.id, dir: `table/${t.id}`, table: t, crumbPage });
  }
  return [...entries.values()];
}

function buildTableContentHtml(entry, appConfig, meta = null) {
  const t = entry.table;
  const label = cleanLabel(t.label);
  const src = sourceBrandingFor(t.id, appConfig);
  const parts = [];

  const crumbs = [`<a class="breadcrumb-link" href="/">${escapeHtml(appConfig.app.name)}</a>`];
  if (entry.crumbPage) {
    for (const crumb of entry.crumbPage.breadcrumbs) {
      crumbs.push(`<a class="breadcrumb-link" href="/${escapeAttr(crumb.dir)}/">${escapeHtml(crumb.label)}</a>`);
    }
    const crumbDir = entry.crumbPage.canonicalDir || entry.crumbPage.dir;
    crumbs.push(`<a class="breadcrumb-link" href="/${escapeAttr(crumbDir)}/">${escapeHtml(entry.crumbPage.label)}</a>`);
  }
  crumbs.push(`<span class="breadcrumb-current" aria-current="page">${escapeHtml(label)}</span>`);
  parts.push(`<nav class="breadcrumbs" aria-label="Brodsmulesti">${crumbs.join('<span class="breadcrumb-sep">/</span>')}</nav>`);

  parts.push(`<h1>${escapeHtml(label)}</h1>`);
  parts.push(`<p>${escapeHtml(buildTableDescription(t, appConfig, meta))}</p>`);

  // Faktaliste — tidsperiode og oppdatert-dato alltid fra den ferske /tables-oppføringen
  const facts = [`Tabell-ID: ${escapeHtml(t.id)}`];
  if (t.discontinued) facts.push('Status: Avsluttet — tabellen oppdateres ikke lenger, men tallene er fortsatt tilgjengelige');
  if (t.firstPeriod && t.lastPeriod) facts.push(`Tidsperiode: ${escapeHtml(t.firstPeriod)}–${escapeHtml(t.lastPeriod)}`);
  if (isoDate(t.updated)) facts.push(`Sist oppdatert: ${escapeHtml(formatDateNo(t.updated))}`);
  const license = src.licenseUrl
    ? ` (<a href="${escapeAttr(src.licenseUrl)}" rel="noopener noreferrer">${escapeHtml(src.licenseName || 'lisens')}</a>)` : '';
  facts.push(`Kilde: <a href="${escapeAttr(src.url)}" rel="noopener noreferrer">${escapeHtml(src.nameFull || src.name)}</a>${license}`);
  parts.push(`<ul>${facts.map(m => `<li>${m}</li>`).join('\n')}</ul>`);

  if (meta) {
    parts.push(...buildEnrichedSections(meta, t));
  } else if (Array.isArray(t.variableNames) && t.variableNames.length > 0) {
    parts.push('<h2>Variabler i tabellen</h2>');
    parts.push(`<ul>${t.variableNames.map(v => `<li>${escapeHtml(v)}</li>`).join('\n')}</ul>`);
  }

  parts.push(`<p><a href="/#variables/${escapeAttr(t.id)}">Åpne tabellen i ${escapeHtml(appConfig.app.name)}</a> — velg variabler, se og last ned tallene.</p>`);
  if (entry.crumbPage) {
    const crumbDir = entry.crumbPage.canonicalDir || entry.crumbPage.dir;
    parts.push(`<p><a href="/${escapeAttr(crumbDir)}/">Flere tabeller om ${escapeHtml(entry.crumbPage.label.toLowerCase())}</a></p>`);
  }

  return parts.join('\n      ');
}

/**
 * Berikede innholdsseksjoner for en tabellside med lokal metadatafil:
 * notater som prosa, alle verdilabels per dimensjon (statistikkvariabelen
 * med enheter), Klass-/VarDok-lenker og kontakt. Tidsdimensjonen vises som
 * range fra den ferske /tables-oppføringen — periodekoder («2024M01» osv.)
 * har ingen søkeverdi, og metadatafilens perioder kan være gamle.
 */
function buildEnrichedSections(meta, t) {
  const parts = [];

  const notes = (Array.isArray(meta.note) ? meta.note : []).filter(Boolean);
  if (notes.length > 0) {
    parts.push('<h2>Om tabellen</h2>');
    for (const note of notes) parts.push(`<p>${noteHtml(note)}</p>`);
  }

  const timeDims = new Set(meta.role?.time || []);
  const metricDims = new Set(meta.role?.metric || []);
  const dimParts = [];
  for (const code of dimensionCodes(meta)) {
    const dim = meta.dimension?.[code];
    if (!dim) continue;
    if (timeDims.has(code) || code === 'Tid') {
      if (t.firstPeriod && t.lastPeriod) {
        dimParts.push(`<h3>${escapeHtml(dim.label || code)}</h3>`);
        dimParts.push(`<p>Tall for perioden ${escapeHtml(t.firstPeriod)}–${escapeHtml(t.lastPeriod)}.</p>`);
      }
      continue;
    }
    const codes = orderedCodes(dim.category);
    if (codes.length === 0) continue;
    const isMetric = metricDims.has(code) || code === 'ContentsCode';
    const items = codes.map(vc => {
      const label = stripHierarchyPrefix(dim.category?.label?.[vc] ?? vc);
      const unit = isMetric ? dim.category?.unit?.[vc]?.base : null;
      return `<li>${escapeHtml(label)}${unit ? ` <small>(${escapeHtml(unit)})</small>` : ''}</li>`;
    });
    dimParts.push(`<h3>${escapeHtml(dim.label || code)} <small>(${codes.length} ${codes.length === 1 ? 'verdi' : 'verdier'})</small></h3>`);
    dimParts.push(`<ul>${items.join('\n')}</ul>`);
  }
  if (dimParts.length > 0) {
    parts.push('<h2>Variabler og verdier</h2>', ...dimParts);
  }

  // Klass-/VarDok-lenker fra link.describedby (datasett- og dimensjonsnivå),
  // dedupet på URN. SSB bruker to former: {href, label} og
  // {extension: {DimKode: "urn:... urn:..."}} (mellomromsseparert URN-liste).
  const seenHrefs = new Set();
  const linkItems = [];
  const addLinks = (entries, dimLabel) => {
    for (const link of entries || []) {
      const hrefs = link?.href
        ? [{ href: link.href, label: link.label }]
        : Object.values(link?.extension || {})
            .flatMap(v => String(v).split(/\s+/))
            .filter(Boolean)
            .map(href => ({ href }));
      for (const { href, label } of hrefs) {
        if (seenHrefs.has(href)) continue;
        const url = urnToUrl(href);
        if (!url) continue;
        seenHrefs.add(href);
        const klassId = href.match(/klass:(\d+)$/)?.[1];
        const vardokId = href.match(/vardok:(\d+)$/)?.[1];
        const text = label
          || (klassId ? `Klassifikasjon ${klassId} (Klass)` : null)
          || (vardokId ? `Variabeldefinisjon ${vardokId} (VarDok)` : null)
          || href;
        const prefix = dimLabel ? `${escapeHtml(dimLabel)}: ` : '';
        linkItems.push(`<li>${prefix}<a href="${escapeAttr(url)}" rel="noopener noreferrer">${escapeHtml(text)}</a></li>`);
      }
    }
  };
  addLinks(meta.link?.describedby, null);
  for (const dim of Object.values(meta.dimension || {})) addLinks(dim.link?.describedby, dim.label);
  if (linkItems.length > 0) {
    parts.push('<h2>Klassifikasjoner og definisjoner</h2>');
    parts.push(`<ul>${linkItems.join('\n')}</ul>`);
  }

  const contacts = (meta.extension?.contact || []).filter(c => c && (c.name || c.mail));
  if (contacts.length > 0) {
    const contactStr = contacts.map(c => {
      const bits = [];
      if (c.name) bits.push(escapeHtml(c.name));
      if (c.mail) bits.push(`<a href="mailto:${escapeAttr(c.mail)}">${escapeHtml(c.mail)}</a>`);
      return bits.join(', ');
    }).join('; ');
    parts.push(`<p><small>Kontakt hos ${escapeHtml(meta.source || 'kilden')}: ${contactStr}</small></p>`);
  }

  return parts;
}

/**
 * Berik tabellsidens Dataset med innhold fra den lokale metadatafilen.
 * Brukes KUN på tabellsidene — emnesidenes DataCatalog beholder de slanke
 * Dataset-ene fra datasetJsonLd(). dateModified/temporalCoverage arves
 * urørt fra base (ferske /tables-verdier — ferskhetsregelen).
 */
function enrichDatasetJsonLd(base, meta, t) {
  const timeDims = new Set(meta.role?.time || []);
  const metricDims = new Set(meta.role?.metric || []);

  const MAX_VARIABLES = 30;
  const variableMeasured = [];
  for (const code of dimensionCodes(meta)) {
    const dim = meta.dimension?.[code];
    if (!dim || timeDims.has(code) || code === 'Tid') continue;
    if (metricDims.has(code) || code === 'ContentsCode') {
      // Statistikkvariabelens verdier er de faktisk målte størrelsene — med enhet
      for (const vc of orderedCodes(dim.category)) {
        if (variableMeasured.length >= MAX_VARIABLES) break;
        const unit = dim.category?.unit?.[vc]?.base;
        variableMeasured.push({
          '@type': 'PropertyValue',
          name: stripHierarchyPrefix(dim.category?.label?.[vc] ?? vc),
          ...(unit ? { unitText: unit } : {}),
        });
      }
    } else if (variableMeasured.length < MAX_VARIABLES) {
      variableMeasured.push({ '@type': 'PropertyValue', name: dim.label || code });
    }
  }

  const noteStr = (Array.isArray(meta.note) ? meta.note : []).filter(Boolean).map(noteText).join(' ');
  const description = noteStr ? `${base.description} ${noteStr}`.slice(0, 5000) : base.description;

  // Nøkkelord: variabelnavn + dimensjonslabels + statistikkvariabelens verdier.
  // Aldri verdilabels fra store dimensjoner (kommuner osv.) — de ligger i brødteksten.
  const MAX_KEYWORDS = 25;
  const keywords = new Set(Array.isArray(t.variableNames) ? t.variableNames : []);
  for (const code of dimensionCodes(meta)) {
    const dim = meta.dimension?.[code];
    if (dim?.label && !timeDims.has(code) && code !== 'Tid') keywords.add(dim.label);
  }
  for (const label of contentsValueLabels(meta)) keywords.add(label);

  return {
    ...base,
    description,
    ...(variableMeasured.length ? { variableMeasured } : {}),
    ...(keywords.size ? { keywords: [...keywords].slice(0, MAX_KEYWORDS) } : {}),
    ...(meta.role?.geo?.length ? { spatialCoverage: 'Norge' } : {}),
  };
}

/** Dataset (med katalog-kobling) + BreadcrumbList for en tabellside. */
function buildTableJsonLd(entry, site, appConfig, meta = null) {
  const url = `${site}/table/${entry.id}/`;
  const graph = [];

  let dataset = datasetJsonLd(entry.table, site, appConfig);
  if (meta) dataset = enrichDatasetJsonLd(dataset, meta, entry.table);
  graph.push({
    ...dataset,
    includedInDataCatalog: { '@type': 'DataCatalog', name: appConfig.app.name, url: `${site}/` },
  });

  const crumbItems = [{ name: appConfig.app.name, item: `${site}/` }];
  if (entry.crumbPage) {
    for (const c of entry.crumbPage.breadcrumbs) {
      crumbItems.push({ name: c.label, item: `${site}/${c.dir}/` });
    }
    const crumbDir = entry.crumbPage.canonicalDir || entry.crumbPage.dir;
    crumbItems.push({ name: entry.crumbPage.label, item: `${site}/${crumbDir}/` });
  }
  crumbItems.push({ name: cleanLabel(entry.table.label), item: url });
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: crumbItems.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.item,
    })),
  });

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Som renderPage(), men for en tabellside (samme mal, samme ankere).
 *  meta er tabellens lokale metadatafil eller null (fallback til /tables-felter). */
function renderTablePage(template, entry, site, appConfig, meta = null) {
  const t = entry.table;
  const url = `${site}/table/${entry.id}/`;
  const title = `${cleanLabel(t.label)} – ${appConfig.app.name}`;
  const description = buildTableDescription(t, appConfig, meta);

  let html = template;

  html = mustReplace(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`, '<title>');
  html = mustReplace(
    html,
    /<meta name="description" content="[^"]*" id="meta-description">/,
    `<meta name="description" content="${escapeAttr(description)}" id="meta-description">`,
    'meta description'
  );
  html = mustReplace(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(url)}">`, 'canonical');
  html = mustReplace(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`, 'og:title');
  html = mustReplace(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`, 'og:description');
  html = mustReplace(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(url)}">`, 'og:url');

  // Relative asset-stier → absolutte (sidene ligger under /table/{id}/)
  html = html.replace(/href="css\//g, 'href="/css/').replace(/src="js\//g, 'src="/js/');

  const jsonLd = JSON.stringify(buildTableJsonLd(entry, site, appConfig, meta)).replace(/</g, '\\u003c');
  html = mustReplace(
    html,
    /<\/head>/,
    `  <script type="application/ld+json" id="seo-jsonld">${jsonLd}</script>\n</head>`,
    '</head> (JSON-LD)'
  );

  html = mustReplace(
    html,
    /(<script src="\/js\/version\.js")/,
    `<script>window.__SEO_TABLE_ID__=${JSON.stringify(entry.id)};</script>\n  $1`,
    'script-injeksjon (js/version.js)'
  );

  matchContentDiv(html);
  html = html.replace(CONTENT_DIV_RE, `$1\n      ${buildTableContentHtml(entry, appConfig, meta)}\n    $3`);

  return html;
}

// ---------------------------------------------------------------------------
// Forsiden (index.html): statisk crawlbart innhold + WebSite JSON-LD
// ---------------------------------------------------------------------------

function formatCount(n) {
  return n.toLocaleString('nb-NO');
}

/** Søkefeltets placeholder fra js/translations.js (standardspråket), med fallback. */
function loadSearchPlaceholder(appConfig) {
  const FALLBACK = 'Søk etter tabell (ID, tittel, variabler...)';
  try {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'js', 'translations.js'), 'utf8');
    const sandbox = {
      window: {},
      localStorage: { getItem: () => null, setItem: () => {} },
      navigator: { language: 'nb' },
    };
    vm.runInNewContext(`${src}\n;window.__translations = translations;`, sandbox);
    return sandbox.window.__translations?.[appConfig.defaultLanguage || 'nb']?.['search.placeholder'] || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Statisk forside-innhold som speiler appens egen forside (js/front-page.js):
 * søkefelt + emnegrid med samme CSS-klasser og tekster, slik at overgangen til
 * den dynamiske visningen knapt synes (visningen beholder dette som
 * plassholder under lastingen — se seoContentMatchesRoute i js/utils.js).
 * SEO-teksten (totaltall, emnefordeling med lenker til gruppesidene) ligger i
 * en egen seksjon under gridet, der appens «Nylig oppdaterte» senere vises.
 */
function buildRootContentHtml(pages, totalTables, appConfig) {
  const sourceName = joinNamesNo(enabledSourceNames(appConfig));
  const groups = pages.filter(p => p.isGroup);
  const parts = [];
  parts.push('<div class="front-page">');
  parts.push(`<div class="front-search-container"><input type="text" id="front-search" placeholder="${escapeAttr(loadSearchPlaceholder(appConfig))}" class="search-input front-search-input" /></div>`);
  parts.push('<div class="subject-grid">');
  for (const group of groups) {
    const items = group.children.map(c =>
      `<li><a href="/${escapeAttr(c.dir)}/" class="front-subject-link">${escapeHtml(c.label)}</a></li>`
    );
    parts.push(`<div class="subject-group-column">
        <h3 class="subject-group-column-header">${escapeHtml(group.label)}</h3>
        <ul class="subject-list">${items.join('\n')}</ul>
      </div>`);
  }
  parts.push('</div>');
  const distribution = groups.map(g =>
    `<a href="/${escapeAttr(g.dir)}/">${escapeHtml(g.label)}</a> (${formatCount(g.totalCount)} tabeller)`
  ).join(', ');
  parts.push(`<section class="front-seo-intro">
        <p>Utforsk ${formatCount(totalTables)} statistikktabeller fra ${escapeHtml(sourceName)} — søk, filtrer og last ned tall, gratis og uten innlogging.</p>
        <p>Tabellene fordeler seg på ${distribution}. Mange tabeller hører til flere emner.</p>
      </section>`);
  parts.push('</div>');
  return parts.join('\n      ');
}

/**
 * Forsiden beholder appens relative asset-stier, men får emnerik tittel og
 * beskrivelse, statisk emneoversikt i #content (med base64-bevart original,
 * se stripRootInjection), WebSite JSON-LD og canonical/og:url satt til --site.
 * window.__SEO_TOPIC_PATH__=[] markerer siden som pre-rendret, slik at
 * init-koden i index.html lar tittel og meta-description stå.
 */
function renderRootPage(template, site, appConfig, pages, totalTables) {
  const match = matchContentDiv(template);
  const orig = Buffer.from(match[2], 'utf8').toString('base64');
  const inner = `<!-- seo-root:start orig="${orig}" -->\n      ${buildRootContentHtml(pages, totalTables, appConfig)}\n      <!-- seo-root:end -->`;
  let html = template.replace(CONTENT_DIV_RE, () => `${match[1]}\n      ${inner}\n    ${match[3]}`);

  const sourceName = joinNamesNo(enabledSourceNames(appConfig));
  const title = `${appConfig.app.name} – utforsk statistikk fra ${joinNamesNo(enabledSourceNames(appConfig, 'name'))}`;
  const description = `Søk i ${formatCount(totalTables)} statistikktabeller fra ${sourceName}. ${appConfig.app.name} samler åpne statistikkdata på ett sted. Utforsk, filtrer og last ned tall.`;

  html = mustReplace(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`, '<title> (forside)');
  html = mustReplace(
    html,
    /<meta name="description" content="[^"]*" id="meta-description">/,
    `<meta name="description" content="${escapeAttr(description)}" id="meta-description">`,
    'meta description (forside)'
  );
  html = mustReplace(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(site)}/">`, 'canonical (forside)');
  html = mustReplace(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`, 'og:title (forside)');
  html = mustReplace(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`, 'og:description (forside)');
  html = mustReplace(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(site)}/">`, 'og:url (forside)');
  html = mustReplace(
    html,
    /(<script src="js\/version\.js")/,
    `<script>window.__SEO_TOPIC_PATH__=[];</script>\n  $1`,
    'script-injeksjon (forside, js/version.js)'
  );

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: appConfig.app.name,
    url: `${site}/`,
    description,
    publisher: { '@type': 'Organization', name: appConfig.app.name, url: `${site}/` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site}/#search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }).replace(/</g, '\\u003c');
  html = mustReplace(
    html,
    /<\/head>/,
    `  <script type="application/ld+json" id="seo-root-jsonld">${jsonLd}</script>\n</head>`,
    '</head> (JSON-LD forside)'
  );

  return html;
}

// ---------------------------------------------------------------------------
// sitemap.xml / robots.txt
// ---------------------------------------------------------------------------

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildSitemap(pages, tableEntries, site) {
  const newest = pages.reduce((max, p) =>
    (p.lastUpdated && (!max || p.lastUpdated > max)) ? p.lastUpdated : max, null);
  const entries = [{ loc: `${site}/`, lastmod: isoDate(newest) }];
  // Kun kanoniske URL-er i sitemap — duplikater canonicaliserer mot en annen URL
  for (const page of pages.filter(p => p.dir === (p.canonicalDir || p.dir))) {
    entries.push({
      loc: `${site}/${page.dir}/`,
      lastmod: isoDate(page.lastUpdated),
    });
  }
  for (const entry of tableEntries) {
    entries.push({
      loc: `${site}/${entry.dir}/`,
      lastmod: isoDate(entry.table.updated),
    });
  }
  if (entries.length >= 50000) {
    throw new Error(`sitemap.xml ville fått ${entries.length} URL-er (grensen er 50 000) — del opp i sitemap-indeks.`);
  }
  const urls = entries.map(e => {
    const lastmod = e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(e.loc)}</loc>${lastmod}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function buildRobots(site) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`;
}

/**
 * seo-map.json: rute → kanonisk URL-oppslag for appens head-sync
 * (js/seo-head.js). topics: hash-sti → pen mappe (duplikater løses til den
 * primære). tables: id-ene som faktisk har /table/{id}/-sider, så appen
 * aldri setter canonical mot en side som ikke finnes.
 */
function buildSeoMap(pages, tableEntries, site) {
  const topics = {};
  for (const page of pages) {
    topics[page.hashPath.join('/')] = page.canonicalDir || page.dir;
  }
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    site,
    topics,
    tables: tableEntries.map(e => e.id).sort(),
  });
}

// ---------------------------------------------------------------------------
// Skriving og opprydding (kun manifest-eide slettinger)
// ---------------------------------------------------------------------------

const MANIFEST_NAME = '.seo-manifest.json';

function loadManifest(webroot) {
  const p = path.join(webroot, MANIFEST_NAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    console.warn('[SEO] Klarte ikke å lese eksisterende manifest — hopper over opprydding.');
    return null;
  }
}

function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function main_write(webroot, site, appConfig, pages, tableEntries, totalTables, oldManifest, dryRun, metadataDir) {
  const newDirs = [...pages.map(p => p.dir), ...tableEntries.map(e => e.dir)].sort();
  const sitemap = buildSitemap(pages, tableEntries, site);
  const seoMap = buildSeoMap(pages, tableEntries, site);

  // robots.txt: skriv kun hvis fraværende eller eid av dette scriptet
  const robotsPath = path.join(webroot, 'robots.txt');
  const robotsOwned = !fs.existsSync(robotsPath) || (oldManifest?.files || []).includes('robots.txt');
  const newFiles = ['sitemap.xml', 'seo-map.json'];
  if (robotsOwned) newFiles.push('robots.txt');
  else console.warn(`[SEO] robots.txt finnes fra før og eies ikke av scriptet — legg til "Sitemap: ${site}/sitemap.xml" manuelt.`);

  // Slettekandidater: mapper fra forrige kjøring som ikke lenger genereres
  const oldDirs = oldManifest?.dirs || [];
  const newDirSet = new Set(newDirs);
  const staleDirs = oldDirs.filter(d => !newDirSet.has(d));

  if (dryRun) {
    const listCap = 20;
    const withMetaCount = tableEntries.filter(e => fs.existsSync(path.join(metadataDir, `${e.id}.json`))).length;
    console.log(`\n[SEO] DRY RUN — ingen filer skrives.`);
    console.log(`[SEO] Ville skrevet forside-innhold i index.html + ${pages.length} emnesider + ${tableEntries.length} tabellsider (${withMetaCount} med lokale metadata) + sitemap.xml + seo-map.json${robotsOwned ? ' + robots.txt' : ''}.`);
    for (const d of newDirs.slice(0, listCap)) console.log(`  /${d}/`);
    if (newDirs.length > listCap) console.log(`  … og ${newDirs.length - listCap} til`);
    if (staleDirs.length) {
      console.log(`[SEO] Ville slettet ${staleDirs.length} utdaterte mapper:`);
      for (const d of staleDirs.slice(0, listCap)) console.log(`  /${d}/`);
      if (staleDirs.length > listCap) console.log(`  … og ${staleDirs.length - listCap} til`);
    }
    const template = loadTemplate(webroot);
    const sample = pages.find(p => (p.sections || []).length > 0) || pages[pages.length - 1];
    console.log(`\n[SEO] Eksempel-emneside (/${sample.dir}/):\n`);
    console.log(renderPage(template, sample, site, appConfig));
    const tableSample = tableEntries.find(e => e.crumbPage && (e.table.variableNames || []).length > 0) || tableEntries[0];
    if (tableSample) {
      console.log(`\n[SEO] Eksempel-tabellside (/${tableSample.dir}/):\n`);
      console.log(renderTablePage(template, tableSample, site, appConfig));
    }
    // Én eksempelside per fremmed kilde, så per-kilde-attribusjonen (Kilde:/
    // license i JSON-LD) kan inspiseres uten full kjøring
    for (const prefix of ['nb-', 'fhi-']) {
      const foreignSample = tableEntries.find(e => e.id.startsWith(prefix));
      if (foreignSample) {
        console.log(`\n[SEO] Eksempel-tabellside for fremmed kilde (/${foreignSample.dir}/):\n`);
        console.log(renderTablePage(template, foreignSample, site, appConfig));
      }
    }
    // I tillegg: første tabell med gyldig lokal metadatafil, som beriket eksempel
    let enrichedSample = null;
    for (const entry of tableEntries) {
      const meta = loadLocalMetadata(metadataDir, entry.id);
      if (meta) { enrichedSample = { entry, meta }; break; }
    }
    if (enrichedSample) {
      console.log(`\n[SEO] Eksempel på beriket tabellside (/${enrichedSample.entry.dir}/):\n`);
      console.log(renderTablePage(template, enrichedSample.entry, site, appConfig, enrichedSample.meta));
    }
    return;
  }

  // 1) Skriv alle nye sider + statisk forside-innhold i index.html
  const template = loadTemplate(webroot);
  for (const page of pages) {
    const dirPath = path.join(webroot, page.dir);
    fs.mkdirSync(dirPath, { recursive: true });
    atomicWrite(path.join(dirPath, 'index.html'), renderPage(template, page, site, appConfig));
  }
  let enrichedCount = 0;
  for (const entry of tableEntries) {
    const meta = loadLocalMetadata(metadataDir, entry.id);
    if (meta) enrichedCount++;
    const dirPath = path.join(webroot, entry.dir);
    fs.mkdirSync(dirPath, { recursive: true });
    atomicWrite(path.join(dirPath, 'index.html'), renderTablePage(template, entry, site, appConfig, meta));
  }
  atomicWrite(path.join(webroot, 'index.html'), renderRootPage(template, site, appConfig, pages, totalTables));
  console.log(`[SEO] Skrev ${pages.length} emnesider + ${tableEntries.length} tabellsider (${enrichedCount} beriket med lokale metadata) + forside-innhold i index.html.`);

  // 2) sitemap + seo-map + robots
  atomicWrite(path.join(webroot, 'sitemap.xml'), sitemap);
  atomicWrite(path.join(webroot, 'seo-map.json'), seoMap);
  if (robotsOwned) atomicWrite(robotsPath, buildRobots(site));

  // 3) Rydd opp utdaterte mapper (kun index.html + tomme mapper, aldri rekursivt)
  for (const dir of staleDirs.sort((a, b) => b.split('/').length - a.split('/').length)) {
    const indexPath = path.join(webroot, dir, 'index.html');
    try { fs.unlinkSync(indexPath); } catch { /* allerede borte */ }
    try { fs.rmdirSync(path.join(webroot, dir)); } catch { /* ikke tom — rører den ikke */ }
  }
  if (staleDirs.length) console.log(`[SEO] Ryddet ${staleDirs.length} utdaterte mapper.`);

  // 4) Manifest sist
  atomicWrite(path.join(webroot, MANIFEST_NAME), JSON.stringify({
    generatedAt: new Date().toISOString(),
    site,
    dirs: newDirs,
    files: newFiles,
  }, null, 2));
  console.log(`[SEO] Ferdig: ${pages.length} emnesider, ${tableEntries.length} tabellsider, sitemap.xml, seo-map.json${robotsOwned ? ', robots.txt' : ''}.`);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // Verifiser malen tidlig så vi feiler før API-kallene
  loadTemplate(args.webroot);

  const appConfig = loadAppConfig();
  const subjectConfig = loadSubjectConfig(appConfig);
  console.log(`[SEO] API: ${appConfig.apiBaseUrl} (${appConfig.app.name})`);
  if (fs.existsSync(args.metadataDir)) {
    console.log(`[SEO] Lokale tabellmetadata: ${args.metadataDir}`);
  } else {
    console.warn(`[SEO] Metadatakatalogen ${args.metadataDir} finnes ikke — alle tabellsider bygges fra /tables-listen alene.`);
  }

  const tables = await enumerateAllTables(appConfig, subjectConfig, args);
  const hierarchy = buildHierarchy(tables);
  const cardDepth = appConfig.ui?.topicCardDepth ?? 2; // samme terskel som topic-view.js
  const pages = assignCanonicals(buildPages(subjectConfig, hierarchy, cardDepth));
  const tableEntries = buildTableEntries(tables, pages);
  const totalTables = new Set(tables.map(t => t.id)).size;
  console.log(`[SEO] Bygde ${pages.length} emnesider + ${tableEntries.length} tabellsider fra ${tables.length} tabeller (kort-dybde ${cardDepth}).`);

  const oldManifest = loadManifest(args.webroot);
  main_write(args.webroot, args.site, appConfig, pages, tableEntries, totalTables, oldManifest, args.dryRun, args.metadataDir);
}

main().catch(err => {
  console.error(`[SEO] FEIL: ${err.message}`);
  process.exit(1);
});
