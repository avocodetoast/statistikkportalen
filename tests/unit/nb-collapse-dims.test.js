/**
 * norges-bank-adapter.js — collapseDims (kjennetegns-kollaps):
 *   - Config-raden kan angi `collapseDims: {anchor, dims}` for dimensjoner som
 *     er funksjonelt avhengige av et anker (GOVT_PRIMARY_MARKET: ISIN →
 *     MATURITY/COUPON/INSTR). Adapteren skal fjerne dem fra metadataobjektet,
 *     berike ankeretikettene, og sortere ankeret på forfall (synkende).
 *   - validKeys skal rebygges fra tupler (ikke '.'-join — COUPON-koder
 *     inneholder selv punktum og forskyver ellers segmentene) uten kollapsede
 *     dims.
 *   - Nøkkelbygging skal fortsatt produsere ETT segment per DSD-dimensjon
 *     (fullId), med tomme segmenter for kollapsede dims.
 *   - getTableData skal levere datasett uten kollapsede dims, med berikede
 *     ankeretiketter.
 *   - Probe-svikt → ingen kollaps (degradér som i dag); flows uten
 *     collapseDims er uendret.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// ---- Fixturer ----

const FLOWS = {
  PRIM: {
    dims: ['FREQ', 'UNIT_MEASURE', 'ISIN', 'MATURITY', 'COUPON', 'INSTR'],
    keys: [
      ['B', 'Y', 'NO1', '2030-01-01', '1.50000000', 'NST 1/2030'],
      ['B', 'Y', 'NO2', '2033-03-13', '3.62500000', 'NST 03/2033'],
      ['B', 'V', 'NO2', '2033-03-13', '3.62500000', 'NST 03/2033'],
      ['B', 'Y', 'NO3', '2026-09-16', '0.00000000', 'NTB 09/2026']
    ],
    // CL_ISIN har vennlige navn for NO1/NO2, men mangler NO3 (→ INSTR-fallback).
    isinNames: { NO1: 'NGB 01/2030', NO2: 'NGB 03/2033' }
  },
  CBC: {
    dims: ['ISIN', 'MATURITY', 'INSTR'],
    keys: [
      ['C1', '2026-01-05', 'F-loan'],
      ['C2', '2026-02-10', 'F-loan'] // delt INSTR (mange-til-én)
    ],
    isinNames: {}
  },
  PLAIN: { // uten collapseDims — regresjon
    dims: ['FREQ', 'ISIN', 'MATURITY'],
    keys: [['B', 'P1', '2027-01-01']],
    isinNames: {}
  },
  NOKEYS: { // serieskeysonly feiler → ingen kollaps
    dims: ['FREQ', 'ISIN', 'MATURITY'],
    keys: [['B', 'K1', '2027-01-01']],
    isinNames: {}
  }
};

function dsdJson(flowId) {
  const spec = FLOWS[flowId];
  return {
    data: {
      dataStructures: [{
        id: 'DSD_' + flowId,
        names: { en: 'English-only DSD name ' + flowId },
        dataStructureComponents: {
          dimensionList: {
            dimensions: spec.dims.map((id, i) => ({
              id,
              position: i + 1,
              localRepresentation: {
                enumeration: 'urn:sdmx:org.sdmx.infomodel.codelist.Codelist=NB:CL_' + id + '(1.0)'
              }
            })),
            timeDimensions: [{ id: 'TIME_PERIOD', position: spec.dims.length + 1 }]
          }
        }
      }],
      codelists: spec.dims.map((id, i) => {
        const seen = [];
        spec.keys.forEach(k => { if (!seen.includes(k[i])) seen.push(k[i]); });
        return {
          id: 'CL_' + id,
          names: { no: 'Kodeliste ' + id },
          codes: seen.map(c => ({
            id: c,
            names: id === 'ISIN' && spec.isinNames[c]
              ? { en: spec.isinNames[c] } : { no: c }
          }))
        };
      })
    }
  };
}

function keysJson(flowId) {
  const spec = FLOWS[flowId];
  const values = spec.dims.map((id, i) => {
    const seen = [];
    spec.keys.forEach(k => { if (!seen.includes(k[i])) seen.push(k[i]); });
    return seen.map(c => ({ id: c, name: c }));
  });
  const series = {};
  spec.keys.forEach(k => {
    series[k.map((c, i) => values[i].findIndex(v => v.id === c)).join(':')] = {};
  });
  return {
    data: {
      structure: {
        dimensions: {
          series: spec.dims.map((id, i) => ({ id, keyPosition: i, name: id, values: values[i] })),
          observation: []
        }
      },
      dataSets: [{ series }]
    }
  };
}

/** Lite probesvar (tids-/katalogprober): første serienøkkel, to perioder. */
function probeJson(flowId) {
  const spec = FLOWS[flowId];
  const key = spec.keys[0];
  const timeVals = ['2025-01-01', '2025-01-02'];
  const observations = {};
  timeVals.forEach((t, i) => { observations[i] = [1 + i]; });
  return {
    data: {
      structure: {
        dimensions: {
          series: spec.dims.map((id, i) => ({
            id, keyPosition: i, name: id, values: [{ id: key[i], name: key[i] }]
          })),
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{ series: { [spec.dims.map(() => 0).join(':')]: { observations } } }]
    },
    meta: { prepared: '2026-01-10T00:00:00Z' }
  };
}

/** Fullt datasvar for PRIM-getTableData: to «diagonale» serier, tre perioder. */
function primDataJson() {
  const timeVals = ['2025-01-01', '2025-01-02', '2025-01-03'];
  return {
    data: {
      structure: {
        dimensions: {
          series: [
            { id: 'FREQ', keyPosition: 0, name: 'Frekvens', values: [{ id: 'B', name: 'B' }] },
            { id: 'UNIT_MEASURE', keyPosition: 1, name: 'Måltall', values: [{ id: 'Y', name: 'Y' }] },
            { id: 'ISIN', keyPosition: 2, name: 'ISIN',
              values: [{ id: 'NO1', name: 'NO1' }, { id: 'NO2', name: 'NO2' }] },
            { id: 'MATURITY', keyPosition: 3, name: 'Forfall',
              values: [{ id: '2030-01-01' }, { id: '2033-03-13' }] },
            { id: 'COUPON', keyPosition: 4, name: 'Kupong',
              values: [{ id: '1.50000000' }, { id: '3.62500000' }] },
            { id: 'INSTR', keyPosition: 5, name: 'Instrument',
              values: [{ id: 'NST 1/2030' }, { id: 'NST 03/2033' }] }
          ],
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{
        series: {
          '0:0:0:0:0:0': { observations: { 0: [10], 1: [11], 2: [12] } },
          '0:0:1:1:1:1': { observations: { 0: [20], 1: [21], 2: [22] } }
        }
      }]
    },
    meta: { prepared: '2026-01-10T00:00:00Z' }
  };
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const requestedUrls = [];

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    requestedUrls.push(u);
    const flowId = Object.keys(FLOWS).find(f =>
      u.includes('/DSD_' + f + '?') || u.includes('/data/' + f + '/'));
    if (!flowId) throw new Error('uventet URL i test: ' + u);
    if (u.includes('/datastructure/NB/DSD_')) return jsonResponse(dsdJson(flowId));
    if (u.includes('detail=serieskeysonly')) {
      if (flowId === 'NOKEYS') return { ok: false, status: 404, json: async () => null };
      return jsonResponse(keysJson(flowId));
    }
    if (u.includes('lastNObservations=60') || u.includes('firstNObservations=1')) {
      return jsonResponse(probeJson(flowId));
    }
    // getTableData: 404-sti for uttrekk med markørkoden NO404.
    if (u.includes('NO404')) return { ok: false, status: 404, json: async () => null };
    return jsonResponse(primDataJson());
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

app.AppConfig.sources.nb.dataflows = [
  { flow: 'PRIM', version: '1.0', tableId: 'nb-PRIM',
    path: ['bf', 'nb-statsgjeld'],
    collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] },
    label: { nb: 'Statspapirer – test', en: 'Government securities – test' } },
  { flow: 'CBC', version: '1.0', tableId: 'nb-CBC',
    path: ['bf', 'nb-likviditet'],
    collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'INSTR'] },
    label: { nb: 'F-auksjoner – test' } },
  { flow: 'PLAIN', version: '1.0', tableId: 'nb-PLAIN',
    path: ['bf', 'nb-renter'], label: { nb: 'Uten kollaps' } },
  { flow: 'NOKEYS', version: '1.0', tableId: 'nb-NOKEYS',
    path: ['bf', 'nb-renter'],
    collapseDims: { anchor: 'ISIN', dims: ['MATURITY'] },
    label: { nb: 'Probe-svikt' } }
];

