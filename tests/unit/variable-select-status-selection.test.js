'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/variable-select-state.js',
  'js/variable-select-status.js'
]);

function setMetadata(value) {
  vm.runInThisContext('tableMetadata = ' + JSON.stringify(value) + ';');
}
function classes(initial = []) {
  const values = new Set(initial);
  return {
    add(...xs) { xs.forEach(x => values.add(x)); },
    remove(...xs) { xs.forEach(x => values.delete(x)); },
    toggle(x, force) { force === undefined ? (values.has(x) ? values.delete(x) : values.add(x)) : (force ? values.add(x) : values.delete(x)); },
    contains(x) { return values.has(x); }
  };
}
function item(code, selected = false) {
  const attrs = {};
  return {
    dataset: { code }, classList: classes(selected ? ['selected'] : []),
    setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; },
    getAttribute(k) { return attrs[k]; }
  };
}
function listCard(dim, codes, selected = [], extra = {}) {
  const items = codes.map(c => item(c, selected.includes(c)));
  const container = {
    dataset: { mode: 'specific' }, classList: classes(),
    querySelectorAll(sel) {
      if (sel === '.value-list-item') return items;
      if (sel === '.value-list-item.selected') return items.filter(x => x.classList.contains('selected'));
      if (sel === '.value-list-item:not(.value-freq-hidden)') return items.filter(x => !x.classList.contains('value-freq-hidden'));
      return [];
    }
  };
  const selectedCount = { textContent: '' };
  const totalCount = { textContent: '' };
  const input = { placeholder: '' };
  const card = {
    dataset: { dimension: dim, ...extra }, classList: classes(), items, container,
    querySelector(sel) {
      return ({ '.value-list-container': container, '.selected-count': selectedCount,
        '.total-count': totalCount, '.value-filter-input': input })[sel] || null;
    },
    querySelectorAll() { return []; }
  };
  return card;
}
function pillCard(dim, values, checked, extra = {}) {
  const radios = values.map(value => ({ value, checked: value === checked, disabled: false,
    closest() { return { classList: classes() }; } }));
  return {
    dataset: { dimension: dim, pillGroup: 'true', ...extra }, radios,
    querySelector() { return null; },
    querySelectorAll(sel) { return sel.includes('radio') ? radios.filter(r => !sel.includes(':checked') || r.checked) : []; }
  };
}
function withCards(cards, fn) {
  const oldOne = app.document.querySelector;
  const oldAll = app.document.querySelectorAll;
  app.document.querySelector = sel => {
    const m = /data-dimension="([^"]+)"/.exec(sel);
    return m ? cards[m[1]] || null : null;
  };
  app.document.querySelectorAll = sel => sel === '.variable-card' ? Object.values(cards) : [];
  try { return fn(); } finally { app.document.querySelector = oldOne; app.document.querySelectorAll = oldAll; }
}

describe('getPillSelectedCodes / hasPendingMandatorySelection', () => {
  it('reads checked pills and distinguishes mandatory from elimination cards', () => {
    const mandatory = pillCard('FREQ', ['A', 'M'], 'M');
    assert.deepEqual(app.getPillSelectedCodes(mandatory), ['M']);
    mandatory.radios[1].checked = false;
    const optional = listCard('OPT', ['x'], [], { elimination: 'true' });
    const vk = { dims: ['FREQ', 'OPT'] };
    assert.equal(withCards({ FREQ: mandatory, OPT: optional }, () => app.hasPendingMandatorySelection(vk)), true);
    mandatory.dataset.elimination = 'true';
    assert.equal(withCards({ FREQ: mandatory, OPT: optional }, () => app.hasPendingMandatorySelection(vk)), false);
  });
});

