#!/usr/bin/env node
/**
 * Byggescript for FHI-katalogen — Statistikkportalen 2.0 (Fase G).
 *
 * FHIs åpne API (statistikk-data.fhi.no) har INGEN vennlig tittel-felt noe
 * sted (verifisert: /table, /Table/{id}, /Table/{id}/metadata returnerer alle
 * kun det interne tabellnavnet, f.eks. «D10b_selvmord», «NPR_3»). Enkelte
 * kilder (mfr, og deler av nokkel) har allerede lesbare titler — men mange
 * («daar» nesten uten unntak) har det ikke. API-et mangler også en billig måte
 * å finne en tabells tidsperiode på: det krever et eget /dimension-kall PER
 * TABELL (240 kall for alle tre aktive kilder), noe som er for dyrt å gjøre
 * ved hvert sideoppslag i nettleseren.
 *
 * Dette scriptet løser begge deler ved BYGGETID (ikke i nettleseren):
 *   - GET /{source}/table                     — katalogliste per kilde
 *   - GET /{source}/Table/{id}/dimension       — for å finne tidsdimensjonen
 *     og dens første/siste periode (samme rollegjenkjenning som
 *     js/sources/fhi-adapter.js — TIDSMØNSTERET ER BEVISST DUPLISERT, se
 *     kommentaren ved TIME_PATTERN under; hold de to i sync ved endring)
 *   - GET /{source}/Table/{id}/metadata        — for å utlede en lesbar
 *     tittel/beskrivelse fra «Om statistikken»/«Beskrivelse»-avsnittet når
 *     det interne navnet ser ut som en kode (ikke en lesbar tittel)
 *
 * Resultatet skrives til data/sources/fhi-catalog.json og leses av
 * js/sources/fhi-adapter.js (getAllTables/getTableMetadata) via en relativ
 * `fetch('data/sources/fhi-catalog.json')` fra siden — se kommentaren der.
 * Mangler filen (aldri kjørt, eller kjøring feilet), faller adapteren
 * tilbake til dagens live /table-liste uten periode/tittel-berikelse.
 *
 * TITTEL-HEURISTIKK
 * ------------------
 * Et API-tittelfelt anses som en INTERN KODE (ikke en lesbar tittel) hvis det
 * enten mangler mellomrom helt, eller starter med et token etterfulgt av
 * understrek (f.eks. «D10b_selvmord», «NPR_3», «AAP_UTDANN_1»). Slike titler
 * erstattes av en tittel utledet fra tabellens metadata-sammendrag («Om
 * statistikken» → «Sammendrag»/«Formål»-avsnittet, eller «Beskrivelse» for
 * nokkel-kilden som mangler «Om statistikken») — første setning, maks ~90
 * tegn. Finnes ikke noe sammendrag, humaniseres selve kodenavnet i stedet
 * (Dxx_-prefiks fjernet, '_' → mellomrom, stor forbokstav). Det opprinnelige
 * API-tittelfeltet beholdes ALLTID som `internalName` (søk/debug), uansett
 * hvilken gren som traff.
 *
 * PERIODEFORMAT
 * --------------
 * FHI har fem ulike former for uke/måned/tertial («2024 -uke 17», «2024-w40»,
 * «2021-01», «Oktober 2025», «2023 1.tertial»). first-/lastPeriod normaliseres
 * derfor til SSB-form (2024U17, 2025M10, 2023T1) av normalizeCatalogPeriods
 * (scripts/lib/fhi-catalog-merge.mjs) FØR skriving, og timeUnit utledes av
 * resultatet der deriveTimeInfo ikke allerede har fastslått 'Annual'. Reglene
 * ligger i js/period-format.js, som nettleseren og dette scriptet DELER (via
 * scripts/lib/period-format.mjs) — adapteren normaliserer de samme periodene
 * på nytt når en tabell åpnes.
 *
 * MANUELL KURATERING (data/sources/fhi-curation.json)
 * ----------------------------------------------------
 * Håndskrevne visningstitler og kategoritilordninger (register → kategori i
 * emnetreet) ligger i en egen innsjekket fil og flettes inn ETTER byggingen
 * (scripts/lib/fhi-curation.mjs) — regenerering overskriver dem aldri.
 * Avvik (foreldreløse tabell-id-er, udefinerte kategorier, ukategoriserte
 * tabeller) logges som advarsler.
 *
 * INKREMENTELL KJØRING (--incremental)
 * -------------------------------------
 * En full kjøring er ~740 kall (2 per tabell). Tabell-lista
 * GET /{source}/table koster derimot ETT kall per kilde og inneholder
 * modifiedAt/publishedAt — den brukes til å hente KUN de tabellene som er nye
 * eller endret siden katalogens `generatedAt`, og som fasit på hvilke tabeller
 * som fortsatt finnes (fjernede tabeller tas ut). Typisk uke-drift er en
 * håndfull tabeller, altså ~30 kall i stedet for ~740. Kuratering flettes inn
 * som vanlig, og `lastFullBuildAt` arves så det er synlig når det sist var en
 * full regenerering. Uendrede rader beholdes ordrett.
 * Flettelogikken ligger i scripts/lib/fhi-catalog-merge.mjs (enhetstestet).
 *
 * Kjøres manuelt/periodisk (dataene endrer seg sjelden — nye FHI-tabeller er
 * uvanlig, oppdaterte tallserier endrer ikke tittel/periode-strukturen):
 *   node scripts/update-fhi-catalog.mjs [--rate <kall/min>] [--out <sti>]
 *     [--limit <antall per kilde>] [--curation <sti>] [--incremental]
 *
 * Krever Node 18+ (global fetch). Ingen npm-avhengigheter.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { applyCuration } from './lib/fhi-curation.mjs';
import { selectStaleTableIds, mergeCatalogSource, normalizeCatalogPeriods } from './lib/fhi-catalog-merge.mjs';
import { atomicWrite } from './lib/atomic-write.mjs';

const DEFAULT_RATE = 240; // kall/minutt — FHI-API-et dokumenterer ingen grense; holdt beskjedent av høflighet
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    out: path.join(REPO_ROOT, 'data', 'sources', 'fhi-catalog.json'),
    curation: path.join(REPO_ROOT, 'data', 'sources', 'fhi-curation.json'),
    rate: DEFAULT_RATE,
    limit: null, // maks antall tabeller PER KILDE (for rask testing)
    incremental: false, // hent kun nye/endrede tabeller (se --incremental)
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--curation') args.curation = argv[++i];
    else if (a === '--rate') args.rate = parseInt(argv[++i], 10);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--incremental') args.incremental = true;
    else {
      console.error(`Ukjent argument: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.rate) || args.rate <= 0) {
    console.error('--rate må være et positivt tall');
    process.exit(2);
  }
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    console.error('--limit må være et positivt tall');
    process.exit(2);
  }
  args.out = path.resolve(args.out);
  args.curation = path.resolve(args.curation);
  return args;
}

/**
 * Les den eksisterende katalogen for --incremental. Mangler den, kan vi ikke
 * regne ut noe delta — da skal brukeren kjøre en full build først, ikke få en
 * stille (og svært dyr) fallback.
 */
