/**
 * Delte brukerflyter for E2E — Statistikkportalen.
 *
 * HVORFOR EGEN MODUL: nøyaktig de samme stegene kjøres i to modi — av
 * record-fixtures.mjs mot ekte API-er, og av smoke.e2e.mjs mot fixtures. Hvis
 * flyten fantes i to kopier ville fixturene stille slutte å dekke det testen
 * faktisk gjør. Én kilde, to modi.
 *
 * Flytene DRIVER appen og RAPPORTERER hva de så. De asserter ikke selv —
 * det gjør testfila, så feilmeldingene peker på riktig sted.
 *
 * Selektorene under er verifisert mot appen slik den faktisk rendrer. Alle er
 * eksisterende id-er/data-attributter; ingen data-testid er lagt til for
 * testenes skyld.
 */

/** Liten SSB-tabell (12 celler i standardvalget) — rask og stabil å hente. */
export const DEFAULT_TABLE = '13760';

/**
 * Norges Bank: styringsrente. Liten (405 celler maks) og går gjennom hele
 * SDMX→JSON-Stat2-konverteringen i js/sources/sdmx-to-jsonstat.js.
 */
export const NB_TABLE = 'nb-IR';

/**
 * FHI: befolkningsvekst. Blant de minste FHI-tabellene (18 814 celler) og
 * treffer FHI-adapterens ekstra /metadata + /flag-kall ved tabellåpning.
 */
export const FHI_TABLE = 'fhi-nokkel-185';

/** Alle tre kildene, for tester som skal dekke hele matrisen. */
export const SOURCE_TABLES = [
  { source: 'ssb', tableId: DEFAULT_TABLE },
  { source: 'nb', tableId: NB_TABLE },
  { source: 'fhi', tableId: FHI_TABLE }
];

const TIMEOUT = 20000;

/**
 * Venter til variabelvalget faktisk har rendret, og rapporterer hva appen viser.
 *
 * Brukes av deep-link-testene: der er poenget nettopp at man IKKE går via
 * forsiden, så `runTableFlow()` (som navigerer selv) passer ikke.
 */
export async function readVariableSelection(page) {
  await page.waitForSelector('[data-dimension]', { timeout: TIMEOUT });
  return {
    view: await page.evaluate(() => window.AppState?.currentView),
    hash: await page.evaluate(() => window.location.hash),
    dimensionCount: await page.locator('[data-dimension]').count(),
    subjectCount: await page.locator('[data-subject]').count()
  };
}

/**
 * Forside → søk. Søket utløses av Enter (ikke av debounce), jf.
 * front-page.js: keydown-handleren navigerer til #search.
 */
export async function runSearchFlow(page, query = 'arbeidsledighet') {
  await page.fill('#front-search', query);
  await page.press('#front-search', 'Enter');
  await page.waitForFunction(() => window.location.hash.startsWith('#search'), { timeout: TIMEOUT });
  await page.waitForSelector('a[href*="#variables/"]', { timeout: TIMEOUT });

  return {
    hash: await page.evaluate(() => window.location.hash),
    resultCount: await page.locator('a[href*="#variables/"]').count()
  };
}

/**
 * Forside → emne → underemne → tabelliste.
 *
 * MERK: kortene nedover i treet er IKKE <a href="#topic/...">. De eneste
 * ekte topic-lenkene på siden er den faste menylinja øverst, som er lik på
 * alle nivåer. Nedboringen skjer via klikk på .subtopic-card / .category-card,
 * som topic-view.js binder click-handlere på. Å følge href-er her ville stått
 * stille på nivå 1 for alltid.
 *
 * Dybden varierer per gren (SSB har 3 nivåer, FHI-registre kan ha 3 med
 * kategori), så vi borer til tabell-lenkene dukker opp.
 */
export async function runTopicFlow(page, { maxDepth = 5 } = {}) {
  await page.waitForSelector('[data-subject]', { timeout: TIMEOUT });
  const subjectCount = await page.locator('[data-subject]').count();

  await page.locator('.front-subject-link').first().click();
  await page.waitForTimeout(400);

  const visited = [];
  let depth = 0;

  while (depth < maxDepth) {
    if (await page.locator('a[href*="#variables/"]').count() > 0) break;

    const card = page.locator('.subtopic-card, .category-card').first();
    if (await card.count() === 0) break;

    await card.click();
    await page.waitForTimeout(500);
    visited.push(await page.evaluate(() => window.location.hash));
    depth++;
  }

  return {
    subjectCount,
    depth,
    visited,
    hash: await page.evaluate(() => window.location.hash),
    tableLinkCount: await page.locator('a[href*="#variables/"]').count()
  };
}

