/**
 * Celletak per kilde. Kun SSB har en ekte API-grense (maxDataCells fra /config,
 * 403 ved brudd) — Norges Bank og FHI har INGEN cellegrense, bare et tregere
 * svar (målt 2026-08-02, se API-FINDINGS.md). Dekker:
 *   - cellLimitsFor(tableId): riktig bås per kilde, reserve for ukjent kilde.
 *   - estimateFetchCells(): sparsomme kilder (SDMX) skal måles på anslåtte
 *     observasjoner, ikke på det tette kryssproduktet.
 *   - classifyCellCount(): 'block' KAN ikke oppstå for NB/FHI.
 *   - _applyConfig(): SSBs /config skal ikke forurense NB/FHI-grensene.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/variable-select-state.js',
  'js/variable-select-status.js'
]);

/** Kjør fn med api.sourceFor() låst til én kilde. */
function asSource(sourceId, fn) {
  const prev = app.api.sourceFor;
  app.api.sourceFor = () => sourceId;
  try { return fn(); } finally { app.api.sourceFor = prev; }
}

describe('cellLimitsFor — grensene er kildespesifikke', () => {
  it('SSB: hard grense (ekte API-regel, 403 ved brudd)', () => {
    const l = asSource('ssb', () => app.cellLimitsFor('07459'));
    assert.equal(l.maxCells, 800000);
    assert.equal(l.warnCells, 600000);
    assert.equal(l.denseWarnCells, null);
  });

  it('Norges Bank: INGEN hard grense — kun tett-produkt-vakt', () => {
    const l = asSource('nb', () => app.cellLimitsFor('nb-EXR'));
    assert.strictEqual(l.maxCells, null, 'NB har ingen cellegrense');
    assert.equal(l.warnCells, 2000000);
    assert.equal(l.denseWarnCells, 20000000); // speiler MAX_DENSE_CELLS
  });

  it('FHI: INGEN hard grense — treghetsterskler i stedet', () => {
    const l = asSource('fhi', () => app.cellLimitsFor('fhi-msis-733'));
    assert.strictEqual(l.maxCells, null, 'FHI har ingen cellegrense');
    assert.equal(l.warnCells, 1000000);
    assert.equal(l.slowWarnCells, 4000000);
  });

  it('ukjent kilde faller tilbake på toppnivåets reserve', () => {
    const l = asSource('xx', () => app.cellLimitsFor('xx-1'));
    assert.equal(l.maxCells, 800000);
    assert.equal(l.warnCells, 600000);
  });

  it('uten api.sourceFor (instans med kun én kilde) brukes reserven', () => {
    const prev = app.api.sourceFor;
    app.api.sourceFor = undefined;
    try {
      const l = app.cellLimitsFor('07459');
      assert.equal(l.maxCells, 800000);
      assert.equal(l.warnCells, 600000);
    } finally {
      app.api.sourceFor = prev;
    }
  });

  // Object.assign kopierer også undefined: en utelatt nøkkel i bySource ville
  // da nulle reserveverdien i stedet for å arve den. Skriv nullene eksplisitt.
  it('ingen bySource-oppføring har undefined-felter', () => {
    const felt = ['maxCells', 'warnCells', 'slowWarnCells', 'denseWarnCells'];
    for (const [kilde, entry] of Object.entries(app.AppConfig.limits.bySource)) {
      for (const f of felt) {
        assert.notEqual(entry[f], undefined, kilde + '.' + f + ' må være satt (null om ubrukt)');
      }
    }
  });
});

describe('estimateFetchCells — sparsomt vs. tett', () => {
  it('uten serieantall (SSB/FHI) ER det tette produktet uttrekket', () => {
    assert.equal(app.estimateFetchCells(1224960, 290, null), 1224960);
  });

  it('uten perioder faller den tilbake på det tette produktet', () => {
    assert.equal(app.estimateFetchCells(500, 0, 42), 500);
  });

  // GOVT_PRIMARY_MARKET: tett kryssprodukt 5,2 billioner, 11 264 faktiske
  // observasjoner. Å advare på produktet ville gitt støy på hver NB-tabell.
  it('sparsom SDMX-flow: anslaget er astronomisk mindre enn produktet', () => {
    const est = app.estimateFetchCells(5.2e12, 200, 11264);
    assert.equal(est, 2252800);
    assert.ok(est < 5.2e12 / 1e6);
  });
});

