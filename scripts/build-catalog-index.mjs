#!/usr/bin/env node
/**
 * Byggetidsindeksen for katalogen — Statistikkportalen 2.0.
 *
 * HVORFOR: appen henter i dag hele /tables-katalogen (~7 700 SSB-rader) ved
 * hver kalde oppstart før første paint. Denne byggeren serialiserer katalogen
 * per kilde til et kompakt, innholdsadressert shard (scripts/lib/
 * catalog-format.mjs → js/catalog-index.js dekoder det) som kan serveres
 * ferdig komprimert og caches evig på filnavnet.
 *
 * Dette scriptet er BEVISST TYNT: all logikk med konsekvenser — guardene,
 * plana og skriverekkefølgen — ligger i scripts/lib/catalog-build.mjs, og
 * radbyggingen per kilde i scripts/lib/catalog-sources.mjs. Her er det bare
 * argumenter, fillesing, en writer og exit-koder. Endrer du en garanti, endre
 * den der (og i tests/unit/catalog-build.test.js), ikke her.
 *
 * BRUK
 *   node scripts/build-catalog-index.mjs --webroot <sti>
 *     [--source ssb|nb|fhi]     gjentakbar; utelatt = alle aktiverte kilder
 *     [--lang no]               språktaggen i filnavn og dokument
 *     [--min-tables 5000]       sanity-terskel for SSB
 *     [--max-shrink 10]         maks fall i radantall mot deployet manifest, %
 *     [--keep-generations 2]    hvor mange generasjoner shards som beholdes
 *     [--dry-run]               skriver ingenting; printer størrelser + diff
 *     [--snapshot]              skriver den innsjekkede kopien i data/index/
 *
 * Skriver til {webroot}/data/index/:
 *   catalog-manifest.json      { format, generatedAt, shards[] }
 *   {kilde}-{lang}-{hash}.json (+ .json.br for nginx brotli_static)
 *   .index-manifest.json       byggerens egen sporing av filer DEN skrev
 *
 * --SNAPSHOT: den innsjekkede kopien i repoets data/index/. Bygges uten ett
 * eneste nettverkskall og er deterministisk (se deriveSnapshotGeneratedAt i
 * catalog-build.mjs): SSB-radene kommer fra den innspilte E2E-fixturen — de
 * samme 83 radene testsuiten allerede spiller av — mens NB og FHI bygges
 * FULLSTENDIG fra data/sources/nb-periods.json og fhi-catalog.json, fordi
 * enhetstestene bygger emnetreet på hele de to katalogene.
 * PRODUKSJONSINDEKSEN COMMITTES IKKE; snapshotten er den ene innsjekkede kopien.
 *
 * Kjøres periodisk på serveren (cron), f.eks. nattlig:
 *   30 3 * * * cd /sti/til/repo && node scripts/build-catalog-index.mjs \
 *     --webroot /sti/til/webroot >> catalog-index.log 2>&1
 *
 * Krever Node 18+ (global fetch). Ingen npm-avhengigheter.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAppConfig, loadSubjectConfig, apiLang, buildSourceRows, isKnownAdapter,
} from './lib/catalog-sources.mjs';
import {
  buildCatalogIndex, deriveSnapshotGeneratedAt,
  CATALOG_MANIFEST_NAME, INDEX_MANIFEST_NAME,
} from './lib/catalog-build.mjs';
import { atomicWrite } from './lib/atomic-write.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const MIN_TABLE_COUNT = 5000;  // samme sanity-terskel som generate-seo-pages.mjs
const MAX_SHRINK_PCT = 10;
const KEEP_GENERATIONS = 2;

/** Den innspilte SSB-tabellista E2E-suiten spiller av — snapshot-modusens
 *  SSB-kilde. Å gjenbruke fixturen (i stedet for et eget uttrekk) gjør at den
 *  innsjekkede indeksen og E2E-suiten aldri kan komme ut av synk. */
const SSB_FIXTURE = path.join(
  REPO_ROOT, 'tests', 'e2e', 'fixtures',
  'data-ssb-no__api-pxwebapi-v2-tables__3f41d03c.json'
);

