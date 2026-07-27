/**
 * E2E — variabelvalg og API-bygger, i ekte Chrome mot innspilte fixtures.
 *
 * Røyktesten (smoke.e2e.mjs) dekker at appen laster og at hovedflytene henger
 * sammen, med én liten tabell per kilde. Den sier ingenting om mekanikken i
 * variabelvalget, som er der mesteparten av logikken ligger og der fem av
 * filene står som `untracked` i dekningsporten. Denne fila dekker den
 * mekanikken, gjennom fire SSB-tabeller valgt for hver sin egenskap:
 *
 *   08801 — Varekoder (13 429 verdier) og Land (262) i SAMME tabell, altså
 *           begge sider av Ctrl+A-terskelen på 500.
 *   13472 — tre valgfrie dimensjoner + Region med fjorten grupperinger.
 *   11189 — ti statistikkvariabler + to dimensjoner med hver sin gruppering.
 *   12850 — sju dimensjoner der fem er valgfrie, så antallet parametre i
 *           spørringen kan asserteres eksakt.
 *
 * ÉN DRIVING PER TABELL: hver flyt kjøres én gang i before(), og testene
 * asserterer på det den returnerte. Det holder kjøretiden nede (fire
 * tabellastinger i stedet for tjue) og gjør at record-fixtures.mjs kan kjøre
 * nøyaktig de samme funksjonene, slik at fixturene ikke kan komme ut av synk
 * med det testene faktisk gjør.
 *
 * MERK OM TRIMMEDE FIXTURES: store dimensjoner kappes til MAX_DIM_VALUES (700)
 * under innspilling, se stub-routes.mjs. Derfor asserteres FORHOLDET til
 * terskelen — «over» og «under» — aldri det eksakte antallet. Testen leser
 * begge tall fra appen selv, så verken en hevet terskel eller en senket
 * trimgrense kan få stjernestien til å slutte å bli dekket uten å bli rød.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { launchApp, waitForFrontPage, e2eAvailable, MODE_HTTP } from './helpers/app-browser.mjs';
import {
  runCtrlAFlow, runOptionalDimsFlow, runContentsFlow, runManyOptionalFlow,
  countValueCodeParams, BUILDER_TABLES,
  REGION_AGG_CODELIST, REGION_VS_CODELIST,
  DEFAULT_TABLE
} from './helpers/flows.mjs';

const availability = e2eAvailable();
const NETWORK = process.env.E2E_LIVE ? 'live' : 'replay';
const skip = availability.ok ? false : availability.reason;

/** Asserter at ingenting har gått galt i nettleseren så langt. */
function assertClean(app, step) {
  const problems = app.problems();
  assert.equal(problems, null, `${step} ga feil i nettleseren:\n${problems}`);
}

let app;

before(async () => {
  if (!availability.ok) return;
  app = await launchApp({
    mode: MODE_HTTP,
    network: NETWORK,
    keepTables: [DEFAULT_TABLE, ...BUILDER_TABLES],
    shotPrefix: 'varvalg'
  });
  await waitForFrontPage(app.page);
});

after(async () => {
  if (app) await app.close();
});

