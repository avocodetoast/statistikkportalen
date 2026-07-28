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

// GOVT_PRIMARY_MARKET-lignende flow: snitt PÅ ISSUE_TYPE, samtidig som
// MATURITY/COUPON/INSTR kollapses inn i ISIN. Kodene her inneholder med vilje
// punktum og skråstrek («3.62500000», «NGB 03/2033») — nøyaktig de kodene som
// ikke kan stå i nøkkelstien, og som tvinger validKeys-rebyggingen til å gå via
// kodetupler i stedet for de '.'-joinede nøklene.
const GOVT_DIMS = ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'FREQ', 'ISIN', 'ISSUE_TYPE',
  'MATURITY', 'COUPON', 'INSTR'];
// Papir 1 er en obligasjon, papir 2 en veksel — INSTRUMENT_TYPE er dermed
// funksjonelt bestemt av ISIN, men beholdes bevisst som filter.
const GOVT_SEC = {
  NO1: ['GBON', '2033-03-13', '3.62500000', 'NGB 03/2033'],
  NO2: ['TBIL', '2025-06-18', '0.00000000', 'NTB 06/2025']
};
const GOVT_KEYS = [];
// Utstedelsesauksjon: begge papirene, to måleenheter.
['NO1', 'NO2'].forEach(isin => {
  const [type, mat, cpn, instr] = GOVT_SEC[isin];
  ['V_A', 'Y'].forEach(m => GOVT_KEYS.push([type, m, 'B', isin, 'AU', mat, cpn, instr]));
});
// Tilbakekjøpsauksjon: bare obligasjonen, og med en egen måleenhet (vektet
// snittkurs) som ikke finnes under utstedelsesauksjonene — grunnen til at
// ISSUE_TYPE er riktig delelinje.
['V_A', 'P_WA'].forEach(m => {
  const [type, mat, cpn, instr] = GOVT_SEC.NO1;
  GOVT_KEYS.push([type, m, 'B', 'NO1', 'BB', mat, cpn, instr]);
});

const FLOWS = {
  REG: { dims: REG_DIMS, keys: REG_KEYS },
  GOVT: { dims: GOVT_DIMS, keys: GOVT_KEYS },
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
  },
  GOVT: {
    INSTRUMENT_TYPE: { GBON: 'Statsobligasjoner', TBIL: 'Statskasseveksler' },
    UNIT_MEASURE: { V_A: 'Tildelt volum', Y: 'Effektiv rente', P_WA: 'Vektet snittkurs' },
    ISSUE_TYPE: { AU: 'Utstedelsesauksjon', BB: 'Tilbakekjøpsauksjon' },
    FREQ: { B: 'Virkedag' }
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

/**
 * Datasvar for nb-GOVT-AU-uttrekket (måleenhet «tildelt volum»): ett papir av
 * hver type, ISSUE_TYPE pinnet til AU, kjennetegnene med i svaret slik det ekte
 * API-et returnerer dem. To perioder.
 */
function govtDataJson() {
  const timeVals = ['2026-01-05', '2026-01-06'];
  const dimValues = {
    INSTRUMENT_TYPE: ['GBON', 'TBIL'],
    UNIT_MEASURE: ['V_A'],
    FREQ: ['B'],
    ISIN: ['NO1', 'NO2'],
    ISSUE_TYPE: ['AU'],
    MATURITY: ['2033-03-13', '2025-06-18'],
    COUPON: ['3.62500000', '0.00000000'],
    INSTR: ['NGB 03/2033', 'NTB 06/2025']
  };
  return {
    data: {
      structure: {
        dimensions: {
          series: GOVT_DIMS.map((id, i) => ({
            id, keyPosition: i, name: 'Navn ' + id,
            values: dimValues[id].map(c => ({
              id: c, name: (PROBE_VALUE_NAMES.GOVT[id] && PROBE_VALUE_NAMES.GOVT[id][c]) || c
            }))
          })),
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: timeVals.map(t => ({ id: t, name: t }))
          }]
        }
      },
      dataSets: [{
        series: {
          // GBON/V_A/B/NO1/AU + obligasjonens kjennetegn (indeks 0 hele veien).
          '0:0:0:0:0:0:0:0': { observations: { 0: [100], 1: [101] } },
          // TBIL/V_A/B/NO2/AU + vekselens kjennetegn (indeks 1).
          '1:0:0:1:0:1:1:1': { observations: { 0: [200], 1: [201] } }
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
    if (u.includes('detail=serieskeysonly')) return jsonResponse(keysJson(flowId));
    if (u.includes('firstNObservations=1')) {
      // Katalogperiode: ulik historikk per probeKey — avslører delt cachenøkkel.
      const early = u.includes('/data/REG/Q.REGIND.');
      return jsonResponse(probeJson(flowId, early ? ['2003-Q1', '2026-Q1'] : ['2010-Q1', '2026-Q1']));
    }
    if (u.includes('lastNObservations=60')) {
      return jsonResponse(probeJson(flowId, ['2025-Q1', '2025-Q2']));
    }
    if (flowId === 'GOVT') return jsonResponse(govtDataJson());
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
    path: ['bf', 'nb-renter'], label: { nb: 'Uten snitt' } },

  // Statspapirer: snitt på emisjonsform + kjennetegnskollaps i samme rad.
  { flow: 'GOVT', version: '1.0', tableId: 'nb-GOVT-AU',
    path: ['bf', 'nb-statsgjeld'],
    slice: { ISSUE_TYPE: 'AU' },
    probeKey: '..B..AU...',
    collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] },
    dimLabels: { ISIN: { nb: 'Statspapir' } },
    label: { nb: 'Statspapirer – utstedelsesauksjoner' } },

  { flow: 'GOVT', version: '1.0', tableId: 'nb-GOVT-BB',
    path: ['bf', 'nb-statsgjeld'],
    slice: { ISSUE_TYPE: 'BB' },
    probeKey: '..B..BB...',
    collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] },
    label: { nb: 'Statsobligasjoner – tilbakekjøpsauksjoner' } },

  // Snitt på måleenhet i stedet for emisjonsform (annenhåndsmarkedets mønster):
  // den pinnede dimensjonen er en annen, og ISSUE_TYPE blir stående som filter.
  { flow: 'GOVT', version: '1.0', tableId: 'nb-GOVT-VOL',
    path: ['bf', 'nb-statsgjeld'],
    slice: { UNIT_MEASURE: 'V_A' },
    probeKey: '.V_A.B.....',
    collapseDims: { anchor: 'ISIN', dims: ['MATURITY', 'COUPON', 'INSTR'] },
    label: { nb: 'Statspapirer – tildelt volum' } }
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

