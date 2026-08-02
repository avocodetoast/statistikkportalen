/**
 * To ulike tidsavbrudd i kildelaget, og hvorfor de MÅ være forskjellige:
 *
 *   sources.fetchTimeoutMs (15 s)     — katalog og metadata. Verner første
 *     paint: BrowserState venter på hele katalogaggregeringen, så en hengende
 *     kilde må feile raskt.
 *   sources.dataFetchTimeoutMs (90 s) — KUN getTableData. Et stort uttrekk er
 *     ikke en hengende kilde: FHI leverer 2 mill. celler på 39 s og 6 mill. på
 *     116 s (målt 2026-08-02, se API-FINDINGS.md). Med 15 s var en FHI-tabell
 *     på 2 mill. celler uhentbar uansett hva brukeren gjorde.
 *
 * Kontrakttest: hindrer at en senere refaktor tråkker det lange taket inn i
 * metadatastien (som ville kostet første paint) eller det korte inn i datastien.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// ---- Norges Bank-fixturer (SDMX-JSON) ----

const NB_DIMS = ['FREQ', 'SERIES'];
const NB_KEYS = [['B', 'S1'], ['A', 'S1']];

function dsdJson() {
  return {
    data: {
      dataStructures: [{
        id: 'DSD_TFLOW',
        names: { no: 'DSD TFLOW' },
        dataStructureComponents: {
          dimensionList: {
            dimensions: NB_DIMS.map((id, i) => ({
              id,
              position: i + 1,
              localRepresentation: {
                enumeration: 'urn:sdmx:org.sdmx.infomodel.codelist.Codelist=NB:CL_' + id + '(1.0)'
              }
            })),
            timeDimensions: [{ id: 'TIME_PERIOD', position: NB_DIMS.length + 1 }]
          }
        }
      }],
      codelists: NB_DIMS.map((id, i) => {
        const seen = [];
        NB_KEYS.forEach(k => { if (!seen.includes(k[i])) seen.push(k[i]); });
        return {
          id: 'CL_' + id,
          names: { no: 'Kodeliste ' + id },
          codes: seen.map(c => ({ id: c, names: { no: 'Navn ' + c } }))
        };
      })
    }
  };
}

function keysJson() {
  const values = NB_DIMS.map((id, i) => {
    const seen = [];
    NB_KEYS.forEach(k => { if (!seen.includes(k[i])) seen.push(k[i]); });
    return seen.map(c => ({ id: c, name: 'Navn ' + c }));
  });
  const series = {};
  NB_KEYS.forEach(k => {
    series[k.map((c, i) => values[i].findIndex(v => v.id === c)).join(':')] = {};
  });
  return {
    data: {
      structure: { dimensions: { series: NB_DIMS.map((id, i) => ({ id, keyPosition: i, name: id, values: values[i] })), observation: [] } },
      dataSets: [{ series }]
    }
  };
}

function obsJson(timeVals) {
  const key = NB_KEYS[0];
  const observations = {};
  timeVals.forEach((t, i) => { observations[i] = [1 + i]; });
  return {
    data: {
      structure: {
        dimensions: {
          series: NB_DIMS.map((id, i) => ({ id, keyPosition: i, name: id, values: [{ id: key[i], name: key[i] }] })),
          observation: [{ id: 'TIME_PERIOD', name: 'Tidsperiode', values: timeVals.map(t => ({ id: t, name: t })) }]
        }
      },
      dataSets: [{ series: { [NB_DIMS.map(() => 0).join(':')]: { observations } } }]
    },
    meta: { prepared: '2026-07-25T05:00:00Z' }
  };
}

// ---- FHI-fixturer ----

const FHI_CATALOG = {
  generatedAt: '2026-08-02T00:00:00Z',
  sources: {
    daar: {
      title: 'Dødsårsaksregisteret (DÅR)',
      tables: [{
        tableId: 268, title: 'Testtabell', description: 'Testtabell.',
        firstPeriod: '1986', lastPeriod: '2025', timeUnit: 'Annual',
        variableNames: [], updated: '2026-04-22T11:08:52Z'
      }]
    }
  }
};

const FHI_DIMENSIONS = {
  dimensions: [
    { code: 'aar', label: 'År', categories: [{ value: '2024', label: '2024' }, { value: '2025', label: '2025' }] },
    { code: 'MEASURE_TYPE', label: 'Måltall', categories: [{ value: 'antall', label: 'Antall' }] }
  ]
};

const FHI_DATA = {
  class: 'dataset', version: '2.0', label: 'Testtabell',
  id: ['aar', 'MEASURE_TYPE'], size: [2, 1],
  role: { time: ['aar'], metric: ['MEASURE_TYPE'] },
  dimension: {
    aar: { label: 'År', category: { index: { 2024: 0, 2025: 1 }, label: { 2024: '2024', 2025: '2025' } } },
    MEASURE_TYPE: { label: 'Måltall', category: { index: { antall: 0 }, label: { antall: 'Antall' } } }
  },
  value: [1, 2]
};

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);

    // Norges Bank
    if (u.includes('/datastructure/NB/DSD_')) return jsonResponse(dsdJson());
    if (u.includes('detail=serieskeysonly')) return jsonResponse(keysJson());
    if (u.includes('/data/TFLOW/')) return jsonResponse(obsJson(['2024', '2025']));

    // FHI
    if (u.includes('fhi-catalog.json')) return jsonResponse(FHI_CATALOG);
    if (u.endsWith('/Common/source')) return jsonResponse([]);
    if (/\/Table\/\d+\/dimension$/.test(u)) return jsonResponse(FHI_DIMENSIONS);
    if (/\/Table\/\d+\/query$/.test(u)) return jsonResponse({ dimensions: [] });
    if (/\/Table\/\d+\/metadata$/.test(u)) return jsonResponse({ name: 'Testtabell', paragraphs: [] });
    if (/\/Table\/\d+\/flag$/.test(u)) return jsonResponse([]);
    if (/\/Table\/\d+\/data$/.test(u)) return jsonResponse(FHI_DATA);
    if (/\/[^/]+\/table$/.test(u)) {
      return jsonResponse([{ tableId: 268, title: 'Testtabell', publishedAt: '', modifiedAt: '' }]);
    }

    throw new Error('uventet URL i test: ' + u);
  }
});

app.AppConfig.sources.fhi.sourceIds = ['daar'];
app.AppConfig.sources.nb.dataflows = [
  { flow: 'TFLOW', version: '1.0', tableId: 'nb-TFLOW',
    path: ['bf', 'nb-pengepolitikk'], label: { nb: 'Tidsavbruddstest' } }
];

// Legg en opptaker rundt fetchWithTimeout uten å endre oppførselen: adapterne
// slår den opp dynamisk på window.SourceCommon, så dette treffer alle kall.
const calls = [];
const origFetchWithTimeout = app.SourceCommon.fetchWithTimeout;
app.SourceCommon.fetchWithTimeout = (url, fetchOptions, opts) => {
  calls.push({ url: String(url), timeoutMs: opts && opts.timeoutMs });
  return origFetchWithTimeout(url, fetchOptions, opts);
};

const nb = app.SourceAdapters.find(a => a.sourceId === 'nb');
const fhi = app.SourceAdapters.find(a => a.sourceId === 'fhi');

/** Alle registrerte kall som treffer et URL-mønster. */
const matching = re => calls.filter(c => re.test(c.url));

