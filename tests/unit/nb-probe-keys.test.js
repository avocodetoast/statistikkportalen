/**
 * norges-bank-adapter.js — posisjonsbevisste tidsprober + probeKey:
 *   - FREQ er ikke alltid første dimensjon (GOVT_IRS: sist; GOVT_KEYFIGURES:
 *     midt i) — frekvensproben skal sette frekvenskoden på FREQ-dimensjonens
 *     faktiske posisjon i serienøkkelen (fra serieskeysonly).
 *   - Flows uten FREQ (FAUCTION) skal gå rett på /all-proben, aldri en
 *     «B…»-nøkkel.
 *   - `probeKey` i config-raden (streng eller {period,time}) skal brukes for
 *     katalogperiode-/tidsprobene i stedet for åpne nøkler (tunge flows).
 *   - `discontinued: true` i config-raden skal ut i katalogoppføringen.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// Alle URL-er fanges så testene kan assertere på probenøklene.
const requestedUrls = [];

// ---- Minimale SDMX-JSON-fixturer ----

const FLOW_DIMS = {
  MIDFREQ: ['UNIT_MEASURE', 'QUARTER', 'FREQ'],           // FREQ sist (à la GOVT_IRS/KEYFIGURES)
  NOFREQ: ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'AUCTION_ID'], // ingen FREQ (à la FAUCTION)
  PKSTR: ['FREQ', 'SEGMENT', 'MATURITY'],
  PKOBJ: ['FREQ', 'FORECAST_TYPE', 'FORECAST_DATE']
};
const FLOW_KEYS = {
  MIDFREQ: [['V', 'Q1', 'B']],
  NOFREQ: [['FD', 'ANN', 'A1']],
  PKSTR: [['B', 'U', 'ON']],
  PKOBJ: [['D', 'STAT_S', '2026-01-05']]
};

function dsdJson(flow) {
  const dims = FLOW_DIMS[flow];
  return {
    data: {
      dataStructures: [{
        id: 'DSD_' + flow,
        names: { no: 'Testflow ' + flow },
        dataStructureComponents: {
          dimensionList: {
            dimensions: dims.map((id, i) => ({
              id,
              position: i + 1,
              localRepresentation: {
                enumeration: 'urn:sdmx:org.sdmx.infomodel.codelist.Codelist=NB:CL_' + id + '(1.0)'
              }
            })),
            timeDimensions: [{ id: 'TIME_PERIOD', position: dims.length + 1 }]
          }
        }
      }],
      codelists: dims.map((id, i) => ({
        id: 'CL_' + id,
        names: { no: id },
        codes: (FLOW_KEYS[flow] || []).map(k => ({ id: k[i], names: { no: k[i] } }))
      }))
    }
  };
}

function keysJson(flow) {
  const dims = FLOW_DIMS[flow];
  const keys = FLOW_KEYS[flow];
  const values = dims.map((id, i) => {
    const seen = [];
    keys.forEach(k => { if (!seen.includes(k[i])) seen.push(k[i]); });
    return seen.map(c => ({ id: c, name: c }));
  });
  const series = {};
  keys.forEach(k => {
    series[k.map((c, i) => values[i].findIndex(v => v.id === c)).join(':')] = {};
  });
  return {
    data: {
      structure: {
        dimensions: {
          series: dims.map((id, i) => ({ id, keyPosition: i, name: id, values: values[i] })),
          observation: []
        }
      },
      dataSets: [{ series }]
    }
  };
}

function dataJson(flow) {
  const dims = FLOW_DIMS[flow];
  const key = FLOW_KEYS[flow][0];
  const timeVals = ['2024-12-30', '2025-01-02'];
  const observations = {};
  timeVals.forEach((t, i) => { observations[i] = [1.5 + i]; });
  return {
    data: {
      structure: {
        dimensions: {
          series: dims.map((id, i) => ({
            id, keyPosition: i, name: id, values: [{ id: key[i], name: key[i] }]
          })),
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{ series: { [dims.map(() => 0).join(':')]: { observations } } }]
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
    requestedUrls.push(u);
    const flow = Object.keys(FLOW_DIMS).find(f =>
      u.includes('/DSD_' + f + '?') || u.includes('/data/' + f + '/'));
    if (!flow) throw new Error('uventet URL i test: ' + u);
    if (u.includes('/datastructure/NB/DSD_')) return jsonResponse(dsdJson(flow));
    if (u.includes('detail=serieskeysonly')) return jsonResponse(keysJson(flow));
    // Katalogperiode- og tidsprober får samme lille datasvar.
    return jsonResponse(dataJson(flow));
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

// Adapteren leser cfg.dataflows ved kalltid — muter config etter last.
app.AppConfig.sources.nb.dataflows = [
  { flow: 'MIDFREQ', version: '1.0', tableId: 'nb-MIDFREQ',
    path: ['bf', 'nb-renter'], label: { nb: 'FREQ sist' } },
  { flow: 'NOFREQ', version: '1.0', tableId: 'nb-NOFREQ',
    path: ['bf', 'nb-renter'], label: { nb: 'Uten FREQ' } },
  { flow: 'PKSTR', version: '1.0', tableId: 'nb-PKSTR',
    path: ['bf', 'nb-likviditet'], probeKey: 'B.U..',
    label: { nb: 'Med probeKey-streng' } },
  { flow: 'PKOBJ', version: '1.0', tableId: 'nb-PKOBJ',
    path: ['bf', 'nb-likviditet'], probeKey: { period: 'D.STAT_S.', time: 'D.FCAST.' },
    discontinued: true,
    label: { nb: 'Med probeKey-objekt' } }
];

function urlsFor(flow) {
  return requestedUrls.filter(u => u.includes('/data/' + flow + '/'));
}

describe('NBAdapter — discontinued-flagg i katalogen', () => {
  it('speiler flow.discontinued; default er false', async () => {
    const { tables } = await adapter.getTables({});
    const pkobj = tables.find(t => t.id === 'nb-PKOBJ');
    const midfreq = tables.find(t => t.id === 'nb-MIDFREQ');
    assert.equal(pkobj.discontinued, true);
    assert.equal(midfreq.discontinued, false);
  });

  it('bruker probeKey (period-varianten) i katalogperiode-proben', () => {
    // getTables over har allerede probet periodene for alle flows.
    assert.ok(urlsFor('PKSTR').some(u =>
      u.includes('/data/PKSTR/B.U..?') && u.includes('firstNObservations=1')),
      'PKSTR-periodeproben skal bruke probeKey-strengen');
    assert.ok(urlsFor('PKOBJ').some(u =>
      u.includes('/data/PKOBJ/D.STAT_S.?') && u.includes('firstNObservations=1')),
      'PKOBJ-periodeproben skal bruke probeKey.period');
    assert.ok(!urlsFor('PKOBJ').some(u =>
      u.includes('/data/PKOBJ/D.FCAST.?') && u.includes('firstNObservations=1')),
      'PKOBJ-periodeproben skal IKKE bruke probeKey.time');
  });
});

describe('NBAdapter — posisjonsbevisst tidsprobe', () => {
  it('setter frekvenskoden på FREQ-dimensjonens faktiske posisjon (sist)', async () => {
    const meta = await adapter.getTableMetadata('nb-MIDFREQ', false, 'no');
    // FREQ er tredje (siste) seriedimensjon → nøkkelen skal være «..B».
    assert.ok(urlsFor('MIDFREQ').some(u =>
      u.includes('/data/MIDFREQ/..B?') && u.includes('lastNObservations=60')),
      'frekvensproben skal bruke nøkkelen «..B» (FREQ sist), fikk: ' +
      urlsFor('MIDFREQ').join(', '));
    assert.ok(meta.extension && meta.extension.timePeriodsByFreq,
      'frekvensbevisst tidsliste skal være satt');
    assert.deepEqual(meta.extension.timePeriodsByFreq.byFreq.B,
      ['2024-12-30', '2025-01-02']);
  });

  it('flows uten FREQ probes med /all, aldri en «B…»-nøkkel', async () => {
    const meta = await adapter.getTableMetadata('nb-NOFREQ', false, 'no');
    const urls = urlsFor('NOFREQ');
    assert.ok(urls.some(u => u.includes('/data/NOFREQ/all?')),
      'skal falle tilbake til /all');
    // Nøkkelen (path-delen etter flow-navnet) skal aldri inneholde «B».
    const keys = urls.map(u => u.split('/data/NOFREQ/')[1].split('?')[0]);
    assert.ok(keys.every(k => !k.includes('B')),
      'skal ikke prøve en B-nøkkel, prøvde: ' + keys.join(', '));
    // Tidsverdiene kommer likevel fra /all-proben.
    const timeId = meta.role.time[0];
    assert.equal(Object.keys(meta.dimension[timeId].category.index).length, 2);
  });

  it('percent-encoder koder og utelater nøkkel-ufiltrerbare dimensjoner', () => {
    // Manuelt metadata-objekt (buildApiQuery krever options.meta): COUPON er
    // merket ufiltrerbar (punktum-koder) og skal gi tomt segment selv med
    // utvalg; COUNTERPARTY-koden med mellomrom skal percent-encodes.
    const meta = {
      id: ['COUNTERPARTY', 'COUPON', 'TIME_PERIOD'],
      role: { time: ['TIME_PERIOD'] },
      dimension: {},
      extension: { unfilterableDims: ['COUPON'] }
    };
    const q = adapter.buildApiQuery('nb-MIDFREQ', {
      COUNTERPARTY: ['Danske Bank'],
      COUPON: ['0.00000000'],
      TIME_PERIOD: 'top(3)'
    }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/MIDFREQ/Danske%20Bank.?'),
      'forventet encodet motpart + tomt COUPON-segment, fikk: ' + q.url);
    assert.ok(q.url.includes('lastNObservations=3'));
  });

  it('bruker probeKey (time-varianten) for tidsproben', async () => {
    await adapter.getTableMetadata('nb-PKSTR', false, 'no');
    assert.ok(urlsFor('PKSTR').some(u =>
      u.includes('/data/PKSTR/B.U..?') && u.includes('lastNObservations=60')),
      'PKSTR-tidsproben skal bruke probeKey-strengen');

    const meta = await adapter.getTableMetadata('nb-PKOBJ', false, 'no');
    assert.ok(urlsFor('PKOBJ').some(u =>
      u.includes('/data/PKOBJ/D.FCAST.?') && u.includes('lastNObservations=60')),
      'PKOBJ-tidsproben skal bruke probeKey.time');
    // Én frekvens i serieskeysonly → byFreq registreres under den.
    assert.ok(meta.extension.timePeriodsByFreq &&
      Array.isArray(meta.extension.timePeriodsByFreq.byFreq.D));
  });
});