function loadPreviousCatalog(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `--incremental krever en eksisterende katalog på ${file}. ` +
      'Kjør «node scripts/update-fhi-catalog.mjs» (uten --incremental) først.'
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.sources || !parsed.generatedAt) {
    throw new Error(`Katalogen ${file} mangler «sources» eller «generatedAt» — kjør en full build.`);
  }
  console.log(`[fhi-catalog] Inkrementelt fra ${file} (generatedAt: ${parsed.generatedAt}).`);
  return parsed;
}

/** Les kurateringsfila; mangler den (første kjøring) → tomt objekt. */
function loadCuration(file) {
  if (!fs.existsSync(file)) {
    console.log(`[fhi-catalog] Ingen kurateringsfil på ${file} — bygger uten manuell kuratering.`);
    return { sources: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.sources) {
    throw new Error(`Kurateringsfila ${file} mangler toppnivået «sources»`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// App-konfigurasjon (duplisert fra generate-seo-pages.mjs/update-table-metadata.mjs)
// ---------------------------------------------------------------------------

/**
 * Kjør en browser-global appfil i en sandkasse og les ut window.{key}.
 *
 * `deps` kjøres i SAMME sandkasse først (speiler <script>-rekkefølgen i
 * index.html). config.js refererer window.NbCatalog (js/sources/nb-catalog.js)
 * og window.SourceTopology (js/sources/source-topology.js) for kildekatalogen
 * og emnetre-topologien; uten dem kommer AppConfig ut uten
 * sources.fhi.sourceIds. Samme mønster som loadAppConfig i
 * scripts/generate-seo-pages.mjs.
 */
function loadBrowserGlobal(file, key, deps = []) {
  const sandbox = { window: {} };
  for (const dep of deps.concat([file])) {
    vm.runInNewContext(fs.readFileSync(path.join(REPO_ROOT, 'js', dep), 'utf8'), sandbox);
  }
  const value = sandbox.window[key];
  if (!value) throw new Error(`Klarte ikke å lese ${key} fra js/${file}`);
  return value;
}

function loadAppConfig() {
  const cfg = loadBrowserGlobal('config.js', 'AppConfig',
    ['sources/nb-catalog.js', 'sources/source-topology.js']);
  const fhi = cfg.sources && cfg.sources.fhi;
  if (!fhi || !fhi.baseUrl || !Array.isArray(fhi.sourceIds) || fhi.sourceIds.length === 0) {
    throw new Error('AppConfig.sources.fhi mangler baseUrl/sourceIds i js/config.js');
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Rate-limiter — samme mønster som update-table-metadata.mjs, kun kall
// SEKVENSIELT (aldri parallelt) slik at intervallet faktisk overholdes.
// ---------------------------------------------------------------------------

function createThrottle(ratePerMinute) {
  const minIntervalMs = 60000 / ratePerMinute;
  let lastRequestTime = 0;
  return async function throttle() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed);
    }
    lastRequestTime = Date.now();
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Fetch-hjelper (forenklet variant av fetchJson i fhi-adapter.js)
// ---------------------------------------------------------------------------

async function fetchJson(url, throttle) {
  await throttle();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Rollegjenkjenning — DUPLISERT fra js/sources/fhi-adapter.js (isTimeDim).
// Hold i sync ved endring: begge må enes om hvilken dimensjon som er «tid»,
// ellers vil katalogens firstPeriod/lastPeriod og adapterens egen
// role.time-utledning kunne peke på ulike dimensjoner.
// ---------------------------------------------------------------------------

const TIME_PATTERN = /(år|aar)(?![a-zæøåA-ZÆØÅ])/i;
// Eksakte dimensjonsnavn uten fritt «år»-token (Årgang/Sesong/year/Måned/Uke
// m.fl.) — se kommentaren ved TIME_EXACT i fhi-adapter.js.
const TIME_EXACT = /^(årgang|aargang|argang|sesong|season|year|årstall|måned|maaned|month|uke|week)$/i;

function isTimeDim(code, label) {
  const c = String(code || '').trim();
  const l = String(label || '').trim();
  return TIME_PATTERN.test(c) || TIME_PATTERN.test(l) ||
    TIME_EXACT.test(c) || TIME_EXACT.test(l);
}

/**
 * Plukk ut BLADKATEGORIENE (ikke nøstede foreldre-/grupperingsnoder som
 * f.eks. mfr sin «Fødselsår: Alle»-wrapper) i dimensjonsrekkefølge
 * (depth-first, samme rekkefølge som API-et leverer — verifisert stigende
 * for tidsdimensjoner, jf. fhi-adapter.js sin top(N)-håndtering).
 */
function collectLeafCategories(categories) {
  let result = [];
  (categories || []).forEach(cat => {
    if (cat.children && cat.children.length) {
      result = result.concat(collectLeafCategories(cat.children));
    } else {
      result.push({ code: String(cat.value), label: cat.label != null ? String(cat.label) : String(cat.value) });
    }
  });
  return result;
}

const SINGLE_YEAR_PATTERN = /^\d{4}\*?$/;

/**
 * Finn tidsdimensjonen (om noen) og utled first/lastPeriod + timeUnit.
 *
 * Periodene er kildens RÅ etiketter her; de normaliseres til SSB-form av
 * normalizeCatalogPeriods rett før skriving (se filhodet). timeUnit fastslås
 * kun som 'Annual' — den regelen ser samtlige kategorier og er derfor sikrere
 * enn endepunktene alene; Weekly/Monthly utledes av normaliseringspasset.
 *
 * @returns {{firstPeriod:string, lastPeriod:string, timeUnit:(string|null)}}
 */
function deriveTimeInfo(dims) {
  const timeDim = (dims || []).find(d => isTimeDim(d.code, d.label));
  if (!timeDim) return { firstPeriod: '', lastPeriod: '', timeUnit: null };

  const leaves = collectLeafCategories(timeDim.categories || []);
  if (leaves.length === 0) return { firstPeriod: '', lastPeriod: '', timeUnit: null };

  const firstPeriod = leaves[0].label;
  const lastPeriod = leaves[leaves.length - 1].label;
  const allSingleYears = leaves.every(l => SINGLE_YEAR_PATTERN.test(l.label.trim()));
  return { firstPeriod, lastPeriod, timeUnit: allSingleYears ? 'Annual' : null };
}

// ---------------------------------------------------------------------------
// Tittel-/beskrivelsesutledning fra /Table/{id}/metadata
// ---------------------------------------------------------------------------

/** Er API-tittelfeltet en lesbar tittel, eller en intern kode? Se filhodet. */
function isCodeLikeTitle(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (!/\s/.test(t)) return true; // ingen mellomrom i det hele tatt
  if (/^[A-Za-z0-9]+_/.test(t)) return true; // starter med «token_» (internt kodemønster)
  return false;
}

/** HTML → ren, enkeltlinjet tekst (tag-stripping + vanlige entiteter). */
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hent ren sammendragstekst fra metadata-avsnittene. Prioritet:
 *   1. header «Om statistikken» (daar/mfr — inneholder ofte en innledende
 *      <strong>Sammendrag</strong>/<strong>Formål</strong>-etikett rett før
 *      selve teksten; etiketten fjernes fra resultatet).
 *   2. header «Beskrivelse» (nokkel — mangler «Om statistikken» helt).
 * Returnerer null hvis ingen av avsnittene finnes eller er tomme.
 */
function extractSummaryPlainText(paragraphs) {
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const omStatistikken = list.find(p => p && p.header === 'Om statistikken');
  const beskrivelse = list.find(p => p && p.header === 'Beskrivelse');
  const raw = (omStatistikken && omStatistikken.content) || (beskrivelse && beskrivelse.content) || null;
  if (!raw) return null;

  let text = htmlToText(raw);
  // Fjern en innledende avsnittsetikett («Sammendrag»/«Formål»/«Bakgrunn»/
  // «Beskrivelse») som stammer fra en <strong>-tag helt i starten av innholdet.
  text = text.replace(/^(Sammendrag|Formål|Bakgrunn|Beskrivelse)\s+/i, '').trim();
  return text || null;
}

/**
 * Splitt på setningsgrenser. Krever stor forbokstav (eller tekstslutt) etter
 * tegnet for å unngå falske treff på tallforkortelser («5.», «8.klassinger»)
 * som er svært vanlige i FHIs statistikktekster. Ufullstendig som ekte
 * NLP-setningsdeling, men deterministisk og god nok kombinert med
 * lengdebegrensningen i firstSentence/firstSentences under.
 */
function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÆØÅ]|$)/).filter(Boolean);
}

/** Trunker til maks lengde på ordgrense, med ellipsis. */
function truncateAtWord(text, maxLen) {
  if (text.length <= maxLen) return text;
  let cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.4) cut = cut.slice(0, lastSpace);
  return cut.trim() + '…';
}

/** Tittel utledet fra sammendrag: første setning, maks ~90 tegn. */
function firstSentenceTitle(text, maxLen) {
  const sentences = splitSentences(text);
  let title = (sentences[0] || text).trim();
  const truncated = title.length > maxLen;
  title = truncateAtWord(title, maxLen);
  // Fjern overflødig sluttpunktum på ikke-trunkerte titler (titler ser bedre
  // ut uten, jf. de øvrige API-titlene som aldri har det) — men rør ikke en
  // allerede lagt til ellipsis.
  if (!truncated) title = title.replace(/\.$/, '');
  return title;
}

/** Beskrivelse: inntil 2 setninger, maks ~400 tegn. */
function summaryDescription(text, maxLen) {
  const sentences = splitSentences(text);
  const joined = sentences.slice(0, 2).join(' ').trim() || text;
  return truncateAtWord(joined, maxLen);
}

/** Fallback når intet sammendrag finnes: humaniser selve kodenavnet. */
function humanizeInternalName(name) {
  const raw = String(name || '');
  let s = raw.replace(/^D\d+[a-z]?_/i, ''); // fjern Dxx_/Dxxb_-prefiks (daar-kodemønster)
  s = s.replace(/_/g, ' ').trim();
  if (!s) return raw;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Utled {title, description} for én tabell.
 * `title` er den API-leverte tittelen hvis den ser lesbar ut, ellers utledet
 * fra sammendraget (eller humanisert kodenavn som siste utvei). `description`
 * forsøkes ALLTID fra sammendraget, uavhengig av tittel-grenen.
 */
function deriveTitleAndDescription(rawTitle, paragraphs) {
  const summary = extractSummaryPlainText(paragraphs);
  const description = summary ? summaryDescription(summary, 400) : '';

  if (!isCodeLikeTitle(rawTitle)) {
    return { title: rawTitle, description };
  }
  if (summary) {
    return { title: firstSentenceTitle(summary, 90), description };
  }
  return { title: humanizeInternalName(rawTitle), description };
}

// ---------------------------------------------------------------------------
// Bygging per kilde
// ---------------------------------------------------------------------------

/** GET /{source}/table — hele tabell-lista, sortert på tableId. */
async function fetchSourceRows(appConfig, source, throttle) {
  const base = appConfig.sources.fhi.baseUrl.replace(/\/+$/, '');
  const rows = await fetchJson(`${base}/${encodeURIComponent(source)}/table`, throttle);
  return (rows || []).slice().sort((a, b) => Number(a.tableId) - Number(b.tableId));
}

async function buildSource(appConfig, source, throttle, limit, presetRows) {
  const base = appConfig.sources.fhi.baseUrl.replace(/\/+$/, '');
  const sorted = presetRows || await fetchSourceRows(appConfig, source, throttle);
  const queue = limit !== null ? sorted.slice(0, limit) : sorted;

  console.log(`[fhi-catalog] Kilde «${source}»: ${sorted.length} tabeller${limit !== null ? ` (behandler ${queue.length})` : ''}.`);

  const tables = [];
  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    const tableId = row.tableId;
    const rawTitle = row.title || String(tableId);
    const updated = row.modifiedAt || row.publishedAt || '';

    let firstPeriod = '', lastPeriod = '', timeUnit = null, variableNames = [];
    try {
      const dimJson = await fetchJson(
        `${base}/${encodeURIComponent(source)}/Table/${encodeURIComponent(tableId)}/dimension`, throttle
      );
      const dims = (dimJson && dimJson.dimensions) || [];
      variableNames = dims.map(d => d.label || d.code).filter(Boolean);
      const timeInfo = deriveTimeInfo(dims);
      firstPeriod = timeInfo.firstPeriod;
      lastPeriod = timeInfo.lastPeriod;
      timeUnit = timeInfo.timeUnit;
      // Rolledeteksjonen (TIME_PATTERN) er heuristisk og kildene bruker ulike
      // dimensjonskoder — logg tabeller uten funnet tidsdimensjon slik at nye
      // kilder kan sjekkes ved aktivering (jf. ROADMAP «rolledeteksjonen bør
      // sjekkes»). Enkelte tabeller HAR reelt ingen tidsdimensjon (f.eks.
      // øyeblikksbilder i ngs) — meldingen er informativ, ikke en feil.
      if (!dims.some(d => isTimeDim(d.code, d.label))) {
        console.warn(`[fhi-catalog] ${source}/${tableId}: ingen tidsdimensjon gjenkjent (dims: ${dims.map(d => d.code).join(', ')})`);
      }
    } catch (err) {
      console.warn(`[fhi-catalog] ${source}/${tableId}: klarte ikke hente /dimension (${err.message}) — periode/variabler utelates.`);
    }

    let title = rawTitle;
    let description = '';
    try {
      const metaJson = await fetchJson(
        `${base}/${encodeURIComponent(source)}/Table/${encodeURIComponent(tableId)}/metadata`, throttle
      );
      const derived = deriveTitleAndDescription(rawTitle, metaJson && metaJson.paragraphs);
      title = derived.title;
      description = derived.description;
    } catch (err) {
      console.warn(`[fhi-catalog] ${source}/${tableId}: klarte ikke hente /metadata (${err.message}) — bruker humanisert kodenavn som tittel.`);
      title = isCodeLikeTitle(rawTitle) ? humanizeInternalName(rawTitle) : rawTitle;
    }

    tables.push({
      tableId,
      title,
      internalName: rawTitle,
      description,
      firstPeriod,
      lastPeriod,
      timeUnit,
      variableNames,
      updated,
    });

    const n = i + 1;
    if (n % 25 === 0 || n === queue.length) {
      console.log(`[fhi-catalog]   ${source}: ${n}/${queue.length}`);
    }
  }

  tables.sort((a, b) => Number(a.tableId) - Number(b.tableId));
  return tables;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const appConfig = loadAppConfig();
  const throttle = createThrottle(args.rate);
  const sourceIds = appConfig.sources.fhi.sourceIds.slice();

  console.log(`[fhi-catalog] API: ${appConfig.sources.fhi.baseUrl}`);
  console.log(`[fhi-catalog] Kilder: ${sourceIds.join(', ')}`);
  console.log(`[fhi-catalog] Rate: ${args.rate} kall/min`);
  console.log(`[fhi-catalog] Ut: ${args.out}`);

  const base = appConfig.sources.fhi.baseUrl.replace(/\/+$/, '');
  // Kildeinfoen bakes inn i katalogfila: aboutUrl/publishedBy vises i
  // Tabellinfo (registerets egen «Om statistikken»-side, og hvem som faktisk
  // utgir — `nokkel` utgis av Helsedirektoratet, ikke FHI). Med dem i fila
  // slipper adapteren å hente /Common/source ved hver app-init.
  const infoMap = {};
  try {
    const list = await fetchJson(`${base}/Common/source`, throttle);
    (list || []).forEach(s => {
      if (!s || !s.id) return;
      infoMap[s.id] = {
        title: s.title || s.id,
        aboutUrl: s.aboutUrl || '',
        publishedBy: s.publishedBy || ''
      };
    });
  } catch (err) {
    console.warn(`[fhi-catalog] Klarte ikke hente /Common/source (${err.message}) — bruker kilde-id som tittel.`);
  }

  const curation = loadCuration(args.curation);
  const previous = args.incremental ? loadPreviousCatalog(args.out) : null;

  const sources = {};
  let probedTotal = 0;

  for (const source of sourceIds) {
    let tables;

    if (previous) {
      // Inkrementelt: tabell-lista (ETT kall per kilde) avgjør både hva som må
      // hentes på nytt og hva som fortsatt finnes. Kun nye/endrede tabeller
      // koster /dimension + /metadata-kall.
      const rows = await fetchSourceRows(appConfig, source, throttle);
      const existingTables = (previous.sources[source] || {}).tables || [];
      const staleIds = selectStaleTableIds(existingTables, rows, previous.generatedAt);
      const staleSet = new Set(staleIds.map(String));
      const staleRows = rows.filter(r => staleSet.has(String(r.tableId)));

      console.log(`[fhi-catalog] Kilde «${source}»: ${rows.length} tabeller, ` +
                  `${staleRows.length} nye/endrede siden ${previous.generatedAt}.`);

      const probed = staleRows.length
        ? await buildSource(appConfig, source, throttle, args.limit, staleRows)
        : [];
      probedTotal += probed.length;

      const merged = mergeCatalogSource(existingTables, rows, probed);
      if (merged.added.length) console.log(`[fhi-catalog]   nye: ${merged.added.join(', ')}`);
      if (merged.updated.length) console.log(`[fhi-catalog]   oppdatert: ${merged.updated.join(', ')}`);
      if (merged.removed.length) {
        console.warn(`[fhi-catalog]   fjernet (borte fra API-et): ${merged.removed.join(', ')}`);
      }
      tables = merged.tables;
    } else {
      tables = await buildSource(appConfig, source, throttle, args.limit);
      probedTotal += tables.length;
    }

    // Periodene normaliseres til SSB-form (2024U17/2025M10/2023T1) over HELE
    // kilden, av samme grunn som kurateringen under: en inkrementell kjøring
    // beholder uendrede rader ordrett, og de skal ikke bli liggende på FHIs
    // råformat til neste fulle regenerering. Se normalizeCatalogPeriods.
    tables = normalizeCatalogPeriods(tables);

    // Kurateringen flettes på nytt over HELE kilden, også inkrementelt: den
    // ligger i en egen innsjekket fil og er idempotent.
    const info = infoMap[source] || {};
    const built = {
      title: info.title || source,
      // Tomme felt utelates: adapteren faller da tilbake til live
      // /Common/source, slik at en eldre katalogfil fortsatt virker.
      ...(info.aboutUrl ? { aboutUrl: info.aboutUrl } : {}),
      ...(info.publishedBy ? { publishedBy: info.publishedBy } : {}),
      tables
    };
    sources[source] = applyCuration(built, curation.sources[source],
      msg => console.warn(`[fhi-catalog] kuratering ${source}: ${msg}`));
  }

  const now = new Date().toISOString();
  const output = {
    generatedAt: now,
    // Når katalogen sist ble bygget FRA BUNNEN. Inkrementelle kjøringer
    // arver verdien, så det er synlig når en full regenerering bør kjøres.
    lastFullBuildAt: previous ? (previous.lastFullBuildAt || previous.generatedAt) : now,
    sources,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const json = JSON.stringify(output, null, 2);
  atomicWrite(args.out, json);

  const totalTables = Object.values(sources).reduce((n, s) => n + s.tables.length, 0);
  console.log(`\n[fhi-catalog] Ferdig: ${sourceIds.length} kilder, ${totalTables} tabeller ` +
              `(${probedTotal} hentet fra API-et) skrevet til:`);
  console.log(`[fhi-catalog]   ${args.out}`);
}

main().catch(err => {
  console.error(`[fhi-catalog] FEIL: ${err.message}`);
  process.exit(1);
});
