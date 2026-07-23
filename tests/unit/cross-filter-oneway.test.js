/**
 * variable-select — énveis kryssfilter + seksjonert layout (rene hjelpere):
 *   - computeCrossFilterEnabled(vk, constraints, metricSet): måltalls-
 *     dimensjoners begrensninger skal ALDRI anvendes på andre dimensjoner
 *     (nøkkeltall er verdier som hentes ut, ikke filtre) — filterdims
 *     kryssfiltrerer fortsatt hverandre og styrer nøkkeltall-listene.
 *     Uten metricSet: dagens toveis semantikk (SSB/FHI/nb-EXR uendret).
 *   - countCrossFilterMatches bruker fortsatt FULL begrensning (telleren og
 *     Hent-valideringen skal reflektere det faktiske uttrekket).
 *   - sectionedDimensionLayout(meta): partisjonerer dimensjonene i
 *     filtre/nøkkeltall (+ tid sist) og enkeltverdi-dims som skal auto-
 *     skjules; null for tabeller uten validKeys+metric (gate).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/variable-select-state.js',
  'js/variable-select-status.js',
  'js/variable-select-render.js'
]);

// Modellerer førstehåndsmarkedet: auksjonsmål (BC) finnes kun for AU,
// veid snittpris (P_WA) kun for BB; NO2 har kun AU-serier.
function fixtureVk() {
  return {
    dims: ['ISSUE_TYPE', 'UNIT_MEASURE', 'ISIN'],
    keys: ['AU.P.NO1', 'AU.BC.NO1', 'BB.P_WA.NO1', 'AU.P.NO2']
  };
}

describe('computeCrossFilterEnabled — énveis for måltallsdimensjoner', () => {
  it('legacy (uten metricSet): toveis som i dag — måltall begrenser filtre', () => {
    const en = app.computeCrossFilterEnabled(fixtureVk(),
      { ISSUE_TYPE: null, UNIT_MEASURE: new Set(['P']), ISIN: null });
    assert.deepEqual([...en.ISSUE_TYPE].sort(), ['AU']);
  });

  it('med metricSet: måltallsvalg begrenser IKKE filtre', () => {
    const en = app.computeCrossFilterEnabled(fixtureVk(),
      { ISSUE_TYPE: null, UNIT_MEASURE: new Set(['P']), ISIN: null },
      new Set(['UNIT_MEASURE']));
    assert.deepEqual([...en.ISSUE_TYPE].sort(), ['AU', 'BB']);
    assert.deepEqual([...en.ISIN].sort(), ['NO1', 'NO2']);
  });

  it('filtre begrenser fortsatt måltall-lista', () => {
    const en = app.computeCrossFilterEnabled(fixtureVk(),
      { ISSUE_TYPE: new Set(['BB']), UNIT_MEASURE: null, ISIN: null },
      new Set(['UNIT_MEASURE']));
    assert.deepEqual([...en.UNIT_MEASURE].sort(), ['P_WA']);
  });

  it('filter↔filter er fortsatt toveis', () => {
    const en = app.computeCrossFilterEnabled(fixtureVk(),
      { ISSUE_TYPE: new Set(['BB']), UNIT_MEASURE: null, ISIN: null },
      new Set(['UNIT_MEASURE']));
    assert.deepEqual([...en.ISIN].sort(), ['NO1']);

    const en2 = app.computeCrossFilterEnabled(fixtureVk(),
      { ISSUE_TYPE: null, UNIT_MEASURE: null, ISIN: new Set(['NO2']) },
      new Set(['UNIT_MEASURE']));
    assert.deepEqual([...en2.ISSUE_TYPE].sort(), ['AU']);
  });

  it('flere måltallsdimensjoner ignoreres alle som begrensere', () => {
    const vk = { dims: ['F', 'M1', 'M2'], keys: ['a.x.q', 'b.y.r'] };
    const en = app.computeCrossFilterEnabled(vk,
      { F: null, M1: new Set(['x']), M2: new Set(['r']) },
      new Set(['M1', 'M2']));
    assert.deepEqual([...en.F].sort(), ['a', 'b']);
    // Måltall begrenses kun av filteret F (ingen F-begrensning her).
    assert.deepEqual([...en.M1].sort(), ['x', 'y']);
    assert.deepEqual([...en.M2].sort(), ['q', 'r']);
  });

  it('countCrossFilterMatches bruker full begrensning (uendret)', () => {
    const n = app.countCrossFilterMatches(fixtureVk(),
      { ISSUE_TYPE: new Set(['BB']), UNIT_MEASURE: new Set(['P']), ISIN: null });
    assert.equal(n, 0);
    const n2 = app.countCrossFilterMatches(fixtureVk(),
      { ISSUE_TYPE: new Set(['AU']), UNIT_MEASURE: new Set(['P']), ISIN: null });
    assert.equal(n2, 2);
  });
});

describe('sectionedDimensionLayout — gate og partisjonering', () => {
  function nbMeta() {
    const dim = codes => ({
      category: { index: Object.fromEntries(codes.map((c, i) => [c, i])), label: {} }
    });
    return {
      id: ['FREQ', 'UNIT_MEASURE', 'ISIN', 'ISSUE_TYPE', 'TIME_PERIOD'],
      role: { time: ['TIME_PERIOD'], metric: ['UNIT_MEASURE'] },
      dimension: {
        FREQ: dim(['B']),
        UNIT_MEASURE: dim(['P', 'Y']),
        ISIN: dim(['NO1', 'NO2']),
        ISSUE_TYPE: dim(['AU', 'BB']),
        TIME_PERIOD: dim(['2025-01-01'])
      },
      extension: {
        validKeys: { dims: ['FREQ', 'UNIT_MEASURE', 'ISIN', 'ISSUE_TYPE'], keys: ['B.P.NO1.AU'] },
        px: { heading: ['FREQ', 'UNIT_MEASURE', 'ISIN', 'ISSUE_TYPE'], stub: ['TIME_PERIOD'] }
      }
    };
  }

  it('null uten validKeys eller uten metric-rolle (SSB/FHI/nb-EXR)', () => {
    const m1 = nbMeta();
    delete m1.extension.validKeys;
    assert.equal(app.sectionedDimensionLayout(m1), null);

    const m2 = nbMeta();
    m2.role.metric = [];
    assert.equal(app.sectionedDimensionLayout(m2), null);

    assert.equal(app.sectionedDimensionLayout(null), null);
  });

  it('partisjonerer i filtre / måltall+tid, i visningsrekkefølge', () => {
    const layout = app.sectionedDimensionLayout(nbMeta());
    assert.deepEqual(layout.filters, ['FREQ', 'ISIN', 'ISSUE_TYPE']);
    assert.deepEqual(layout.measures, ['UNIT_MEASURE', 'TIME_PERIOD']);
  });

  it('enkeltverdi-dims (ikke tid) merkes for auto-skjuling', () => {
    const layout = app.sectionedDimensionLayout(nbMeta());
    assert.deepEqual(layout.autoHidden, ['FREQ']);
    // Tidsdimensjonen skal aldri auto-skjules selv med én verdi.
    assert.ok(!layout.autoHidden.includes('TIME_PERIOD'));
  });
});

/**
 * Kuraterte NB-tabeller (config-radens `slice`) har ingen måltallsdimensjon, så
 * sectionedDimensionLayout gir null for dem. Enkeltverdi-dims (FREQ etter
 * snittet) flagges i stedet av adapteren via extension.autoHiddenDims, og
 * rendres som en «Automatisk valgt»-linje over det første kortet.
 */
