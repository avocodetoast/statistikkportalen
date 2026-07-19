/**
 * sdmx-to-jsonstat.js — kjennetegns-kollaps + tittelpreferanse:
 *   - structureToMetadata skal foretrekke kuratert configetikett
 *     (flowConfig.label) over DSD-navnet — NB-DSD-er har ofte kun engelsk
 *     navn, som ellers overstyrer den norske katalogtittelen etter
 *     metadatalasting.
 *   - dataToJsonStat(sdmx, {collapseDims}) skal fjerne kjennetegns-
 *     dimensjoner (MATURITY/COUPON/INSTR — funksjonelt avhengige av ISIN)
 *     fra datasettet og reindeksere den flate value-arrayen tilsvarende.
 *   - formatSecurityLabel skal bygge berikede verdipapiretiketter
 *     («NGB 03/2033 – 3,625 % – forfall 13.03.2033»).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.sources);
const S = app.SdmxToJsonStat;

// ---- Fixturer ----

function dsdJson(names, dims) {
  return {
    data: {
      dataStructures: [{
        id: 'DSD_TEST',
        names: names,
        dataStructureComponents: {
          dimensionList: {
            dimensions: (dims || ['FREQ']).map((id, i) => ({
              id,
              position: i + 1,
              localRepresentation: {
                enumeration: 'urn:sdmx:org.sdmx.infomodel.codelist.Codelist=NB:CL_' + id + '(1.0)'
              }
            })),
            timeDimensions: [{ id: 'TIME_PERIOD', position: 99 }]
          }
        }
      }],
      codelists: (dims || ['FREQ']).map(id => ({
        id: 'CL_' + id, names: { no: id }, codes: [{ id: 'X', names: { no: 'X' } }]
      }))
    }
  };
}

/**
 * Datamelding med seriedims ISIN(2) × MATURITY(2) × COUPON(2) + TIME_PERIOD(3).
 * To serier på «diagonalen» (kjennetegnene følger ISIN): 0:0:0 og 1:1:1.
 * Serie 1 mangler obs-indeks 1 og har OBS_STATUS på obs-indeks 2.
 */
function dataFixture() {
  return {
    data: {
      structure: {
        name: 'Testdatasett',
        dimensions: {
          series: [
            { id: 'ISIN', keyPosition: 0, name: 'ISIN',
              values: [{ id: 'NO1', name: 'NO1' }, { id: 'NO2', name: 'NO2' }] },
            { id: 'MATURITY', keyPosition: 1, name: 'Forfall',
              values: [{ id: '2030-01-01', name: '2030-01-01' }, { id: '2033-03-13', name: '2033-03-13' }] },
            { id: 'COUPON', keyPosition: 2, name: 'Kupong',
              values: [{ id: '1.50000000', name: '1.50000000' }, { id: '3.62500000', name: '3.62500000' }] }
          ],
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: [{ id: '2025-01-01' }, { id: '2025-01-02' }, { id: '2025-01-03' }]
          }]
        },
        attributes: {
          observation: [{ id: 'OBS_STATUS', values: [{ id: 'P', name: 'Foreløpig' }] }]
        }
      },
      dataSets: [{
        series: {
          '0:0:0': { observations: { 0: [1], 1: [2], 2: [3] } },
          '1:1:1': { observations: { 0: [4], 2: [6, 0] } }
        }
      }]
    },
    meta: { prepared: '2026-01-10T00:00:00Z' }
  };
}

// ---- Tittelpreferanse ----

describe('structureToMetadata — tittel: configetikett foran DSD-navn', () => {
  const flowConfig = {
    flow: 'TEST', tableId: 'nb-TEST',
    label: { nb: 'Statspapirer – førstehåndsmarkedet', en: 'Government securities – primary market' }
  };

  it('foretrekker norsk configetikett over engelsk-only DSD-navn (lang=no)', () => {
    const meta = S.structureToMetadata(
      dsdJson({ en: 'Norwegian government securities auctions' }), flowConfig, { lang: 'no' });
    assert.equal(meta.label, 'Statspapirer – førstehåndsmarkedet');
  });

  it('foretrekker engelsk configetikett (lang=en)', () => {
    const meta = S.structureToMetadata(
      dsdJson({ en: 'Norwegian government securities auctions' }), flowConfig, { lang: 'en' });
    assert.equal(meta.label, 'Government securities – primary market');
  });

  it('faller tilbake til DSD-navn uten configetikett, så tableId', () => {
    const meta = S.structureToMetadata(
      dsdJson({ en: 'DSD name only' }), { flow: 'TEST', tableId: 'nb-TEST' }, { lang: 'no' });
    assert.equal(meta.label, 'DSD name only');

    const meta2 = S.structureToMetadata(
      dsdJson(undefined), { flow: 'TEST', tableId: 'nb-TEST' }, { lang: 'no' });
    assert.equal(meta2.label, 'nb-TEST');
  });
});

// ---- dataToJsonStat-kollaps ----

