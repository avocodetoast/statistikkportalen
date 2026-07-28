/**
 * norges-bank-adapter.js — fersk tidsperiode tilbake til tabellistene.
 *
 * Katalogen kommer normalt fra den forhåndsbygde katalogindeksen (bygget bl.a.
 * fra data/sources/nb-periods.json ved byggetid) og kan være noen uker gammel
 * (se nb-catalog-periods.test.js). Når en tabell ÅPNES probes flowen uansett,
 * og adapteren legger da det ferske vinduet i
 * meta.extension.periods — det kildeagnostiske feltet
 * BrowserState.syncTablePeriodsFromMetadata() retter katalogen i minnet fra
 * (samme mekanisme som FHI bruker).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// ---- Fixturer ----

const FLOWS = {
  // Med FREQ → intervallbasert tidsvelger (timeBounds settes i tillegg).
  WITHFREQ: { dims: ['FREQ', 'SERIES'], keys: [['B', 'S1'], ['A', 'S1']] },
  // Uten FREQ og uten intervalPicker → ingen tidsvelger, men periodene skal
  // likevel rapporteres tilbake til katalogen.
  NOFREQ: { dims: ['SERIES'], keys: [['S1']] }
};

// Katalogproben (firstNObservations=1&lastNObservations=1) gir hele historikken;
// tidsproben gir bare de siste periodene. Ulike årstall skiller dem i testen.
const CATALOGUE_PERIODS = ['2001-01-02', '2026-07-24'];
const TIME_PROBE_PERIODS = ['2026-07-23', '2026-07-24'];

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

function obsJson(flowId, timeVals) {
  const spec = FLOWS[flowId];
  const key = spec.keys[0];
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
    meta: { prepared: '2026-07-25T05:00:00Z' }
  };
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const requested = [];
const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    requested.push(u);
    const flowId = Object.keys(FLOWS).find(f =>
      u.includes('/DSD_' + f + '?') || u.includes('/data/' + f + '/'));
    if (!flowId) throw new Error('uventet URL i test: ' + u);
    if (u.includes('/datastructure/NB/DSD_')) return jsonResponse(dsdJson(flowId));
    if (u.includes('detail=serieskeysonly')) return jsonResponse(keysJson(flowId));
    if (u.includes('firstNObservations=1&lastNObservations=1')) {
      return jsonResponse(obsJson(flowId, CATALOGUE_PERIODS));
    }
    return jsonResponse(obsJson(flowId, TIME_PROBE_PERIODS));
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

app.AppConfig.sources.nb.dataflows = [
  { flow: 'WITHFREQ', version: '1.0', tableId: 'nb-WITHFREQ',
    path: ['bf', 'nb-pengepolitikk'], label: { nb: 'Med frekvens – test' } },
  { flow: 'NOFREQ', version: '1.0', tableId: 'nb-NOFREQ',
    path: ['bf', 'nb-pengepolitikk'], label: { nb: 'Uten frekvens – test' } }
];

describe('NBAdapter.getTableMetadata — extension.periods', () => {
  it('rapporterer katalogvinduet fra periodeproben, ikke tidsprobens utsnitt', async () => {
    const meta = await adapter.getTableMetadata('nb-WITHFREQ', false, 'no');
    assert.deepEqual(meta.extension.periods, { first: '2001', last: '2026' });
  });

  it('gjelder også flows uten tidsvelger', async () => {
    const meta = await adapter.getTableMetadata('nb-NOFREQ', false, 'no');
    assert.deepEqual(meta.extension.periods, { first: '2001', last: '2026' });
  });

  it('bruker samme probe til tidsvelgerens grenser (ett kall, to bruk)', async () => {
    // Periodeproben caches 24 t på tvers av tabellåpninger — tøm den, ellers
    // teller vi bare cachetreffet fra testene over.
    await app.SourceRegistry.ssb.instance.cache.delete('nb-catperiod-v2-WITHFREQ');
    requested.length = 0;
    const meta = await adapter.getTableMetadata('nb-WITHFREQ', false, 'no');
    const bounds = meta.dimension.TIME_PERIOD.extension.timeBounds;
    assert.equal(bounds.firstCode, '2001-01-02');
    assert.equal(bounds.lastCode, '2026-07-24');

    const catalogueProbes = requested.filter(u =>
      u.includes('firstNObservations=1&lastNObservations=1'));
    assert.equal(catalogueProbes.length, 1,
      'katalogperioden skal hentes én gang og gjenbrukes');
  });

  it('mates rett inn i BrowserState-kontrakten for periodeoppfriskning', async () => {
    const meta = await adapter.getTableMetadata('nb-NOFREQ', false, 'no');
    // Speiler syncTablePeriodsFromMetadata i js/browser-state.js.
    const periods = meta.extension.periods;
    assert.equal(typeof periods.first, 'string');
    assert.equal(typeof periods.last, 'string');
    assert.ok(periods.first && periods.last);
  });
});
