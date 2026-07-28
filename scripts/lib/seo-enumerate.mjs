/**
 * Leser den byggetidsbygde katalogindeksen ({webroot}/data/index/, skrevet av
 * scripts/build-catalog-index.mjs) og gir scripts/generate-seo-pages.mjs alle
 * katalogradene i nøyaktig samme flate form adapternes getTables() ga — og
 * som scripts/lib/catalog-sources.mjs sin fetchAllTables()/buildSourceRows()
 * ga generatoren FØR P6.
 *
 * HVORFOR EGEN MODUL (P6): SEO-generatoren bygde tidligere katalogen selv —
 * SSBs pagerte /tables hentet direkte, NB og FHI bygget nettverksfritt via
 * scripts/lib/seo-sources.mjs sine providere. Nå KONSUMERER den i stedet
 * indeksen scripts/build-catalog-index.mjs allerede har skrevet, slik at
 * indeksen (appen laster den) og de statiske SEO-sidene alltid bygges fra
 * samme øyeblikksbilde av kildene og aldri kan bli uenige om hvilke tabeller
 * som finnes. Se README.md for cron-rekkefølgen dette krever
 * (build-catalog-index.mjs FØR generate-seo-pages.mjs).
 *
 * decode() kommer fra scripts/lib/catalog-format.mjs sin loadDecoder(), som
 * kjører den ekte js/catalog-index.js via node:vm — samme kode nettleseren
 * kjører, ingen dobbeltimplementasjon av dekodingslogikken her.
 *
 * Ren ESM. `fs` er en parameter (default node:fs) slik at tester kan kjøre
 * mot en syntetisk indeks uten ekte filer på disk (CLAUDE.md: ingen test skal
 * treffe nettverk — dette går et skritt lenger og trenger ikke disken heller).
 */
import nodeFs from 'node:fs';
import path from 'node:path';
import { loadDecoder } from './catalog-format.mjs';
import { apiLang } from './catalog-sources.mjs';
import { CATALOG_MANIFEST_NAME } from './catalog-build.mjs';

// SSBs nøkkel i AppConfig.sources / manifestets shard.source — den harde
// garantien, som SSB-hentingen var før P6.
const PRIMARY_SOURCE = 'ssb';

/**
 * Alle katalograder fra alle kilder i katalogindeksen, samlet i én flat
 * liste (samme form som før: id, label, paths[], variableNames[], perioder,
 * discontinued, …).
 *
 * GARANTIER (speiler de harde/myke feilreglene fra før P6):
 *   - Mangler manifestet, er formatet ukjent (`format !== 1`), mangler
 *     SSB-shardet for det aktuelle språket, eller dekoder SSB-shardet til
 *     færre enn `minTables` rader → kaster, uten å ha skrevet noe (kalleren,
 *     generate-seo-pages.mjs, skriver ingenting til webroot før denne
 *     funksjonen har returnert).
 *   - En fremmed kildes (nb/fhi/…) shard som mangler i manifestet, ikke lar
 *     seg lese, eller ikke dekoder, logges og hoppes over — resten av
 *     kjøringen fortsetter (feilisolering, som aggregateTables i
 *     js/sources/source-registry.js).
 *
 * @param {object} appConfig
 * @param {number} minTables - Sanity-terskel, håndhevet på DEKODET SSB-antall.
 * @param {object} opts
 * @param {string} opts.webroot - Katalogen index.html og data/index/ ligger i.
 * @param {string} [opts.lang] - Manifestets språktagg (default: apiLang(appConfig), samme
 *   som scripts/build-catalog-index.mjs tagger shardene med — IKKE UI-språket).
 * @param {object} [opts.fs] - fs-implementasjon (injiserbar for test; default node:fs).
 * @param {function} [opts.log]
 * @param {function} [opts.warn]
 * @returns {object[]} katalograder, alle kilder samlet.
 */
export function enumerateAllTables(appConfig, minTables, opts = {}) {
  const fs = opts.fs || nodeFs;
  const log = opts.log || console.log;
  const warn = opts.warn || console.warn;
  const lang = opts.lang || apiLang(appConfig);
  const indexDir = path.join(opts.webroot, 'data', 'index');
  const manifestPath = path.join(indexDir, CATALOG_MANIFEST_NAME);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Fant ikke katalogindeksen (${manifestPath}): ${err.message} — kjør ` +
      '«node scripts/build-catalog-index.mjs --webroot <sti>» først.'
    );
  }
  if (!manifest || manifest.format !== 1 || !Array.isArray(manifest.shards)) {
    throw new Error(
      `Katalogindeksen har ukjent format (${manifestPath}, format=${manifest && manifest.format}) ` +
      '— bygg den på nytt med scripts/build-catalog-index.mjs.'
    );
  }

  const decode = loadDecoder();
  const wanted = manifest.shards.filter(s => s && s.lang === lang);

  const tables = [];
  let primaryRows = null;
  for (const shard of wanted) {
    let rows;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(indexDir, shard.file), 'utf8'));
      rows = decode(doc);
    } catch (err) {
      if (shard.source === PRIMARY_SOURCE) {
        throw new Error(
          `Klarte ikke å lese/dekode SSB-shardet (${shard.file}): ${err.message} — ` +
          'avbryter uten å røre webroot.'
        );
      }
      warn(`[SEO] Kilden «${shard.source}» feilet (${err.message}) — hopper over.`);
      continue;
    }
    if (shard.source === PRIMARY_SOURCE) primaryRows = rows;
    log(`[SEO] Kilde «${shard.source}»: ${rows.length} tabeller.`);
    tables.push(...rows);
  }

  if (primaryRows === null) {
    throw new Error(
      `Katalogindeksen mangler SSB-shardet for språk «${lang}» (${manifestPath}) — ` +
      'avbryter uten å røre webroot.'
    );
  }
  if (primaryRows.length < minTables) {
    throw new Error(
      `Bare ${primaryRows.length} dekodede SSB-rader i katalogindeksen (forventet minst ` +
      `${minTables}) — avbryter uten å røre webroot.`
    );
  }

  return tables;
}
