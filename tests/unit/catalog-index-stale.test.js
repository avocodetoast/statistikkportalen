/** catalog-index.js — cachelesing skal bevare stale-if-error-kopien. */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);
const { CatalogIndex } = app;

describe('CatalogIndex._cachedJson — ikke-destruktiv stale-if-error', () => {
  it('serverer et ferskt getEntry-treff uten å bruke destruktiv get()', async () => {
    const doc = { format: 1, fresh: true };
    app.api.cache = {
      getEntry: async () => ({ value: doc, fresh: true, stored: Date.now() }),
      get: async () => { throw new Error('destruktiv get() skal ikke kalles'); },
      set: async () => {}
    };
    CatalogIndex._fetchJson = async () => { throw new Error('nettverket skal ikke kalles'); };

    assert.equal(await CatalogIndex._cachedJson('key', '/index.json', 100), doc);
  });

  it('beholder et utløpt treff lokalt og serverer det når nettet feiler', async () => {
    const stale = { format: 1, stale: true };
    let stored = { value: stale, fresh: false, stored: Date.now() - 1000 };
    app.api.cache = {
      get: async () => {
        stored = null;
        return null;
      },
      getEntry: async () => stored,
      set: async () => {}
    };
    CatalogIndex._fetchJson = async () => { throw new Error('offline'); };

    assert.equal(await CatalogIndex._cachedJson('key', '/index.json', 100), stale);
  });
});