const log = msg => console.log(`[katalog] ${msg}`);
const warn = msg => console.warn(`[katalog] ${msg}`);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    webroot: null, sources: [], lang: null,
    minTables: MIN_TABLE_COUNT, maxShrink: MAX_SHRINK_PCT,
    keepGenerations: KEEP_GENERATIONS, dryRun: false, snapshot: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--webroot') args.webroot = argv[++i];
    else if (a === '--source') args.sources.push(argv[++i]);
    else if (a === '--lang') args.lang = argv[++i];
    else if (a === '--min-tables') args.minTables = parseInt(argv[++i], 10);
    else if (a === '--max-shrink') args.maxShrink = parseFloat(argv[++i]);
    else if (a === '--keep-generations') args.keepGenerations = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--snapshot') args.snapshot = true;
    else {
      console.error(`Ukjent argument: ${a}`);
      process.exit(2);
    }
  }
  if (!args.snapshot && !args.webroot) {
    console.error('Bruk: node scripts/build-catalog-index.mjs --webroot <sti> [--source <kilde>] ' +
                  '[--lang no] [--min-tables <antall>] [--max-shrink <prosent>] ' +
                  '[--keep-generations <antall>] [--dry-run] [--snapshot]');
    process.exit(2);
  }
  if (args.snapshot && args.webroot) {
    console.error('--snapshot skriver alltid i repoets data/index/ — kan ikke kombineres med --webroot.');
    process.exit(2);
  }
  if (!Number.isFinite(args.minTables) || !Number.isFinite(args.maxShrink) ||
      !Number.isFinite(args.keepGenerations) || args.keepGenerations < 1) {
    console.error('--min-tables, --max-shrink og --keep-generations må være tall (keep-generations ≥ 1).');
    process.exit(2);
  }
  if (args.webroot) args.webroot = path.resolve(args.webroot);
  return args;
}

// ---------------------------------------------------------------------------
// Kilder
// ---------------------------------------------------------------------------

/** SSB-radene fra den innspilte E2E-fixturen (snapshot-modus, null nettverk). */
function ssbFixtureRows() {
  const doc = JSON.parse(fs.readFileSync(SSB_FIXTURE, 'utf8'));
  const rows = doc.tables || [];
  if (rows.length === 0) throw new Error(`Fixturen ${path.relative(REPO_ROOT, SSB_FIXTURE)} er tom.`);
  return rows;
}

/**
 * Kildebeskrivelsene planBuild jobber på: én per aktivert (og forespurt) kilde
 * i AppConfig.sources, med radbyggingen som en lat `build()`.
 */
function buildSourceList(appConfig, subjectConfig, args, lang) {
  const requested = new Set(args.sources);
  const list = [];

  for (const [key, src] of Object.entries(appConfig.sources || {})) {
    if (!src?.adapter) continue;
    if (src.enabled === false) continue;
    if (requested.size && !requested.has(key)) continue;
    if (!isKnownAdapter(src.adapter)) {
      warn(`Kilden «${key}» har ukjent adapter «${src.adapter}» — hopper over ` +
           '(legg til en gren i scripts/lib/catalog-sources.mjs).');
      continue;
    }

    const primary = src.adapter === 'ssb';
    // Snapshot-modus henter SSB fra fixturen; alt annet bygges nettverksfritt
    // fra de innsjekkede byggetidsfilene uansett modus.
    const build = (args.snapshot && primary)
      ? async () => ssbFixtureRows()
      : async () => buildSourceRows(key, {
          appConfig, subjectConfig, lang,
          minTables: primary ? args.minTables : 0,
          prefix: '[katalog]',
        });

    list.push({ key, lang, primary, build });
  }

  for (const key of requested) {
    if (!list.some(s => s.key === key)) warn(`Ukjent eller avskrudd kilde «${key}» i --source — ignorert.`);
  }
  return list;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function readJsonIfPresent(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    warn(`Klarte ikke å lese ${path.basename(file)} — behandles som fraværende.`);
    return null;
  }
}

const writer = {
  mkdir: dir => fs.mkdirSync(dir, { recursive: true }),
  writeFile: (file, content) => atomicWrite(file, content),
  removeFile: (file) => { try { fs.unlinkSync(file); } catch { /* allerede borte */ } },
};