describe('getTrueDimensionValueCount', () => {
  beforeEach(() => vm.runInThisContext('Object.keys(activeCodelists).forEach(k => delete activeCodelists[k]);'));

  it('uses metadata normally and original-code coverage for active codelists', () => {
    setMetadata({ dimension: { D: { category: { label: { a: 'A', b: 'B', c: 'C' } } } } });
    assert.equal(app.getTrueDimensionValueCount('D'), 3);
    assert.equal(app.getTrueDimensionValueCount('missing'), 0);
    vm.runInThisContext("activeCodelists.D = { originalCodes: new Set(['a', 'c']) };");
    assert.equal(app.getTrueDimensionValueCount('D'), 2);
  });
});

describe('getVariableSelection / validateSelection', () => {
  beforeEach(() => vm.runInThisContext('Object.keys(activeCodelists).forEach(k => delete activeCodelists[k]);'));

  it('builds picker, pill, star, top and chronological specific selections', () => {
    setMetadata({ id: ['TIME', 'FREQ', 'ALL', 'TOP', 'Tid'], role: { time: ['Tid'] }, dimension: {
      Tid: { category: { index: { old: 0, newer: 1 } } }
    } });
    const time = { dataset: { dimension: 'TIME', timePicker: 'interval', pickerMode: 'star' }, querySelector() { return null; }, querySelectorAll() { return []; } };
    const freq = pillCard('FREQ', ['A', 'M'], 'A');
    const all = listCard('ALL', ['x']); all.container.dataset.mode = 'star';
    const top = listCard('TOP', ['x']); top.container.dataset.mode = 'top'; top.querySelector = sel => sel === '.value-list-container' ? top.container : sel === '.top-n-input' ? { value: '4' } : null;
    const tid = listCard('Tid', ['old', 'newer'], ['newer', 'old']);
    const selection = withCards({ TIME: time, FREQ: freq, ALL: all, TOP: top, Tid: tid }, () => app.getVariableSelection());
    assert.deepEqual(selection, { TIME: '*', FREQ: ['A'], ALL: '*', TOP: 'top(4)', Tid: ['old', 'newer'] });
    assert.equal(withCards({ TIME: time, FREQ: freq, ALL: all, TOP: top, Tid: tid }, () => app.validateSelection(selection)), true);
  });

  it('omits empty optional dimensions and rejects missing mandatory values', () => {
    setMetadata({ id: ['REQ', 'OPT'], dimension: {} });
    const req = listCard('REQ', ['x']);
    const opt = listCard('OPT', ['y'], [], { elimination: 'true' });
    const selection = withCards({ REQ: req, OPT: opt }, () => app.getVariableSelection());
    assert.deepEqual(selection, { REQ: [] });
    assert.equal(withCards({ REQ: req, OPT: opt }, () => app.validateSelection(selection)), false);
    assert.equal(app.validateSelection(selection), false);
  });

  it('expands filter codelists and keeps aggregate codelist codes', () => {
    setMetadata({ id: ['FILTER', 'AGG'], dimension: {} });
    const filter = listCard('FILTER', ['group'], ['group']);
    filter.items[0].dataset.valuemap = JSON.stringify(['a', 'b']);
    const agg = listCard('AGG', ['sum']); agg.container.dataset.mode = 'star';
    vm.runInThisContext("activeCodelists.FILTER = { isAggregated: false, originalCodes: new Set(['a','b']) }; activeCodelists.AGG = { isAggregated: true, values: [{code:'sum'}], originalCodes: new Set(['a','b']) };");
    assert.deepEqual(withCards({ FILTER: filter, AGG: agg }, () => app.getVariableSelection()), {
      FILTER: ['a', 'b'], AGG: ['sum']
    });
  });
});

