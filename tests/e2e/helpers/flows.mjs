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

/** DBH: areal. Liten årstabell som går gjennom DBH→JSON-Stat2-konverteringen. */
export const DBH_TABLE = 'dbh-226';

/** Alle fire kildene, for tester som skal dekke hele matrisen. */
export const SOURCE_TABLES = [
  { source: 'ssb', tableId: DEFAULT_TABLE },
  { source: 'nb', tableId: NB_TABLE },
  { source: 'fhi', tableId: FHI_TABLE },
  { source: 'dbh', tableId: DBH_TABLE }
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

// ============================================================
// Variabelvalg og API-bygger — flyter for tabellene som dekker
// Ctrl+A, valgfrie variabler, grupperinger og statistikkvariabler
// ============================================================

/**
 * Tabellene som dekker API-byggeren og variabelvalget, i den rekkefølgen både
 * record-fixtures.mjs og variable-select.e2e.mjs kjører dem.
 *
 * REKKEFØLGEN ER DELT OG BETYDNINGSFULL: CacheManager lagrer svar i
 * localStorage, og nettleserkonteksten lever gjennom hele kjøringen. Et kall
 * som ble cache-servert under innspilling gikk aldri på nett og fikk derfor
 * ingen fixture. Byttes rekkefølgen om i bare den ene av de to, kan replay
 * plutselig mangle en fixture for et kall som nå går først.
 *
 *   08801 — Varekoder (13 429 verdier, trimmet til MAX_DIM_VALUES) mot Land
 *           (262): begge sider av Ctrl+A-terskelen i samme tabell.
 *   13472 — tre valgfrie dimensjoner + Region med 14 grupperinger.
 *   11189 — ti statistikkvariabler + to dimensjoner med vs_-grupperinger.
 *   12850 — sju dimensjoner der fem er valgfrie.
 */
export const BUILDER_TABLES = ['08801', '13472', '11189', '12850'];

/**
 * Åpner variabelvalget for en tabell og rapporterer hva som ble rendret.
 *
 * Navigasjonen er en ren fragmentnavigasjon, ikke en omlasting. Det er trygt
 * fordi URLRouter nullstiller AppState.variableSelection og activeCodelistIds
 * når ruta mangler ?v=/?c= (js/router.js:329-339) — uten det ville 12850 arvet
 * Region-/NACE2007-valg fra 13472, som har dimensjoner med samme navn.
 */
export async function openVariableSelection(page, tableId) {
  const base = page.url().split('#')[0];
  await page.goto(`${base}#variables/${tableId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-dimension]', { timeout: TIMEOUT });
  // Verdilistene rendres etter at kodelisterekkefølgen er forhåndslastet.
  await page.waitForSelector('.value-list-item, .dim-pill-group', { timeout: TIMEOUT });
  return readDimensions(page);
}

/**
 * Tilstanden til hvert dimensjonskort, lest i én runde i nettleseren.
 *
 * `valueCount` kommer fra METADATA, ikke fra DOM-en: tekstfilteret skjuler
 * elementer og en aktiv kodeliste bytter ut lista, så en DOM-telling ville
 * målt noe annet enn det Ctrl+A-terskelen sammenlignes mot.
 */
export async function readDimensions(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.variable-card')];
    return {
      view: window.AppState?.currentView,
      hash: window.location.hash,
      starThreshold: window.AppConfig.ui.selectAllStarThreshold,
      hasDefaultSelection: !!document.getElementById('load-default-selection'),
      fetchEnabled: !document.getElementById('fetch-data-btn')?.disabled,
      dims: cards.map(card => {
        const code = card.dataset.dimension;
        const container = card.querySelector('.value-list-container');
        const meta = typeof tableMetadata !== 'undefined' && tableMetadata?.dimension?.[code];
        return {
          code,
          valueCount: meta ? Object.keys(meta.category.label).length : 0,
          itemCount: card.querySelectorAll('.value-list-item').length,
          visibleCount: [...card.querySelectorAll('.value-list-item')]
            .filter(el => el.style.display !== 'none').length,
          selectedCount: card.querySelectorAll('.value-list-item.selected').length,
          elimination: card.dataset.elimination === 'true',
          singleSelect: card.dataset.singleselect === 'true',
          pillGroup: card.dataset.pillGroup === 'true',
          mode: container ? container.dataset.mode : null,
          codelistIds: [...card.querySelectorAll('.codelist-dropdown option')]
            .map(o => o.value).filter(Boolean)
        };
      })
    };
  });
}

/** Ett dimensjonskorts tilstand. */
export async function readDimension(page, dimCode) {
  const { dims } = await readDimensions(page);
  return dims.find(d => d.code === dimCode) ?? null;
}

/**
 * En kompakt signatur for en verdiliste: «antall:synlige:førstekode».
 *
 * Brukes til å vente på at lista har endret seg. Antall alene holder ikke, av
 * to grunner: tekstfilteret SKJULER elementer med style.display i stedet for å
 * rendre lista på nytt (antallet står stille), og et kodelistebytte kan tilfeldigvis
 * gi like mange verdier som forrige liste.
 */
function listSignature(page, dimCode) {
  return page.evaluate((code) => {
    const items = [...document.querySelectorAll(`[data-dimension="${code}"] .value-list-item`)];
    const visible = items.filter(el => el.style.display !== 'none');
    return `${items.length}:${visible.length}:${items[0]?.dataset.code ?? ''}`;
  }, dimCode);
}

/** Venter til verdilista er noe annet enn `previous`. */
function waitForListChange(page, dimCode, previous) {
  return page.waitForFunction(([code, prev]) => {
    const items = [...document.querySelectorAll(`[data-dimension="${code}"] .value-list-item`)];
    const visible = items.filter(el => el.style.display !== 'none');
    return `${items.length}:${visible.length}:${items[0]?.dataset.code ?? ''}` !== prev;
  }, [dimCode, previous], { timeout: TIMEOUT });
}

/**
 * Ctrl+A i en dimensjon.
 *
 * `focus: 'list'` fokuserer .value-list-container (den har tabindex="0"), slik
 * en bruker som har klikket i lista. `focus: 'filter'` lar fokus stå i
 * tekstfeltet — da SKAL snarveien la være å gjøre noe, jf. INPUT-vakten i
 * variable-select-events.js:310.
 *
 * Ingen verdi klikkes på forhånd; et klikk ville selv ha markert noe og gjort
 * etterprøvingen tvetydig.
 */
export async function pressSelectAll(page, dimCode, { filter = null, focus = 'list' } = {}) {
  const card = page.locator(`[data-dimension="${dimCode}"]`);

  if (filter !== null) {
    const before = await listSignature(page, dimCode);
    await card.locator('.value-filter-input').fill(filter);
    // Filteret er debounced (AppConfig.ui.filterDebounceMs).
    await waitForListChange(page, dimCode, before);
  }

  if (focus === 'list') {
    await card.locator('.value-list-container').focus();
  } else {
    await card.locator('.value-filter-input').focus();
  }

  await page.keyboard.press('Control+a');

  return page.evaluate((code) => {
    const el = document.querySelector(`[data-dimension="${code}"]`);
    const note = el.querySelector('.select-all-note');
    return {
      mode: el.querySelector('.value-list-container')?.dataset.mode ?? null,
      selectedCount: el.querySelectorAll('.value-list-item.selected').length,
      visibleCount: [...el.querySelectorAll('.value-list-item')]
        .filter(x => x.style.display !== 'none').length,
      noteVisible: !!note && note.classList.contains('is-visible')
    };
  }, dimCode);
}

/** «Velg alle»-knappen (stjernemodus uansett størrelse). */
export async function clickSelectAll(page, dimCode) {
  await page.locator(`[data-dimension="${dimCode}"] .select-all-btn`).first().click();
  return readDimension(page, dimCode);
}

/** «Opphev alle»-knappen. */
export async function clickSelectNone(page, dimCode) {
  await page.locator(`[data-dimension="${dimCode}"] .select-none-btn`).first().click();
  return readDimension(page, dimCode);
}

/**
 * Merker konkrete verdier: første med vanlig klikk (erstatter), resten med
 * modifikatorklikk (legger til) — samme semantikk som i Utforsker/Finder.
 *
 * MODIFIKATOREN MÅ VÆRE 'ControlOrMeta', ikke 'Control'. På macOS tolker
 * Chromium Ctrl+klikk som HØYREKLIKK (systemkonvensjon), så click-handleren i
 * variable-select-events.js får aldri se hendelsen: første verdi ble valgt og
 * de neste ignorert, helt stille. 'ControlOrMeta' blir Cmd på macOS og Ctrl
 * ellers, altså det tastetrykket en bruker på plattformen faktisk gjør.
 * (Tastatursnarveien Ctrl+A er upåvirket — det er bare klikk som remappes.)
 */
export async function selectValues(page, dimCode, codes) {
  for (let i = 0; i < codes.length; i++) {
    const item = page.locator(`[data-dimension="${dimCode}"] .value-list-item[data-code="${codes[i]}"]`);
    await item.scrollIntoViewIfNeeded();
    await item.click(i === 0 ? {} : { modifiers: ['ControlOrMeta'] });
  }
  return readDimension(page, dimCode);
}

/**
 * Velger en gruppering i «Kategorisering»-nedtrekket og venter til verdilista
 * faktisk er byttet ut. Tom codelistId = «Velg fritt» (tilbake til originalen).
 */
export async function chooseCodelist(page, dimCode, codelistId) {
  const before = await listSignature(page, dimCode);
  await page.locator(`[data-dimension="${dimCode}"] .codelist-dropdown`).selectOption(codelistId);
  await waitForListChange(page, dimCode, before);

  // URL-oppdateringen er debounced (debouncedURLUpdate), så hashen henger etter
  // DOM-en. Uten denne ventingen ville ?c= lest tomt i ny og ne.
  if (codelistId) await waitForUrlSync(page);

  const dim = await readDimension(page, dimCode);
  return {
    ...dim,
    activeCodelistIds: await page.evaluate(() => ({ ...window.AppState.activeCodelistIds })),
    hash: await page.evaluate(() => window.location.hash),
    dropdownValue: await page.locator(`[data-dimension="${dimCode}"] .codelist-dropdown`).inputValue()
  };
}

/**
 * Venter til URL-en har tatt igjen DOM-en.
 *
 * debouncedURLUpdate() skriver ?v=/?c= 500 ms etter siste endring. Å vente på
 * at «v= finnes» er IKKE nok: parameteren ligger der allerede fra en tidligere
 * skriving, så en hash lest for tidlig beskriver et eldre utvalg. Det ga en
 * deep-link med bare halve utvalget i, og en datahenting som spurte om noe
 * annet enn testen trodde.
 *
 * Predikatet gjenskaper nøyaktig det debouncedURLUpdate ville skrevet nå, med
 * appens egne funksjoner, og sammenligner med hashen som faktisk står der.
 */
export function waitForUrlSync(page) {
  return page.waitForFunction(() => {
    if (!window.AppState?.selectedTable) return false;
    const params = {};
    const selection = getVariableSelection();
    if (selection && Object.keys(selection).length > 0) {
      params.v = URLRouter.encode(selection);
    }
    if (Object.keys(window.AppState.activeCodelistIds).length > 0) {
      params.c = URLRouter.encode(window.AppState.activeCodelistIds);
    }
    const expected = URLRouter.buildHash(
      `variables/${window.AppState.selectedTable.id}`, params);
    return window.location.hash === expected;
  }, undefined, { timeout: TIMEOUT });
}

/** getVariableSelection() slik appen selv ville sendt den til API-et. */
export async function readSelection(page) {
  return page.evaluate(() => getVariableSelection());
}

/**
 * API-byggerens forhåndsvisning.
 *
 * GET-URL-en oppdateres av updateSelectionStatus() uansett om panelet er
 * utvidet, så den kan leses direkte. POST krever utvidelse: radioknappen ligger
 * inne i et <label class="api-pill"> der selve <input> er visuelt skjult, så
 * den må klikkes via labelen — .check() henger på visibility.
 */
export async function readApiPreview(page, { method = 'get' } = {}) {
  if (method === 'post') {
    const content = page.locator('#query-preview-content');
    if (!(await content.isVisible())) {
      await page.click('#query-preview-toggle');
      await content.waitFor({ state: 'visible', timeout: TIMEOUT });
    }
    await page.locator('label.api-pill:has(input[name="api-method"][value="post"])').click();
    await page.waitForSelector('#api-post-body-section', { state: 'visible', timeout: TIMEOUT });
  }

  return page.evaluate(() => {
    const url = document.getElementById('query-preview-url');
    const warning = document.getElementById('api-url-warning');
    const body = document.getElementById('api-post-body-preview');
    return {
      rawUrl: decodeURIComponent(url?.dataset.rawUrl ?? ''),
      postBody: body?.textContent?.trim() || null,
      warningVisible: !!warning && warning.style.display !== 'none',
      warningText: warning?.textContent?.trim() ?? '',
      maxGetUrlLength: window.AppConfig.limits.maxGetUrlLength,
      cellCount: document.getElementById('cell-count-display')?.textContent?.trim() ?? '',
      fetchEnabled: !document.getElementById('fetch-data-btn')?.disabled
    };
  });
}

/** «Hent data» → den rendrede tabellen. */
export async function fetchData(page) {
  await page.click('#fetch-data-btn');
  await page.waitForSelector('#data-container table', { timeout: TIMEOUT });
  return page.evaluate(() => {
    const table = document.querySelector('#data-container table');
    return {
      rowCount: table.querySelectorAll('tr').length,
      headerText: [...table.querySelectorAll('th')].map(th => th.textContent.trim()).join(' | ')
    };
  });
}

/** Antall valueCodes[...]-parametre i en forhåndsvist GET-URL. */
export function countValueCodeParams(rawUrl) {
  return (rawUrl.match(/valueCodes\[/g) || []).length;
}

/** De N første verdikodene i en dimensjons verdiliste, slik den vises nå. */
async function firstCodes(page, dimCode, n) {
  return page.evaluate(([code, count]) =>
    [...document.querySelectorAll(`[data-dimension="${code}"] .value-list-item`)]
      .slice(0, count).map(el => el.dataset.code),
  [dimCode, n]);
}

/**
 * 13472 Region har 14 grupperinger. To av dem brukes bevisst, fordi de treffer
 * hver sin gren i getVariableSelection():
 *
 *   agg_KommFylker — EKTE aggregering: F-31 ← ~40 kommunekoder. extractCodelistCodes
 *     utleder isAggregated=true, så stjernevalg sender kodelistas EGNE koder.
 *   vs_Fylker      — filter: identitets-valueMap, isAggregated=false, så
 *     stjernevalg sender de underliggende originalkodene i stedet.
 *
 * (agg_Fylker2024 har type «Aggregation» men identitets-valueMap og ville
 * derfor tatt filter-grenen — den er verifisert i codelist-extract.test.js.)
 */
export const REGION_AGG_CODELIST = 'agg_KommFylker';
export const REGION_VS_CODELIST = 'vs_Fylker';

/**
 * 08801 — Ctrl+A på begge sider av stjerneterskelen, i samme tabell.
 *
 * Ingen datahenting her: Varekoder × Land × ContentsCode × Tid sprenger
 * 800 000-cellegrensa, og et 403-svar ville blitt en ubrukelig fixture.
 */
export async function runCtrlAFlow(page) {
  const opened = await openVariableSelection(page, '08801');

  // Over terskelen → stjerne, uten å materialisere én node per verdi.
  const starBig = await pressSelectAll(page, 'Varekoder');
  const selectionStar = await readSelection(page);
  const previewStar = await readApiPreview(page);

  // Under terskelen → hver verdi merkes eksplisitt.
  const starSmall = await pressSelectAll(page, 'Land');
  const selectionExplicit = await readSelection(page);
  const previewExplicit = await readApiPreview(page);

  // Tilbake til kjent utgangspunkt før filtertestene.
  await clickSelectNone(page, 'Varekoder');

  // Fokus i tekstfeltet: snarveien skal ikke gjøre noe i det hele tatt.
  const guarded = await pressSelectAll(page, 'Varekoder', { filter: '0101', focus: 'filter' });

  // Bredere filter, og nå med fokus i lista: treffene merkes eksplisitt selv om
  // DIMENSJONEN er over terskelen — et filtrert utvalg er avgrenset og
  // brukervalgt, så '*' ville sendt noe annet enn det brukeren så. Filteret er
  // valgt så treffmengden gir en GET-URL over lengdegrensa, slik at
  // advarselen også blir utløst gjennom ekte UI.
  const filtered = await pressSelectAll(page, 'Varekoder', { filter: '010', focus: 'list' });
  const selectionFiltered = await readSelection(page);
  const previewFiltered = await readApiPreview(page);

  const previewPost = await readApiPreview(page, { method: 'post' });

  return {
    opened,
    starBig,
    starSmall,
    guarded,
    filtered,
    selectionStar,
    selectionExplicit,
    selectionFiltered,
    previewStar,
    previewExplicit,
    previewFiltered,
    previewPost
  };
}

/**
 * 13472 — tre valgfrie dimensjoner og Regions fjorten grupperinger.
 */
export async function runOptionalDimsFlow(page) {
  const opened = await openVariableSelection(page, '13472');

  // Bare de to obligatoriske dimensjonene. De tre valgfrie står urørt og skal
  // da forsvinne helt ut av spørringen, ikke sendes som tomme lister.
  const contents = await firstCodes(page, 'ContentsCode', 1);
  const periods = await firstCodes(page, 'Tid', 2);
  await selectValues(page, 'ContentsCode', contents);
  await selectValues(page, 'Tid', periods);
  const minimal = await readApiPreview(page);
  const selectionMinimal = await readSelection(page);

  // En valgfri dimensjon fylles og tømmes igjen.
  const sektorFilled = await pressSelectAll(page, 'Sektor');
  const selectionWithSektor = await readSelection(page);
  await clickSelectNone(page, 'Sektor');
  const selectionSektorCleared = await readSelection(page);

  // Region er over terskelen → stjerne.
  const regionStar = await pressSelectAll(page, 'Region');
  const selectionRegionStar = await readSelection(page);

  // Ekte aggregering: bytte av kodeliste nullstiller utvalget.
  const aggApplied = await chooseCodelist(page, 'Region', REGION_AGG_CODELIST);
  await clickSelectAll(page, 'Region');
  const selectionAgg = await readSelection(page);
  const previewAgg = await readApiPreview(page);

  // Filterkodeliste: samme stjernevalg, men utvides til originalkodene.
  const vsApplied = await chooseCodelist(page, 'Region', REGION_VS_CODELIST);
  await clickSelectAll(page, 'Region');
  const selectionVs = await readSelection(page);
  const previewVs = await readApiPreview(page);

  // «Velg fritt» tilbake til originaldimensjonen.
  const reset = await chooseCodelist(page, 'Region', '');
  const previewReset = await readApiPreview(page);

  // Gjenoppretting: kodelista ligger i ?c= i URL-en. Dette er den eneste
  // testen som ville merket at de to kopiene av gjenopprettingslogikken
  // (render.js restoreSelections vs codelists.js setupCodelistDropdowns)
  // driver fra hverandre.
  await chooseCodelist(page, 'Region', REGION_AGG_CODELIST);
  await clickSelectAll(page, 'Region');
  await waitForUrlSync(page);
  const deepLink = await page.evaluate(() => window.location.hash);
  const base = page.url().split('#')[0];
  await page.goto(`${base}#home`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-subject]', { timeout: TIMEOUT });
  await page.goto(`${base}${deepLink}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-dimension]', { timeout: TIMEOUT });
  // Vent på TILSTANDEN, ikke på en indikator for den: gjenopprettingen skjer i
  // to trinn (først settes kodelista, så merkes verdiene), så nedtrekket kan ha
  // riktig verdi flere hundre millisekunder før utvalget er tilbake. Ventes det
  // bare på nedtrekket, henter neste steg data med et tomt Region-valg.
  await page.waitForFunction(
    () => {
      const dropdown = document.querySelector('[data-dimension="Region"] .codelist-dropdown');
      if (!dropdown || dropdown.value === '') return false;
      const sel = getVariableSelection();
      return Array.isArray(sel.Region) && sel.Region.length > 0;
    },
    { timeout: TIMEOUT }
  );
  const restored = {
    ...(await readDimension(page, 'Region')),
    dropdownValue: await page.locator('[data-dimension="Region"] .codelist-dropdown').inputValue(),
    activeCodelistIds: await page.evaluate(() => ({ ...window.AppState.activeCodelistIds }))
  };
  const selectionRestored = await readSelection(page);

  const table = await fetchData(page);

  return {
    opened,
    minimal,
    selectionMinimal,
    sektorFilled,
    selectionWithSektor,
    selectionSektorCleared,
    regionStar,
    selectionRegionStar,
    aggApplied,
    selectionAgg,
    previewAgg,
    vsApplied,
    selectionVs,
    previewVs,
    reset,
    previewReset,
    deepLink,
    restored,
    selectionRestored,
    table
  };
}

/**
 * 11189 — ti statistikkvariabler, og to dimensjoner med hver sine
 * vs_-grupperinger som må holdes fra hverandre.
 */
export async function runContentsFlow(page) {
  const opened = await openVariableSelection(page, '11189');

  // Alle ti statistikkvariablene på én gang (10 < terskelen → eksplisitt).
  const contentsAll = await pressSelectAll(page, 'ContentsCode');
  const selectionAllContents = await readSelection(page);

  // To samtidige grupperinger på hver sin dimensjon.
  const investDim = opened.dims.find(d => d.code === 'Investeringsart');
  const naceDim = opened.dims.find(d => d.code === 'NACE');
  const invCodelist = investDim.codelistIds[0];
  const naceCodelist = naceDim.codelistIds[0];

  const invApplied = await chooseCodelist(page, 'Investeringsart', invCodelist);
  const naceApplied = await chooseCodelist(page, 'NACE', naceCodelist);
  const previewBoth = await readApiPreview(page);

  // Tilbake til «Velg fritt» på begge, så datahentingen blir liten og entydig.
  await chooseCodelist(page, 'Investeringsart', '');
  await chooseCodelist(page, 'NACE', '');

  // Tre statistikkvariabler × tre perioder = 9 celler; begge de valgfrie
  // dimensjonene utelates og aggregeres av API-et.
  await clickSelectNone(page, 'ContentsCode');
  const contentsCodes = await firstCodes(page, 'ContentsCode', 3);
  await selectValues(page, 'ContentsCode', contentsCodes);
  const periods = await firstCodes(page, 'Tid', 3);
  await selectValues(page, 'Tid', periods);

  const selectionFetch = await readSelection(page);
  const previewFetch = await readApiPreview(page);
  const table = await fetchData(page);

  const contentsLabels = await page.evaluate((codes) =>
    codes.map(c => tableMetadata.dimension.ContentsCode.category.label[c]), contentsCodes);

  return {
    opened,
    contentsAll,
    selectionAllContents,
    invCodelist,
    naceCodelist,
    invApplied,
    naceApplied,
    previewBoth,
    contentsCodes,
    contentsLabels,
    selectionFetch,
    previewFetch,
    table
  };
}

/**
 * 12850 — fem av sju dimensjoner er valgfrie. Her kan antallet
 * valueCodes-parametre asserteres EKSAKT, fordi hver utelatt dimensjon skal
 * forsvinne helt ut av spørringen.
 */
export async function runManyOptionalFlow(page) {
  const opened = await openVariableSelection(page, '12850');

  const contents = await firstCodes(page, 'ContentsCode', 1);
  const periods = await firstCodes(page, 'Tid', 1);
  await selectValues(page, 'ContentsCode', contents);
  await selectValues(page, 'Tid', periods);
  const minimal = await readApiPreview(page);
  const selectionMinimal = await readSelection(page);

  // Én valgfri dimensjon inn …
  const alderFilled = await pressSelectAll(page, 'Alder');
  const withAlder = await readApiPreview(page);
  const selectionWithAlder = await readSelection(page);

  // … og ut igjen. Den skal forsvinne fra spørringen, ikke stå igjen tom.
  await clickSelectNone(page, 'Alder');
  const withoutAlder = await readApiPreview(page);
  const selectionWithoutAlder = await readSelection(page);

  const table = await fetchData(page);

  return {
    opened,
    minimal,
    selectionMinimal,
    alderFilled,
    withAlder,
    selectionWithAlder,
    withoutAlder,
    selectionWithoutAlder,
    table
  };
}

/** Alle fire byggerflytene, i den delte rekkefølgen. */
export const BUILDER_FLOWS = {
  '08801': runCtrlAFlow,
  '13472': runOptionalDimsFlow,
  '11189': runContentsFlow,
  '12850': runManyOptionalFlow
};

// ============================================================
// Emnehierarkiet — navigasjon og at tabeller havner der de skal
// ============================================================

/**
 * De to emnerutene som blander SSB med en fremmedkilde i samme node.
 *
 * Begge er dybde 3, og SSBs egne stier er dybde 4 — tabellene ligger altså i
 * BARNESEKSJONER (`details.hierarchy-group`), ikke rett på løvnoden.
 * Fremmedkilden legger seg som enda et barn, og sorterer sist fordi sortCode
 * sammenlignes som streng ('912' > '0000900010').
 *
 * ssbTables/foreignTables er id-er vi krever å finne igjen i den navngitte
 * seksjonen. Antall asserteres IKKE her: /tables-fixturen er trimmet, så bare
 * de pinnede SSB-tabellene finnes. Totaler testes mot den ekte, fulle katalogen
 * i tests/unit/hierarchy-real-catalog.test.js.
 */
export const TOPIC_ROUTES = [
  {
    key: 'nb',
    path: ['os', 'os07', 'offogjeld'],
    group: 'okonomi',
    leafLabel: 'Offentlig forvaltnings fordringer og gjeld',
    foreignNode: 'Statsgjeld og statspapirer',
    badge: 'source-badge--nb',
    ssbSections: {
      'Kvartalsvise tall': ['11560', '11559', '05830'],
      'Årlige tall': ['07511', '08753']
    },
    discontinuedSection: 'Avslutta tidsserier',
    discontinuedTable: '04423',
    foreignTables: {
      'nb-GOVT_KEYFIGURES': 'Nøkkeltall for statsgjelden',
      'nb-SEC': 'Statspapirer – kurser og renter'
    }
  },
  {
    key: 'fhi',
    path: ['he', 'he04', 'helsetjko'],
    group: 'helse',
    leafLabel: 'Kommunehelsetenesta',
    foreignNode: 'Kommunalt pasient- og brukerregister',
    badge: 'source-badge--fhi',
    ssbSections: {
      Fastleger: ['07456'],
      'KOSTRA – Økonomi': ['12362']
    },
    discontinuedSection: 'Avslutta tidsserier',
    discontinuedTable: '06358',
    foreignTables: {
      'fhi-kpr-634': 'Helse- og omsorgstjenester: antall brukere per tjeneste'
    }
  }
];

/**
 * SSB-tabellene som må overleve trimTableList for at emnetestene skal ha noe å
 * finne. /tables beholder ellers bare tre tabeller per emne, valgt vilkårlig.
 */
export const TOPIC_KEEP_TABLES = TOPIC_ROUTES.flatMap(r => [
  ...Object.values(r.ssbSections).flat(),
  r.discontinuedTable
]);

/** Deeplenk til en emnerute og vent til tabellområdet er rendret. */
export async function openTopic(page, path) {
  const base = page.url().split('#')[0];
  await page.goto(`${base}#topic/${path.join('/')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#topic-table-area', { timeout: TIMEOUT });
  return readTopicLeaf(page);
}

/**
 * Leser en emneløvnode: brødsmuler, overskrift og hver seksjon med radene sine.
 *
 * Selektorene er de `BrowserState.renderTableListHTML` og `_topicRenderSubtree`
 * faktisk produserer — ingen data-testid er lagt til.
 */
export async function readTopicLeaf(page) {
  return page.evaluate(() => {
    const rowsIn = (root) => [...root.querySelectorAll('tr.table-row')].map(tr => ({
      id: tr.dataset.tableId,
      shownId: tr.querySelector('td')?.textContent.trim(),
      title: tr.querySelector('a.table-link')?.textContent.trim(),
      badge: [...(tr.querySelector('.source-badge')?.classList || [])]
        .find(c => c.startsWith('source-badge--')) || null,
      discontinued: tr.classList.contains('discontinued')
    }));

    const area = document.getElementById('topic-table-area');
    return {
      hash: window.location.hash,
      heading: document.querySelector('.topic-view h1')?.textContent.trim(),
      breadcrumbs: [...document.querySelectorAll('a.breadcrumb-link')].map(a => a.dataset.path),
      // Seksjoner i DOM-rekkefølge, som er sortCode-rekkefølgen.
      sections: [...area.querySelectorAll(':scope > details.hierarchy-group')].map(d => ({
        label: d.querySelector(':scope > summary')?.firstChild?.textContent.trim(),
        count: d.querySelector('.hierarchy-count')?.textContent.trim(),
        rows: rowsIn(d)
      })),
      // Tabeller som ligger rett på løvnoden, utenfor alle seksjoner.
      looseRows: rowsIn(area).length - [...area.querySelectorAll('details.hierarchy-group tr.table-row')].length
    };
  });
}

/** Slå «vis avsluttede» av/på og vent til tabellområdet er bygget om. */
export async function setTopicDiscontinued(page, on) {
  const before = await page.evaluate(() =>
    document.querySelectorAll('#topic-table-area tr.table-row').length);
  await page.locator('#topic-include-discontinued').setChecked(on);
  await page.waitForFunction(
    (n) => document.querySelectorAll('#topic-table-area tr.table-row').length !== n,
    before,
    { timeout: TIMEOUT }
  );
  return readTopicLeaf(page);
}

/**
 * Ekte navigasjon fra forsiden ned til en emnerute — ikke deeplenk.
 *
 * Til forskjell fra runTopicFlow(), som klikker grådig på FØRSTE kort den
 * finner, sikter denne på id: emnelenka på forsiden, så
 * .subtopic-card[data-subtopic-id], så .category-card[data-category-id].
 * Kortene er <div>-er med click-handlere, ikke lenker, så href kan ikke følges.
 */
export async function drillDownToTopic(page, path) {
  const [subject, subtopic, category] = path;
  const base = page.url().split('#')[0];

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-subject]', { timeout: TIMEOUT });

  const visited = [];

  await page.locator(`.front-subject-link[data-subject="${subject}"]`).click();
  await page.waitForSelector(`.subtopic-card[data-subtopic-id="${subtopic}"]`, { timeout: TIMEOUT });
  visited.push(await page.evaluate(() => window.location.hash));

  await page.locator(`.subtopic-card[data-subtopic-id="${subtopic}"]`).click();
  await page.waitForSelector(`.category-card[data-category-id="${category}"]`, { timeout: TIMEOUT });
  visited.push(await page.evaluate(() => window.location.hash));

  await page.locator(`.category-card[data-category-id="${category}"]`).click();
  await page.waitForSelector('#topic-table-area', { timeout: TIMEOUT });
  visited.push(await page.evaluate(() => window.location.hash));

  return { visited, leaf: await readTopicLeaf(page) };
}

/**
 * Full emneflyt for én rute: deeplenk, avsluttet-filter på, og klikkveien dit.
 *
 * Standardtilstanden er avsluttede tabeller SKJULT
 * (AppConfig.ui.showDiscontinuedByDefault === false), så `initial` er uten dem
 * og `withDiscontinued` er etter at haken er satt.
 */
export async function runTopicRouteFlow(page, route) {
  const initial = await openTopic(page, route.path);
  const withDiscontinued = await setTopicDiscontinued(page, true);
  const drilled = await drillDownToTopic(page, route.path);
  return { initial, withDiscontinued, drilled };
}
