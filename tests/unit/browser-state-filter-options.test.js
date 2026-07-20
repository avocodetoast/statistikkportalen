/**
 * browser-state.js — renderFrequencyFilterOptions/renderUpdatedFilterOptions
 * (shared <option> builders extracted from search-view.js/topic-view.js) and
 * ensureLoaded (shared isLoaded/spinner/init/error boilerplate extracted from
 * front-page.js/search-view.js/topic-view.js).
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

const { BrowserState } = app;

describe('BrowserState.renderFrequencyFilterOptions', () => {
  const counts = { Monthly: 3, Quarterly: 0, Annual: 5, Other: 1 };

  it('includes all four frequency options with counts', () => {
    const html = BrowserState.renderFrequencyFilterOptions(counts, { allLabel: 'Alle (9)' });
    assert.match(html, /<option value="Monthly">.*\(3\)<\/option>/);
    assert.match(html, /<option value="Quarterly">.*\(0\)<\/option>/);
    assert.match(html, /<option value="Annual">.*\(5\)<\/option>/);
    assert.match(html, /<option value="Other">.*\(1\)<\/option>/);
  });

  it('renders the given allLabel verbatim on the empty-value option', () => {
    const html = BrowserState.renderFrequencyFilterOptions(counts, { allLabel: 'Alle frekvenser (9)' });
    assert.match(html, /<option value="">Alle frekvenser \(9\)<\/option>/);
  });

  it('marks the selected value inline when opts.selected is given', () => {
    const html = BrowserState.renderFrequencyFilterOptions(counts, { allLabel: 'Alle', selected: 'Annual' });
    assert.match(html, /<option value="Annual" selected>/);
    assert.doesNotMatch(html, /<option value="Monthly" selected>/);
    assert.doesNotMatch(html, /<option value="" selected>/);
  });

  it('marks the empty option selected when opts.selected is empty string', () => {
    const html = BrowserState.renderFrequencyFilterOptions(counts, { allLabel: 'Alle', selected: '' });
    assert.match(html, /<option value="" selected>/);
    assert.doesNotMatch(html, /<option value="Monthly" selected>/);
  });

  it('omits selected attributes entirely when opts.selected is not provided (dynamic update mode)', () => {
    const html = BrowserState.renderFrequencyFilterOptions(counts, { allLabel: 'Alle' });
    assert.doesNotMatch(html, /selected/);
  });

  it('treats a missing count as zero', () => {
    const html = BrowserState.renderFrequencyFilterOptions({}, { allLabel: 'Alle' });
    assert.match(html, /<option value="Monthly">.*\(0\)<\/option>/);
  });
});

describe('BrowserState.renderUpdatedFilterOptions', () => {
  const counts = { '1': 2, '7': 4, '30': 10, '365': 20, '730': 25 };

  it('includes all five period options with counts, in ascending period order', () => {
    const html = BrowserState.renderUpdatedFilterOptions(counts, { allLabel: 'Alle' });
    const order = ['1', '7', '30', '365', '730'].map(v => html.indexOf(`value="${v}"`));
    assert.deepEqual(order, order.slice().sort((a, b) => a - b));
    assert.match(html, /<option value="1">.*\(2\)<\/option>/);
    assert.match(html, /<option value="730">.*\(25\)<\/option>/);
  });

  it('marks the selected period inline when opts.selected is given', () => {
    const html = BrowserState.renderUpdatedFilterOptions(counts, { allLabel: 'Alle', selected: '30' });
    assert.match(html, /<option value="30" selected>/);
    assert.doesNotMatch(html, /<option value="7" selected>/);
  });
});

describe('BrowserState.ensureLoaded', () => {
  function fakeContainer() {
    return { innerHTML: '' };
  }

  it('returns true immediately without touching the container when already loaded', async () => {
    BrowserState.isLoaded = true;
    const container = fakeContainer();
    const result = await BrowserState.ensureLoaded(container);
    assert.equal(result, true);
    assert.equal(container.innerHTML, '');
  });

  it('renders the default spinner then returns false and renders an error on init failure', async () => {
    BrowserState.isLoaded = false;
    BrowserState._initPromise = null;
    const originalInit = BrowserState._doInit;
    BrowserState._doInit = async () => { throw new Error('boom'); };
    try {
      const container = fakeContainer();
      const result = await BrowserState.ensureLoaded(container);
      assert.equal(result, false);
      assert.match(container.innerHTML, /error-message/);
      assert.match(container.innerHTML, /boom/);
    } finally {
      BrowserState._doInit = originalInit;
      BrowserState.isLoaded = true; // restore for later tests in this file
      BrowserState._initPromise = null;
    }
  });

  it('uses a custom renderSpinner callback instead of the default spinner', async () => {
    BrowserState.isLoaded = false;
    BrowserState._initPromise = null;
    const originalInit = BrowserState._doInit;
    BrowserState._doInit = async () => { throw new Error('boom'); };
    try {
      const container = fakeContainer();
      let spinnerCalledWith = null;
      await BrowserState.ensureLoaded(container, {
        renderSpinner: (c) => { spinnerCalledWith = c; c.innerHTML = 'custom-spinner'; }
      });
      assert.equal(spinnerCalledWith, container);
    } finally {
      BrowserState._doInit = originalInit;
      BrowserState.isLoaded = true;
      BrowserState._initPromise = null;
    }
  });
});
