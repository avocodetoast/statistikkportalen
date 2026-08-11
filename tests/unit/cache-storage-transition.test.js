/**
 * cache.js — overgang mellom localStorage og IndexedDB for samme nøkkel.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);

function createCacheManager() {
  const cm = new app.CacheManager();
  const entries = new Map();

  cm.largeSizeThreshold = 200;
  cm._initPromise = Promise.resolve(true);
  cm.indexedDBCache.set = async (key, value, ttlMs) => {
    entries.set(key, {
      value,
      expires: Date.now() + ttlMs,
      stored: Date.now()
    });
  };
  cm.indexedDBCache._getRaw = async (key) => entries.get(key) || null;
  cm.indexedDBCache.get = async (key) => {
    const item = entries.get(key);
    if (!item || Date.now() > item.expires) {
      entries.delete(key);
      return null;
    }
    return item.value;
  };
  cm.indexedDBCache.delete = async (key) => { entries.delete(key); };

  return { cm, entries };
}

describe('CacheManager.set — overgang mellom lagringsnivåer', () => {
  it('erstatter stor IndexedDB-verdi med ny liten localStorage-verdi', async () => {
    const { cm, entries } = createCacheManager();
    const key = 'nivaa_stor_til_liten';

    await cm.set(key, { tekst: 'x'.repeat(300) }, 60000);
    await cm.set(key, { tekst: 'ny liten verdi' }, 60000);

    assert.equal(localStorage.getItem(cm.prefix + key + '_ref'), null);
    assert.equal(entries.has(key), false);
    assert.deepEqual(await cm.get(key), { tekst: 'ny liten verdi' });
  });

  it('lar ikke gammel localStorage-verdi gjenoppstå etter liten→stor→utløp', async () => {
    const { cm, entries } = createCacheManager();
    const key = 'nivaa_liten_til_stor';

    await cm.set(key, { tekst: 'gammel liten verdi' }, 60000);
    await cm.set(key, { tekst: 'y'.repeat(300) }, 60000);

    assert.equal(localStorage.getItem(cm.prefix + key), null);
    entries.get(key).expires = Date.now() - 1;

    assert.equal(await cm.get(key), null);
    assert.equal(await cm.get(key), null);
  });

  it('rydder gammel localStorage-verdi ved QuotaExceeded-fallback til IndexedDB', async () => {
    const { cm, entries } = createCacheManager();
    const key = 'nivaa_quota_fallback';
    const storageKey = cm.prefix + key;

    localStorage.setItem(storageKey, JSON.stringify({
      value: { tekst: 'gammel verdi' },
      expires: Date.now() + 60000,
      stored: Date.now()
    }));

    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (candidateKey, value) => {
      if (candidateKey === storageKey) {
        const error = new Error('kvoten er brukt opp');
        error.name = 'QuotaExceededError';
        throw error;
      }
      originalSetItem(candidateKey, value);
    };

    await cm.set(key, { tekst: 'ny verdi' }, 60000);

    assert.equal(localStorage.getItem(storageKey), null);
    assert.ok(localStorage.getItem(storageKey + '_ref'));
    assert.deepEqual(entries.get(key).value, { tekst: 'ny verdi' });
  });
});
