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
  readVariableSelection,
  readSourceBadge,
  DEFAULT_TABLE,
  NB_TABLE,
  FHI_TABLE,
  SOURCE_TABLES
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

  it('sidelastingen gjør ingen eksterne API-kall', async () => {
    // Selve poenget med katalogindeksen. Før den lastet BrowserState._doInit()
    // /config og /tables fra data.ssb.no sekvensielt før første paint (~11,7 MB
    // rå). Nå kommer hele katalogen fra data/index/ på egen opprinnelse.
    //
    // Denne suiten har allerede navigert til forsiden og ventet på emnetreet i
    // before(), så alt init trengte ligger i app.requests. Asserter på
    // opprinnelse, ikke på antall kall: da fanger den også et nytt eksternt
    // kall noen legger inn senere, uansett hvilken vert det går til.
    // Ett uttrykt unntak: Umami-analyticsskriptet som index.html injiserer.
    // Det er ikke et API-kall og har ingenting med metadatalasting å gjøre.
    // Unntaket er navngitt, ikke et generisk filter — dukker det opp en NY
    // ekstern vert, feiler testen slik den skal.
    const ANALYTICS = 'stats.statistikkportalen.no';
    const external = app.externalRequests().filter(u => !u.includes(ANALYTICS));

    assert.deepEqual(
      external, [],
      `sidelastingen traff eksterne API-er:\n  - ${external.join('\n  - ')}`
    );
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
 * file:// er en dokumentert, BEVISST DEGRADERT modus (CLAUDE.md: «Åpnes
 * direkte som index.html»). Katalogindeksen (js/catalog-index.js) og FHIs
 * pregenererte katalog (data/sources/fhi-catalog.json) hentes begge med
 * fetch(), som nettleseren blokkerer for lokale filer — appen faller da
 * tilbake til direkte kildehenting fra API-ene. Fungerer, men tregt og uten
 * byggetids-metadata: NB/FHI-tabellene mangler periodekolonner (ingen bakt
 * fil, og ingen tabell er åpnet ennå til å friske opp en cache-oppføring).
 * Kravet om at appen skal virke IDENTISK over file:// ble droppet da
 * katalogindeksen kom til — denne testen dekker at degraderingen er PEN
 * (appen laster, viser tabeller, ingen feil), ikke at den er umerkelig.
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

  it('Norges Bank og FHI degraderer pent (ingen byggetids-metadata over file://)', async () => {
    const badge = await readSourceBadge(app.page);
    assert.match(badge, /3\/3/, `statusbadgen viste «${badge}» over file://`);

    // Katalogindeksen OG fhi-catalog.json er begge lokale filer — begge
    // blokkert av nettleseren over file:// — så NB/FHI-tabellene kommer nå
    // fra direkte kildehenting UTEN byggetids-berikelse: periodekolonnene er
    // tomme (ingen bakt fil, og ingen tabell er åpnet ennå), men tabellene
    // skal fortsatt være der med en gyldig label. Se CLAUDE.md.
    const foreign = await app.page.evaluate(() =>
      window.BrowserState.allTables
        .filter((t) => t.id.startsWith('nb-') || t.id.startsWith('fhi-'))
        .map((t) => ({ id: t.id, label: t.label, first: t.firstPeriod, last: t.lastPeriod }))
    );

    assert.ok(foreign.length > 0, 'ingen nb-/fhi-tabeller i katalogen');
    assert.ok(
      foreign.every((t) => typeof t.label === 'string' && t.label.trim().length > 0),
      'alle nb-/fhi-tabeller skal ha en label selv uten byggetids-katalogen'
    );
    assert.ok(
      foreign.every((t) => t.first === '' && t.last === ''),
      'periodekolonnene skal være tomme over file:// — ingen bakt fil er tilgjengelig ' +
        'og ingen tabell er åpnet ennå til å friske dem opp'
    );
    assertClean(app, 'NB/FHI-degradering over file://');
  });
});

