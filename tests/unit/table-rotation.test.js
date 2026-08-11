/** Table rotation layout math and validation. */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const errors = [];
let renders = 0;
const app = loadApp(SCRIPTS.tableTools, { globals: {
  currentData: null,
  AppState: {},
  escapeHtml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  },
  showError(message) { errors.push(message); },
  displayData() { renders++; }
} });

function chip(dimension) { return { dataset: { dimension } }; }
function zone(dimensions) {
  return {
    innerHTML: '',
    querySelectorAll(selector) { return selector === '.dimension-chip' ? dimensions.map(chip) : []; },
    querySelector() { return null; },
    addEventListener() {}
  };
}
function overlay(rows, columns) {
  const rowsZone = zone(rows);
  const columnsZone = zone(columns);
  return {
    rowsZone, columnsZone,
    querySelector(selector) {
      return selector === '#rows-zone' ? rowsZone : selector === '#columns-zone' ? columnsZone : null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
}

beforeEach(() => {
  errors.length = 0;
  renders = 0;
  app.currentData = {
    id: ['Region', 'Contents', 'Tid'],
    dimension: {
      Region: { label: '<Region>', category: { index: { A: 0, B: 1 } } },
      Contents: { label: 'Measure', category: { index: { X: 0 } } },
      Tid: { label: 'Year', category: { index: { 2023: 0, 2024: 1 } } }
    }
  };
  app.AppState = { tableLayout: { rows: [], columns: [] } };
});

describe('renderDimensionList', () => {
  it('renders labels, counts, zone and escaped values', () => {
    const html = app.renderDimensionList(['Region'], 'row');
    assert.match(html, /data-dimension="Region"/);
    assert.match(html, /data-zone="row"/);
    assert.match(html, /&lt;Region>/);
    assert.match(html, />2 /);
  });

  it('renders the empty-zone prompt for no dimensions', () => {
    assert.match(app.renderDimensionList([], 'col'), /empty-zone/);
  });
});

describe('applyPreset', () => {
  it('puts a time dimension in rows and other dimensions in columns by default', () => {
    const ui = overlay([], []);
    app.applyPreset('default', ['Region', 'Contents', 'Tid'], ui);
    assert.match(ui.rowsZone.innerHTML, /data-dimension="Tid"/);
    assert.match(ui.columnsZone.innerHTML, /data-dimension="Region"/);
    assert.match(ui.columnsZone.innerHTML, /data-dimension="Contents"/);
  });

  it('transposes the current row and column dimensions', () => {
    const ui = overlay(['Region'], ['Contents', 'Tid']);
    app.applyPreset('transpose', app.currentData.id, ui);
    assert.match(ui.rowsZone.innerHTML, /Contents[\s\S]*Tid/);
    assert.match(ui.columnsZone.innerHTML, /Region/);
  });

  it('supports all-rows and all-cols layouts', () => {
    const rowsUi = overlay([], []);
    app.applyPreset('all-rows', app.currentData.id, rowsUi);
    assert.doesNotMatch(rowsUi.rowsZone.innerHTML, /empty-zone/);
    assert.match(rowsUi.columnsZone.innerHTML, /empty-zone/);

    const colsUi = overlay([], []);
    app.applyPreset('all-cols', app.currentData.id, colsUi);
    assert.match(colsUi.rowsZone.innerHTML, /empty-zone/);
    assert.doesNotMatch(colsUi.columnsZone.innerHTML, /empty-zone/);
  });
});

describe('applyRotation', () => {
  it('stores a valid layout, closes, and rerenders', () => {
    let closed = false;
    app.applyRotation(overlay(['Region', 'Tid'], ['Contents']), () => { closed = true; });
    assert.deepEqual(app.AppState.tableLayout, { rows: ['Region', 'Tid'], columns: ['Contents'] });
    assert.equal(closed, true);
    assert.equal(renders, 1);
  });

  it('rejects missing or duplicated dimensions', () => {
    app.applyRotation(overlay(['Region', 'Region'], ['Tid']), () => {});
    assert.equal(errors.length, 1);
    assert.equal(renders, 0);
  });
});