// ============================================================
describe('08801 — Ctrl+A på begge sider av stjerneterskelen', { skip }, () => {
  let r;

  before(async () => { if (availability.ok) r = await runCtrlAFlow(app.page); });

  it('tabellen rendrer alle fem dimensjonene', () => {
    assert.deepEqual(
      r.opened.dims.map(d => d.code),
      ['ContentsCode', 'Tid', 'Varekoder', 'ImpEks', 'Land'],
      'dimensjonsrekkefølgen følger extension.px heading+stub'
    );
  });

  it('Varekoder ligger over terskelen og Land under — i samme tabell', () => {
    const varekoder = r.opened.dims.find(d => d.code === 'Varekoder');
    const land = r.opened.dims.find(d => d.code === 'Land');
    const T = r.opened.starThreshold;

    assert.ok(varekoder.valueCount > T, `Varekoder hadde ${varekoder.valueCount}, terskel ${T}`);
    assert.ok(land.valueCount <= T, `Land hadde ${land.valueCount}, terskel ${T}`);
  });

  it('Ctrl+A over terskelen bytter til stjerne uten å merke én eneste verdi', () => {
    assert.equal(r.starBig.mode, 'star');
    assert.equal(r.starBig.selectedCount, 0, 'stjernevalget skal være O(1), ikke N noder');
    assert.equal(r.starBig.noteVisible, true, 'brukeren skal få vite hvorfor');
    assert.equal(r.selectionStar.Varekoder, '*');
  });

  it('Ctrl+A under terskelen merker hver verdi eksplisitt', () => {
    const land = r.opened.dims.find(d => d.code === 'Land');
    assert.equal(r.starSmall.mode, 'specific');
    assert.equal(r.starSmall.selectedCount, land.valueCount);
    assert.ok(Array.isArray(r.selectionExplicit.Land));
    assert.equal(r.selectionExplicit.Land.length, land.valueCount);
  });

  it('Ctrl+A gjør ingenting når fokus står i tekstfeltet', () => {
    // Uten INPUT-vakten ville nettleserens egen «merk all tekst» blitt kapret.
    assert.equal(r.guarded.mode, 'specific');
    assert.equal(r.guarded.selectedCount, 0);
  });

  it('Ctrl+A med aktivt filter holder seg eksplisitt, uansett dimensjonsstørrelse', () => {
    // Et filtrert utvalg er avgrenset og brukervalgt — da er stjerne feil svar,
    // for '*' ville sendt hele dimensjonen i stedet for det brukeren så.
    const varekoder = r.opened.dims.find(d => d.code === 'Varekoder');
    assert.equal(r.filtered.mode, 'specific');
    assert.ok(r.filtered.selectedCount > 0, 'filteret traff ingenting');
    assert.equal(r.filtered.selectedCount, r.filtered.visibleCount);
    assert.ok(r.filtered.selectedCount < varekoder.valueCount,
      'filteret må avgrense, ellers tester dette ingenting');
    assert.equal(r.selectionFiltered.Varekoder.length, r.filtered.selectedCount);
  });

  it('stjernevalget blir til * i GET-URL-en', () => {
    assert.match(r.previewStar.rawUrl, /valueCodes\[Varekoder\]=\*/);
    assert.equal(r.previewStar.rawUrl.includes('codelist['), false);
  });

  it('lengdeadvarselen følger URL-ens faktiske lengde', () => {
    // Land eksplisitt (262 korte koder) gir en kort URL; det filtrerte
    // Varekoder-utvalget (lange varenumre) gir en for lang én. Begge sider av
    // grensa skal stemme med om advarselen vises.
    for (const [navn, p] of [['Land', r.previewExplicit], ['filtrert Varekoder', r.previewFiltered]]) {
      assert.equal(p.warningVisible, p.rawUrl.length > p.maxGetUrlLength,
        `${navn}: URL ${p.rawUrl.length} tegn, grense ${p.maxGetUrlLength}, advarsel ${p.warningVisible}`);
    }
    assert.ok(r.previewExplicit.rawUrl.length <= r.previewExplicit.maxGetUrlLength);
    assert.ok(r.previewFiltered.rawUrl.length > r.previewFiltered.maxGetUrlLength,
      `filtrert URL ble bare ${r.previewFiltered.rawUrl.length} tegn — ` +
      'velg et bredere filter i runCtrlAFlow, ellers dekkes ikke advarselen');
  });

  it('POST-kroppen pakker stjernen i et array', () => {
    const body = JSON.parse(r.previewPost.postBody);
    const varekoder = body.selection.find(e => e.variableCode === 'Varekoder');
    // Utvalget er nå det filtrerte, ikke stjernen — men Land står fortsatt
    // eksplisitt, og POST-URL-en skal uansett aldri bære valueCodes.
    assert.ok(Array.isArray(varekoder.valueCodes));
    assert.equal(r.previewPost.rawUrl.includes('valueCodes'), false);

    const land = body.selection.find(e => e.variableCode === 'Land');
    assert.equal('codelist' in land, false, 'ingen kodeliste er aktiv');
    assert.equal('outputValues' in land, false);
  });

  it('ingen feil i nettleseren', () => assertClean(app, '08801-flyten'));
});

