/**
 * sdmx-to-jsonstat.js — kuratert dimensjonsrekkefølge (`dimOrder`):
 *   - DSD-rekkefølgen er ikke alltid den mest lesbare. GOVT_SECONDARY_MARKET
 *     har FREQ.ISIN.INSTRUMENT_TYPE…, altså den lange lista med enkeltlån FØR
 *     den grove papirtypen som avgrenser den. `dimOrder` på en config-rad lar
 *     en tabell sette rekkefølgen kortene vises i.
 *   - Rekkefølgen påvirker BARE presentasjonen: SDMX-nøkkelen har ett segment
 *     per DSD-dimensjon i DSD-rekkefølge, så structureToMetadata må feste den
 *     opprinnelige rekkefølgen i extension.fullDimId (buildKeyAndParams leser
 *     den) — ellers bygges API-URL-en med segmentene i feil rekkefølge.
 *   - dataToJsonStat må flytte verdiene tilsvarende: id/size permuteres, og
 *     hver serie må havne i riktig celle i den flate value-arrayen.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.sources);
const S = app.SdmxToJsonStat;

// ---- Fixturer ----

// DSD-rekkefølge: FREQ.ISIN.INSTRUMENT_TYPE (som GOVT_SECONDARY_MARKET).
const DIMS = ['FREQ', 'ISIN', 'INSTRUMENT_TYPE'];
const CODES = {
  FREQ: ['M'],
  ISIN: ['NO1', 'NO2'],
  INSTRUMENT_TYPE: ['GBON', 'TBIL']
};

function dsdJson() {
  return {
    data: {
      dataStructures: [{
        id: 'DSD_TEST',
        names: { no: 'Teststruktur' },
        dataStructureComponents: {
          dimensionList: {
            dimensions: DIMS.map((id, i) => ({
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
      codelists: DIMS.map(id => ({
        id: 'CL_' + id,
        names: { no: 'Kodeliste ' + id },
        codes: CODES[id].map(c => ({ id: c, names: { no: c } }))
      }))
    }
  };
}

/**
 * Datamelding i DSD-rekkefølge FREQ(1) × ISIN(2) × INSTRUMENT_TYPE(2) × TID(2).
 * To serier: obligasjonen (NO1/GBON) og vekselen (NO2/TBIL).
 */
function dataJson() {
  return {
    data: {
      structure: {
        dimensions: {
          series: DIMS.map((id, i) => ({
            id, keyPosition: i, name: id,
            values: CODES[id].map(c => ({ id: c, name: c }))
          })),
          observation: [{
            id: 'TIME_PERIOD', name: 'Tidsperiode',
            values: [{ id: '2026-01', name: '2026-01' }, { id: '2026-02', name: '2026-02' }]
          }]
        }
      },
      dataSets: [{
        series: {
          '0:0:0': { observations: { 0: [10], 1: [11] } }, // M / NO1 / GBON
          '0:1:1': { observations: { 0: [20], 1: [21] } }  // M / NO2 / TBIL
        }
      }]
    }
  };
}

const ORDER = ['FREQ', 'INSTRUMENT_TYPE', 'ISIN'];

