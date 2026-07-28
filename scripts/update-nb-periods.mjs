#!/usr/bin/env node
/**
 * Byggescript for Norges Bank-katalogens tidsperioder — Statistikkportalen 2.0.
 *
 * HVORFOR: adapteren fylte tidligere «Tidsperiode»/«Sist oppdatert» i
 * tabellistene med ETT probekall per katalograd ved hver app-init — 31
 * samtidige kall mot data.norges-bank.no for hver kalde sidelasting, i
 * tillegg blokkerende for BrowserState.init(). Norges Banks SDMX-API har
 * ingen bulkvei til tidsvinduene, så probene kjøres her ved byggetid og
 * resultatet sjekkes inn.
 *
 * data/sources/nb-periods.json leses ved BYGGETID av
 * scripts/lib/catalog-sources.mjs (applyNbPeriods), som feeder den
 * forhåndsbygde katalogindeksen i data/index/ — appen leser aldri denne fila
 * direkte. norges-bank-adapter.js sin egen getTables() (kun brukt som
 * fallback når indeksen mangler/er ubrukelig) gjør null nettverkskall og
 * fyller periodefeltene KUN fra en fersk per-tabell cache-oppføring, skrevet
 * forrige gang tabellen ble åpnet (fetchCataloguePeriod +
 * BrowserState.syncTablePeriodsFromMetadata) — ellers står de tomme til
 * tabellen åpnes.
 *
 * Kjøres manuelt/periodisk (ukentlig er rikelig — dette er visningsmetadata
 * for tabellistene, ikke selve tallene):
 *   node scripts/update-nb-periods.mjs [--out <sti>] [--delay <ms>]
 *
 * Krever Node 18+ (global fetch). Ingen npm-avhengigheter.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { probeAll, probeTargets } from './lib/nb-periods.mjs';
import { atomicWrite } from './lib/atomic-write.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_DELAY_MS = 250; // pause mellom sekvensielle prober

function parseArgs(argv) {
  const args = {
    out: path.join(REPO_ROOT, 'data', 'sources', 'nb-periods.json'),
    delay: DEFAULT_DELAY_MS
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--delay') args.delay = parseInt(argv[++i], 10);
    else {
      console.error(`Ukjent argument: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.delay) || args.delay < 0) {
    console.error('--delay må være et ikke-negativt tall');
    process.exit(2);
  }
  args.out = path.resolve(args.out);
  return args;
}

/**
 * Kjør en browser-global appfil i en sandkasse og les ut window.{key}.
 * config.js refererer window.NbCatalog/window.SourceTopology, så de må kjøres
 * i SAMME sandkasse først (speiler <script>-rekkefølgen i index.html).
 * Samme mønster som i scripts/update-fhi-catalog.mjs og generate-seo-pages.mjs.
 */
function loadAppConfig() {
  const sandbox = { window: {} };
  for (const file of ['sources/nb-catalog.js', 'sources/source-topology.js', 'config.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(REPO_ROOT, 'js', file), 'utf8'), sandbox);
  }
  const cfg = sandbox.window.AppConfig;
  if (!cfg) throw new Error('Klarte ikke å lese AppConfig fra js/config.js');
  const nb = cfg.sources && cfg.sources.nb;
  if (!nb || !Array.isArray(nb.dataflows) || nb.dataflows.length === 0) {
    throw new Error('AppConfig.sources.nb.dataflows er tom — sjekk js/sources/nb-catalog.js');
  }
  return cfg;
}

async function main() {
  const args = parseArgs(process.argv);
  const appConfig = loadAppConfig();
  const targets = probeTargets(appConfig);
  const distinct = new Set(targets.map(t => t.probeId)).size;

  console.log(`[nb-periods] API: ${appConfig.sources.nb.baseUrl}`);
  console.log(`[nb-periods] Rader: ${targets.length} (${distinct} unike prober)`);
  console.log(`[nb-periods] Pause mellom kall: ${args.delay} ms`);
  console.log(`[nb-periods] Ut: ${args.out}`);

  const output = await probeAll(appConfig, {
    delayMs: args.delay,
    warn: msg => console.warn(`[nb-periods] ${msg}`),
    log: msg => console.log(`[nb-periods]${msg}`)
  });

  const found = Object.keys(output.tables).length;
  // Alt feilet = nettet er nede eller API-et har flyttet seg. Da skal den
  // innsjekkede fila stå urørt heller enn å bli erstattet med en tom katalog
  // (adapteren ville da vist tomme periodekolonner for alle NB-tabeller).
  if (found === 0) {
    throw new Error('Ingen prober lyktes — lar den eksisterende fila stå urørt.');
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const json = JSON.stringify(output, null, 2);
  atomicWrite(args.out, json);

  const missing = targets.filter(t => !output.tables[t.tableId]).map(t => t.tableId);
  if (missing.length) {
    console.warn(`[nb-periods] Uten periode (probe feilet): ${missing.join(', ')}`);
  }
  console.log(`\n[nb-periods] Ferdig: ${found}/${targets.length} rader skrevet til:`);
  console.log(`[nb-periods]   ${args.out}`);
}

main().catch(err => {
  console.error(`[nb-periods] FEIL: ${err.message}`);
  process.exit(1);
});