// ============================================================
describe('13472 — valgfrie dimensjoner og grupperinger', { skip }, () => {
  let r;

  before(async () => { if (availability.ok) r = await runOptionalDimsFlow(app.page); });

  it('tre dimensjoner er valgfrie og to obligatoriske', () => {
    const optional = r.opened.dims.filter(d => d.elimination).map(d => d.code);
    const required = r.opened.dims.filter(d => !d.elimination).map(d => d.code);
    assert.deepEqual(optional.sort(), ['NACE2007', 'Region', 'Sektor']);
    assert.deepEqual(required.sort(), ['ContentsCode', 'Tid']);
  });

  it('Region tilbyr både vs_- og agg_-grupperinger, med vs_ først', () => {
    const region = r.opened.dims.find(d => d.code === 'Region');
    assert.ok(region.codelistIds.length >= 10, `bare ${region.codelistIds.length} grupperinger`);
    assert.ok(region.codelistIds[0].startsWith('vs_'), `først kom ${region.codelistIds[0]}`);
    assert.ok(region.codelistIds.at(-1).startsWith('agg_'), `sist kom ${region.codelistIds.at(-1)}`);
    assert.ok(region.codelistIds.includes(REGION_AGG_CODELIST));
    assert.ok(region.codelistIds.includes(REGION_VS_CODELIST));
  });

  it('urørte valgfrie dimensjoner utelates HELT fra spørringen', () => {
    // Ikke «sendes som tom liste» — utelatelse er det som får API-et til å
    // aggregere over dimensjonen.
    for (const dim of ['Region', 'NACE2007', 'Sektor']) {
      assert.equal(dim in r.selectionMinimal, false, `${dim} lå i utvalget`);
      assert.equal(r.minimal.rawUrl.includes(`valueCodes[${dim}]`), false, `${dim} lå i URL-en`);
    }
    assert.equal(countValueCodeParams(r.minimal.rawUrl), 2);
    assert.equal(r.minimal.fetchEnabled, true, '«Hent data» skal være aktiv uten de valgfrie');
  });

  it('en valgfri dimensjon kan fylles og tømmes igjen', () => {
    assert.equal(r.selectionWithSektor.Sektor.length, r.sektorFilled.selectedCount);
    assert.equal('Sektor' in r.selectionSektorCleared, false,
      'tømt valgfri dimensjon må forsvinne igjen, ikke bli stående tom');
  });

  it('Region er over terskelen og gir stjerne', () => {
    assert.equal(r.regionStar.mode, 'star');
    assert.equal(r.selectionRegionStar.Region, '*');
  });

  it('bytte av gruppering nullstiller utvalget', () => {
    assert.equal(r.aggApplied.mode, 'specific');
    assert.equal(r.aggApplied.selectedCount, 0);
    assert.equal(r.aggApplied.dropdownValue, REGION_AGG_CODELIST);
    assert.equal(r.aggApplied.activeCodelistIds.Region, REGION_AGG_CODELIST);
    assert.match(r.aggApplied.hash, /[?&]c=/);
  });

  it('en gruppering kan ikke gjøre en valgfri dimensjon obligatorisk', () => {
    // Kodelister får lov til å gjøre en obligatorisk dimensjon valgfri, aldri
    // motsatt (variable-select-codelists.js:122-125).
    assert.equal(r.aggApplied.elimination, true);
    assert.equal(r.vsApplied.elimination, true);
  });

  it('ekte aggregering + Velg alle sender kodelistas EGNE koder, ikke *', () => {
    assert.ok(Array.isArray(r.selectionAgg.Region), `fikk ${JSON.stringify(r.selectionAgg.Region)}`);
    assert.equal(r.selectionAgg.Region.length, r.aggApplied.itemCount);
    assert.match(r.previewAgg.rawUrl, new RegExp(`codelist\\[Region\\]=${REGION_AGG_CODELIST}`));
    assert.match(r.previewAgg.rawUrl, /outputValues\[Region\]=aggregated/);
  });

  it('filtergruppering utvider til originalkodene og får IKKE outputValues', () => {
    assert.ok(Array.isArray(r.selectionVs.Region));
    assert.match(r.previewVs.rawUrl, new RegExp(`codelist\\[Region\\]=${REGION_VS_CODELIST}`));
    assert.equal(r.previewVs.rawUrl.includes('outputValues['), false,
      'vs_-kodelister er filtre, ikke summeringer');
  });

  it('«Velg fritt» fjerner grupperingen helt', () => {
    const region = r.opened.dims.find(d => d.code === 'Region');
    assert.equal(r.reset.dropdownValue, '');
    assert.equal(r.reset.itemCount, region.itemCount, 'originallista skal være tilbake');
    assert.equal('Region' in r.reset.activeCodelistIds, false);
    assert.equal(r.previewReset.rawUrl.includes('codelist[Region]'), false);
  });

  it('grupperingen overlever navigasjon bort og tilbake via ?c= i URL-en', () => {
    // Gjenopprettingslogikken finnes i to nesten like kopier (render.js
    // restoreSelections og codelists.js setupCodelistDropdowns). Dette er den
    // eneste testen som ville merket at de driver fra hverandre.
    assert.equal(r.restored.dropdownValue, REGION_AGG_CODELIST);
    assert.equal(r.restored.activeCodelistIds.Region, REGION_AGG_CODELIST);
    assert.equal(r.restored.itemCount, r.aggApplied.itemCount);
    assert.equal(r.restored.elimination, true);
    assert.ok(Array.isArray(r.selectionRestored.Region));
  });

  it('henter data med aggregert gruppering aktiv', () => {
    assert.ok(r.table.rowCount > 1, `tabellen hadde ${r.table.rowCount} rader`);
  });

  it('ingen feil i nettleseren', () => assertClean(app, '13472-flyten'));
});

