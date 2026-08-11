'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.browse, 'js/browser-state.js']);
const state = vm.runInThisContext('AppState');
const R = app.URLRouter;

describe('URLRouter route handlers', () => {
  let renders;

  beforeEach(() => {
    renders = 0;
    app.renderCurrentView = () => { renders += 1; };
    app.location.hash = '';
    app.sessionStorage.clear();
    state.reset();
  });

  it('dispatches home, search and topic hashes into state and filters', async () => {
    app.location.hash = '#home';
    await R.handleRoute();
    assert.equal(state.currentView, 'home');

    app.location.hash = '#search?q=arbeid&disc=1&freq=Monthly&upd=30';
    await R.handleRoute();
    assert.equal(state.currentView, 'search');
    assert.equal(app.BrowserState.searchFilters.query, 'arbeid');
    assert.equal(app.BrowserState.searchFilters.includeDiscontinued, true);
    assert.equal(app.BrowserState.searchFilters.frequencyFilter, 'Monthly');

    app.location.hash = '#topic/be/be02?disc=1&freq=Annual';
    await R.handleRoute();
    assert.equal(state.currentView, 'topic');
    assert.deepEqual(state.topicPath, ['be', 'be02']);
    assert.equal(app.BrowserState.topicFilters.includeDiscontinued, true);
    assert.equal(app.BrowserState.topicFilters.frequencyFilter, 'Annual');
    assert.equal(renders, 3);
  });

  it('restores variables selection, codelists and matching navigation context', async () => {
    const selection = { Region: ['0301'], Tid: 'top(3)' };
    const codelists = { Region: 'agg_KommFylker' };
    app.sessionStorage.setItem('ssb_navRef', JSON.stringify({ tableId: '13760', ref: 'topic/be/be02' }));
    app.location.hash = R.buildHash('variables/13760', {
      v: R.encode(selection), c: R.encode(codelists)
    });

    await R.handleRoute();

    assert.equal(state.currentView, 'variables');
    assert.deepEqual(state.selectedTable, { id: '13760', label: '13760: (laster...)' });
    assert.deepEqual(state.variableSelection, selection);
    assert.deepEqual(state.activeCodelistIds, codelists);
    assert.equal(state.navigationRef, 'topic/be/be02');
    assert.equal(renders, 1);
  });

  it('restores table selection and layout, but redirects a table without selections', async () => {
    const selection = { ContentsCode: ['Personer'], Tid: ['2025'] };
    const layout = { rows: ['Tid'], columns: ['ContentsCode'] };
    app.location.hash = R.buildHash('table/07459', {
      v: R.encode(selection), l: R.encode(layout)
    });
    await R.handleRoute();
    assert.equal(state.currentView, 'table');
    assert.deepEqual(state.variableSelection, selection);
    assert.deepEqual(state.tableLayout, layout);
    assert.equal(renders, 1);

    const redirects = [];
    const originalNavigate = R.navigateTo;
    R.navigateTo = (...args) => redirects.push(args);
    await R._handleTableRoute('table/07459', {});
    R.navigateTo = originalNavigate;
    assert.deepEqual(redirects, [['variables/07459', {}, false]]);
    assert.equal(renders, 1);
  });

  it('maps all legacy browser route shapes and redispatches them', () => {
    const navigations = [];
    let redispatches = 0;
    const originalNavigate = R.navigateTo;
    const originalHandle = R.handleRoute;
    R.navigateTo = (...args) => navigations.push(args);
    R.handleRoute = () => { redispatches += 1; };

    R._handleLegacyBrowserRoute('browser', { mode: 'search', q: 'lønn' });
    R._handleLegacyBrowserRoute('browser/be/be02', {});
    R._handleLegacyBrowserRoute('browser', {});

    R.navigateTo = originalNavigate;
    R.handleRoute = originalHandle;
    assert.deepEqual(navigations, [
      ['search', { q: 'lønn' }, false],
      ['topic/be/be02', {}, false],
      ['home', {}, false]
    ]);
    assert.equal(redispatches, 3);
  });

  it('restores a saved query and uses successfully prefetched data', async () => {
    const originalQuery = app.api.getSavedQuery;
    const originalData = app.api.getSavedQueryData;
    app.api.getSavedQuery = async () => ({ savedQuery: {
      tableId: '13760',
      selection: {
        selection: [
          { variableCode: 'Region', valueCodes: ['0301'], codelist: 'agg_KommFylker' },
          { variableCode: 'Tid', valueCodes: ['2025'] }
        ],
        placement: { stub: ['Region'], heading: ['Tid'] }
      }
    } });
    app.api.getSavedQueryData = async () => ({ value: [42] });

    await R._handleSavedQueryRoute('30121434');

    app.api.getSavedQuery = originalQuery;
    app.api.getSavedQueryData = originalData;
    assert.equal(state.currentView, 'table');
    assert.equal(state.selectedTable.id, '13760');
    assert.deepEqual(state.variableSelection, { Region: ['0301'], Tid: ['2025'] });
    assert.deepEqual(state.activeCodelistIds, { Region: 'agg_KommFylker' });
    assert.deepEqual(state.tableLayout, { rows: ['Region'], columns: ['Tid'] });
    assert.deepEqual(state.tableData, { value: [42] });
    assert.equal(renders, 1);
  });
});

describe('SSBURLMapper', () => {
  it('maps saved queries, tables, search and invalid URLs', () => {
    assert.equal(app.SSBURLMapper.fromSSB('https://www.ssb.no/statbank/sq/30121434'), '#sq/30121434');
    assert.equal(app.SSBURLMapper.fromSSB('https://www.ssb.no/statbank/table/13760?sq=99'), '#sq/99');
    assert.equal(app.SSBURLMapper.fromSSB('https://www.ssb.no/statbank/table/13760'), '#variables/13760');
    assert.equal(app.SSBURLMapper.fromSSB('https://www.ssb.no/statbank/?query=arbeid%20og%20lønn'), '#search?q=arbeid%20og%20l%C3%B8nn');
    assert.equal(app.SSBURLMapper.fromSSB('not a url'), '#home');
  });

  it('builds a deep link from origin, pathname and current hash', () => {
    app.location.origin = 'https://example.test';
    app.location.pathname = '/portal/';
    app.location.hash = '#table/13760?v=abc';
    assert.equal(app.SSBURLMapper.toDeepLink(), 'https://example.test/portal/#table/13760?v=abc');
  });
});
