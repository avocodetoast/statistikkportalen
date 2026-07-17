/**
 * cache.js — CacheManager namespace and staleness logic.
 * Migrated from the legacy test.html suite. IndexedDB is unavailable in the
 * Node test environment; CacheManager must fall back to localStorage-only.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);

describe('CacheManager — SSB namespace', () => {
  const cm = new app.CacheManager();

  it('uses the ssb_ localStorage prefix', () => {
    assert.equal(cm.prefix, 'ssb_');
  });

  it('uses the ssb_cache IndexedDB database name', () => {
    assert.equal(cm.indexedDBCache.dbName, 'ssb_cache');
  });

  it('computes a positive last-SSB-update timestamp (schedule staleness on)', () => {
    // With 3 sourceUpdateTimes in AppConfig this must return a real timestamp
    assert.ok(cm._getLastSSBUpdateTimestamp() > 0);
  });
});

describe('CacheManager — localStorage fallback (no IndexedDB in Node)', () => {
  const cm = new app.CacheManager();

  it('set/get round-trips a small value via localStorage', async () => {
    await cm.set('unit_test_key', { hello: 'verden' }, 60000);
    const value = await cm.get('unit_test_key');
    assert.deepEqual(value, { hello: 'verden' });
  });

  it('expires values after their TTL', async () => {
    await cm.set('unit_test_expired', 'x', -1);
    const value = await cm.get('unit_test_expired');
    assert.equal(value, null);
  });
});