// ============================================================
describe('11189 — mange statistikkvariabler og to grupperinger', { skip }, () => {
  let r;

  before(async () => { if (availability.ok) r = await runContentsFlow(app.page); });

  it('ContentsCode lister ti statistikkvariabler og er obligatorisk', () => {
    const cc = r.opened.dims.find(d => d.code === 'ContentsCode');
    assert.equal(cc.valueCount, 10);
    assert.equal(cc.itemCount, 10);
    assert.equal(cc.elimination, false);
  });

  it('alle ti kan velges på én gang, eksplisitt (10 er under terskelen)', () => {
    assert.equal(r.contentsAll.mode, 'specific');
    assert.equal(r.contentsAll.selectedCount, 10);
    assert.equal(r.selectionAllContents.ContentsCode.length, 10);
  });

  it('to dimensjoner har hver sine grupperinger', () => {
    const inv = r.opened.dims.find(d => d.code === 'Investeringsart');
    const nace = r.opened.dims.find(d => d.code === 'NACE');
    assert.ok(inv.codelistIds.length >= 2, `Investeringsart hadde ${inv.codelistIds.length}`);
    assert.ok(nace.codelistIds.length >= 3, `NACE hadde ${nace.codelistIds.length}`);
    assert.notEqual(r.invCodelist, r.naceCodelist);
  });

  it('to samtidige grupperinger holdes fra hverandre', () => {
    assert.equal(r.naceApplied.activeCodelistIds.Investeringsart, r.invCodelist);
    assert.equal(r.naceApplied.activeCodelistIds.NACE, r.naceCodelist);
    assert.match(r.previewBoth.rawUrl, new RegExp(`codelist\\[Investeringsart\\]=${r.invCodelist}`));
    assert.match(r.previewBoth.rawUrl, new RegExp(`codelist\\[NACE\\]=${r.naceCodelist}`));
  });

  it('vs_-grupperinger gir ingen outputValues', () => {
    assert.ok(r.invCodelist.startsWith('vs_'), `fikk ${r.invCodelist}`);
    assert.ok(r.naceCodelist.startsWith('vs_'), `fikk ${r.naceCodelist}`);
    assert.equal(r.previewBoth.rawUrl.includes('outputValues['), false);
  });

  it('henter data for tre statistikkvariabler, med begge valgfrie utelatt', () => {
    assert.deepEqual(r.selectionFetch.ContentsCode, r.contentsCodes);
    assert.equal('Investeringsart' in r.selectionFetch, false);
    assert.equal('NACE' in r.selectionFetch, false);
    assert.equal(countValueCodeParams(r.previewFetch.rawUrl), 2);
    assert.ok(r.table.rowCount > 1);
  });

  it('hver valgt statistikkvariabel får sin egen kolonne', () => {
    for (const label of r.contentsLabels) {
      assert.ok(r.table.headerText.includes(label),
        `«${label}» manglet i tabellhodet: ${r.table.headerText}`);
    }
  });

  it('ingen feil i nettleseren', () => assertClean(app, '11189-flyten'));
});

// ============================================================
describe('12850 — fem av sju dimensjoner er valgfrie', { skip }, () => {
  let r;

  before(async () => { if (availability.ok) r = await runManyOptionalFlow(app.page); });

  it('sju dimensjoner, fem av dem valgfrie', () => {
    assert.equal(r.opened.dims.length, 7);
    assert.deepEqual(
      r.opened.dims.filter(d => d.elimination).map(d => d.code).sort(),
      ['Alder', 'Fagfelt', 'NACE2007', 'Region', 'UtdNivaa']
    );
  });

  it('bare de to obligatoriske gir nøyaktig to parametre og én celle', () => {
    assert.equal(countValueCodeParams(r.minimal.rawUrl), 2);
    assert.equal(Object.keys(r.selectionMinimal).length, 2);
    assert.match(r.minimal.cellCount, /\b1\b/, `celletelleren viste «${r.minimal.cellCount}»`);
  });

  it('en valgfri dimensjon inn gir en parameter til', () => {
    assert.equal(countValueCodeParams(r.withAlder.rawUrl), 3);
    assert.equal(r.selectionWithAlder.Alder.length, r.alderFilled.selectedCount);
  });

  it('og ut igjen fjerner den — den blir ikke stående som tom liste', () => {
    assert.equal(countValueCodeParams(r.withoutAlder.rawUrl), 2);
    assert.equal('Alder' in r.selectionWithoutAlder, false);
    assert.match(r.withoutAlder.cellCount, /\b1\b/);
  });

  it('henter data med fem dimensjoner aggregert bort', () => {
    assert.ok(r.table.rowCount >= 1, `tabellen hadde ${r.table.rowCount} rader`);
  });

  it('ingen feil i nettleseren', () => assertClean(app, '12850-flyten'));
});
