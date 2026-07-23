/**
 * browser-state.js — renderTableListHTML, the single table-list renderer shared
 * by the search view, the topic view and the front page's "recently updated"
 * section. Pure string building (escapeHtml + AppConfig only), no DOM.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.browse,
  'js/browser-state.js'
]);

const { BrowserState, displayTableId } = app;

const table = (over) => Object.assign({
  id: '07459',
  label: 'Befolkning',
  firstPeriod: '2010',
  lastPeriod: '2025',
  updated: '2025-01-15T08:00:00Z'
}, over);

describe('displayTableId', () => {
  it('strips the nb-/fhi- source prefix', () => {
    assert.equal(displayTableId('nb-EXR'), 'EXR');
    assert.equal(displayTableId('fhi-mfr-1234'), 'mfr-1234');
  });

  it('leaves SSB ids untouched', () => {
    assert.equal(displayTableId('07459'), '07459');
  });

  it('degrades to an empty string for a missing id', () => {
    assert.equal(displayTableId(null), '');
    assert.equal(displayTableId(undefined), '');
  });
});

describe('BrowserState.renderTableListHTML', () => {
  it('labels the id column "Tabell" — foreign-source ids are not numbers', () => {
    const html = BrowserState.renderTableListHTML([table()]);
    assert.match(html, /<th>Tabell<\/th>/);
    assert.doesNotMatch(html, /Tabellnr/);
  });

  it('adds no source badge for SSB tables', () => {
    const html = BrowserState.renderTableListHTML([table()]);
    assert.doesNotMatch(html, /source-badge/);
  });

  it('badges Norges Bank and FHI tables after the title link', () => {
    const html = BrowserState.renderTableListHTML([
      table({ id: 'nb-EXR', label: 'Valutakurser' }),
      table({ id: 'fhi-mfr-1', label: 'Fødte' })
    ]);
    assert.match(html, /source-badge--nb/);
    assert.match(html, /source-badge--fhi/);
    // Badge sits after the link, inside the title cell
    assert.ok(html.indexOf('Valutakurser</a>') < html.indexOf('source-badge--nb'));
  });

  it('shows foreign ids without their source prefix (the badge carries that now)', () => {
    const html = BrowserState.renderTableListHTML([
      table({ id: 'fhi-mfr-1234', label: 'Fødte' })
    ]);
    assert.match(html, />mfr-1234</);
    assert.doesNotMatch(html, />fhi-mfr-1234</);
    // The full id stays reachable: row dataset for navigation, title for hover
    assert.match(html, /data-table-id="fhi-mfr-1234"/);
    assert.match(html, /title="fhi-mfr-1234"/);
  });

  it('keeps the discontinued badge alongside the source badge', () => {
    const html = BrowserState.renderTableListHTML([
      table({ id: 'nb-GOVT_IRS', label: 'Rentebytteavtaler', discontinued: true })
    ]);
    assert.match(html, /source-badge--nb/);
    assert.match(html, /discontinued-badge/);
  });
});