describe('adapterAutoHiddenDims / autoSelectedInfoHtml', () => {
  const dim = (codes, label) => ({
    label,
    category: {
      index: Object.fromEntries(codes.map((c, i) => [c, i])),
      label: Object.fromEntries(codes.map(c => [c, c === 'Q' ? 'Kvartal' : c]))
    }
  });

  const slicedMeta = () => ({
    id: ['FREQ', 'REGNET_SECTOR', 'HORIZON', 'TIME_PERIOD'],
    role: { time: ['TIME_PERIOD'] },
    dimension: {
      FREQ: dim(['Q'], 'Frekvens'),
      REGNET_SECTOR: dim(['AGG', 'IND_TOT'], 'Næring'),
      HORIZON: dim(['CURRQ', 'N1Q'], 'Tidshorisont'),
      TIME_PERIOD: dim(['2025-Q1'], 'Tidsperiode')
    },
    extension: { autoHiddenDims: ['FREQ'] }
  });

  it('leser autoHiddenDims fra metadata', () => {
    assert.deepEqual(app.adapterAutoHiddenDims(slicedMeta()), ['FREQ']);
  });

  it('tom liste uten flagget (SSB/FHI/øvrige NB-tabeller uendret)', () => {
    const m = slicedMeta();
    delete m.extension.autoHiddenDims;
    assert.deepEqual(app.adapterAutoHiddenDims(m), []);
    assert.deepEqual(app.adapterAutoHiddenDims(null), []);
  });

  it('skjuler aldri tidsdimensjonen, og hopper over ukjente dims', () => {
    const m = slicedMeta();
    m.extension.autoHiddenDims = ['FREQ', 'TIME_PERIOD', 'FINNES_IKKE'];
    assert.deepEqual(app.adapterAutoHiddenDims(m), ['FREQ']);
  });

  it('bygger infolinjen med dimensjonsetikett = verdietikett', () => {
    const html = app.autoSelectedInfoHtml(slicedMeta(), ['FREQ']);
    assert.match(html, /class="auto-selected-info"/);
    assert.match(html, /Frekvens = Kvartal/);
  });

  it('gir tom streng uten skjulte dims (ingen tom infoboks)', () => {
    assert.equal(app.autoSelectedInfoHtml(slicedMeta(), []), '');
  });
});
