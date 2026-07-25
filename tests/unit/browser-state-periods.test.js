/**
 * browser-state.js — syncTablePeriodsFromMetadata: frisker opp én tabells
 * first/lastPeriod i den aggregerte katalogen når tabellen åpnes.
 *
 * Bakgrunn: FHI har ingen bulk-vei til første/siste observasjon (ett
 * /dimension-kall per tabell), så periodene bygges ved byggetid og kan være
 * noen uker gamle. Adapteren leverer ferske perioder som
 * metadata.extension.periods når tabellen åpnes.
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

const BrowserState = app.BrowserState;

const meta = (first, last) => ({ extension: { periods: { first: first, last: last } } });

describe('BrowserState.syncTablePeriodsFromMetadata', () => {
  beforeEach(() => {
    BrowserState.allTables = [
      { id: 'fhi-daar-268', label: 'Dødsfall', firstPeriod: '1986', lastPeriod: '2024' },
      { id: '13760', label: 'SSB-tabell', firstPeriod: '2000', lastPeriod: '2025' }
    ];
  });

  it('oppdaterer perioden når API-et har ferskere data', () => {
    const changed = BrowserState.syncTablePeriodsFromMetadata('fhi-daar-268', meta('1986', '2025*'));
    assert.equal(changed, true);
    const t = BrowserState.allTables.find(x => x.id === 'fhi-daar-268');
    assert.equal(t.lastPeriod, '2025*');
    assert.equal(t.firstPeriod, '1986');
  });

  it('rapporterer ingen endring når periodene alt er like', () => {
    assert.equal(
      BrowserState.syncTablePeriodsFromMetadata('fhi-daar-268', meta('1986', '2024')),
      false
    );
  });

  it('rører ikke andre tabeller', () => {
    BrowserState.syncTablePeriodsFromMetadata('fhi-daar-268', meta('1990', '2026'));
    const ssb = BrowserState.allTables.find(x => x.id === '13760');
    assert.equal(ssb.firstPeriod, '2000');
    assert.equal(ssb.lastPeriod, '2025');
  });

  it('er en no-op for metadata uten extension.periods (SSB/NB)', () => {
    assert.equal(BrowserState.syncTablePeriodsFromMetadata('13760', { extension: {} }), false);
    assert.equal(BrowserState.syncTablePeriodsFromMetadata('13760', {}), false);
    assert.equal(BrowserState.syncTablePeriodsFromMetadata('13760', null), false);
    const ssb = BrowserState.allTables.find(x => x.id === '13760');
    assert.equal(ssb.lastPeriod, '2025');
  });

  it('er en no-op for en ukjent tabell-id', () => {
    assert.equal(
      BrowserState.syncTablePeriodsFromMetadata('fhi-mfr-999', meta('1967', '2025')),
      false
    );
  });

  it('overskriver ikke med tomme verdier', () => {
    assert.equal(
      BrowserState.syncTablePeriodsFromMetadata('fhi-daar-268', meta('', '')),
      false
    );
    const t = BrowserState.allTables.find(x => x.id === 'fhi-daar-268');
    assert.equal(t.firstPeriod, '1986');
    assert.equal(t.lastPeriod, '2024');
  });

  it('fyller inn en periode som manglet helt i katalogen', () => {
    BrowserState.allTables = [{ id: 'fhi-ngs-914', label: 'Influensa', firstPeriod: '', lastPeriod: '' }];
    assert.equal(
      BrowserState.syncTablePeriodsFromMetadata('fhi-ngs-914', meta('2025 aug', '2026 mai')),
      true
    );
    assert.equal(BrowserState.allTables[0].firstPeriod, '2025 aug');
    assert.equal(BrowserState.allTables[0].lastPeriod, '2026 mai');
  });
});
