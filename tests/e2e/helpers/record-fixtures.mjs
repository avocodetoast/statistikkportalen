#!/usr/bin/env node
/**
 * Spiller inn E2E-fixtures ved å kjøre den ekte røyktestflyten mot de ekte
 * API-ene én gang — Statistikkportalen.
 *
 * HVORFOR SLIK: fixtures som skrives for hånd (eller av et script som gjetter
 * URL-er) driver fra hverandre i det appen endrer en query-parameter. Her er
 * det appen selv som genererer requestene, og stub-routes.mjs lagrer dem under
 * nøyaktig den nøkkelen replay senere slår opp på. Da kan de ikke bomme.
 *
 * Kjør på nytt når API-formatet endrer seg eller flyten utvides:
 *   node tests/e2e/helpers/record-fixtures.mjs [--table 07459]
 *
 * Krever nett. Fixtures skrives til tests/e2e/fixtures/ og skal committes.
 */

import fs from 'node:fs';
import { launchApp, waitForFrontPage } from './app-browser.mjs';
import {
  runSearchFlow, runTopicFlow, runTableFlow,
  BUILDER_TABLES, BUILDER_FLOWS,
  TOPIC_ROUTES, TOPIC_KEEP_TABLES, runTopicRouteFlow,
  DEFAULT_TABLE, NB_TABLE, FHI_TABLE
} from './flows.mjs';
import { FIXTURE_DIR } from './stub-routes.mjs';

function parseArgs(argv) {
  const args = { table: DEFAULT_TABLE, clean: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--table') args.table = argv[++i];
    else if (argv[i] === '--no-clean') args.clean = false;
  }
  return args;
}

const { table, clean } = parseArgs(process.argv);

console.log(`Spiller inn fixtures mot ekte API-er (tabell ${table})...`);
console.log('Kallene bremses til ~1 per 2,2 s for å holde oss under SSBs 30/min.\n');

// Standard er å tømme katalogen: da kan ingen foreldreløse fixtures bli
// liggende igjen etter at en flyt er endret. --no-clean spiller inn oppå de
// eksisterende, nyttig når bare én tabell skal friskes opp.
if (clean && fs.existsSync(FIXTURE_DIR)) {
  for (const file of fs.readdirSync(FIXTURE_DIR)) {
    if (file.endsWith('.json')) fs.unlinkSync(`${FIXTURE_DIR}/${file}`);
  }
}

const app = await launchApp({
  mode: 'http',
  network: 'record',
  keepTables: [table, ...BUILDER_TABLES, ...TOPIC_KEEP_TABLES]
});

try {
  // ALLE flytene må kjøres, ikke bare tabellflyten: søket gjør sitt eget
  // /tables?query=…-kall (SSB-side søk i tillegg til det klientside), og uten
  // det steget her mangler røyktesten en fixture den trenger.
  await waitForFrontPage(app.page);

  await runSearchFlow(app.page);

  await app.page.goto(app.baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForFrontPage(app.page);
  await runTopicFlow(app.page);

  // Én tabell per kilde: SSB (PxWebApi), Norges Bank (SDMX) og FHI
  // (JSON-Stat2 + eget metadata/flag-kall). Alle tre går ulike veier gjennom
  // adapterlaget, så alle tre må spilles inn.
  for (const id of [table, NB_TABLE, FHI_TABLE]) {
    await app.page.goto(app.baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForFrontPage(app.page);
    await runTableFlow(app.page, id);
  }

  // Variabelvalg- og API-byggerflytene. Nøyaktig de samme funksjonene som
  // variable-select.e2e.mjs kjører, i nøyaktig samme rekkefølge — se
  // kommentaren over BUILDER_TABLES om hvorfor rekkefølgen betyr noe.
  for (const id of BUILDER_TABLES) {
    console.log(`  … byggerflyt for ${id}`);
    await BUILDER_FLOWS[id](app.page);
  }

  // Emnehierarkiet. Ingen NYE endepunkter treffes — treet bygges av /tables,
  // som allerede er spilt inn — men flyten kjøres her likevel, både for at
  // rekkefølgen skal stemme med testen, og for at et framtidig steg som FAKTISK
  // gjør et kall skal bli fanget opp av innspillingen.
  for (const route of TOPIC_ROUTES) {
    console.log(`  … emneflyt for ${route.path.join('/')}`);
    await runTopicRouteFlow(app.page, route);
  }
} finally {
  const problems = app.problems();
  await app.close();

  console.log(`\n${app.routes.recorded.length} kall spilt inn:`);
  for (const line of app.routes.recorded) console.log(`  ${line}`);
  console.log(`\nSkrevet til ${FIXTURE_DIR}`);

  if (problems) {
    console.log(`\nMerk — problemer under innspilling:\n${problems}`);
  }
}
