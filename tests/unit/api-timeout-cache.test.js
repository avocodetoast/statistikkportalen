/**
 * api.js — SSB-kall skal bruke den delte timeout-hjelperen, og cachetømming
 * skal være awaitbar helt ned til IndexedDB.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/app-env.js');

const app = loadApp([
  'js/version.js',
  'js/sources/nb-catalog.js',
  'js/sources/source-topology.js',
  'js/config.js',
  'js/translations.js',
  'js/cache.js',
  'js/sources/source-common.js',
  'js/catalog-index.js',
  'js/api.js'
]);

describe('SSBApi._throttledFetch — timeout', () => {
  it('sender SSB-kall gjennom SourceCommon med et romsligere katalogtak', async () => {
    const calls = [];
    app.SourceCommon.fetchWithTimeout = async (url, options, timeoutOptions) => {
      calls.push({ url, options, timeoutOptions });
      return { ok: true, status: 200 };
    };

    const options = { headers: { Accept: 'application/json' } };
    const response = await app.api._throttledFetch('https://data.ssb.no/test', options);

    assert.equal(response.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://data.ssb.no/test');
    assert.equal(calls[0].options, options);
    assert.equal(calls[0].timeoutOptions.queue, 'ssb');
    assert.equal(calls[0].timeoutOptions.timeoutMs, 30000);
    assert.equal(app.AppConfig.sources.ssb.fetchTimeoutMs, 30000);
  });
});

describe('SSBApi.clearCache', () => {
  it('returnerer cache.clear()-promisen slik at caller faktisk kan await den', () => {
    const pending = new Promise(() => {});
    app.api.cache.clear = () => pending;
    assert.equal(app.api.clearCache(), pending);
  });
});
