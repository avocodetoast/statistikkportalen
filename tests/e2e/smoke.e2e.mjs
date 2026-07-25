/**
 * Røyktest — Statistikkportalen.
 *
 * Dekker det enhetstestene med vilje IKKE dekker: at appen faktisk laster og
 * at hovedflytene henger sammen i en ekte nettleser. tests/README.md har
 * alltid pekt på «verify the rest manually in the browser» for de DOM-tunge
 * view-modulene — dette er den automatiserte versjonen av den setningen.
 *
 *   npm run test:e2e                 # mot fixtures (deterministisk)
 *   E2E_LIVE=1 npm run test:e2e      # mot ekte API-er
 *   E2E_SHOTS=1 npm run test:e2e     # lagrer skjermbilder underveis
 *
 * Filendelsen er .e2e.mjs, ikke .test.js — `npm test` globber
 * "tests/**./*.test.js" og skal fortsette å være rask og nettverksfri.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { launchApp, waitForFrontPage, e2eAvailable, MODE_FILE, MODE_HTTP } from './helpers/app-browser.mjs';
import {
  runSearchFlow,
  runTopicFlow,
  runTableFlow,
  readSourceBadge,
  DEFAULT_TABLE,
  NB_TABLE,
  FHI_TABLE
} from './helpers/flows.mjs';

const availability = e2eAvailable();
const NETWORK = process.env.E2E_LIVE ? 'live' : 'replay';

/** Asserter at ingenting har gått galt i nettleseren så langt. */
function assertClean(app, step) {
  const problems = app.problems();
  assert.equal(problems, null, `${step} ga feil i nettleseren:\n${problems}`);
}

