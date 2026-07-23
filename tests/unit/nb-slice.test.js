/**
 * norges-bank-adapter.js — `slice` (kuraterte «syntetiske» tabeller):
 *   - En config-rad kan angi `slice: {DIM: 'kode' | ['kode', ...]}`. Flere rader
 *     kan dele samme `flow` (Regionalt nettverk → seks tematabeller).
 *   - Enkeltkode-snitt PINNER dimensjonen: den fjernes helt fra metadata og
 *     datasettet, men koden står i sitt segment i SDMX-nøkkelen (API-byggerens
 *     URL må reprodusere nøyaktig det tabellen viser).
 *   - Flerkode-snitt snevrer bare verdilista; dimensjonen vises som normalt.
 *   - Etter snitt er de kuraterte tabellene fulle rektangler, så validKeys
 *     gråer ikke ut noe (poenget med hele øvelsen).
 *   - collapseDims skal AVVISES når kollapsen ikke er funksjonell (ett anker →
 *     flere kombinasjoner), i stedet for stilltiende å kaste serier.
 *   - Rader som deler flow, men har ulik probeKey, må ikke dele katalog-
 *     periodecache.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// ---- Fixturer ----

// REGNET-lignende flow: FREQ.TOPIC.SECTOR.REGION.HORIZON.
// _X/_Z er SDMX-plassholdere (Unspecified / Not Applicable) — nøyaktig
// mønsteret i den ekte REGNET-flowen.
const REG_DIMS = ['FREQ', 'TOPIC', 'SECTOR', 'REGION', 'HORIZON'];
const REG_KEYS = [];
['S1', 'S2'].forEach(s => {
  ['CURRQ', 'N1Q'].forEach(h => REG_KEYS.push(['Q', 'PROD', s, '_X', h]));
  REG_KEYS.push(['Q', 'SYSS', s, '_X', 'CURRQ']);
  REG_KEYS.push(['Q', 'SYSSPLAN', s, '_X', 'N1Q']);
  ['CURRY', 'N1Y'].forEach(h => REG_KEYS.push(['Q', 'ARSLONN', s, '_X', h]));
});
['R1', 'R2'].forEach(r => REG_KEYS.push(['Q', 'REGIND', '_Z', r, '_X']));

const FLOWS = {
  REG: { dims: REG_DIMS, keys: REG_KEYS },
  // Uten slice — regresjon: alt skal se ut som før.
  PLAIN: { dims: ['FREQ', 'TOPIC'], keys: [['B', 'A1'], ['B', 'A2']] }
};

// Lokaliserte verdinavn fra serieskeysonly-proben.
const PROBE_VALUE_NAMES = {
  REG: {
    FREQ: { Q: 'Kvartal' },
    TOPIC: {
      PROD: 'Produksjonsvekst', SYSS: 'Sysselsettingsvekst',
      SYSSPLAN: 'Sysselsettingsplaner', ARSLONN: 'Årslønnsvekst',
      REGIND: 'Regionalindikator'
    },
    HORIZON: {
      CURRQ: 'Inneværende kvartal', N1Q: 'Neste kvartal',
      CURRY: 'Inneværende år', N1Y: 'Neste år'
    }
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
          codes: seen.map(c => ({ id: c, names: { no: c } }))
        };
      })
    }
  };
}

function keysJson(flowId) {
  const spec = FLOWS[flowId];
  const names = PROBE_VALUE_NAMES[flowId] || {};
  const values = spec.dims.map((id, i) => {
    const seen = [];
    spec.keys.forEach(k => { if (!seen.includes(k[i])) seen.push(k[i]); });
    return seen.map(c => ({ id: c, name: (names[id] && names[id][c]) || c }));
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
function probeJson(flowId, timeVals) {
  const spec = FLOWS[flowId];
  const key = spec.keys[0];
  const observations = {};
  timeVals.forEach((_, i) => { observations[i] = [1 + i]; });
  return {
    data: {
      structure: {
        dimensions: {
          series: spec.dims.map((id, i) => ({
            id, keyPosition: i, name: 'Navn ' + id, values: [{ id: key[i], name: key[i] }]
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

/**
 * Datasvar for nb-REG-PROD-uttrekket: FREQ/TOPIC/REGION har én verdi hver
 * (nøkkelen pinner dem), SECTOR to og HORIZON to → 4 serier × 3 perioder.
 */