describe('classifyCellCount', () => {
  const ssb = { maxCells: 800000, warnCells: 600000, slowWarnCells: null, denseWarnCells: null };
  const nb = { maxCells: null, warnCells: 2000000, slowWarnCells: null, denseWarnCells: 20000000 };
  const fhi = { maxCells: null, warnCells: 1000000, slowWarnCells: 4000000, denseWarnCells: null };

  it('SSB over maxCells sperrer', () => {
    const v = app.classifyCellCount({ denseCells: 900000, estimatedCells: 900000 }, ssb);
    assert.equal(v.level, 'block');
    assert.equal(v.reason, 'apiLimit');
  });

  it('SSB over advarselsterskelen advarer', () => {
    assert.equal(app.classifyCellCount({ denseCells: 700000, estimatedCells: 700000 }, ssb).level, 'warn');
  });

  it('SSB godt under terskelen er ok', () => {
    assert.equal(app.classifyCellCount({ denseCells: 500000, estimatedCells: 500000 }, ssb).level, 'ok');
  });

  // Selve feilrapporten: full EXR er 1 544 388 celler og leveres av Norges Bank
  // på 1,5 s. Den skal verken sperres eller advares mot.
  it('NB full EXR (1 544 388 celler) er helt ok', () => {
    const v = app.classifyCellCount({ denseCells: 1544388, estimatedCells: 1544388 }, nb);
    assert.equal(v.level, 'ok');
  });

  it('NB sparsom flow over MAX_DENSE_CELLS: minnevarsel, ikke treghetsvarsel', () => {
    const v = app.classifyCellCount({ denseCells: 5.2e12, estimatedCells: 11264 }, nb);
    assert.equal(v.level, 'severe');
    assert.equal(v.reason, 'memory');
  });

  it('NB tett innenfor vakten, men mange observasjoner: treghetsvarsel', () => {
    const v = app.classifyCellCount({ denseCells: 15000000, estimatedCells: 3100000 }, nb);
    assert.equal(v.level, 'warn');
    assert.equal(v.reason, 'slow');
  });

  it('FHI 1,2 mill. celler: advarsel (målt ~24 s)', () => {
    assert.equal(app.classifyCellCount({ denseCells: 1200000, estimatedCells: 1200000 }, fhi).level, 'warn');
  });

  it('FHI 5 mill. celler: vil trolig gå i tidsavbrudd', () => {
    const v = app.classifyCellCount({ denseCells: 5000000, estimatedCells: 5000000 }, fhi);
    assert.equal(v.level, 'severe');
    assert.equal(v.reason, 'timeout');
  });

  it('FHI største tabell (nokkel-343, 49 129 080 celler): tidsavbrudd', () => {
    const v = app.classifyCellCount({ denseCells: 49129080, estimatedCells: 49129080 }, fhi);
    assert.equal(v.level, 'severe');
    assert.equal(v.reason, 'timeout');
  });

  // Observert i nettleseren: NB EXR uten fullført utvalg viste «0 celler valgt
  // — stor spørring: uttrekket kan ta tid». Anslaget bygger på serieantallet,
  // som er optimistisk før alle obligatoriske dimensjoner har verdier.
  it('ufullstendig utvalg (0 celler) advarer ikke, uansett anslag', () => {
    for (const limits of [ssb, nb, fhi]) {
      const v = app.classifyCellCount({ denseCells: 0, estimatedCells: 2136633 }, limits);
      assert.equal(v.level, 'ok');
    }
  });

  // Mekanisk håndheving av beslutningen: NB/FHI skal ALDRI kunne sperre.
  it('kilder uten maxCells kan aldri gi block — uansett størrelse', () => {
    for (const limits of [nb, fhi]) {
      for (const n of [1e3, 1e6, 1e9, 1e12, 1e15]) {
        const v = app.classifyCellCount({ denseCells: n, estimatedCells: n }, limits);
        assert.notEqual(v.level, 'block', n + ' celler ga block for en kilde uten grense');
      }
    }
  });
});

