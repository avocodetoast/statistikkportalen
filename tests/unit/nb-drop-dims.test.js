/**
 * norges-bank-adapter.js — dropDims + intervalPicker uten FREQ:
 *
 *   - `dropDims: [dimId, …]` på en config-rad fjerner dimensjonen HELT fra
 *     metadataobjektet (velger + resultattabell). Nøkkelsegmentet står tomt, så
 *     API-et returnerer alle verdier. Brukt for FAUCTION.AUCTION_ID, som bare er
 *     duplikat-identitet: budfristen (TIME_PERIOD) identifiserer auksjonen alene.
 *   - validKeys må rebygges uten den droppede dimen (ellers kryssfiltrerer UI-en
 *     mot segmenter som ikke finnes lenger), og fullDimId må beholde DSD-
 *     rekkefølgen slik at nøkkelen får ett segment per DSD-dimensjon.
 *   - getTableData skal levere datasett uten dimen, med verdiene i riktige celler.
 *   - `intervalPicker: {granularity}` gir tidsdimensjonen fra–til-velgeren også i
 *     flows UTEN FREQ-dimensjon (der frekvenskartet ellers utleder den).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// ---- Fixturer ----
//
// AUC etterligner FAUCTION: ingen FREQ-dimensjon, og auksjonsid-en varierer
// uten å bære informasjon. PLAIN er regresjonskontrollen (ingen dropDims).

const FLOWS = {
  AUC: {
    dims: ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'AUCTION_ID'],
    keys: [
      ['FDFLIR', 'ANN', '10220'],
      ['FDFLIR', 'V_B', '10220'],
      ['FLFXIR', 'ANN', '10221'],
      ['FLFXIR', 'V_B', '10221'],
      ['FDFLIR', 'ANN', '10222']   // samme kombinasjon som første → dedupliseres
    ]
  },
  PLAIN: {
    dims: ['INSTRUMENT_TYPE', 'AUCTION_ID'],
    keys: [['FDFLIR', '10220']]
  }
};

function dsdJson(flowId) {
  const spec = FLOWS[flowId];
  return {
    data: {
      dataStructures: [{
        id: 'DSD_' + flowId,
        names: { no: 'DSD ' + flowId },
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
          codes: seen.map(c => ({ id: c, names: { no: c } }))
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

/** Tids-/katalogprobe: første serienøkkel, to tidsstempler (budfrister). */
function probeJson(flowId) {
  const spec = FLOWS[flowId];
  const key = spec.keys[0];
  const timeVals = ['2025-01-02T10:16:24', '2025-01-03T15:50'];
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
            id: 'TIME_PERIOD', name: 'Budfrist',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{ series: { [spec.dims.map(() => 0).join(':')]: { observations } } }]
    },
    meta: { prepared: '2026-01-10T00:00:00Z' }
  };
}

/**
 * Datasvar for AUC: to auksjoner (ulik AUCTION_ID) på hver sin budfrist.
 * Etter dropDims skal cellene fordeles på INSTRUMENT_TYPE × UNIT_MEASURE × tid.
 */
