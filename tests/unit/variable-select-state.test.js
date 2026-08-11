'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/app-env.js');

let nextTimer = 0;
const timers = new Map();
const cleared = [];
const navigations = [];
const encoded = [];

const app = loadApp(['js/variable-select-state.js'], {
  globals: {
    AppState: {
      selectedTable: { id: '07459' },
      activeCodelistIds: { Region: 'agg_region' }
    },
    getVariableSelection: () => ({ Region: ['0301'] }),
    URLRouter: {
      encode(value) { encoded.push(value); return 'encoded-' + encoded.length; },
      navigateTo(...args) { navigations.push(args); }
    },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { cleared.push(id); timers.delete(id); }
  }
});

describe('debouncedURLUpdate', () => {
  it('cancels the previous update and deterministically runs only the latest one', () => {
    app.debouncedURLUpdate();
    app.debouncedURLUpdate();

    assert.deepEqual(cleared, [null, 1]);
    assert.equal(timers.size, 1);
    const [{ callback, delay }] = timers.values();
    assert.equal(delay, 500);
    callback();

    assert.deepEqual(encoded, [
      { Region: ['0301'] },
      { Region: 'agg_region' }
    ]);
    assert.deepEqual(navigations, [[
      'variables/07459',
      { v: 'encoded-1', c: 'encoded-2' },
      false
    ]]);
  });
});
