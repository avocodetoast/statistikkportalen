/**
 * table-display.js — flat-indeks-precompute (ytelse for store tabeller)
 *
 * buildHtmlTable regnet tidligere ut cellens flate indeks per celle: to fulle
 * `data.id.forEach` med `indexOf`-oppslag + positionell vekting. Den er
 * separerbar: flatIndex = rowOffset(rowHeader) + colOffset(colHeader), der hver
 * del er konstant per rad/kolonne. `computeFlatIndexOffsets` forhåndsberegner
 * begge én gang.
 *
 * Kontrakt: for enhver (rad, kolonne) må rowOffsets[r] + colOffsets[c] gi
 * NØYAKTIG samme flate indeks som den gamle per-celle-stien — ellers ville
 * celler vist feil tall. `legacyFlatIndex` nedenfor reimplementerer den gamle
 * stien uavhengig (deler ikke kode med implementasjonen) og er fasit her.
 *
 * table-display.js er en view-modul, men helperen er ren (rører ikke DOM ved
 * kall), så den laster trygt i harnessen.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/table-display.js'
]);

/** Bygg en JSON-Stat2-lignende fikstur der value[i] === i, så et celleoppslag
 *  returnerer sin egen flate indeks — enkelt å verifisere mot fasit. */
function makeData(dimSpecs) {
  const id = dimSpecs.map(d => d.name);
  const size = dimSpecs.map(d => d.codes.length);
  const total = size.reduce((a, b) => a * b, 1);
  const dimension = {};
  dimSpecs.forEach(d => {
    const index = {};
    const label = {};
    d.codes.forEach((c, i) => { index[c] = i; label[c] = c.toUpperCase(); });
    dimension[d.name] = { label: d.name, category: { index, label } };
  });
  return { id, size, value: Array.from({ length: total }, (_, i) => i), dimension, role: {} };
}

/**
 * Uavhengig fasit: den tidligere per-celle-stien, reimplementert i testen slik at
 * oraklet ikke deler kode med implementasjonen det verifiserer. Bygger fullIndices
 * i data.id-rekkefølge (row/col → riktig header) og regner flat indeks med
 * radix-mixed positionell vekting (siste dimensjon endres raskest).
 */
function legacyFlatIndex(data, layout, rowHeader, colHeader) {
  const fullIndices = data.id.map(dimCode => {
    const rowIndex = layout.rows.indexOf(dimCode);
    const colIndex = layout.columns.indexOf(dimCode);
    if (rowIndex !== -1) return rowHeader.indices[rowIndex];
    if (colIndex !== -1) return colHeader.indices[colIndex];
    return 0;
  });
  let flat = 0;
  let multiplier = 1;
  for (let i = data.size.length - 1; i >= 0; i--) {
    flat += fullIndices[i] * multiplier;
    multiplier *= data.size[i];
  }
  return flat;
}

function assertParity(data, layout) {
  const rowHeaders = app.buildDimensionCombinations(layout.rows, data);
  const colHeaders = app.buildDimensionCombinations(layout.columns, data);
  const { rowOffsets, colOffsets } = app.computeFlatIndexOffsets(data, layout, rowHeaders, colHeaders);

  assert.equal(rowOffsets.length, rowHeaders.length, 'ett rowOffset per rad');
  assert.equal(colOffsets.length, colHeaders.length, 'ett colOffset per kolonne');

  rowHeaders.forEach((rh, r) => {
    colHeaders.forEach((ch, c) => {
      const expected = legacyFlatIndex(data, layout, rh, ch);
      const actual = rowOffsets[r] + colOffsets[c];
      assert.equal(actual, expected,
        `flatIndex for rad ${r} kol ${c}: fikk ${actual}, forventet ${expected}`);
      // value[i] === i, så oppslaget skal returnere selve indeksen.
      assert.equal(data.value[actual], expected);
    });
  });
}

describe('computeFlatIndexOffsets — paritet med calculateFlatIndex', () => {
  it('3 dimensjoner fordelt på både rader og kolonner', () => {
    const data = makeData([
      { name: 'A', codes: ['a0', 'a1'] },
      { name: 'B', codes: ['b0', 'b1', 'b2'] },
      { name: 'C', codes: ['c0', 'c1'] }
    ]);
    assertParity(data, { rows: ['A', 'C'], columns: ['B'] });
  });

  it('rekkefølge i layout ≠ rekkefølge i data.id', () => {
    const data = makeData([
      { name: 'A', codes: ['a0', 'a1'] },
      { name: 'B', codes: ['b0', 'b1', 'b2'] },
      { name: 'C', codes: ['c0', 'c1', 'c2', 'c3'] }
    ]);
    // C før A i radene, B alene i kolonnene — bryter data.id-rekkefølgen.
    assertParity(data, { rows: ['C', 'A'], columns: ['B'] });
  });

  it('alle dimensjoner i radene (ingen kolonnedimensjoner)', () => {
    const data = makeData([
      { name: 'A', codes: ['a0', 'a1', 'a2'] },
      { name: 'B', codes: ['b0', 'b1'] }
    ]);
    assertParity(data, { rows: ['A', 'B'], columns: [] });
  });

  it('én dimensjon på hver akse', () => {
    const data = makeData([
      { name: 'A', codes: ['a0', 'a1', 'a2'] },
      { name: 'B', codes: ['b0', 'b1', 'b2', 'b3'] }
    ]);
    assertParity(data, { rows: ['A'], columns: ['B'] });
  });
});