describe('structureToMetadata — dimOrder', () => {
  it('permuterer id/size/heading og holder tidsdimensjonen sist', () => {
    const meta = S.structureToMetadata(dsdJson(), { tableId: 'nb-TEST' },
      { lang: 'no', dimOrder: ORDER });
    assert.deepEqual(meta.id, ['FREQ', 'INSTRUMENT_TYPE', 'ISIN', 'TIME_PERIOD']);
    // size må følge med på flyttingen: ISIN(2) og INSTRUMENT_TYPE(2) er like
    // store her, så sjekk mot dimensjonene i stedet for tallene alene.
    meta.id.forEach((d, i) => {
      if (d === 'TIME_PERIOD') return;
      assert.equal(meta.size[i], Object.keys(meta.dimension[d].category.index).length,
        'size stemmer ikke for ' + d);
    });
    assert.deepEqual(meta.extension.px.heading, ['FREQ', 'INSTRUMENT_TYPE', 'ISIN']);
  });

  it('fester DSD-rekkefølgen i fullDimId så API-nøkkelen ikke flytter seg', () => {
    const meta = S.structureToMetadata(dsdJson(), { tableId: 'nb-TEST' },
      { lang: 'no', dimOrder: ORDER });
    assert.deepEqual(meta.extension.fullDimId,
      ['FREQ', 'ISIN', 'INSTRUMENT_TYPE', 'TIME_PERIOD']);
  });

  it('lar dimensjoner som ikke er nevnt beholde DSD-rekkefølgen bakerst', () => {
    const meta = S.structureToMetadata(dsdJson(), { tableId: 'nb-TEST' },
      { lang: 'no', dimOrder: ['INSTRUMENT_TYPE'] });
    assert.deepEqual(meta.id, ['INSTRUMENT_TYPE', 'FREQ', 'ISIN', 'TIME_PERIOD']);
  });

  it('uten dimOrder er alt som før (regresjon)', () => {
    const meta = S.structureToMetadata(dsdJson(), { tableId: 'nb-TEST' }, { lang: 'no' });
    assert.deepEqual(meta.id, ['FREQ', 'ISIN', 'INSTRUMENT_TYPE', 'TIME_PERIOD']);
    assert.equal(meta.extension.fullDimId, undefined);
  });
});

describe('dataToJsonStat — dimOrder', () => {
  it('permuterer id/size og flytter verdiene til riktige celler', () => {
    const ds = S.dataToJsonStat(dataJson(), { lang: 'no', dimOrder: ORDER });
    assert.deepEqual(ds.id, ['FREQ', 'INSTRUMENT_TYPE', 'ISIN', 'TIME_PERIOD']);
    assert.deepEqual(ds.size, [1, 2, 2, 2]);
    // Rekkefølge nå: FREQ(1) × TYPE(GBON,TBIL) × ISIN(NO1,NO2) × TID(2).
    // GBON/NO1 = 10,11 ; GBON/NO2 = tomt ; TBIL/NO1 = tomt ; TBIL/NO2 = 20,21.
    assert.deepEqual(ds.value, [10, 11, null, null, null, null, 20, 21]);
  });

  it('uten dimOrder er verdiene lagt ut i DSD-rekkefølge (regresjon)', () => {
    const ds = S.dataToJsonStat(dataJson(), { lang: 'no' });
    assert.deepEqual(ds.id, ['FREQ', 'ISIN', 'INSTRUMENT_TYPE', 'TIME_PERIOD']);
    // FREQ(1) × ISIN(NO1,NO2) × TYPE(GBON,TBIL) × TID(2):
    // NO1/GBON = 10,11 ; NO1/TBIL = tomt ; NO2/GBON = tomt ; NO2/TBIL = 20,21.
    assert.deepEqual(ds.value, [10, 11, null, null, null, null, 20, 21]);
  });

  it('holder samme celleinnhold uansett rekkefølge (samme serie, samme tall)', () => {
    const plain = S.dataToJsonStat(dataJson(), { lang: 'no' });
    const ordered = S.dataToJsonStat(dataJson(), { lang: 'no', dimOrder: ORDER });
    // Slå opp obligasjonen i begge og sammenlign — indeksene ligger ulikt.
    const at = (ds, sel) => {
      const strides = ds.size.map((_, i) =>
        ds.size.slice(i + 1).reduce((a, b) => a * b, 1));
      let flat = 0;
      ds.id.forEach((d, i) => { flat += ds.dimension[d].category.index[sel[d]] * strides[i]; });
      return ds.value[flat];
    };
    const sel = { FREQ: 'M', ISIN: 'NO1', INSTRUMENT_TYPE: 'GBON', TIME_PERIOD: '2026-02' };
    assert.equal(at(plain, sel), 11);
    assert.equal(at(ordered, sel), 11);
  });
});
