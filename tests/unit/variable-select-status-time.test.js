'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/period-format.js',
  'js/sources/sdmx-to-jsonstat.js',
  'js/variable-select-state.js',
  'js/variable-select-status.js',
  'js/variable-select-render.js'
]);

function setMetadata(value) {
  vm.runInThisContext('tableMetadata = ' + JSON.stringify(value) + ';');
}

function field(value = '') { return { value }; }
function picker(dataset, fields = {}) {
  return {
    dataset,
    querySelector(selector) { return fields[selector] || null; },
    querySelectorAll() { return []; }
  };
}

describe('getTimeFreqSpec', () => {
  it('returns only complete frequency/time mappings', () => {
    const spec = { freqDim: 'FREQ', timeDim: 'TIME', byFreq: { A: ['2024'] } };
    setMetadata({ extension: { timePeriodsByFreq: spec } });
    assert.deepEqual(app.getTimeFreqSpec(), spec);

    for (const incomplete of [null, {}, { freqDim: 'FREQ' }, { freqDim: 'FREQ', timeDim: 'TIME' }]) {
      setMetadata({ extension: { timePeriodsByFreq: incomplete } });
      assert.equal(app.getTimeFreqSpec(), null);
    }
    setMetadata(null);
    assert.equal(app.getTimeFreqSpec(), null);
  });
});

describe('readPeriodSide / readTimePickerToken', () => {
  it('validates years and supplies sensible default quarters', () => {
    const card = picker({ pickerGran: 'quarter' }, {
      '.tp-from-year': field('2023'), '.tp-from-q': field(''),
      '.tp-to-year': field('2024'), '.tp-to-q': field('Q2')
    });
    assert.equal(app.readPeriodSide(card, 'from'), '2023-Q1');
    assert.equal(app.readPeriodSide(card, 'to'), '2024-Q2');
    card.querySelector('.tp-from-year').value = '23';
    assert.equal(app.readPeriodSide(card, 'from'), '');
  });

  it('reads year/day sides and all picker token modes', () => {
    const card = picker({ pickerGran: 'year', pickerMode: 'range' }, {
      '.tp-from': field(' 2020 '), '.tp-to': field('bad'), '.top-n-input': field('7')
    });
    assert.equal(app.readPeriodSide(card, 'from'), '2020');
    assert.equal(app.readPeriodSide(card, 'to'), '');
    assert.equal(app.readTimePickerToken(card), 'range(2020,)');
    card.dataset.pickerMode = 'top';
    assert.equal(app.readTimePickerToken(card), 'top(7)');
    card.querySelector('.top-n-input').value = '0';
    assert.equal(app.readTimePickerToken(card), 'top(10)');
    card.dataset.pickerMode = 'star';
    assert.equal(app.readTimePickerToken(card), '*');
  });
});

describe('timePickerBounds / ensureRangeDefaults', () => {
  beforeEach(() => setMetadata({
    dimension: { TIME: { extension: { timeBounds: {
      firstPeriod: '2019', lastPeriod: '2026',
      firstCode: '2020-02-03T10:00:00', lastCode: '2025-11-12T12:00:00'
    } } } },
    extension: { timePeriodsByFreq: {
      freqDim: 'FREQ', timeDim: 'TIME', byFreq: { M: ['2025-01', '2025-09'] }
    } }
  }));

  it('prefers exact converted bounds and the selected frequency maximum', () => {
    const card = picker({ dimension: 'TIME' });
    assert.deepEqual(app.timePickerBounds(card, 'month', 'M'), {
      min: '2020-02', max: '2025-09'
    });
    assert.deepEqual(app.timePickerBounds(card, 'day', null), {
      min: '2020-02-03', max: '2025-11-12'
    });
  });

  it('falls back to catalogue-year edges when exact codes cannot be refined', () => {
    setMetadata({ dimension: { TIME: { extension: { timeBounds: {
      firstPeriod: '2019', lastPeriod: '2026', firstCode: '2020', lastCode: '2025'
    } } } } });
    assert.deepEqual(app.timePickerBounds(picker({ dimension: 'TIME' }), 'month', null), {
      min: '2019-01', max: '2026-12'
    });
  });

  it('fills an entirely empty range without overwriting user input', () => {
    const wrap = { innerHTML: '' };
    const card = picker({ dimension: 'TIME', timePicker: 'interval', pickerMode: 'range', pickerGran: 'month' }, {
      '.tp-from': field(''), '.tp-to': field(''), '.tp-range-inputs': wrap
    });
    assert.equal(app.ensureRangeDefaults(card), true);
    assert.match(wrap.innerHTML, /value="2020-02"/);
    assert.match(wrap.innerHTML, /value="2025-11"/);

    card.querySelector('.tp-from').value = '2022-01';
    assert.equal(app.ensureRangeDefaults(card), false);
    card.dataset.pickerMode = 'star';
    assert.equal(app.ensureRangeDefaults(card), false);
  });
});

describe('findInvertedRangePicker', () => {
  it('finds a complete inverted range and ignores top/open ranges', () => {
    const inverted = picker({ timePicker: 'interval', pickerMode: 'range', pickerGran: 'year' }, {
      '.tp-from': field('2025'), '.tp-to': field('2020')
    });
    const open = picker({ timePicker: 'interval', pickerMode: 'range', pickerGran: 'year' }, {
      '.tp-from': field('2020'), '.tp-to': field('')
    });
    const top = picker({ timePicker: 'interval', pickerMode: 'top', pickerGran: 'year' });
    const old = app.document.querySelectorAll;
    app.document.querySelectorAll = () => [open, top, inverted];
    try { assert.equal(app.findInvertedRangePicker(), inverted); }
    finally { app.document.querySelectorAll = old; }
  });
});