function aucDataJson() {
  const timeVals = ['2025-01-02T10:16:24', '2025-01-03T15:50'];
  return {
    data: {
      structure: {
        dimensions: {
          series: [
            { id: 'INSTRUMENT_TYPE', keyPosition: 0, name: 'Instrumenttype',
              values: [{ id: 'FDFLIR', name: 'F-innskudd' }, { id: 'FLFXIR', name: 'F-lån' }] },
            { id: 'UNIT_MEASURE', keyPosition: 1, name: 'Måleenhet',
              values: [{ id: 'ANN', name: 'Annonsering' }, { id: 'V_B', name: 'Budvolum' }] },
            { id: 'AUCTION_ID', keyPosition: 2, name: 'Auksjonsid',
              values: [{ id: '10220', name: '10220' }, { id: '10221', name: '10221' }] }
          ],
          observation: [{
            id: 'TIME_PERIOD', name: 'Budfrist',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{
        series: {
          // FDFLIR/V_B, auksjon 10220 → budfrist 0
          '0:1:0': { observations: { 0: [100] } },
          // FLFXIR/V_B, auksjon 10221 → budfrist 1
          '1:1:1': { observations: { 1: [200] } }
        }
      }]
    },
    meta: { prepared: '2026-01-10T00:00:00Z' }
  };
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    const flowId = Object.keys(FLOWS).find(f =>
      u.includes('/DSD_' + f + '?') || u.includes('/data/' + f + '/'));
    if (!flowId) throw new Error('uventet URL i test: ' + u);
    if (u.includes('/datastructure/NB/DSD_')) return jsonResponse(dsdJson(flowId));
    if (u.includes('detail=serieskeysonly')) return jsonResponse(keysJson(flowId));
    if (u.includes('lastNObservations=60') || u.includes('firstNObservations=1')) {
      return jsonResponse(probeJson(flowId));
    }
    return jsonResponse(aucDataJson());
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

app.AppConfig.sources.nb.dataflows = [
  { flow: 'AUC', version: '1.0', tableId: 'nb-AUC',
    path: ['bf', 'nb-pengepolitikk'],
    dropDims: ['AUCTION_ID'],
    intervalPicker: { granularity: 'day' },
    label: { nb: 'F-auksjoner – test' } },
  { flow: 'PLAIN', version: '1.0', tableId: 'nb-PLAIN',
    path: ['bf', 'nb-pengepolitikk'],
    label: { nb: 'Uten dropDims' } }
];

describe('NBAdapter — dropDims i metadata', () => {
  it('fjerner dimensjonen fra id/size/dimension/heading', async () => {
    const meta = await adapter.getTableMetadata('nb-AUC', false, 'no');
    assert.deepEqual(meta.id, ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'TIME_PERIOD']);
    assert.equal(meta.size.length, 3);
    assert.equal(meta.dimension.AUCTION_ID, undefined);
    assert.deepEqual(meta.extension.px.heading, ['INSTRUMENT_TYPE', 'UNIT_MEASURE']);
  });

  it('registrerer droppedDims og bevarer DSD-rekkefølgen i fullDimId', async () => {
    const meta = await adapter.getTableMetadata('nb-AUC', false, 'no');
    assert.deepEqual(meta.extension.droppedDims, ['AUCTION_ID']);
    assert.deepEqual(meta.extension.fullDimId,
      ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'AUCTION_ID', 'TIME_PERIOD']);
  });

  it('rebygger validKeys uten den droppede dimen (deduplisert)', async () => {
    const meta = await adapter.getTableMetadata('nb-AUC', false, 'no');
    const vk = meta.extension.validKeys;
    assert.deepEqual(vk.dims, ['INSTRUMENT_TYPE', 'UNIT_MEASURE']);
    assert.deepEqual(vk.keys.slice().sort(),
      ['FDFLIR.ANN', 'FDFLIR.V_B', 'FLFXIR.ANN', 'FLFXIR.V_B']);
  });

  it('flow uten dropDims er uendret (regresjon)', async () => {
    const meta = await adapter.getTableMetadata('nb-PLAIN', false, 'no');
    assert.deepEqual(meta.id, ['INSTRUMENT_TYPE', 'AUCTION_ID', 'TIME_PERIOD']);
    assert.equal(meta.extension.droppedDims, undefined);
  });
});

describe('NBAdapter — intervalPicker uten FREQ-dimensjon', () => {
  it('setter intervalPicker og pickerGran fra config-raden', async () => {
    const meta = await adapter.getTableMetadata('nb-AUC', false, 'no');
    const ext = meta.dimension.TIME_PERIOD.extension || {};
    assert.equal(ext.intervalPicker, true);
    assert.equal(ext.pickerGran, 'day');
    // Uten FREQ finnes ikke frekvenskartet — velgeren må klare seg uten.
    assert.equal(meta.extension.timePeriodsByFreq, undefined);
  });

  it('flow uten intervalPicker beholder verdilista', async () => {
    const meta = await adapter.getTableMetadata('nb-PLAIN', false, 'no');
    const ext = (meta.dimension.TIME_PERIOD && meta.dimension.TIME_PERIOD.extension) || {};
    assert.notEqual(ext.intervalPicker, true);
  });
});

describe('NBAdapter — nøkkelbygging og datasti med dropDims', () => {
  it('gir tomt segment for den droppede dimen i riktig posisjon', async () => {
    const meta = await adapter.getTableMetadata('nb-AUC', false, 'no');
    const q = adapter.buildApiQuery('nb-AUC', {
      INSTRUMENT_TYPE: ['FDFLIR'], UNIT_MEASURE: ['V_B'],
      TIME_PERIOD: 'range(2025-01-01,2025-01-31)'
    }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/AUC/FDFLIR.V_B.?'),
      'forventet tomt AUCTION_ID-segment, fikk: ' + q.url);
    assert.ok(q.url.includes('startPeriod=2025-01-01'));
    assert.ok(q.url.includes('endPeriod=2025-01-31'));
  });

  it('getTableData leverer datasett uten den droppede dimen', async () => {
    await adapter.getTableMetadata('nb-AUC', false, 'no'); // legg i cache
    const ds = await adapter.getTableData('nb-AUC', {
      INSTRUMENT_TYPE: ['FDFLIR', 'FLFXIR'], UNIT_MEASURE: ['ANN', 'V_B'],
      TIME_PERIOD: '*'
    }, 'no');
    assert.deepEqual(ds.id, ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'TIME_PERIOD']);
    assert.equal(ds.dimension.AUCTION_ID, undefined);
    assert.deepEqual(ds.size, [2, 2, 2]);
    // FDFLIR/V_B/budfrist0 → flat = (0*2 + 1)*2 + 0 = 2
    assert.equal(ds.value[2], 100);
    // FLFXIR/V_B/budfrist1 → flat = (1*2 + 1)*2 + 1 = 7
    assert.equal(ds.value[7], 200);
  });
});
