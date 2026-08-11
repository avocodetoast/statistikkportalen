/** Export option construction and API delegation. */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const fields = {};
const calls = [];
const dialog = {
  querySelector(selector) { return fields[selector] || null; }
};

const app = loadApp(SCRIPTS.tableTools, { globals: {
  currentData: null,
  AppState: {},
  document: {
    getElementById(id) {
      if (id === 'export-dialog') return dialog;
      if (id === 'include-title') return fields.includeTitle || null;
      return null;
    }
  },
  showLoading(...args) { calls.push(['loading', ...args]); },
  showError(...args) { calls.push(['error', ...args]); },
  getCurrentApiLang() { return 'no'; }
} });

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(fields)) delete fields[key];
  app.currentData = { id: ['Region', 'Contents', 'Tid'] };
  app.AppState = {
    selectedTable: { id: '07459' },
    variableSelection: { Region: ['0301'], Tid: ['2024'] },
    activeCodelistIds: { Region: 'vs_Region' },
    tableLayout: { rows: ['Region'], columns: ['Contents', 'Tid'] }
  };
  app.api.downloadTableData = async (...args) => { calls.push(['download', ...args]); };
});

describe('executeExport', () => {
  it('builds CSV parameters and preserves the displayed layout', async () => {
    fields['input[name="export-format"]:checked'] = { value: 'csv' };
    fields['input[name="display-format"]:checked'] = { value: 'UseCodesAndTexts' };
    fields['input[name="csv-separator"]:checked'] = { value: 'SeparatorTab' };
    fields['input[name="table-layout"]:checked'] = { value: 'as-shown' };
    fields.includeTitle = { checked: true };

    await app.executeExport();

    assert.deepEqual(calls[1], ['download', '07459', app.AppState.variableSelection, {
      format: 'csv',
      stub: ['Region'],
      heading: ['Contents', 'Tid'],
      formatParams: ['UseCodesAndTexts', 'IncludeTitle', 'SeparatorTab'],
      lang: 'no',
      codelistIds: { Region: 'vs_Region' }
    }]);
    assert.deepEqual(calls.filter(c => c[0] === 'loading').map(c => c[1]), [true, false]);
  });

  it('uses every dimension as stub for a pivot-friendly export', async () => {
    fields['input[name="export-format"]:checked'] = { value: 'xlsx' };
    fields['input[name="display-format"]:checked'] = { value: '' };
    fields['input[name="table-layout"]:checked'] = { value: 'pivot-friendly' };

    await app.executeExport();

    const options = calls.find(c => c[0] === 'download')[3];
    assert.deepEqual(options.stub, ['Region', 'Contents', 'Tid']);
    assert.deepEqual(options.heading, []);
    assert.deepEqual(options.formatParams, []);
  });
});

describe('quickExportXlsx', () => {
  it('delegates with the current layout and title enabled', async () => {
    await app.quickExportXlsx();
    assert.deepEqual(calls.find(c => c[0] === 'download').slice(1), [
      '07459', app.AppState.variableSelection, {
        format: 'xlsx', stub: ['Region'], heading: ['Contents', 'Tid'],
        formatParams: ['IncludeTitle'], lang: 'no', codelistIds: { Region: 'vs_Region' }
      }
    ]);
  });

  it('reports missing data without calling the API', async () => {
    app.currentData = null;
    await app.quickExportXlsx();
    assert.equal(calls.some(c => c[0] === 'download'), false);
    assert.equal(calls.some(c => c[0] === 'error'), true);
  });
});
