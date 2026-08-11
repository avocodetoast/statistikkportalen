/** Saved-query serialization, response handling, and fingerprint reuse. */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const content = { innerHTML: '' };
const errors = [];
const saves = [];
const app = loadApp(SCRIPTS.tableTools, { globals: {
  currentData: null,
  AppState: {},
  document: {
    getElementById(id) { return id === 'save-query-content' ? content : null; }
  },
  openDialog() {},
  escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'); },
  sourceBrandingForTable() { return { name: 'SSB' }; },
  showError(message) { errors.push(message); },
  getCurrentApiLang() { return 'no'; }
} });

beforeEach(() => {
  content.innerHTML = '';
  errors.length = 0;
  saves.length = 0;
  app.currentData = { value: [1] };
  app.AppState = {
    selectedTable: { id: '07459' },
    variableSelection: { Region: ['0301'], Tid: ['2024'] },
    activeCodelistIds: { Region: 'vs_Region' },
    tableLayout: { rows: ['Region'], columns: ['Tid'] }
  };
  app.api.saveSavedQuery = async (...args) => { saves.push(args); return { id: 'abc123' }; };
});

describe('showSaveQueryDialog', () => {
  it('serializes the selection, layout, codelists and language', async () => {
    await app.showSaveQueryDialog();
    assert.deepEqual(saves, [[
      '07459', app.AppState.variableSelection,
      { stub: ['Region'], heading: ['Tid'], codelistIds: { Region: 'vs_Region' }, lang: 'no' }
    ]]);
    assert.match(content.innerHTML, /https:\/\/www\.ssb\.no\/statbank\/sq\/abc123/);
    assert.match(content.innerHTML, /http:\/\/localhost\/#sq\/abc123/);
  });

  it('accepts the nested savedQuery response shape', async () => {
    app.AppState.variableSelection = { Region: ['1103'] };
    app.api.saveSavedQuery = async (...args) => { saves.push(args); return { savedQuery: { id: 'nested7' } }; };
    await app.showSaveQueryDialog();
    assert.match(content.innerHTML, /sq\/nested7/);
  });

  it('reuses the saved id while the complete query fingerprint is unchanged', async () => {
    app.AppState.variableSelection = { Region: ['5001'] };
    await app.showSaveQueryDialog();
    await app.showSaveQueryDialog();
    assert.equal(saves.length, 1);
    assert.match(content.innerHTML, /sq\/abc123/);
  });

  it('saves again when layout or selection changes', async () => {
    app.AppState.variableSelection = { Region: ['5501'] };
    await app.showSaveQueryDialog();
    app.AppState.tableLayout = { rows: ['Tid'], columns: ['Region'] };
    await app.showSaveQueryDialog();
    assert.equal(saves.length, 2);
  });

  it('renders an error when the response has no id', async () => {
    app.AppState.variableSelection = { Region: ['9999'] };
    app.api.saveSavedQuery = async () => ({});
    await app.showSaveQueryDialog();
    assert.match(content.innerHTML, /error-message/);
  });

  it('rejects an inactive query before calling the API', async () => {
    app.currentData = null;
    await app.showSaveQueryDialog();
    assert.equal(saves.length, 0);
    assert.equal(errors.length, 1);
  });
});
