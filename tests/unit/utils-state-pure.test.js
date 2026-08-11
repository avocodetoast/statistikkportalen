'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.browse, 'js/browser-state.js']);
const state = vm.runInThisContext('AppState');

describe('AppState', () => {
  beforeEach(() => {
    state.reset();
    app.sessionStorage.clear();
  });

  it('setSelectedTable clears selection state', () => {
    state.variableSelection = { Tid: ['2025'] };
    state.activeCodelistIds = { Region: 'agg_Test' };
    state.setSelectedTable({ id: '13760', label: 'title' });
    assert.deepEqual(state.selectedTable, { id: '13760', label: 'title' });
    assert.deepEqual(state.variableSelection, {});
    assert.deepEqual(state.activeCodelistIds, {});
  });

  it('resetTableState and reset clear table and topic state', () => {
    Object.assign(state, {
      selectedTable: { id: '1' }, variableSelection: { x: ['1'] },
      activeCodelistIds: { x: 'c' }, tableData: { value: [1] },
      tableLayout: { rows: ['x'], columns: [] }, navigationRef: 'topic/a', topicPath: ['a']
    });
    app.sessionStorage.setItem('ssb_navRef', 'stored');
    state.resetTableState();
    assert.equal(state.selectedTable, null);
    assert.deepEqual(state.tableLayout, { rows: [], columns: [] });
    assert.equal(state.navigationRef, null);
    assert.equal(app.sessionStorage.getItem('ssb_navRef'), null);
    assert.deepEqual(state.topicPath, ['a']);
    state.reset();
    assert.deepEqual(state.topicPath, []);
  });

  it('_updateHash and setView encode variables/table state', () => {
    const calls = [];
    const originalNavigate = app.URLRouter.navigateTo;
    const originalRender = app.renderCurrentView;
    app.URLRouter.navigateTo = (...args) => calls.push(args);
    let renders = 0;
    app.renderCurrentView = () => { renders += 1; };
    state.selectedTable = { id: '13760' };
    state.variableSelection = { Tid: ['2025'] };
    state.activeCodelistIds = { Region: 'agg_Test' };
    state.tableLayout = { rows: ['Tid'], columns: [] };

    state._updateHash('variables');
    state.setView('table');

    app.URLRouter.navigateTo = originalNavigate;
    app.renderCurrentView = originalRender;
    assert.equal(calls[0][0], 'variables/13760');
    assert.deepEqual(app.URLRouter.decode(calls[0][1].v), { Tid: ['2025'] });
    assert.equal(calls[1][0], 'table/13760');
    assert.deepEqual(app.URLRouter.decode(calls[1][1].l), { rows: ['Tid'], columns: [] });
    assert.equal(calls[1][2], true);
    assert.equal(state.currentView, 'table');
    assert.equal(renders, 1);
  });
});

describe('pure utility helpers', () => {
  it('formats missing, nonnumeric, integer and decimal values', () => {
    assert.equal(app.formatNumber(null), '-');
    assert.equal(app.formatNumber('ukjent'), 'ukjent');
    assert.equal(app.formatNumber(1234567), '1 234 567');
    assert.equal(app.formatNumber('1234.50'), '1 234,50');
    assert.equal(app.formatNumber(1.236, 2), '1,24');
  });

  it('extracts numeric table prefixes and supplies the translated fallback', () => {
    assert.equal(app.extractTableTitle('13760: Folkemengde'), 'Folkemengde');
    assert.equal(app.extractTableTitle('nb-IR: Renter'), 'nb-IR: Renter');
    assert.equal(app.extractTableTitle(''), app.t('table.unnamed'));
  });

  it('returns a timestamp in local YYYYMMDD_HHMMSS form', () => {
    assert.match(app.getTimestamp(), /^\d{8}_\d{6}$/);
  });

  it('debounces calls and preserves the latest arguments', async () => {
    const calls = [];
    const debounced = app.debounce((...args) => calls.push(args), 5);
    debounced('first');
    debounced('latest', 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(calls, [['latest', 2]]);
  });

  it('matches SEO topic and table markers exactly', () => {
    app.__SEO_TOPIC_PATH__ = ['be', 'be02'];
    app.__SEO_TABLE_ID__ = 13760;
    assert.equal(app.seoContentMatchesRoute(['be', 'be02']), true);
    assert.equal(app.seoContentMatchesRoute(['be']), false);
    assert.equal(app.seoTableMatchesRoute('13760'), true);
    assert.equal(app.seoTableMatchesRoute('07459'), false);
    delete app.__SEO_TOPIC_PATH__;
    delete app.__SEO_TABLE_ID__;
  });

  it('builds escaped breadcrumbs from navigationRef or the table fallback path', () => {
    app.BrowserState.menuHierarchy = {
      getBreadcrumbs(ids) {
        return ids.map((id, i) => ({ path: ids.slice(0, i + 1), label: id === 'be' ? 'Befolkning & levekår' : 'Barn' }));
      }
    };
    state.navigationRef = 'topic/be/be02?disc=1';
    let html = app.buildNavigationBreadcrumb('13760', '<Folkemengde>');
    assert.match(html, /href="#topic\/be\/be02"/);
    assert.match(html, /Befolkning &amp; levekår/);
    assert.match(html, /&lt;Folkemengde&gt;/);

    state.navigationRef = null;
    app.BrowserState.allTables = [{ id: '13760', paths: [[{ id: 'al' }]] }];
    html = app.buildNavigationBreadcrumb('13760', 'Sysselsetting');
    assert.match(html, /href="#topic\/al"/);
  });
});