describe('applyTimeFreqFilter', () => {
  it('unions selected frequency periods, hides incompatible values and deselects them', () => {
    setMetadata({ extension: { timePeriodsByFreq: {
      freqDim: 'FREQ', timeDim: 'TIME', byFreq: { A: ['2023'], M: ['2023-01', '2023-02'] }
    } } });
    const freq = listCard('FREQ', ['A', 'M'], ['M']);
    const time = listCard('TIME', ['2023', '2023-01', '2023-02'], ['2023', '2023-02']);
    withCards({ FREQ: freq, TIME: time }, () => app.applyTimeFreqFilter());
    assert.equal(time.items[0].classList.contains('value-freq-hidden'), true);
    assert.equal(time.items[0].classList.contains('selected'), false);
    assert.equal(time.items[1].classList.contains('value-freq-hidden'), false);
    assert.equal(time.querySelector('.total-count').textContent, 2);
    assert.match(time.querySelector('.value-filter-input').placeholder, /2023-02/);
  });

  it('shows everything when a selected frequency has no probed list', () => {
    setMetadata({ extension: { timePeriodsByFreq: { freqDim: 'FREQ', timeDim: 'TIME', byFreq: { A: ['2023'] } } } });
    const freq = listCard('FREQ', ['X'], ['X']);
    const time = listCard('TIME', ['2023', '2024'], ['2024']);
    withCards({ FREQ: freq, TIME: time }, () => app.applyTimeFreqFilter());
    assert.ok(time.items.every(x => !x.classList.contains('value-freq-hidden')));
  });
});

describe('applyCrossFilter', () => {
  it('disables and deselects incompatible values, then reports effective matches', () => {
    setMetadata({ role: {}, extension: { validKeys: { dims: ['A', 'B'], keys: ['a.x', 'b.y'] } } });
    const a = listCard('A', ['a', 'b'], ['a']);
    const b = listCard('B', ['x', 'y'], ['y']);
    const result = withCards({ A: a, B: b }, () => app.applyCrossFilter());
    assert.equal(b.items[1].classList.contains('value-disabled'), true);
    assert.equal(b.items[1].classList.contains('selected'), false);
    assert.deepEqual(result, { matchCount: 2, pending: true });
  });

  it('is a no-op without validKeys', () => {
    setMetadata({ extension: {} });
    assert.equal(withCards({}, () => app.applyCrossFilter()), null);
  });
});

describe('cheap visual-state writers', () => {
  it('updates mode highlighting and the selected-value counter', () => {
    const card = listCard('D', ['a', 'b'], ['a']);
    const allButton = { classList: classes() };
    const topButton = { classList: classes() };
    const originalQuery = card.querySelector;
    card.querySelector = sel => sel === '.select-all-btn' ? allButton
      : sel === '.select-top-btn' ? topButton : originalQuery(sel);
    card.querySelectorAll = sel => sel === '.select-all-btn, .select-top-btn' ? [allButton, topButton] : [];

    app.updateModeVisuals(card);
    app.updateValueCounter(card);
    assert.equal(card.container.classList.contains('mode-inactive'), false);
    assert.equal(card.querySelector('.selected-count').textContent, 1);

    card.container.dataset.mode = 'star';
    app.updateModeVisuals(card);
    app.updateValueCounter(card);
    assert.equal(allButton.classList.contains('btn-active'), true);
    assert.equal(card.container.classList.contains('mode-inactive'), true);
    assert.equal(card.querySelector('.selected-count').textContent, app.t('status.all'));
  });

  it('sets card status and shows a cross-filter explanation only when narrowed', () => {
    const badge = { classList: classes() };
    const hint = { textContent: '', hidden: true };
    const card = { classList: classes(['card-status-invalid']), querySelector(sel) {
      return sel === '.variable-badge' ? badge : sel === '.cross-filter-hint' ? hint : null;
    } };
    app.setCardStatus(card, 'valid');
    assert.equal(card.classList.contains('card-status-valid'), true);
    assert.equal(badge.classList.contains('badge-hidden'), true);

    app.updateCrossFilterHint(card, 2, 5);
    assert.equal(hint.hidden, false);
    assert.match(hint.textContent, /2/);
    app.updateCrossFilterHint(card, 5, 5);
    assert.equal(hint.hidden, true);
  });
});