/** Størrelser + diff mot det deployede manifestet. */
function report(plan, previousManifest, { dryRun }) {
  console.log('');
  log(dryRun ? 'DRY RUN — ingen filer skrives.' : 'Skrevet:');
  for (const shard of plan.shards) {
    const perRow = (shard.bytes / shard.count).toFixed(0);
    const perRowBr = (shard.brotliBytes / shard.count).toFixed(0);
    const before = shard.previous ? shard.previous.count : null;
    const diff = before === null ? 'ny' : `${before} → ${shard.count} (${shard.count - before >= 0 ? '+' : ''}${shard.count - before})`;
    log(`  ${shard.source.padEnd(4)} ${String(shard.count).padStart(6)} rader  ` +
        `${kb(shard.bytes).padStart(9)} rå  ${kb(shard.brotliBytes).padStart(9)} brotli  ` +
        `${perRow} B/rad (${perRowBr} komprimert)  [${diff}]`);
    log(`       ${shard.file}`);
  }
  for (const entry of (plan.manifest?.shards || [])) {
    if (plan.shards.some(s => s.source === entry.source)) continue;
    log(`  ${entry.source.padEnd(4)} ${String(entry.count).padStart(6)} rader  (videreført fra forrige kjøring: ${entry.file})`);
  }
  const totalRaw = plan.shards.reduce((n, s) => n + s.bytes, 0);
  const totalBr = plan.shards.reduce((n, s) => n + s.brotliBytes, 0);
  log(`  Sum: ${kb(totalRaw)} rå / ${kb(totalBr)} brotli`);
  if (previousManifest) log(`  Deployet manifest fra ${previousManifest.generatedAt}`);
}

function kb(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const appConfig = loadAppConfig();
  const subjectConfig = loadSubjectConfig(appConfig);
  const lang = args.lang || apiLang(appConfig);

  const outDir = args.snapshot
    ? path.join(REPO_ROOT, 'data', 'index')
    : path.join(args.webroot, 'data', 'index');

  log(`API: ${appConfig.apiBaseUrl} (${appConfig.app.name})`);
  log(`Ut: ${outDir}${args.snapshot ? '  (innsjekket snapshot)' : ''}`);

  const sources = buildSourceList(appConfig, subjectConfig, args, lang);
  if (sources.length === 0) throw new Error('Ingen kilder å bygge — sjekk --source og AppConfig.sources.');
  log(`Kilder: ${sources.map(s => s.key).join(', ')} (språk ${lang})`);

  const previousManifest = readJsonIfPresent(path.join(outDir, CATALOG_MANIFEST_NAME));
  const indexManifest = readJsonIfPresent(path.join(outDir, INDEX_MANIFEST_NAME));

  const res = await buildCatalogIndex({
    sources,
    previousManifest,
    indexManifest,
    // Snapshotten bruker fixturens 83 rader — sanity-terskelen for den ekte
    // katalogen gir ingen mening der og ville alltid slått til.
    minTables: args.snapshot ? 0 : args.minTables,
    maxShrink: args.maxShrink,
    // Deterministisk i snapshot-modus (ellers gir hver kjøring nye filnavn og
    // en støyende diff); veggklokke ved en ekte kjøring.
    generatedAt: args.snapshot
      ? ({ rows }) => deriveSnapshotGeneratedAt(rows)
      : new Date().toISOString(),
    keepGenerations: args.keepGenerations,
    outDir,
    writer,
    dryRun: args.dryRun,
    log, warn,
  });

  if (!res.ok) {
    for (const err of res.plan.errors.filter(e => e.fatal)) {
      console.error(`[katalog] FEIL (${err.source}): ${err.message}`);
    }
    console.error('[katalog] Ingenting er skrevet — den deployede indeksen står urørt.');
    process.exit(1);
  }

  report(res.plan, previousManifest, args);
  if (!args.dryRun) {
    log(`Ferdig: ${res.written.length} filer skrevet, ${res.deleted.length} ryddet.`);
  }
}

main().catch(err => {
  console.error(`[katalog] FEIL: ${err.message}`);
  process.exit(1);
});