// Statspapir-flowene (GOVT_PRIMARY_MARKET / GOVT_SECONDARY_MARKET) kombinerer
// snitt og kjennetegnskollaps i samme tabell — den kombinasjonen har ingen av
// REGNET-radene, og kjennetegnskodene inneholder punktum og skråstrek.
describe('NBAdapter — slice + kjennetegnskollaps (statspapirer)', () => {
  it('pinner emisjonsformen bort og kollapser kjennetegnene inn i ISIN', async () => {
    const meta = await adapter.getTableMetadata('nb-GOVT-AU', false, 'no');
    assert.deepEqual(meta.id,
      ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'FREQ', 'ISIN', 'TIME_PERIOD']);
    assert.equal(meta.dimension.ISSUE_TYPE, undefined);
    assert.equal(meta.dimension.MATURITY, undefined);
    assert.equal(meta.dimension.COUPON, undefined);
    assert.equal(meta.dimension.INSTR, undefined);
    assert.deepEqual(meta.extension.pinnedDims.byDim, { ISSUE_TYPE: 'AU' });
    assert.deepEqual(meta.extension.collapsedDims.dims, ['MATURITY', 'COUPON', 'INSTR']);
  });

  it('snittet fjerner måleenheten som bare finnes under en annen emisjonsform', async () => {
    const au = await adapter.getTableMetadata('nb-GOVT-AU', false, 'no');
    assert.deepEqual(Object.keys(au.dimension.UNIT_MEASURE.category.index), ['V_A', 'Y']);
    // Vektet snittkurs hører til tilbakekjøpsauksjonene og skal ikke lekke inn.
    assert.equal(au.dimension.UNIT_MEASURE.category.index.P_WA, undefined);

    const bb = await adapter.getTableMetadata('nb-GOVT-BB', false, 'no');
    assert.deepEqual(Object.keys(bb.dimension.UNIT_MEASURE.category.index).sort(),
      ['P_WA', 'V_A']);
    // Bare obligasjonen kjøpes tilbake → ISIN og papirtype har én verdi hver, og
    // UI-en velger dem automatisk i stedet for å vise tomme kort.
    assert.deepEqual(bb.extension.autoHiddenDims.slice().sort(),
      ['FREQ', 'INSTRUMENT_TYPE', 'ISIN']);
  });

  it('beriker ISIN-etiketten med kupong og forfall', async () => {
    const meta = await adapter.getTableMetadata('nb-GOVT-AU', false, 'no');
    assert.equal(meta.dimension.ISIN.category.label.NO1,
      'NGB 03/2033 – 3,625 % – forfall 13.03.2033');
    assert.equal(meta.dimension.ISIN.category.label.NO2,
      'NTB 06/2025 – 0 % – forfall 18.06.2025');
  });

  it('bygger validKeys fra kodetupler, ikke fra punktum-joinede nøkler', async () => {
    const meta = await adapter.getTableMetadata('nb-GOVT-AU', false, 'no');
    const vk = meta.extension.validKeys;
    assert.deepEqual(vk.dims, ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'FREQ', 'ISIN']);
    // Papirtypen er funksjonelt bestemt av ISIN og beholdes som filter — derfor
    // er dette IKKE et fullt rektangel (2×2×1×2 = 8), og utgråingen er tilsiktet.
    assert.deepEqual(vk.keys.slice().sort(),
      ['GBON.V_A.B.NO1', 'GBON.Y.B.NO1', 'TBIL.V_A.B.NO2', 'TBIL.Y.B.NO2']);
  });

  it('legger den pinnede emisjonsformen i sitt eget nøkkelsegment', async () => {
    const meta = await adapter.getTableMetadata('nb-GOVT-AU', false, 'no');
    const q = adapter.buildApiQuery('nb-GOVT-AU', {
      INSTRUMENT_TYPE: '*', UNIT_MEASURE: ['V_A'], FREQ: ['B'], ISIN: ['NO1'],
      TIME_PERIOD: '*'
    }, { meta, lang: 'no' });
    // Åtte segmenter: papirtype tom, måleenhet, frekvens, ISIN, AU, og de tre
    // kollapsede kjennetegnene tomme (de kan ikke stå i nøkkelstien).
    assert.ok(q.url.includes('/data/GOVT/.V_A.B.NO1.AU...?'),
      'forventet .V_A.B.NO1.AU... i nøkkelen, fikk: ' + q.url);
  });

  it('snitt på måleenhet pinner den, og lar emisjonsformen stå som filter', async () => {
    const meta = await adapter.getTableMetadata('nb-GOVT-VOL', false, 'no');
    assert.equal(meta.dimension.UNIT_MEASURE, undefined);
    assert.deepEqual(meta.extension.pinnedDims.byDim, { UNIT_MEASURE: 'V_A' });
    assert.deepEqual(Object.keys(meta.dimension.ISSUE_TYPE.category.index).sort(),
      ['AU', 'BB']);
    const q = adapter.buildApiQuery('nb-GOVT-VOL', {
      INSTRUMENT_TYPE: '*', FREQ: ['B'], ISIN: '*', ISSUE_TYPE: ['BB'], TIME_PERIOD: '*'
    }, { meta, lang: 'no' });
    assert.ok(q.url.includes('/data/GOVT/.V_A.B..BB...?'),
      'forventet måleenheten pinnet inn i nøkkelen, fikk: ' + q.url);
  });

  it('leverer datasett uten pinnede og kollapsede dimensjoner', async () => {
    await adapter.getTableMetadata('nb-GOVT-AU', false, 'no'); // legg i cache
    const ds = await adapter.getTableData('nb-GOVT-AU', {
      INSTRUMENT_TYPE: '*', UNIT_MEASURE: ['V_A'], FREQ: ['B'], ISIN: ['NO1', 'NO2'],
      TIME_PERIOD: '*'
    }, 'no');
    assert.deepEqual(ds.id,
      ['INSTRUMENT_TYPE', 'UNIT_MEASURE', 'FREQ', 'ISIN', 'TIME_PERIOD']);
    assert.equal(ds.dimension.ISSUE_TYPE, undefined);
    assert.equal(ds.dimension.COUPON, undefined);
    assert.deepEqual(ds.size, [2, 1, 1, 2, 2]);
    // Obligasjonen ligger på GBON/NO1, vekselen på TBIL/NO2 — kombinasjonene
    // som ikke finnes er null, ikke utelatt.
    assert.deepEqual(ds.value, [100, 101, null, null, null, null, 200, 201]);
    assert.equal(ds.dimension.ISIN.category.label.NO1,
      'NGB 03/2033 – 3,625 % – forfall 13.03.2033');
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
    // Katalogen probes ikke lenger ved oppstart (periodene kommer fra
    // katalogindeksen, bygget bl.a. fra nb-periods.json) — probene kjøres når
    // en tabell ÅPNES og
    // skrives til cachen, som getTables leser. Samme egenskap som før: hver
    // rad må få SITT tidsvindu, ikke naboens.
    await adapter.getTableMetadata('nb-REG-PROD', false, 'no');
    await adapter.getTableMetadata('nb-REG-REGION', false, 'no');

    const res = await adapter.getTables({});
    const prod = res.tables.find(t => t.id === 'nb-REG-PROD');
    const region = res.tables.find(t => t.id === 'nb-REG-REGION');
    assert.equal(prod.firstPeriod, '2010');
    assert.equal(region.firstPeriod, '2003');
  });
});
