/**
 * norges-bank-adapter.js — dimSort (sortering av verdilister):
 *
 * Norges Banks ukodede dimensjoner (LIQUIDITY_FORECAST.FORECAST_DATE,
 * LIQUIDITY_STATISTICS.LIQUIDITY_DETAILS) kommer i tilfeldig rekkefølge fra
 * API-et. `dimSort: {dimId: 'asc'|'desc'}` på config-raden sorterer dem på kode.
 *
 * Viktig: UI-ets verdiliste (renderValueList i variable-select-render.js) følger
 * `category.label` sin INNSETTINGSREKKEFØLGE — derfor må både label og index
 * bygges om, ikke bare index.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// ---- Fixturer ----

const FLOWS = {
  // Ukodede dims i «API-rekkefølge» (usortert), som hos Norges Bank.
  VINTAGE: {
    dims: ['FORECAST_TYPE', 'FORECAST_DATE'],
    keys: [
      ['STAT_S', '2020-05-11'],
      ['STAT_S', '2016-03-07'],
      ['STAT_S', '2025-01-16'],
      ['STAT_S', '2023-12-18']
    ]
  },
  LIQ: {
    dims: ['MAIN', 'DETAILS'],
    keys: [
      ['Tab1', 'tab1_linje08'],
      ['Tab1', 'tab1_linje01'],
      ['Tab2', 'tab2_linje13'],
      ['Tab2', 'tab2_linje01']
    ]
  },
  PLAIN: { // uten dimSort — regresjon
    dims: ['MAIN', 'DETAILS'],
    keys: [['Tab1', 'b'], ['Tab1', 'a']]
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
          codes: seen.map(c => ({ id: c, names: { no: 'Navn ' + c } }))
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
    return seen.map(c => ({ id: c, name: 'Navn ' + c }));
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
    return jsonResponse(probeJson(flowId));
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

app.AppConfig.sources.nb.dataflows = [
  { flow: 'VINTAGE', version: '1.0', tableId: 'nb-VINTAGE',
    path: ['bf', 'nb-pengepolitikk'],
    dimSort: { FORECAST_DATE: 'desc' },
    label: { nb: 'Prognoser – test' } },
  { flow: 'LIQ', version: '1.0', tableId: 'nb-LIQ',
    path: ['bf', 'nb-pengepolitikk'],
    dimSort: { DETAILS: 'asc' },
    label: { nb: 'Likviditet – test' } },
  { flow: 'PLAIN', version: '1.0', tableId: 'nb-PLAIN',
    path: ['bf', 'nb-pengepolitikk'],
    label: { nb: 'Usortert – test' } }
];

/** Kodene i den rekkefølgen UI-et rendrer dem (label-innsettingsrekkefølge). */
function labelOrder(meta, dimId) {
  return Object.keys(meta.dimension[dimId].category.label);
}

describe('NBAdapter — dimSort', () => {
  it('sorterer synkende og holder index i takt med label', async () => {
    const meta = await adapter.getTableMetadata('nb-VINTAGE', false, 'no');
    const cat = meta.dimension.FORECAST_DATE.category;
    assert.deepEqual(labelOrder(meta, 'FORECAST_DATE'),
      ['2025-01-16', '2023-12-18', '2020-05-11', '2016-03-07']);
    assert.deepEqual(
      Object.keys(cat.index).sort((a, b) => cat.index[a] - cat.index[b]),
      ['2025-01-16', '2023-12-18', '2020-05-11', '2016-03-07']);
    // Indeksene skal være sammenhengende 0..n-1.
    assert.deepEqual(Object.values(cat.index).slice().sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('sorterer stigende og lar andre dimensjoner være i fred', async () => {
    const meta = await adapter.getTableMetadata('nb-LIQ', false, 'no');
    assert.deepEqual(labelOrder(meta, 'DETAILS'),
      ['tab1_linje01', 'tab1_linje08', 'tab2_linje01', 'tab2_linje13']);
    // MAIN er ikke nevnt i dimSort → uendret API-rekkefølge.
    assert.deepEqual(labelOrder(meta, 'MAIN'), ['Tab1', 'Tab2']);
  });

  it('beholder etikettene ved sortering', async () => {
    const meta = await adapter.getTableMetadata('nb-LIQ', false, 'no');
    assert.equal(meta.dimension.DETAILS.category.label.tab1_linje01, 'Navn tab1_linje01');
  });

  it('flow uten dimSort er uendret (regresjon)', async () => {
    const meta = await adapter.getTableMetadata('nb-PLAIN', false, 'no');
    assert.deepEqual(labelOrder(meta, 'DETAILS'), ['b', 'a']);
  });
});
