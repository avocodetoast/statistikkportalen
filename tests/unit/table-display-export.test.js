'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const DATA = {
  id: ['Region', 'Metric', 'Time'],
  size: [2, 2, 2],
  role: { metric: ['Metric'], time: ['Time'] },
  value: [1.25, 2, null, 4, 5, 6.5, 7, 8],
  status: { '2': '..', '5': ':' },
  extension: { px: { decimals: 1 } },
  dimension: {
    Region: {
      label: 'Region',
      category: {
        index: { north: 0, south: 1 },
        label: { north: 'Nord;området', south: 'Sør "sentrum"' }
      }
    },
    Metric: {
      label: 'Mål',
      category: {
        index: { people: 0, rate: 1 },
        label: { people: 'Personer', rate: 'Rate' },
        unit: { people: { decimals: 0 }, rate: { decimals: 2 } }
      }
    },
    Time: {
      label: 'Tid',
      category: {
        index: { y2024: 0, y2025: 1 },
        label: { y2024: '2024', y2025: '2025' }
      }
    }
  }
};

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/table-display.js'
]);

// The module intentionally keeps currentData lexical/private. Seed that real
// script binding in the same VM context used by loadApp, without an app hook.
app.__tableDisplayFixture = DATA;
vm.runInThisContext(
  "currentData = globalThis.__tableDisplayFixture; " +
  "AppState.tableLayout = { rows: ['Region'], columns: ['Metric', 'Time'] };"
);
delete app.__tableDisplayFixture;

describe('table-display flat value/status lookup', () => {
  it('reads exact JSON-Stat2 values at precomputed flat indices', () => {
    assert.equal(app.valueAtFlatIndex(0), 1.25);
    assert.equal(app.valueAtFlatIndex(5), 6.5);
    assert.equal(app.valueAtFlatIndex(7), 8);
  });

  it('distinguishes suppressed, missing, and ordinary cells', () => {
    assert.equal(app.valueAtFlatIndex(2), null);
    assert.equal(app.statusAtFlatIndex(2), '..');
    assert.equal(app.statusAtFlatIndex(5), ':');
    assert.equal(app.statusAtFlatIndex(4), null);
  });
});

describe('buildCsvContent', () => {
  it('pivots all three dimensions with exact values, statuses, and escaping', () => {
    assert.equal(app.buildCsvContent(), [
      ';Personer;Personer;Rate;Rate',
      'Region;2024;2025;2024;2025',
      '"Nord;området";1,25;2;..;4',
      '"Sør ""sentrum""";5;:;7;8'
    ].join('\r\n'));
  });
});

describe('buildHtmlTable', () => {
  it('uses correct flat-index values and renders statuses instead of missing values', () => {
    const html = app.buildHtmlTable();
    assert.match(html, /<th colspan="2" class="col-header">Personer<\/th>/);
    assert.match(html, /<th colspan="2" class="col-header">Rate<\/th>/);
    assert.match(html, /<td class="data-cell">1<\/td><td class="data-cell">2<\/td>/);
    assert.match(html, /class="data-cell suppressed-value"[^>]*>\.\.<\/td>/);
    assert.match(html, /class="data-cell suppressed-value"[^>]*>:<\/td>/);
    assert.match(html, /<td class="data-cell">7,00<\/td><td class="data-cell">8,00<\/td>/);
    assert.match(html, /title="Sør &quot;sentrum&quot;"/);
  });
});