// ---- fetchSeriesCount: unfilterableDims teller ikke som filter ----
//
// Modellerer GOVT_PRIMARY_MARKET-formen: ISIN-koder inneholder tegn som ikke
// kan stå i API-nøkkelen, så adapteren henter dimensjonen åpen og filtrerer
// klientside ETTER henting. Et smalt ISIN-utvalg krymper altså ikke det som
// faktisk overføres, og skal derfor ikke krympe størrelsesanslaget heller.

/** Minimal .variable-card med en verdiliste i 'specific'-modus. */
function cardStub(selectedCodes) {
  const container = {
    dataset: { mode: 'specific' },
    querySelectorAll: () => selectedCodes.map(code => ({ dataset: { code } }))
  };
  return { dataset: {}, querySelector: () => container };
}

/** Bind document.querySelector til ett kort per dimensjon. */
function withCards(cards, fn) {
  const prev = app.document.querySelector;
  app.document.querySelector = sel => {
    const m = /data-dimension="([^"]+)"/.exec(sel);
    return (m && cards[m[1]]) || null;
  };
  try { return fn(); } finally { app.document.querySelector = prev; }
}

describe('fetchSeriesCount — klientsidefiltrerte dimensjoner teller ikke', () => {
  const meta = {
    extension: {
      validKeys: {
        dims: ['ISSUE_TYPE', 'ISIN'],
        keys: ['AU.NO1', 'AU.NO2', 'BB.NO1', 'BB.NO2']
      },
      unfilterableDims: ['ISIN']
    }
  };
  const cards = { ISSUE_TYPE: cardStub(['AU']), ISIN: cardStub(['NO1']) };

  it('ser bort fra utvalget i unfilterableDims', () => {
    vm.runInThisContext('tableMetadata = ' + JSON.stringify(meta) + ';');
    // ISSUE_TYPE=AU alene gir 2 serier. Ville ISIN-valget telt med, ble det 1 —
    // et anslag som undervurderer uttrekket, siden NO2 hentes uansett.
    assert.equal(withCards(cards, () => app.fetchSeriesCount()), 2);
  });

  it('filtrerbare dimensjoner teller fortsatt', () => {
    const m2 = { extension: { validKeys: meta.extension.validKeys, unfilterableDims: [] } };
    vm.runInThisContext('tableMetadata = ' + JSON.stringify(m2) + ';');
    assert.equal(withCards(cards, () => app.fetchSeriesCount()), 1);
  });

  it('null uten validKeys (SSB/FHI) — anslaget faller til det tette produktet', () => {
    vm.runInThisContext('tableMetadata = { extension: {} };');
    assert.strictEqual(withCards({}, () => app.fetchSeriesCount()), null);
  });
});

// Muterer delt AppConfig — må stå sist i fila (én loadApp() per prosess).
describe('_applyConfig — SSBs /config forurenser ikke NB/FHI', () => {
  it('skriver kun i SSBs bås', () => {
    app.api._applyConfig({ maxDataCells: 1200000 });

    const by = app.AppConfig.limits.bySource;
    assert.equal(by.ssb.maxCells, 1200000);
    assert.equal(by.ssb.warnCells, 900000); // 75 %

    assert.strictEqual(by.nb.maxCells, null);
    assert.equal(by.nb.warnCells, 2000000);
    assert.equal(by.fhi.slowWarnCells, 4000000);

    // Reserven for kilder uten oppføring skal ikke muteres.
    assert.equal(app.AppConfig.limits.maxCells, 800000);
    assert.equal(app.AppConfig.limits.cellWarningThreshold, 600000);
  });
});
