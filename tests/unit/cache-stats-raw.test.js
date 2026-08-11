'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);

describe('CacheManager.getStats', () => {
  it('counts valid, expired, malformed, and IndexedDB-reference entries', () => {
    const cm = new app.CacheManager();
    const now = Date.now();
    localStorage.setItem('ssb_valid', JSON.stringify({ expires: now + 10000, value: 1 }));
    localStorage.setItem('ssb_expired', JSON.stringify({ expires: now - 1, value: 2 }));
    localStorage.setItem('ssb_broken', '{');
    localStorage.setItem('ssb_large_ref', '1');
    localStorage.setItem('other', 'ignored');

    assert.deepEqual(cm.getStats(), {
      localStorage: { totalEntries: 3, validEntries: 1, expiredEntries: 2, totalSizeKB: 0 },
      indexedDB: { entriesCount: 1, isAvailable: false }
    });
  });
});

describe('IndexedDBCache._getRaw', () => {
  it('resolves the complete stored entry from request.onsuccess', async () => {
    const cm = new app.CacheManager();
    const raw = { value: { x: 1 }, stored: 10, expires: 20 };
    cm.indexedDBCache.isAvailable = true;
    cm.indexedDBCache.db = {
      transaction() {
        return { objectStore() { return { get() {
          const request = {};
          queueMicrotask(() => { request.result = raw; request.onsuccess(); });
          return request;
        } }; } };
      }
    };
    assert.deepEqual(await cm.indexedDBCache._getRaw('key'), raw);
  });

  it('resolves null on request error and synchronous database errors', async () => {
    const cm = new app.CacheManager();
    cm.indexedDBCache.isAvailable = true;
    cm.indexedDBCache.db = {
      transaction() {
        return { objectStore() { return { get() {
          const request = {};
          queueMicrotask(() => request.onerror());
          return request;
        } }; } };
      }
    };
    assert.equal(await cm.indexedDBCache._getRaw('error'), null);

    cm.indexedDBCache.db = { transaction() { throw new Error('boom'); } };
    assert.equal(await cm.indexedDBCache._getRaw('throw'), null);
  });
});