describe('E2E røyktest (http)', { skip: availability.ok ? false : availability.reason }, () => {
  let app;

  before(async () => {
    app = await launchApp({
      mode: MODE_HTTP,
      network: NETWORK,
      keepTables: [DEFAULT_TABLE],
      shotPrefix: 'http'
    });
    await waitForFrontPage(app.page);
  });

  after(async () => {
    if (app) await app.close();
  });

  it('forsiden rendrer emnetreet uten feil', async () => {
    const subjects = await app.page.locator('[data-subject]').count();
    assert.ok(subjects > 10, `forventet et emnegrid, fant ${subjects} emner`);
    await app.shot('forside');
    assertClean(app, 'Forsiden');
  });

  it('alle tre kildene lastes inn', async () => {
    const badge = await readSourceBadge(app.page);
    assert.match(badge, /3\/3/, `statusbadgen viste «${badge}»`);
  });

  it('søk gir treff og bytter rute', async () => {
    await app.page.goto(app.baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForFrontPage(app.page);

    const result = await runSearchFlow(app.page, 'arbeidsledighet');
    assert.match(result.hash, /^#search/);
    assert.ok(result.resultCount > 0, 'søket ga ingen tabelltreff');
    await app.shot('sok');
    assertClean(app, 'Søk');
  });

  it('emnenavigasjon borer ned til en tabelliste', async () => {
    await app.page.goto(app.baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForFrontPage(app.page);

    const result = await runTopicFlow(app.page);
    assert.ok(result.subjectCount > 10, `fant bare ${result.subjectCount} emner`);
    assert.ok(
      result.tableLinkCount > 0,
      `kom til ${result.hash} på dybde ${result.depth} uten å finne tabell-lenker`
    );
    await app.shot('emne');
    assertClean(app, 'Emnenavigasjon');
  });

  it('SSB: variabelvalg → hent data → eksport', async () => {
    const result = await runTableFlow(app.page, DEFAULT_TABLE, { shot: app.shot });

    assert.ok(result.dimensionCount > 0, 'variabelvalget rendret ingen dimensjonskort');
    assert.equal(result.selectionMode, 'default', 'SSB skal ha /defaultselection');
    assert.match(result.cellCount, /\d/, `celletelleren viste «${result.cellCount}»`);
    assert.ok(result.rowCount > 1, `datatabellen hadde ${result.rowCount} rader`);

    // SSB er den eneste kilden med full eksportmeny og lagrede spørringer.
    assert.deepEqual(result.exports, {
      csv: true, excel: true, dialog: true, saveQuery: true, rotate: true
    });
    assert.ok(result.exportDialogOpens, 'eksportdialogen åpnet seg ikke');
    assertClean(app, 'SSB-tabellflyten');
  });

  /**
   * Norges Bank går en helt annen vei enn SSB: SDMX konverteres til
   * JSON-Stat2 av js/sources/sdmx-to-jsonstat.js, og SDMX-API-et har ingen
   * /defaultselection, så variabelvalget må fylles manuelt. Enhetstestene
   * dekker konverteringen isolert; dette er den eneste testen som kjører hele
   * kjeden fra katalog til rendret tabell.
   */
  it('Norges Bank: SDMX-tabell hele veien til rendret data', async () => {
    await app.page.goto(app.baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForFrontPage(app.page);

    const result = await runTableFlow(app.page, NB_TABLE, { shot: app.shot });

    assert.ok(result.dimensionCount > 0, 'NB-tabellen rendret ingen dimensjonskort');
    assert.equal(
      result.selectionMode,
      'select-all',
      'NB skal IKKE ha #load-default-selection — SDMX-API-et har ikke endepunktet'
    );
    assert.ok(result.rowCount > 1, `NB-tabellen ga ${result.rowCount} rader`);
    assert.equal(result.exports.csv, true, 'NB mangler CSV-eksport');
    assert.equal(result.exports.saveQuery, false, 'lagrede spørringer er SSB-only');
    assertClean(app, 'Norges Bank-tabellflyten');
  });

  /**
   * FHI leverer JSON-Stat2 direkte, men adapteren henter i tillegg
   * /metadata og /flag parallelt ved tabellåpning (for Tabellinfo). Den
   * fan-outen finnes ikke for de andre kildene.
   */
  it('FHI: tabell hele veien til rendret data', async () => {
    await app.page.goto(app.baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForFrontPage(app.page);

    const result = await runTableFlow(app.page, FHI_TABLE, { shot: app.shot });

    assert.ok(result.dimensionCount > 0, 'FHI-tabellen rendret ingen dimensjonskort');
    assert.equal(result.selectionMode, 'default', 'FHI skal ha standardvalg');
    assert.ok(result.rowCount > 1, `FHI-tabellen ga ${result.rowCount} rader`);
    assert.equal(result.exports.csv, true, 'FHI mangler CSV-eksport');
    assert.equal(result.exports.excel, false, 'Excel-eksport er SSB-only');
    assert.equal(result.exports.saveQuery, false, 'lagrede spørringer er SSB-only');
    assertClean(app, 'FHI-tabellflyten');
  });
});

/**
 * file:// er en dokumentert støttet modus (CLAUDE.md: «Open index.html in a
 * browser»). Den ryker stille når en ny lokal datafil hentes med fetch() i
 * stedet for å lastes som <script> — nettleseren blokkerer fetch() av lokale
 * filer, og da degraderer NB/FHI uten at noe annet varsler.
 */
describe('E2E røyktest (file://)', { skip: availability.ok ? false : availability.reason }, () => {
  let app;

  before(async () => {
    app = await launchApp({
      mode: MODE_FILE,
      network: NETWORK,
      keepTables: [DEFAULT_TABLE],
      shotPrefix: 'file'
    });
    await waitForFrontPage(app.page);
  });

  after(async () => {
    if (app) await app.close();
  });

  it('appen laster fra disk uten feil', async () => {
    const subjects = await app.page.locator('[data-subject]').count();
    assert.ok(subjects > 10, `forventet et emnegrid, fant ${subjects} emner`);
    await app.shot('forside-file');
    assertClean(app, 'Forsiden over file://');
  });

  it('Norges Bank og FHI virker uten nettverk (bakte kataloger)', async () => {
    const badge = await readSourceBadge(app.page);
    assert.match(badge, /3\/3/, `statusbadgen viste «${badge}» over file://`);

    // Den konkrete regresjonen: NB/FHI-tabeller uten periodekolonner betyr at
    // nb-periods.js / fhi-catalog.js ikke ble lastet som <script>.
    const foreign = await app.page.evaluate(() =>
      window.BrowserState.allTables
        .filter((t) => t.id.startsWith('nb-') || t.id.startsWith('fhi-'))
        .map((t) => ({ id: t.id, first: t.firstPeriod, last: t.lastPeriod }))
    );

    assert.ok(foreign.length > 0, 'ingen nb-/fhi-tabeller i katalogen');
    const withoutPeriods = foreign.filter((t) => !t.first || !t.last);
    assert.equal(
      withoutPeriods.length,
      0,
      `${withoutPeriods.length} av ${foreign.length} nb-/fhi-tabeller mangler perioder ` +
        `— tyder på at en bakt datafil ikke lastes som <script>: ` +
        JSON.stringify(withoutPeriods.slice(0, 5))
    );
  });
});

/**
 * Resilience: én kilde nede skal degradere synlig, ikke kræsje. Verifisert
 * manuelt før dette laget fantes — appen rendret emnetreet fra NB+FHI og
 * viste «2/3 datakilder lastet inn» med SSB blokkert.
 */
describe('E2E degradert modus', { skip: availability.ok ? false : availability.reason }, () => {
  let app;

  before(async () => {
    app = await launchApp({
      mode: MODE_HTTP,
      network: NETWORK,
      blockHosts: ['data.ssb.no'],
      shotPrefix: 'degradert'
    });
    await waitForFrontPage(app.page);
  });

  after(async () => {
    if (app) await app.close();
  });

  it('appen overlever at SSB er nede', async () => {
    const badge = await readSourceBadge(app.page);
    assert.match(badge, /2\/3/, `statusbadgen viste «${badge}» med SSB blokkert`);

    const subjects = await app.page.locator('[data-subject]').count();
    assert.ok(subjects > 0, 'emnetreet forsvant helt da SSB var nede');

    await app.shot('degradert');
    assert.equal(app.pageErrors.length, 0, `uncaught exceptions:\n${app.pageErrors.join('\n')}`);
  });
});