function prodDataJson() {
  const timeVals = ['2025-Q1', '2025-Q2', '2025-Q3'];
  const series = {};
  let n = 10;
  [0, 1].forEach(si => {
    [0, 1].forEach(hi => {
      series['0:0:' + si + ':0:' + hi] = { observations: { 0: [n], 1: [n + 1], 2: [n + 2] } };
      n += 10;
    });
  });
  return {
    data: {
      structure: {
        dimensions: {
          series: [
            { id: 'FREQ', keyPosition: 0, name: 'Frekvens', values: [{ id: 'Q', name: 'Kvartal' }] },
            { id: 'TOPIC', keyPosition: 1, name: 'Tema', values: [{ id: 'PROD', name: 'Produksjonsvekst' }] },
            { id: 'SECTOR', keyPosition: 2, name: 'Næring',
              values: [{ id: 'S1', name: 'S1' }, { id: 'S2', name: 'S2' }] },
            { id: 'REGION', keyPosition: 3, name: 'Region', values: [{ id: '_X', name: '_X' }] },
            { id: 'HORIZON', keyPosition: 4, name: 'Horisont',
              values: [{ id: 'CURRQ', name: 'Inneværende kvartal' }, { id: 'N1Q', name: 'Neste kvartal' }] }
          ],
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{ series }]
    },
    meta: { prepared: '2026-01-10T00:00:00Z' }
  };
}

/** Datasvar for nb-REG-SYSS: TOPIC(2) × SECTOR(2), HORIZON diagonalt. */
function syssDataJson() {
  const timeVals = ['2025-Q1', '2025-Q2'];
  const series = {};
  let n = 1;
  // SYSS ligger på HORIZON-indeks 0 (CURRQ), SYSSPLAN på 1 (N1Q).
  [['0', '0'], ['1', '1']].forEach(([ti, hi]) => {
    ['0', '1'].forEach(si => {
      series['0:' + ti + ':' + si + ':0:' + hi] = { observations: { 0: [n], 1: [n + 1] } };
      n += 10;
    });
  });
  return {
    data: {
      structure: {
        dimensions: {
          series: [
            { id: 'FREQ', keyPosition: 0, name: 'Frekvens', values: [{ id: 'Q', name: 'Kvartal' }] },
            { id: 'TOPIC', keyPosition: 1, name: 'Tema',
              values: [{ id: 'SYSS', name: 'Sysselsettingsvekst' },
                { id: 'SYSSPLAN', name: 'Sysselsettingsplaner' }] },
            { id: 'SECTOR', keyPosition: 2, name: 'Næring',
              values: [{ id: 'S1', name: 'S1' }, { id: 'S2', name: 'S2' }] },
            { id: 'REGION', keyPosition: 3, name: 'Region', values: [{ id: '_X', name: '_X' }] },
            { id: 'HORIZON', keyPosition: 4, name: 'Horisont',
              values: [{ id: 'CURRQ', name: 'Inneværende kvartal' },
                { id: 'N1Q', name: 'Neste kvartal' }] }
          ],
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{ series }]
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
    if (u.includes('detail=serieskeysonly')) return jsonResponse(keysJson(flowId));
    if (u.includes('firstNObservations=1')) {
      // Katalogperiode: ulik historikk per probeKey — avslører delt cachenøkkel.
      const early = u.includes('/data/REG/Q.REGIND.');
      return jsonResponse(probeJson(flowId, early ? ['2003-Q1', '2026-Q1'] : ['2010-Q1', '2026-Q1']));
    }
    if (u.includes('lastNObservations=60')) {
      return jsonResponse(probeJson(flowId, ['2025-Q1', '2025-Q2']));
    }
    return jsonResponse(u.includes('SYSS') ? syssDataJson() : prodDataJson());
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

app.AppConfig.sources.nb.dataflows = [
  { flow: 'REG', version: '1.0', tableId: 'nb-REG-PROD',
    path: ['nk', 'nb-regionalt-nettverk'],
    slice: { TOPIC: 'PROD', REGION: '_X' },
    probeKey: 'Q.PROD.._X.',
    timeUnit: 'Quarterly',
    keywords: ['Produksjonsvekst', 'Regionalt nettverk'],
    description: 'Produksjonsvekst i Norges Banks regionale nettverk.',
    dimLabels: { HORIZON: { nb: 'Tidshorisont', en: 'Horizon' } },
    label: { nb: 'Regionalt nettverk, produksjonsvekst, etter næring' } },

  { flow: 'REG', version: '1.0', tableId: 'nb-REG-SYSS',
    path: ['nk', 'nb-regionalt-nettverk'],
    slice: { TOPIC: ['SYSS', 'SYSSPLAN'], REGION: '_X' },
    collapseDims: { anchor: 'TOPIC', dims: ['HORIZON'], labelStyle: 'suffix' },
    probeKey: 'Q.SYSS+SYSSPLAN.._X.',
    timeUnit: 'Quarterly',
    dimLabels: { TOPIC: { nb: 'Indikator' } },
    label: { nb: 'Regionalt nettverk, sysselsettingsvekst og -planer, etter næring' } },

  { flow: 'REG', version: '1.0', tableId: 'nb-REG-REGION',
    path: ['nk', 'nb-regionalt-nettverk'],
    slice: { TOPIC: 'REGIND', SECTOR: '_Z', HORIZON: '_X' },
    probeKey: 'Q.REGIND._Z.._X',
    timeUnit: 'Quarterly',
    label: { nb: 'Regionalt nettverk, regionalindikator, etter region' } },

  // Ikke-funksjonell kollaps: ARSLONN har TO horisonter, så TOPIC bestemmer
  // ikke HORIZON. Kollapsen skal avvises, ikke kaste halve serien.
  { flow: 'REG', version: '1.0', tableId: 'nb-REG-ARSLONN',
    path: ['nk', 'nb-regionalt-nettverk'],
    slice: { TOPIC: 'ARSLONN', REGION: '_X' },
    collapseDims: { anchor: 'TOPIC', dims: ['HORIZON'] },
    timeUnit: 'Quarterly',
    label: { nb: 'Regionalt nettverk, årslønnsvekst, etter næring' } },

  { flow: 'PLAIN', version: '1.0', tableId: 'nb-PLAIN',
    path: ['bf', 'nb-renter'], label: { nb: 'Uten snitt' } }
];

describe('NBAdapter — slice: pinnede dimensjoner i metadata', () => {
  it('fjerner enkeltkode-snittede dims fra id/size/dimension/heading', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'SECTOR', 'HORIZON', 'TIME_PERIOD']);
    assert.equal(meta.size.length, 4);
    assert.equal(meta.dimension.TOPIC, undefined);
    assert.equal(meta.dimension.REGION, undefined);
    assert.deepEqual(meta.extension.px.heading, ['FREQ', 'SECTOR', 'HORIZON']);
  });

  it('registrerer pinnedDims med koder og full dimensjonsrekkefølge', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    assert.deepEqual(meta.extension.pinnedDims.byDim, { TOPIC: 'PROD', REGION: '_X' });
    assert.deepEqual(meta.extension.fullDimId,
      ['FREQ', 'TOPIC', 'SECTOR', 'REGION', 'HORIZON', 'TIME_PERIOD']);
  });

  it('snevrer verdilistene til snittet', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    assert.deepEqual(Object.keys(meta.dimension.SECTOR.category.index), ['S1', 'S2']);
    assert.deepEqual(Object.keys(meta.dimension.HORIZON.category.index), ['CURRQ', 'N1Q']);
    // Årslønn-horisontene (CURRY/N1Y) hører til et annet tema og skal være borte.
    assert.equal(meta.dimension.HORIZON.category.index.CURRY, undefined);
  });

  it('gir et fullt rektangel i validKeys (ingenting å gråe ut)', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    const vk = meta.extension.validKeys;
    assert.deepEqual(vk.dims, ['FREQ', 'SECTOR', 'HORIZON']);
    assert.deepEqual(vk.keys.slice().sort(),
      ['Q.S1.CURRQ', 'Q.S1.N1Q', 'Q.S2.CURRQ', 'Q.S2.N1Q']);
  });

  it('markerer enkeltverdi-dims som automatisk valgt (autoHiddenDims)', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    assert.deepEqual(meta.extension.autoHiddenDims, ['FREQ']);
  });

  it('bruker dimLabels-overstyringen fra config-raden', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    assert.equal(meta.dimension.HORIZON.label, 'Tidshorisont');
  });

  it('bruker per-tabell description som Tabellinfo-note', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    assert.deepEqual(meta.note, ['Produksjonsvekst i Norges Banks regionale nettverk.']);
  });

  it('flerkode-snitt beholder dimensjonen, kollapsen fjerner den avhengige', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-SYSS', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'TOPIC', 'SECTOR', 'TIME_PERIOD']);
    assert.deepEqual(Object.keys(meta.dimension.TOPIC.category.index), ['SYSS', 'SYSSPLAN']);
    assert.equal(meta.dimension.HORIZON, undefined);
    assert.equal(meta.dimension.REGION, undefined);
    assert.equal(meta.dimension.TOPIC.label, 'Indikator');
    assert.deepEqual(meta.extension.validKeys.keys.slice().sort(),
      ['Q.SYSS.S1', 'Q.SYSS.S2', 'Q.SYSSPLAN.S1', 'Q.SYSSPLAN.S2']);
  });

  // Uten dette er horisonten usynlig: «Sysselsettingsvekst» og
  // «Sysselsettingsplaner» sier ikke hvilket kvartal de gjelder.
  it('labelStyle:suffix flytter den kollapsede verdien inn i ankeretiketten', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-SYSS', false, 'no');
    const label = meta.dimension.TOPIC.category.label;
    assert.equal(label.SYSS, 'Sysselsettingsvekst (Inneværende kvartal)');
    assert.equal(label.SYSSPLAN, 'Sysselsettingsplaner (Neste kvartal)');
  });

  it('de berikede etikettene følger med ut i datasettet', async () => {
    await adapter.getTableMetadata('nb-REG-SYSS', false, 'no');
    const ds = await adapter.getTableData('nb-REG-SYSS',
      { FREQ: ['Q'], TOPIC: '*', SECTOR: '*', TIME_PERIOD: '*' }, 'no');
    assert.equal(ds.dimension.TOPIC.category.label.SYSS,
      'Sysselsettingsvekst (Inneværende kvartal)');
  });

  it('snitt kan pinne flere dims samtidig', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-REGION', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'REGION', 'TIME_PERIOD']);
    assert.deepEqual(Object.keys(meta.dimension.REGION.category.index), ['R1', 'R2']);
    assert.deepEqual(meta.extension.pinnedDims.byDim,
      { TOPIC: 'REGIND', SECTOR: '_Z', HORIZON: '_X' });
  });

  it('avviser ikke-funksjonell kollaps (ett anker → flere kombinasjoner)', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-ARSLONN', false, 'no');
    // TOPIC er pinnet bort, men HORIZON må stå igjen med BEGGE årshorisontene.
    assert.equal(meta.extension.collapsedDims, undefined);
    assert.ok(meta.dimension.HORIZON, 'HORIZON skal ikke være kollapset bort');
    assert.deepEqual(Object.keys(meta.dimension.HORIZON.category.index), ['CURRY', 'N1Y']);
  });

  it('flow uten slice er uendret (regresjon)', async () => {
    const meta = await adapter.getTableMetadata('nb-PLAIN', false, 'no');
    assert.deepEqual(meta.id, ['FREQ', 'TOPIC', 'TIME_PERIOD']);
    assert.equal(meta.extension.pinnedDims, undefined);
    assert.equal(meta.extension.autoHiddenDims, undefined);
  });
});

