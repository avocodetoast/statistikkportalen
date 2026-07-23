/**
 * Forsidens «Nylig oppdaterte tabeller»: filtrering av høyfrekvente tabeller
 * (AppConfig.ui.recentUpdates) i _collectRecentUpdateGroups.
 *
 * Pre-fetch-grenen (recentTables gitt) trenger ingen MenuHierarchy, så
 * front-page.js kan lastes uten DOM-avhengighetene rundt renderFrontPage().
 */
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.browse,
  'js/browser-state.js',
  'js/front-page.js'
]);

const { AppConfig } = app;
const defaultRecentUpdates = AppConfig.ui.recentUpdates;

function table(id, timeUnit, pathIds) {
  const ids = pathIds || ['be', 'be01'];
  return {
    id,
    label: 'Tabell ' + id,
    timeUnit,
    updated: new Date().toISOString(),
    discontinued: false,
    paths: [[
      { id: ids[0], label: 'Befolkning' },
      { id: ids[1], label: 'Folketall' }
    ]]
  };
}

function todayBucket(tables) {
  const buckets = app._collectRecentUpdateGroups(null, tables);
  return buckets.find(b => b.key === 'today');
}

function tableIds(bucket) {
  return bucket.groups.flatMap(g => g.tables.map(t => t.id));
}

afterEach(() => {
  AppConfig.ui.recentUpdates = defaultRecentUpdates;
});

describe('_collectRecentUpdateGroups — høyfrekvente tabeller', () => {
  it('utelater Business-tabeller med standardinnstillingen', () => {
    const bucket = todayBucket([table('nb-exr', 'Business'), table('13760', 'Monthly')]);
    assert.deepEqual(tableIds(bucket), ['13760']);
  });

  it('beholder vanlige frekvenser (ingen regresjon)', () => {
    const bucket = todayBucket([
      table('13760', 'Monthly'),
      table('07459', 'Annual'),
      table('09190', 'Quarterly'),
      table('12791', 'Other')
    ]);
    assert.deepEqual(tableIds(bucket).sort(), ['07459', '09190', '12791', '13760']);
  });

  it('tar med Business-tabeller når showHighFrequency er true', () => {
    AppConfig.ui.recentUpdates = {
      showHighFrequency: true,
      highFrequencyTimeUnits: ['Business', 'Daily']
    };
    const bucket = todayBucket([table('nb-exr', 'Business'), table('13760', 'Monthly')]);
    assert.deepEqual(tableIds(bucket).sort(), ['13760', 'nb-exr']);
  });

  it('fjerner grupper som bare inneholder høyfrekvente tabeller, og teller riktig', () => {
    const bucket = todayBucket([
      table('nb-exr', 'Business', ['bf03', 'renter']),
      table('nb-irs', 'Business', ['bf03', 'renter']),
      table('13760', 'Monthly')
    ]);
    assert.equal(bucket.groups.length, 1);
    assert.equal(bucket.totalCount, 1);
    assert.equal(bucket.groups[0].tables.length, 1);
  });
});

describe('_isHighFrequencyTable', () => {
  it('flagger timeUnit-verdiene i highFrequencyTimeUnits', () => {
    assert.equal(app._isHighFrequencyTable({ timeUnit: 'Business' }), true);
    assert.equal(app._isHighFrequencyTable({ timeUnit: 'Daily' }), true);
    assert.equal(app._isHighFrequencyTable({ timeUnit: 'Monthly' }), false);
    assert.equal(app._isHighFrequencyTable({ timeUnit: null }), false);
  });

  it('degraderer til false når config-nøkkelen mangler', () => {
    AppConfig.ui.recentUpdates = undefined;
    assert.equal(app._isHighFrequencyTable({ timeUnit: 'Business' }), false);
  });
});
