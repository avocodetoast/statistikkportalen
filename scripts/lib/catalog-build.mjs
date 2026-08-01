/**
 * Orkestreringen bak katalogindeksen — guardene, plana og skriverekkefølgen.
 *
 * HVORFOR HER OG IKKE I CLI-EN: repoets mønster er at scripts/lib/*.mjs er ren,
 * testet logikk og scripts/*.mjs er tynne CLI-er med I/O. Guardene under er
 * hele eksistensberettigelsen til byggetidslaget, så de skal kunne testes med
 * injiserte fakes — ikke bare ved å kjøre et script som henter fra nettet og
 * skriver til disk. Radbygging (`build`), komprimering (`compress`) og
 * skriving (`writer`) er derfor parametre.
 *
 * DE FEM GARANTIENE («aldri en halv indeks over en god»):
 *
 *   1. Alt bygges ferdig i minnet (planBuild) FØR noe skrives (writePlan).
 *   2. Primærkilden (SSB) er hard: fetch-feil ELLER færre enn `minTables`
 *      rader avbryter HELE kjøringen. Ingenting skrives.
 *   3. Krympe-guard mot det DEPLOYEDE manifestet: faller et shard mer enn
 *      `maxShrink` % i radantall, nektes kjøringen med tallene i klartekst.
 *      Den fanger en avkortet, men HTTP-200 katalog — noe `minTables` alene
 *      mister så snart katalogen vokser forbi terskelen.
 *   4. Fremmede kilder feilisoleres (speiler aggregateTables i
 *      js/sources/source-registry.js): en FHI-feil logges, FORRIGE FHI-
 *      oppføring bæres verbatim videre inn i det nye manifestet, og kjøringen
 *      lykkes fortsatt for SSB.
 *   5. Skriverekkefølgen er lastbærende: alle nye shard-filer først, deretter
 *      opprydding, deretter byggerens egen sporing, og catalog-manifest.json
 *      ALLER SIST. En leser som løper kappløp med byggeren ser enten det gamle
 *      manifestet (de gamle shardene finnes ennå) eller det nye (de nye finnes)
 *      — aldri et manifest som peker på en fil som ikke er der.
 *
 * SELVEIERSKAP: opprydding sletter kun filer .index-manifest.json sier at
 * byggeren selv har skrevet, og kun fra generasjoner som har falt ut av
 * `keepGenerations`-vinduet — samme modell som .seo-manifest.json i
 * scripts/generate-seo-pages.mjs. En fil det gjeldende manifestet fortsatt
 * peker på (f.eks. et videreført shard fra en feilende kilde) slettes ALDRI.
 *
 * Ren ESM: ingen fs-, nettverks- eller process-tilgang i denne fila.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { encodeCatalog } from './catalog-format.mjs';

export const CATALOG_MANIFEST_NAME = 'catalog-manifest.json';
export const INDEX_MANIFEST_NAME = '.index-manifest.json';

/** Brotli på kvalitet 11 (maks) — filene bygges én gang i døgnet og serveres
 *  tusenvis av ganger, så byggetid er irrelevant mot overføringsbytene.
 *  nginx serverer .br-tvillingen via brotli_static. */
export function brotliCompress(content) {
  return zlib.brotliCompressSync(Buffer.from(content), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
}

/**
 * Kort innholdshash til filnavnet. Innholdsadressering gjør at et uendret
 * shard beholder samme filnavn (ingen unødig cache-invalidering hos klienten),
 * og at et endret shard ALLTID får et nytt navn — filene kan derfor serveres
 * med evig cache-levetid.
 *
 * @param {string|Buffer} json
 * @returns {string} 8 heksadesimale tegn
 */
export function contentHash(json) {
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 8);
}

/**
 * Deterministisk `generatedAt` for --snapshot-modus.
 *
 * HVORFOR IKKE new Date(): den innsjekkede snapshotten regenereres av og til,
 * og et veggklokke-tidsstempel ville gitt en diff (og et nytt innholdshash-
 * filnavn) på HVER kjøring, selv når ingen rad er endret. Da drukner ekte
 * endringer i støy, og `git status` er ikke lenger et signal.
 *
 * Valget: nyeste `updated` blant radene selv. Den er (a) rent avledet av
 * innholdet, altså stabil så lenge dataene er det, og (b) semantisk ærlig —
 * den sier «disse dataene er ferske t.o.m. dette tidspunktet», som er det
 * eneste et snapshot-tidsstempel med rette kan si. Rader uten `updated`
 * ignoreres; har ingen rad noen, faller vi tilbake til epoken (som også er
 * deterministisk).
 *
 * @param {object[]} rows
 * @returns {string} ISO 8601
 */