describe('dataToJsonStat — collapseDims', () => {
  it('uten collapseDims: uendret oppførsel (regresjonsvakt)', () => {
    const ds = S.dataToJsonStat(dataFixture(), { lang: 'no' });
    assert.deepEqual(ds.id, ['ISIN', 'MATURITY', 'COUPON', 'TIME_PERIOD']);
    assert.deepEqual(ds.size, [2, 2, 2, 3]);
    // Serie 1:1:1, obs 2 → flat = 1*12 + 1*6 + 1*3 + 2 = 23.
    assert.equal(ds.value[23], 6);
    assert.equal(ds.status['23'], 'P');
    assert.equal(ds.value.length, 24);
  });

  it('fjerner kollapsede dims fra id/size/dimension og reindekserer value', () => {
    const ds = S.dataToJsonStat(dataFixture(), { lang: 'no', collapseDims: ['MATURITY', 'COUPON'] });
    assert.deepEqual(ds.id, ['ISIN', 'TIME_PERIOD']);
    assert.deepEqual(ds.size, [2, 3]);
    assert.equal(ds.dimension.MATURITY, undefined);
    assert.equal(ds.dimension.COUPON, undefined);
    assert.ok(ds.dimension.ISIN && ds.dimension.TIME_PERIOD);
    // Serie 0:0:0 → rad 0; serie 1:1:1 → rad 1 (kun ISIN-indeksen teller).
    assert.deepEqual(ds.value, [1, 2, 3, 4, null, 6]);
  });

  it('remapper status-indekser til den kollapsede flate arrayen', () => {
    const ds = S.dataToJsonStat(dataFixture(), { lang: 'no', collapseDims: ['MATURITY', 'COUPON'] });
    // Serie 1:1:1, obs 2 → flat = 1*3 + 2 = 5.
    assert.deepEqual(ds.status, { 5: 'P' });
  });

  it('tom melding med collapseDims gir gyldig tomt datasett uten kollapsede dims', () => {
    const fx = dataFixture();
    fx.data.dataSets[0].series = {};
    const ds = S.dataToJsonStat(fx, { lang: 'no', collapseDims: ['MATURITY', 'COUPON'] });
    assert.deepEqual(ds.id, ['ISIN', 'TIME_PERIOD']);
    assert.deepEqual(ds.value, []);
    assert.equal(ds.dimension.MATURITY, undefined);
  });

  it('tetthetsvakten regnes på kollapset størrelse', () => {
    // Ukollapset kryssprodukt 40×40×40×40000 = 2,56 mrd > vakten (20 mill);
    // kollapset 40×40000 = 1,6 mill — skal IKKE kaste når kjennetegnene
    // kollapses.
    const n = 40;
    const mkVals = p => Array.from({ length: n }, (_, i) => ({ id: p + i }));
    const fx = {
      data: {
        structure: {
          dimensions: {
            series: [
              { id: 'ISIN', keyPosition: 0, values: mkVals('NO') },
              { id: 'MATURITY', keyPosition: 1, values: mkVals('D') },
              { id: 'COUPON', keyPosition: 2, values: mkVals('C') }
            ],
            observation: [{ id: 'TIME_PERIOD', values: Array.from({ length: 40000 }, (_, i) => ({ id: 'T' + i })) }]
          }
        },
        dataSets: [{ series: { '0:0:0': { observations: { 0: [1] } } } }]
      }
    };
    assert.throws(() => S.dataToJsonStat(fx, {}), /celler/);
    const ds = S.dataToJsonStat(fx, { collapseDims: ['MATURITY', 'COUPON'] });
    assert.deepEqual(ds.size, [40, 40000]);
    assert.equal(ds.value[0], 1);
  });
});

// ---- formatSecurityLabel ----

describe('formatSecurityLabel', () => {
  it('bygger full norsk etikett med kupong og forfall', () => {
    assert.equal(
      S.formatSecurityLabel({ name: 'NGB 03/2033', maturity: '2033-03-13', coupon: '3.62500000' }, 'no'),
      'NGB 03/2033 – 3,625 % – forfall 13.03.2033');
  });

  it('bygger engelsk variant', () => {
    assert.equal(
      S.formatSecurityLabel({ name: 'NGB 03/2033', maturity: '2033-03-13', coupon: '3.62500000' }, 'en'),
      'NGB 03/2033 – 3.625% – maturity 13.03.2033');
  });

  it('nullkupong vises som 0 %', () => {
    assert.equal(
      S.formatSecurityLabel({ name: 'NTB 09/2026', maturity: '2026-09-16', coupon: '0.00000000' }, 'no'),
      'NTB 09/2026 – 0 % – forfall 16.09.2026');
  });

  it('utelater manglende deler', () => {
    assert.equal(S.formatSecurityLabel({ name: 'F-loan', maturity: '2026-01-05' }, 'no'),
      'F-loan – forfall 05.01.2026');
    assert.equal(S.formatSecurityLabel({ name: 'F-loan' }, 'no'), 'F-loan');
  });

  it('faller tilbake til fallback (ISIN-koden) uten navn', () => {
    assert.equal(S.formatSecurityLabel({ fallback: 'NO0010732555' }, 'no'), 'NO0010732555');
  });

  it('ugyldig dato/kupong brukes rått i stedet for å knekke', () => {
    assert.equal(S.formatSecurityLabel({ name: 'X', maturity: '2033/03' }, 'no'),
      'X – forfall 2033/03');
    assert.equal(S.formatSecurityLabel({ name: 'X', coupon: 'abc' }, 'no'), 'X – abc');
  });
});
