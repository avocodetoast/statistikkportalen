/**
 * browser-state.js — BrowserState.applyIndex(): tar i bruk resultatet av
 * CatalogIndex.checkForUpdate() («Se etter ny indeks») ved å gjenbruke
 * applySourceTables() per endret kilde. Kontrakten som testes:
 *   - kun kildene i `changed` merges inn; uendrede kilder er urørt
 *   - _searchIndex nullstilles (ellers serverer enhanced-søket døde
 *     tabellobjekter, jf. applySourceTables sin egen header-kommentar)
 *   - emnehierarkiet bygges på nytt (den nye tabellen må faktisk finnes i
 *     det ferske hierarkiet, ikke bare i allTables)
 *   - changed: [] er et rent no-op
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
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

const { BrowserState } = app;

/** Katalograd i den formen decode()/adapterne leverer. */
function row(id, subject) {
  return {
    id: id,
    label: 'Tabell ' + id,
    updated: '2026-01-01',
    firstPeriod: '2000',
    lastPeriod: '2026',
    subjectCode: subject,
    sortCode: '0000001',
    timeUnit: 'Annual',
    discontinued: false,
    variableNames: [],
    paths: [[{ id: subject, label: 'Emne ' + subject, sortCode: '0000001' }]],
    description: ''
  };
}

beforeEach(() => {
  BrowserState.reset();
  BrowserState.allTables = [row('13760', 'al'), row('nb-IR', 'os'), row('fhi-daar-301', 'he')];
  BrowserState.isLoaded = true;
  BrowserState._searchIndex = ['stale-entry']; // simulerer en tidligere bygget søkeindeks
  // Speiler fasadens id-prefiks-ruting (nb-*/fhi-* → kilden, ellers ssb) —
  // samme mønster som browser-state-merge.test.js.
  app.api = {
    sourceFor: (id) =>
      String(id).startsWith('nb-') ? 'nb' :
      String(id).startsWith('fhi-') ? 'fhi' : 'ssb'
  };
});

describe('BrowserState.applyIndex', () => {
  it('merger kun inn de endrede kildene, og lar de andre stå urørt', () => {
    const result = BrowserState.applyIndex({
      changed: ['nb'],
      bySource: {
        nb: [row('nb-EXR', 'os')],
        // ssb er IKKE i `changed` — skal ignoreres selv om bySource har den
        ssb: [row('SKAL-IKKE-BRUKES', 'be')]
      }
    });

    assert.deepEqual(result, ['nb']);
    assert.deepEqual(
      BrowserState.allTables.map(t => t.id).sort(),
      ['13760', 'fhi-daar-301', 'nb-EXR'].sort()
    );
  });

  it('nullstiller _searchIndex', () => {
    assert.notEqual(BrowserState._searchIndex, null);
    BrowserState.applyIndex({ changed: ['nb'], bySource: { nb: [row('nb-EXR', 'os')] } });
    assert.equal(BrowserState._searchIndex, null);
  });

  it('bygger emnehierarkiet på nytt — den nye tabellen finnes i det ferske treet', () => {
    BrowserState.applyIndex({ changed: ['fhi'], bySource: { fhi: [row('fhi-ny', 'he')] } });

    assert.ok(BrowserState.menuHierarchy, 'skal ha bygget et hierarki');
    const heTables = BrowserState.menuHierarchy.hierarchy.he.tables.map(t => t.id);
    assert.ok(heTables.includes('fhi-ny'), 'den nye tabellen skal finnes i hierarkiet');
    assert.ok(!heTables.includes('fhi-daar-301'), 'den erstattede FHI-tabellen skal være borte');
  });

  it('changed: [] rører verken allTables eller søkeindeksen', () => {
    const before = BrowserState.allTables.slice();
    const result = BrowserState.applyIndex({ changed: [], bySource: {} });

    assert.deepEqual(result, []);
    assert.deepEqual(BrowserState.allTables, before);
    assert.deepEqual(BrowserState._searchIndex, ['stale-entry']);
  });

  it('flere endrede kilder i samme kall merges alle inn', () => {
    const result = BrowserState.applyIndex({
      changed: ['nb', 'fhi'],
      bySource: {
        nb: [row('nb-EXR', 'os')],
        fhi: [row('fhi-ny', 'he')]
      }
    });

    assert.deepEqual(result.sort(), ['fhi', 'nb']);
    assert.deepEqual(
      BrowserState.allTables.map(t => t.id).sort(),
      ['13760', 'fhi-ny', 'nb-EXR'].sort()
    );
  });
});
