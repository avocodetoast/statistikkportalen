/**
 * variable-select-events.js — shouldSelectAllAsStar (Ctrl+A-terskel)
 *
 * Ctrl+A merket tidligere hver enkelt verdi. På enorme dimensjoner (SSB 08801,
 * ~13000 varenr) materialiserte det 13000 .selected-noder + 13000 eksplisitte
 * koder gjennom URL/API-forhåndsvisning og hang nettleseren. Over en terskel
 * skal Ctrl+A i stedet bytte til stjernemodus ('*'), som «Velg alle»-knappen —
 * O(1) og kompakt API-forespørsel.
 *
 * Predikatet er rent (ingen DOM), så det testes direkte. Selve event-wiringen
 * (view-modul) er unntatt test-først per CLAUDE.md.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/variable-select-state.js',
  'js/variable-select-render.js',
  'js/variable-select-events.js'
]);

describe('shouldSelectAllAsStar', () => {
  const T = 500;

  it('stjerne når lista er over terskel og uten aktivt filter', () => {
    assert.equal(app.shouldSelectAllAsStar(13000, false, T), true);
    assert.equal(app.shouldSelectAllAsStar(501, false, T), true);
  });

  it('eksplisitt (false) på eller under terskel uten filter', () => {
    assert.equal(app.shouldSelectAllAsStar(500, false, T), false);
    assert.equal(app.shouldSelectAllAsStar(50, false, T), false);
    assert.equal(app.shouldSelectAllAsStar(0, false, T), false);
  });

  it('alltid eksplisitt (false) når et tekstfilter er aktivt, uansett størrelse', () => {
    assert.equal(app.shouldSelectAllAsStar(13000, true, T), false);
    assert.equal(app.shouldSelectAllAsStar(501, true, T), false);
  });
});