describe('NBAdapter — collapseDims i metadata', () => {
  it('fjerner kollapsede dims fra id/size/dimension/heading', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'UNIT_MEASURE', 'ISIN', 'TIME_PERIOD']);
    assert.equal(meta.size.length, 4);
    assert.equal(meta.dimension.MATURITY, undefined);
    assert.equal(meta.dimension.COUPON, undefined);
    assert.equal(meta.dimension.INSTR, undefined);
    assert.deepEqual(meta.extension.px.heading, ['FREQ', 'UNIT_MEASURE', 'ISIN']);
  });

  it('registrerer collapsedDims-utvidelsen med fullId og byAnchor', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    const cd = meta.extension.collapsedDims;
    assert.equal(cd.anchor, 'ISIN');
    assert.deepEqual(cd.dims, ['MATURITY', 'COUPON', 'INSTR']);
    assert.deepEqual(cd.fullId,
      ['FREQ', 'UNIT_MEASURE', 'ISIN', 'MATURITY', 'COUPON', 'INSTR', 'TIME_PERIOD']);
    assert.deepEqual(cd.byAnchor.NO2,
      { MATURITY: '2033-03-13', COUPON: '3.62500000', INSTR: 'NST 03/2033' });
  });

  it('beriker ankeretiketter og sorterer på forfall (synkende)', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    const cat = meta.dimension.ISIN.category;
    assert.equal(cat.label.NO2, 'NGB 03/2033 – 3,625 % – forfall 13.03.2033');
    assert.equal(cat.label.NO1, 'NGB 01/2030 – 1,5 % – forfall 01.01.2030');
    // NO3 mangler kodelistenavn → INSTR-fallback.
    assert.equal(cat.label.NO3, 'NTB 09/2026 – 0 % – forfall 16.09.2026');
    // Forfall synkende: 2033, 2030, 2026.
    assert.deepEqual(
      Object.keys(cat.index).sort((a, b) => cat.index[a] - cat.index[b]),
      ['NO2', 'NO1', 'NO3']);
    // UI-en (renderValueList) følger labels innsettingsrekkefølge — den må
    // matche index-sorteringen.
    assert.deepEqual(Object.keys(cat.label), ['NO2', 'NO1', 'NO3']);
  });

  it('rebygger validKeys fra tupler uten kollapsede dims', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    const vk = meta.extension.validKeys;
    assert.deepEqual(vk.dims, ['FREQ', 'UNIT_MEASURE', 'ISIN']);
    assert.deepEqual(vk.keys.slice().sort(),
      ['B.V.NO2', 'B.Y.NO1', 'B.Y.NO2', 'B.Y.NO3']);
    // Ingen segmenter med punktum-koder igjen.
    assert.ok(vk.keys.every(k => k.split('.').length === 3));
  });

  it('fjerner kollapsede dims fra unfilterableDims', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    // COUPON/INSTR var eneste punktum-/skråstrek-dims → utvidelsen skal bort.
    assert.equal(meta.extension.unfilterableDims, undefined);
  });

  it('dedupliserer validKeys for delte kjennetegn (CBC mange-til-én)', async () => {
    const meta = await adapter.getTableMetadata('nb-CBC', false, 'no');
    assert.deepEqual(meta.id, ['ISIN', 'TIME_PERIOD']);
    assert.deepEqual(meta.extension.validKeys.dims, ['ISIN']);
    assert.deepEqual(meta.extension.validKeys.keys.slice().sort(), ['C1', 'C2']);
    // Uten kupong-dim: kun navn + forfall i etiketten.
    assert.equal(meta.dimension.ISIN.category.label.C1, 'F-loan – forfall 05.01.2026');
  });

  it('flow uten collapseDims er uendret (regresjon)', async () => {
    const meta = await adapter.getTableMetadata('nb-PLAIN', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'ISIN', 'MATURITY', 'TIME_PERIOD']);
    assert.equal(meta.extension.collapsedDims, undefined);
  });

  it('serieskeys-svikt → ingen kollaps, ingen feil', async () => {
    const meta = await adapter.getTableMetadata('nb-NOKEYS', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'ISIN', 'MATURITY', 'TIME_PERIOD']);
    assert.equal(meta.extension.collapsedDims, undefined);
  });

  it('tittelen kommer fra configetiketten, ikke det engelske DSD-navnet', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    assert.equal(meta.label, 'Statspapirer – test');
  });
});