export function deriveSnapshotGeneratedAt(rows) {
  let newest = 0;
  for (const row of rows || []) {
    const t = Date.parse(row?.updated || '');
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return new Date(newest).toISOString();
}

/** Manifestoppføringen for en kilde/språk i det deployede manifestet. */
function findShardEntry(manifest, source, lang) {
  return (manifest?.shards || []).find(s => s.source === source && s.lang === lang) || null;
}

/** Løs `generatedAt`-opsjonen: fast streng, eller en funksjon av radene
 *  (snapshot-modus utleder den per shard). */
function resolveGeneratedAt(generatedAt, key, rows) {
  return typeof generatedAt === 'function' ? generatedAt({ key, rows }) : generatedAt;
}

/**
 * Bygg alle forespurte shards i minnet og håndhev guardene. Skriver INGENTING.
 *
 * @param {object} opts
 * @param {Array} opts.sources - [{key, lang, primary?, carryForward?, build: async () => rows[]}]
 *   `primary: true` markerer kilden som hard (SSB): feil der velter kjøringen.
 *   `carryForward: true` betyr «bygg ikke denne nå» — forrige shard-oppføring
 *   bæres videre uendret, og `build` kalles aldri (trenger ikke finnes).
 * @param {object|null} opts.previousManifest - Det DEPLOYEDE catalog-manifest.json.
 * @param {number} [opts.minTables] - Sanity-terskel for primærkilden.
 * @param {number} [opts.maxShrink] - Maks tillatt fall i radantall, i prosent.
 * @param {string|function} opts.generatedAt - ISO-streng, eller ({key, rows}) => ISO.
 * @param {function} [opts.compress] - Komprimering (injiserbar; default brotli q11).
 * @param {function} [opts.log]
 * @param {function} [opts.warn]
 * @returns {Promise<object>} {ok, shards, manifest, skipped, errors}
 */
export async function planBuild({
  sources = [],
  previousManifest = null,
  minTables = 0,
  maxShrink = 10,
  generatedAt,
  compress = brotliCompress,
  log = console.log,
  warn = console.warn,
} = {}) {
  const shards = [];
  const skipped = [];
  const errors = [];
  const manifestShards = [];
  let fatal = false;

  for (const source of sources) {
    const { key, lang = 'no', primary = false, carryForward = false } = source;

    // Garanti 5: en kilde som ikke bygges denne kjøringen står urørt i
    // manifestet. Per-kilde-oppdatering (--source) finnes fordi kildene har
    // ulike publiseringstidspunkt; uten dette ville en kjøring for én kilde
    // strøket de andre ut av manifestet, og de forsvant fra portalen selv om
    // shard-filene lå på disk. Ingen guard gjelder her — det bygges ingenting,
    // så det finnes ingen radliste å måle mot.
    if (carryForward) {
      const carried = findShardEntry(previousManifest, key, lang);
      if (carried) {
        log(`Kilde «${key}»: ikke forespurt — beholder ${carried.file} (${carried.count} rader).`);
        manifestShards.push(carried);
      } else {
        warn(`Kilden «${key}» er ikke forespurt og har ingen tidligere shard — utelates fra manifestet.`);
      }
      continue;
    }

    let rows;
    try {
      rows = await source.build();
    } catch (err) {
      if (primary) {
        // Garanti 2: primærkilden er hard.
        errors.push({ source: key, message: err.message, fatal: true });
        fatal = true;
        break;
      }
      // Garanti 4: fremmede kilder feilisoleres, og forrige oppføring bæres
      // verbatim videre slik at manifestet fortsatt beskriver en HEL indeks.
      const carried = findShardEntry(previousManifest, key, lang);
      errors.push({ source: key, message: err.message, fatal: false });
      skipped.push({ source: key, reason: err.message, carriedForward: !!carried });
      if (carried) {
        warn(`Kilden «${key}» feilet (${err.message}) — beholder forrige shard (${carried.file}, ${carried.count} rader).`);
        manifestShards.push(carried);
      } else {
        warn(`Kilden «${key}» feilet (${err.message}) og har ingen tidligere shard — hoppes over.`);
      }
      continue;
    }

    // Garanti 2: for få rader fra primærkilden er like ille som en feil.
    if (primary && rows.length < minTables) {
      errors.push({
        source: key,
        message: `Bare ${rows.length} rader fra «${key}» (forventet minst ${minTables}) — avbryter uten å skrive noe.`,
        fatal: true,
      });
      fatal = true;
      break;
    }

    const shardGeneratedAt = resolveGeneratedAt(generatedAt, key, rows);
    const doc = encodeCatalog(rows, { source: key, lang, generatedAt: shardGeneratedAt });
    const json = JSON.stringify(doc);
    const hash = contentHash(json);
    const file = `${key}-${lang}-${hash}.json`;
    const bytes = Buffer.byteLength(json);

    // Garanti 3: krympe-guard mot det deployede manifestet. Gjelder ALLE
    // kilder — en mistenkelig krympet katalog er dårlige data, ikke en
    // utilgjengelig kilde, og skal ikke feilisoleres bort.
    const previous = findShardEntry(previousManifest, key, lang);
    if (previous && previous.count > 0) {
      const floor = previous.count * (1 - maxShrink / 100);
      if (rows.length < floor) {
        const fall = (100 * (1 - rows.length / previous.count)).toFixed(1);
        errors.push({
          source: key,
          message: `«${key}» krympet fra ${previous.count} til ${rows.length} rader (${fall} %, ` +
                   `maks tillatt ${maxShrink} %) — avbryter uten å skrive noe.`,
          fatal: true,
        });
        fatal = true;
        break;
      }
    }

    const brotli = compress(json);
    const entry = { source: key, lang, file, count: rows.length, bytes, generatedAt: shardGeneratedAt };
    shards.push({ ...entry, json, brotli, brotliBytes: Buffer.byteLength(brotli), previous });
    manifestShards.push(entry);
    log(`Kilde «${key}»: ${rows.length} rader, ${bytes} B rå / ${Buffer.byteLength(brotli)} B brotli → ${file}`);
  }

  if (fatal) {
    return { ok: false, shards: [], manifest: null, skipped, errors };
  }

  const manifest = {
    format: 1,
    generatedAt: manifestShards.reduce(
      (newest, s) => (s.generatedAt > newest ? s.generatedAt : newest),
      manifestShards[0]?.generatedAt || ''
    ),
    shards: manifestShards,
  };

  return { ok: true, shards, manifest, skipped, errors };
}

/**
 * Filene en generasjon eier: shard-filene manifestet peker på (+ .br) og
 * byggerens egne manifestfiler.
 */
function generationFiles(manifest) {
  const files = [];
  for (const shard of manifest.shards) {
    files.push(shard.file, `${shard.file}.br`);
  }
  files.push(INDEX_MANIFEST_NAME, CATALOG_MANIFEST_NAME);
  return files;
}

/**
 * Skriv plana til disk gjennom den injiserte writeren, i den lastbærende
 * rekkefølgen (garanti 5).
 *
 * @param {object} plan - Fra planBuild.
 * @param {object} opts
 * @param {string} opts.outDir
 * @param {object} opts.writer - {mkdir, writeFile, removeFile}
 * @param {object|null} [opts.indexManifest] - Forrige .index-manifest.json.
 * @param {number} [opts.keepGenerations]
 * @returns {{written: string[], deleted: string[], indexManifest: object}}
 */
export function writePlan(plan, { outDir, writer, indexManifest = null, keepGenerations = 2, log = console.log } = {}) {
  const written = [];
  const deleted = [];
  const abs = name => path.join(outDir, name);

  writer.mkdir(outDir);

  // 1) Alle nye shard-filer + brotli-tvillingene.
  for (const shard of plan.shards) {
    writer.writeFile(abs(shard.file), shard.json);
    written.push(shard.file);
    writer.writeFile(abs(`${shard.file}.br`), shard.brotli);
    written.push(`${shard.file}.br`);
  }

  // 2) Ny generasjon fremst i sporingen; alt utenfor vinduet ryddes.
  const generations = [
    { generatedAt: plan.manifest.generatedAt, files: generationFiles(plan.manifest) },
    ...((indexManifest?.generations) || []),
  ];
  const kept = generations.slice(0, Math.max(1, keepGenerations));
  const dropped = generations.slice(Math.max(1, keepGenerations));

  // Selveierskap + garanti 5: aldri slett noe en beholdt generasjon eller det
  // NYE manifestet fortsatt peker på.
  const live = new Set(kept.flatMap(g => g.files));
  for (const file of new Set(dropped.flatMap(g => g.files))) {
    if (live.has(file)) continue;
    writer.removeFile(abs(file));
    deleted.push(file);
  }
  if (deleted.length) log(`Ryddet ${deleted.length} filer fra utgåtte generasjoner.`);

  // 3) Byggerens egen sporing …
  const newIndexManifest = { format: 1, generatedAt: plan.manifest.generatedAt, generations: kept };
  writer.writeFile(abs(INDEX_MANIFEST_NAME), `${JSON.stringify(newIndexManifest, null, 2)}\n`);
  written.push(INDEX_MANIFEST_NAME);

  // 4) … og manifestet ALLER SIST (garanti 5).
  writer.writeFile(abs(CATALOG_MANIFEST_NAME), `${JSON.stringify(plan.manifest, null, 2)}\n`);
  written.push(CATALOG_MANIFEST_NAME);

  return { written, deleted, indexManifest: newIndexManifest };
}

/**
 * Plan + skriving i ett. Skriver INGENTING hvis plana feiler (garanti 1 og 2)
 * eller ved dryRun.
 *
 * @returns {Promise<{ok: boolean, plan: object, written: string[], deleted: string[]}>}
 */
export async function buildCatalogIndex(opts = {}) {
  const plan = await planBuild(opts);
  if (!plan.ok || opts.dryRun) {
    return { ok: plan.ok, plan, written: [], deleted: [] };
  }
  const res = writePlan(plan, opts);
  return { ok: true, plan, ...res };
}