/**
 * Deep-link ved KALD last: `#variables/{id}` som aller første navigasjon, uten
 * å innom forsiden. index.html kaller `URLRouter.handleRoute()` når det finnes
 * en hash ved oppstart, og ruten må overleve at katalogen ennå ikke er lastet.
 *
 * Hver test starter sin egen nettleser — det er nettopp kaldstarten som testes,
 * så en gjenbrukt side ville gjort fragmentnavigasjon ut av det og målt noe helt
 * annet. Ingen nye fixtures: kallene er de samme som `runTableFlow()` gjør.
 *
 * (Skillet dokumenterte tidligere dette som en kjent feil. Det stemte ikke —
 * derfor står det nå en test her i stedet for en påstand i et dokument.)
 */
describe('E2E deep-link ved kald last', { skip: availability.ok ? false : availability.reason }, () => {
  for (const { source, tableId } of SOURCE_TABLES) {
    it(`${source}: #variables/${tableId} som første navigasjon`, async () => {
      const app = await launchApp({
        mode: MODE_HTTP,
        network: NETWORK,
        keepTables: [tableId],
        hash: `#variables/${tableId}`,
        shotPrefix: `deeplink-${source}`
      });

      try {
        const result = await readVariableSelection(app.page);

        assert.equal(result.view, 'variables', `havnet i «${result.view}» i stedet for variabelvalget`);
        assert.match(result.hash, new RegExp(`^#variables/${tableId}`), `hashen ble «${result.hash}»`);
        assert.ok(result.dimensionCount > 0, 'ingen dimensjonskort rendret');
        assert.equal(result.subjectCount, 0, 'forsiden ble rendret i stedet for variabelvalget');

        await app.shot(`deeplink-${tableId}`);
        assertClean(app, `Deep-link til ${tableId}`);
      } finally {
        await app.close();
      }
    });
  }
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
    // Med katalogindeksen på kommer SSB-katalogen fra det innsjekkede shardet,
    // ikke fra data.ssb.no. Å blokkere verten degraderer derfor IKKE lenger
    // katalogen — alle tre kildene lastes. Det er hele poenget med indeksen,
    // og badgen skal si 3/3. (Før indeksen sa den 2/3; assertionen er skjerpet,
    // ikke svekket — se testen under, som fortsatt dekker det degraderte
    // tilfellet ved å ta bort indeksen OG SSB samtidig.)
    const badge = await readSourceBadge(app.page);
    assert.match(badge, /3\/3/, `statusbadgen viste «${badge}» med SSB blokkert, men indeksen på`);

    const subjects = await app.page.locator('[data-subject]').count();
    assert.ok(subjects > 0, 'emnetreet forsvant helt da SSB var nede');

    await app.shot('degradert');
    assert.equal(app.pageErrors.length, 0, `uncaught exceptions:\n${app.pageErrors.join('\n')}`);
  });
});

/**
 * Fallback-stien: både katalogindeksen OG SSB borte. Da er det bare NB+FHI
 * igjen, og appen skal fortsatt rendre et emnetre og vise degradert status.
 * Dette er tilfellet «E2E degradert modus» dekket før indeksen fantes — det
 * krever nå at BEGGE kildene til katalogen tas bort, ikke bare SSB.
 */
describe('E2E degradert modus uten indeks', { skip: availability.ok ? false : availability.reason }, () => {
  let app;

  before(async () => {
    app = await launchApp({
      mode: MODE_HTTP,
      network: NETWORK,
      blockHosts: ['data.ssb.no'],
      blockPaths: ['/data/index/'],
      shotPrefix: 'degradert-uten-indeks'
    });
    await waitForFrontPage(app.page);
  });

  after(async () => {
    if (app) await app.close();
  });

  it('faller tilbake til direkte kildehenting når indeksen mangler', async () => {
    const badge = await readSourceBadge(app.page);
    assert.match(badge, /2\/3/, `statusbadgen viste «${badge}» med både indeks og SSB blokkert`);

    const subjects = await app.page.locator('[data-subject]').count();
    assert.ok(subjects > 0, 'emnetreet forsvant helt da både indeks og SSB var nede');

    await app.shot('degradert-uten-indeks');
    assert.equal(app.pageErrors.length, 0, `uncaught exceptions:\n${app.pageErrors.join('\n')}`);
  });
});