describe('NBAdapter — nøkkelbygging og datasti med collapseDims', () => {
  it('bygger ett segment per DSD-dim med tomme kollapsede segmenter', async () => {
    const meta = await adapter.getTableMetadata('nb-PRIM', false, 'no');
    const q = adapter.buildApiQuery('nb-PRIM', {
      FREQ: ['B'], UNIT_MEASURE: ['Y'], ISIN: ['NO1'],
      MATURITY: ['2030-01-01'], // gammel delt URL — skal ignoreres
      TIME_PERIOD: 'top(5)'
    }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/PRIM/B.Y.NO1...?'),
      'forventet 6-segments nøkkel med tomme kjennetegn, fikk: ' + q.url);
    assert.ok(q.url.includes('lastNObservations=5'));
  });

  it('getTableData kollapser datasettet og beriker ankeretiketter', async () => {
    await adapter.getTableMetadata('nb-PRIM', false, 'no'); // legg i cache
    const ds = await adapter.getTableData('nb-PRIM',
      { FREQ: ['B'], UNIT_MEASURE: ['Y'], ISIN: ['NO1', 'NO2'], TIME_PERIOD: '*' }, 'no');
    assert.deepEqual(ds.id, ['FREQ', 'UNIT_MEASURE', 'ISIN', 'TIME_PERIOD']);
    assert.equal(ds.dimension.MATURITY, undefined);
    // Serie 2 (NO2) obs 1 → flat = ISIN-idx 1 * 3 + 1 = 4.
    assert.equal(ds.value[4], 21);
    assert.equal(ds.dimension.ISIN.category.label.NO2,
      'NGB 03/2033 – 3,625 % – forfall 13.03.2033');
  });

  it('ikke-sammenhengende tidsutvalg filtreres fortsatt klientside', async () => {
    const ds = await adapter.getTableData('nb-PRIM',
      { FREQ: ['B'], UNIT_MEASURE: ['Y'], ISIN: ['NO1', 'NO2'],
        TIME_PERIOD: ['2025-01-01', '2025-01-03'] }, 'no');
    assert.deepEqual(ds.size, [1, 1, 2, 2]);
    assert.deepEqual(Object.keys(ds.dimension.TIME_PERIOD.category.index),
      ['2025-01-01', '2025-01-03']);
    // NO1: [10, 12]; NO2: [20, 22].
    assert.deepEqual(ds.value, [10, 12, 20, 22]);
  });

  it('404 → tomt datasett bygget fra kollapset metadata', async () => {
    const ds = await adapter.getTableData('nb-PRIM',
      { FREQ: ['B'], UNIT_MEASURE: ['Y'], ISIN: ['NO404'], TIME_PERIOD: '*' }, 'no');
    assert.deepEqual(ds.id, ['FREQ', 'UNIT_MEASURE', 'ISIN', 'TIME_PERIOD']);
    assert.deepEqual(ds.value, []);
  });
});