describe('NBAdapter — slice: nøkkelbygging og datasti', () => {
  it('API-nøkkelen inneholder de pinnede kodene i riktige segmenter', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    const q = adapter.buildApiQuery('nb-REG-PROD', {
      FREQ: ['Q'], SECTOR: ['S1'], HORIZON: ['CURRQ', 'N1Q'], TIME_PERIOD: 'top(5)'
    }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/REG/Q.PROD.S1._X.CURRQ%2BN1Q?') ||
      q.url.includes('/data/REG/Q.PROD.S1._X.CURRQ+N1Q?'),
      'forventet pinnede segmenter i nøkkelen, fikk: ' + q.url);
    assert.ok(q.url.includes('lastNObservations=5'));
  });

  it('pinnede dims wildcardes ikke selv om brukeren ikke har valgt dem', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-REGION', false, 'no');
    const q = adapter.buildApiQuery('nb-REG-REGION',
      { FREQ: ['Q'], REGION: ['R1'], TIME_PERIOD: '*' }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/REG/Q.REGIND._Z.R1._X?'),
      'forventet Q.REGIND._Z.R1._X, fikk: ' + q.url);
  });

  // «Velg alle» i UI-en gir utvalget '*'. For en dimensjon som er SNITTET (men
  // ikke pinnet) må '*' bety «alle verdier i snittet», ikke alle i flowen —
  // ellers sprenger uttaket ut over tabellens tema.
  it('«alle verdier» i en snittet dimensjon begrenses til snittets koder', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-SYSS', false, 'no');
    // FREQ auto-velges av UI-en (enkeltverdi); TOPIC/SECTOR står på «alle».
    const q = adapter.buildApiQuery('nb-REG-SYSS',
      { FREQ: ['Q'], TOPIC: '*', SECTOR: '*', TIME_PERIOD: '*' }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/REG/Q.SYSS+SYSSPLAN.._X.?'),
      'forventet snittets temakoder i nøkkelen, fikk: ' + q.url);
    // SECTOR er ikke nevnt i snittet → tomt segment (alle er uansett gyldige).
    assert.ok(!q.url.includes('S1+S2'), 'usnittede dims skal ikke listes ut: ' + q.url);
  });

  it('et delvalg i en snittet dimensjon brukes som det er', async () => {
    const meta = await adapter.getTableMetadata('nb-REG-SYSS', false, 'no');
    const q = adapter.buildApiQuery('nb-REG-SYSS',
      { FREQ: ['Q'], TOPIC: ['SYSS'], SECTOR: ['S1'], TIME_PERIOD: '*' }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/REG/Q.SYSS.S1._X.?'),
      'forventet Q.SYSS.S1._X., fikk: ' + q.url);
  });

  it('getTableData leverer datasett uten de pinnede dimensjonene', async () => {
    await adapter.getTableMetadata('nb-REG-PROD', false, 'no'); // legg i cache
    const ds = await adapter.getTableData('nb-REG-PROD', {
      FREQ: ['Q'], SECTOR: ['S1', 'S2'], HORIZON: ['CURRQ', 'N1Q'], TIME_PERIOD: '*'
    }, 'no');
    assert.deepEqual(ds.id, ['FREQ', 'SECTOR', 'HORIZON', 'TIME_PERIOD']);
    assert.equal(ds.dimension.TOPIC, undefined);
    assert.equal(ds.dimension.REGION, undefined);
    assert.deepEqual(ds.size, [1, 2, 2, 3]);
    // Serie S1/CURRQ starter på 10, S1/N1Q på 20, S2/CURRQ på 30, S2/N1Q på 40.
    assert.deepEqual(ds.value,
      [10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42]);
  });
});

describe('NBAdapter — katalog for snittede rader', () => {
  it('bruker timeUnit og keywords fra config-raden', async () => {
    const res = await adapter.getTables({ useCache: false });
    const prod = res.tables.find(t => t.id === 'nb-REG-PROD');
    assert.equal(prod.timeUnit, 'Quarterly');
    assert.deepEqual(prod.variableNames, ['Produksjonsvekst', 'Regionalt nettverk']);
    assert.equal(prod.label, 'Regionalt nettverk, produksjonsvekst, etter næring');
  });

  it('rader som deler flow, men har ulik probeKey, deler ikke periodecache', async () => {
    const res = await adapter.getTables({ useCache: false });
    const prod = res.tables.find(t => t.id === 'nb-REG-PROD');
    const region = res.tables.find(t => t.id === 'nb-REG-REGION');
    assert.equal(prod.firstPeriod, '2010');
    assert.equal(region.firstPeriod, '2003');
  });
});
