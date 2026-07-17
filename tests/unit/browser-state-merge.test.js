/**
 * browser-state.js — mergeSourceTables: ren hjelper som erstatter én kildes
 * tabeller i den aggregerte listen (grunnlaget for per-kilde retry/refresh
 * uten full reinit). Kilde-eierskap avgjøres av injisert sourceForFn
 * (fasadens api.sourceFor i produksjon).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/subjects.js',
  'js/menu-hierarchy.js',
  'js/synonyms.js',
  'js/search-enhanced.js',
  'js/browser-state.js'
]);

// Speiler fasadens id-prefiks-ruting (nb-*/fhi-* → kilden, ellers ssb)
const sourceForFn = (id) =>
  String(id).startsWith('nb-') ? 'nb' :
  String(id).startsWith('fhi-') ? 'fhi' : 'ssb';

const T = (id) => ({ id: id, label: 'Tabell ' + id });

describe('BrowserState.mergeSourceTables', () => {
  const all = [T('nb-EXR'), T('13760'), T('fhi-daar-301'), T('nb-IR'), T('07459')];

  it('erstatter kun den navngitte kildens tabeller', () => {
    const merged = app.BrowserState.mergeSourceTables(all, 'nb', [T('nb-NY')], sourceForFn);
    assert.deepEqual(merged.map(t => t.id), ['13760', 'fhi-daar-301', '07459', 'nb-NY']);
  });

  it('bevarer de øvrige kildenes rekkefølge', () => {
    const merged = app.BrowserState.mergeSourceTables(all, 'ssb', [T('11342')], sourceForFn);
    assert.deepEqual(merged.map(t => t.id), ['nb-EXR', 'fhi-daar-301', 'nb-IR', '11342']);
  });

  it('tomme newTables fjerner kildens tabeller', () => {
    const merged = app.BrowserState.mergeSourceTables(all, 'fhi', [], sourceForFn);
    assert.deepEqual(merged.map(t => t.id), ['nb-EXR', '13760', 'nb-IR', '07459']);
  });

  it('muterer ikke input-arrayen', () => {
    const before = all.map(t => t.id);
    app.BrowserState.mergeSourceTables(all, 'nb', [T('nb-NY')], sourceForFn);
    assert.deepEqual(all.map(t => t.id), before);
  });
});
