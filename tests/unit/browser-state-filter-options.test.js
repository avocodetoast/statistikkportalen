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

const { BrowserState, AppConfig } = app;

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

describe('BrowserState.renderSourceFilter', () => {
  const counts = { ssb: 9812, nb: 18, fhi: 742 };

  it('renders a dropdown toggle plus one checkbox per enabled source', () => {
    const html = BrowserState.renderSourceFilter(counts, []);
    assert.match(html, /source-filter-toggle/);
    assert.match(html, /source-filter-panel/);
    assert.match(html, /value="ssb"/);
    assert.match(html, /value="nb"/);
    assert.match(html, /value="fhi"/);
    assert.match(html, />NB</);
    assert.match(html, />FHI</);
    assert.match(html, /source-filter-count[^>]*>\(18\)</);
  });

  it('summarises "all sources" with the total count when nothing is selected', () => {
    const html = BrowserState.renderSourceFilter(counts, []);
    assert.match(html, /Alle kilder \(10572\)/);
    assert.match(html, /aria-expanded="false"/);
  });

  it('summarises the picked sources and their combined count', () => {
    const html = BrowserState.renderSourceFilter(counts, ['nb', 'fhi']);
    assert.match(html, /NB, FHI \(760\)/);
  });

  it('checks the sources present in the selection', () => {
    const html = BrowserState.renderSourceFilter(counts, ['fhi']);
    assert.match(html, /value="fhi"[^>]*checked/);
    assert.doesNotMatch(html, /value="ssb"[^>]*checked/);
    assert.doesNotMatch(html, /value="nb"[^>]*checked/);
  });

  it('prefixes element ids so search and topic views can coexist', () => {
    const html = BrowserState.renderSourceFilter(counts, [], 'topic-');
    assert.match(html, /id="topic-source-filter-fhi"/);
    assert.doesNotMatch(html, /id="source-filter-fhi"/);
  });

  it('treats a missing count as zero', () => {
    const html = BrowserState.renderSourceFilter({}, []);
    assert.match(html, /source-filter-count[^>]*>\(0\)</);
  });

  it('renders nothing for a single-source instance (no source filter to offer)', () => {
    const original = AppConfig.sources;
    delete AppConfig.sources;
    try {
      assert.equal(BrowserState.renderSourceFilter(counts, []), '');
    } finally {
      AppConfig.sources = original;
    }
  });
});

describe('BrowserState.sourceFilterSummary', () => {
  const counts = { ssb: 9812, nb: 18, fhi: 742 };

  it('falls back to the all-sources label for an empty selection', () => {
    assert.equal(BrowserState.sourceFilterSummary(counts, []), 'Alle kilder (10572)');
  });

  it('lists the selected sources in config order, not click order', () => {
    assert.equal(BrowserState.sourceFilterSummary(counts, ['fhi', 'nb']), 'NB, FHI (760)');
  });

  it('ignores unknown keys in the selection', () => {
    assert.equal(BrowserState.sourceFilterSummary(counts, ['bogus']), 'Alle kilder (10572)');
  });
});

describe('BrowserState source filtering', () => {
  const tables = [
    { id: '07459', label: 'SSB-tabell', subjectCode: 'be', timeUnit: 'Annual' },
    { id: 'nb-EXR', label: 'Valutakurser', subjectCode: 'bf', timeUnit: 'Monthly' },
    { id: 'fhi-mfr-1', label: 'Fødte', subjectCode: 'be', timeUnit: 'Annual' },
    { id: 'fhi-daar-2', label: 'Dødsårsaker', subjectCode: 'he', timeUnit: 'Annual' }
  ];
  const ids = (list) => list.map(t => t.id);

  it('keeps every table when the source list is empty (default = all sources)', () => {
    const out = BrowserState._filterNonQuery(tables, { sourceFilter: [] });
    assert.deepEqual(ids(out), ['07459', 'nb-EXR', 'fhi-mfr-1', 'fhi-daar-2']);
  });

  it('keeps every table when the filter field is absent altogether', () => {
    assert.equal(BrowserState._filterNonQuery(tables, {}).length, 4);
  });

  it('keeps only the selected source', () => {
    const out = BrowserState._filterNonQuery(tables, { sourceFilter: ['fhi'] });
    assert.deepEqual(ids(out), ['fhi-mfr-1', 'fhi-daar-2']);
  });

  it('keeps the union when several sources are selected', () => {
    const out = BrowserState._filterNonQuery(tables, { sourceFilter: ['nb', 'fhi'] });
    assert.deepEqual(ids(out), ['nb-EXR', 'fhi-mfr-1', 'fhi-daar-2']);
  });

  it('ignores the source filter when it is the excluded dimension (hit counts)', () => {
    const out = BrowserState._filterNonQuery(tables, { sourceFilter: ['fhi'] }, 'source');
    assert.equal(out.length, 4);
  });

  it('counts tables per source, ignoring the source filter itself', () => {
    const counts = BrowserState.calcSourceCounts(tables, { sourceFilter: ['fhi'] });
    assert.deepEqual(counts, { ssb: 1, nb: 1, fhi: 2, dbh: 0 });
  });

  it('applies the other filters when counting per source', () => {
    const counts = BrowserState.calcSourceCounts(tables, { sourceFilter: [], subjectFilter: 'be' });
    assert.deepEqual(counts, { ssb: 1, nb: 0, fhi: 1, dbh: 0 });
  });
});

describe('BrowserState source filter ↔ URL params', () => {
  it('round-trips the selected sources through the src param', () => {
    BrowserState.searchFilters.sourceFilter = ['nb', 'fhi'];
    const params = BrowserState.searchFiltersToParams();
    assert.equal(params.src, 'nb,fhi');

    BrowserState.searchFilters.sourceFilter = [];
    BrowserState.searchFiltersFromParams(params);
    assert.deepEqual(BrowserState.searchFilters.sourceFilter, ['nb', 'fhi']);
  });

  it('omits the src param when no source is selected', () => {
    BrowserState.searchFilters.sourceFilter = [];
    assert.equal('src' in BrowserState.searchFiltersToParams(), false);
    BrowserState.topicFilters.sourceFilter = [];
    assert.equal('src' in BrowserState.topicFiltersToParams(), false);
  });

  it('drops unknown source keys coming from a hand-edited URL', () => {
    BrowserState.searchFiltersFromParams({ src: 'fhi,bogus' });
    assert.deepEqual(BrowserState.searchFilters.sourceFilter, ['fhi']);
  });

  it('round-trips topic filters too, and resetTopicFilters clears the selection', () => {
    BrowserState.topicFilters.sourceFilter = ['fhi'];
    assert.equal(BrowserState.topicFiltersToParams().src, 'fhi');
    BrowserState.resetTopicFilters();
    assert.deepEqual(BrowserState.topicFilters.sourceFilter, []);
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