/**
 * Fyller inn et gyldig utvalg. «Hent data» er disabled til noe er valgt.
 *
 * Kildene skiller seg her, og det er ikke tilfeldig: /defaultselection er et
 * PxWebApi-endepunkt. SSB og FHI har det, Norges Banks SDMX-API har det ikke,
 * så NB-tabeller mangler #load-default-selection helt og må velges manuelt.
 *
 * @returns {'default'|'select-all'} hvilken vei som ble brukt
 */
async function fillSelection(page) {
  if (await page.locator('#load-default-selection').count() > 0) {
    await page.click('#load-default-selection');
    return 'default';
  }

  // Norges Bank-veien. To fallgruver, begge observert på nb-IR:
  //   - `.card-auto-hidden`-kort er skjult (nullstort rektangel). En blind
  //     click() på `.select-all-btn` henger 30 s på visibility-ventingen.
  //   - Single-select-dimensjoner har ingen «Velg alle»; de rendres som
  //     radioknapper i .dim-pill-group og må velges enkeltvis, ellers blir
  //     kortet stående card-status-invalid og «Hent data» forblir disabled.
  const cards = page.locator('[data-dimension]:not(.card-auto-hidden)');
  const cardCount = await cards.count();

  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);

    if (await card.getAttribute('data-singleselect') === 'true') {
      // Radioknappen selv er visuelt skjult inni <label class="api-pill">;
      // .check() henger på visibility. Klikk labelen, slik en bruker gjør.
      const pill = card.locator('.dim-pill-group label.api-pill').first();
      if (await pill.count() > 0) await pill.click();
      continue;
    }

    const selectAll = card.locator('.select-all-btn');
    if (await selectAll.count() > 0) await selectAll.first().click();
  }

  return 'select-all';
}

/**
 * Variabelvalg → hent data → eksport, for én tabell fra hvilken som helst kilde.
 *
 * Flyten er bevisst adaptiv: eksportmulighetene er kildeavhengige (SSB har
 * Excel + «Flere alternativer» + «Få lenke», FHI bare CSV, jf. at
 * saved queries er SSB-only). Testen asserter mot det som RETURNERES, så
 * kapabilitetsmatrisen står dokumentert i smoke.e2e.mjs i stedet for å være
 * bakt inn som skjulte antakelser her.
 */
export async function runTableFlow(page, tableId = DEFAULT_TABLE, { shot = null } = {}) {
  const base = page.url().split('#')[0];
  await page.goto(`${base}#variables/${tableId}`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('[data-dimension]', { timeout: TIMEOUT });
  const dimensionCount = await page.locator('[data-dimension]').count();
  if (shot) await shot(`${tableId}-variabelvalg`);

  const selectionMode = await fillSelection(page);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById('fetch-data-btn');
      return btn && !btn.disabled;
    },
    { timeout: TIMEOUT }
  );

  const cellCount = await page.locator('#cell-count-display').innerText();
  if (shot) await shot(`${tableId}-utvalg`);

  await page.click('#fetch-data-btn');
  await page.waitForSelector('#data-container table', { timeout: TIMEOUT });

  const rowCount = await page.locator('#data-container table tr').count();
  if (shot) await shot(`${tableId}-tabellvisning`);

  const exports = {
    csv: await page.locator('#export-csv-btn').count() > 0,
    excel: await page.locator('#export-quick-btn').count() > 0,
    dialog: await page.locator('#export-btn').count() > 0,
    saveQuery: await page.locator('#save-query-btn').count() > 0,
    rotate: await page.locator('#rotate-table-btn').count() > 0
  };

  // Eksportdialogen finnes bare der «Flere alternativer» gjør det (SSB).
  let exportDialogOpens = null;
  if (exports.dialog) {
    await page.click('#export-btn');
    await page.waitForSelector('#export-dialog', { state: 'visible', timeout: TIMEOUT });
    exportDialogOpens = await page.locator('#export-dialog').isVisible();
    if (shot) await shot(`${tableId}-eksportdialog`);
  }

  return { dimensionCount, selectionMode, cellCount, rowCount, exports, exportDialogOpens };
}

/** Statusbadgen i headeren, f.eks. «3/3 datakilder lastet inn». */
export async function readSourceBadge(page) {
  return (await page.locator('#api-status-badge').innerText()).replace(/\s+/g, ' ').trim();
}