describe('sources.dataFetchTimeoutMs — konfigurasjonen', () => {
  it('de to tidsavbruddene finnes og er forskjellige', () => {
    assert.equal(app.AppConfig.sources.fetchTimeoutMs, 15000);
    assert.equal(app.AppConfig.sources.dataFetchTimeoutMs, 90000);
  });
});

describe('Norges Bank — kort tak på metadata, langt på data', () => {
  before(async () => {
    await nb.getTableMetadata('nb-TFLOW', false, 'no');
    await nb.getTableData('nb-TFLOW', { FREQ: ['B'], SERIES: ['S1'] }, 'no');
  });

  it('DSD-oppslaget bruker det korte taket', () => {
    const c = matching(/\/datastructure\/NB\/DSD_/);
    assert.ok(c.length > 0, 'DSD-kallet ble ikke registrert');
    c.forEach(x => assert.equal(x.timeoutMs, 15000));
  });

  it('serieskeysonly-proben bruker det korte taket', () => {
    const c = matching(/detail=serieskeysonly/);
    assert.ok(c.length > 0, 'nøkkelproben ble ikke registrert');
    c.forEach(x => assert.equal(x.timeoutMs, 15000));
  });

  it('selve datauttrekket bruker det lange taket', () => {
    const c = matching(/\/data\/TFLOW\//).filter(x => !/serieskeysonly/.test(x.url));
    const lange = c.filter(x => x.timeoutMs === 90000);
    assert.equal(lange.length, 1, 'nøyaktig ett datauttrekk skal ha det lange taket');
  });

  it('probene i metadatastien får ALDRI det lange taket', () => {
    matching(/firstNObservations|lastNObservations|serieskeysonly|datastructure/)
      .forEach(x => assert.equal(x.timeoutMs, 15000, 'probe med langt tak: ' + x.url));
  });
});

describe('FHI — kort tak på katalog/metadata, langt på data', () => {
  before(async () => {
    calls.length = 0;
    await fhi.getTableMetadata('fhi-daar-268', false, 'no');
    await fhi.getTableData('fhi-daar-268', { aar: ['2024'], MEASURE_TYPE: ['antall'] }, 'no');
  });

  it('dimensjons-, query-, metadata- og flaggkall bruker det korte taket', () => {
    const c = matching(/\/Table\/\d+\/(dimension|query|metadata|flag)$/);
    assert.ok(c.length >= 4, 'metadatakallene ble ikke registrert');
    c.forEach(x => assert.equal(x.timeoutMs, 15000, 'metadatakall med feil tak: ' + x.url));
  });

  it('katalogkallet bruker det korte taket', () => {
    matching(/\/table$|fhi-catalog\.json/)
      .forEach(x => assert.equal(x.timeoutMs, 15000, 'katalogkall med feil tak: ' + x.url));
  });

  it('POST /data bruker det lange taket', () => {
    const c = matching(/\/Table\/\d+\/data$/);
    assert.equal(c.length, 1);
    assert.equal(c[0].timeoutMs, 90000);
  });
});
