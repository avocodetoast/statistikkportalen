/**
 * cache.js — stale-kapabel lesing (getEntry) og retensjon av utløpte
 * katalognøkler i cleanup(), grunnlaget for stale-if-error-fallback når en
 * kilde er nede. getEntry() skal ALDRI slette; get()-kontrakten er uendret.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Overskriv expires/stored direkte i localStorage-shimen (prefikset nøkkel). */
function rewriteEntry(cm, key, patch) {
  const raw = localStorage.getItem(cm.prefix + key);
  assert.ok(raw, 'forventet at ' + key + ' finnes i localStorage');
  const item = JSON.parse(raw);
  Object.assign(item, patch);
  localStorage.setItem(cm.prefix + key, JSON.stringify(item));
}

describe('CacheManager.getEntry — ikke-destruktiv lesing', () => {
  const cm = new app.CacheManager();

  it('returnerer fresh entry med verdi og metadata', async () => {
    await cm.set('tables_no_true_10000', { tables: [{ id: '1' }] }, 60000);
    const entry = await cm.getEntry('tables_no_true_10000');
    assert.ok(entry);
    assert.deepEqual(entry.value, { tables: [{ id: '1' }] });
    assert.equal(entry.expired, false);
    assert.equal(entry.fresh, true);
    assert.ok(typeof entry.stored === 'number' && entry.stored > 0);
    assert.ok(typeof entry.expires === 'number' && entry.expires > Date.now());
  });

  it('returnerer null for ukjent nøkkel', async () => {
    assert.equal(await cm.getEntry('finnes_ikke'), null);
  });

  it('returnerer utløpt entry med verdi intakt — uten å slette den', async () => {
    await cm.set('tables_no_true_10000', { tables: [{ id: '2' }] }, 60000);
    rewriteEntry(cm, 'tables_no_true_10000', { expires: Date.now() - 1000 });

    const entry = await cm.getEntry('tables_no_true_10000');
    assert.ok(entry, 'utløpt entry skal fortsatt returneres');
    assert.equal(entry.expired, true);
    assert.equal(entry.fresh, false);
    assert.deepEqual(entry.value, { tables: [{ id: '2' }] });

    // Oppføringen skal fortsatt ligge i localStorage etter getEntry
    assert.ok(localStorage.getItem(cm.prefix + 'tables_no_true_10000'),
      'getEntry skal ikke slette utløpte oppføringer');
  });

  it('markerer schedule-stale SSB-entry som ikke fresh, men beholder verdien', async () => {
    await cm.set('tables_no_true_10000', { tables: [{ id: '3' }] }, 60000);
    // stored langt tilbake → _isStaleBySSBSchedule slår til (SSB-eid nøkkel)
    rewriteEntry(cm, 'tables_no_true_10000', { stored: Date.now() - 30 * DAY_MS });

    const entry = await cm.getEntry('tables_no_true_10000');
    assert.ok(entry);
    assert.equal(entry.expired, false, 'TTL er ikke utløpt');
    assert.equal(entry.fresh, false, 'schedule-stale skal tvinge refetch');
    assert.deepEqual(entry.value, { tables: [{ id: '3' }] });
  });

  it('get() beholder eksisterende kontrakt: utløpt → null', async () => {
    await cm.set('tables_no_true_10000', { tables: [{ id: '4' }] }, 60000);
    rewriteEntry(cm, 'tables_no_true_10000', { expires: Date.now() - 1000 });
    assert.equal(await cm.get('tables_no_true_10000'), null);
  });
});

describe('CacheManager.cleanup — retensjon av utløpte katalognøkler', () => {
  it('beholder utløpt tables_-nøkkel innenfor retensjonsvinduet', async () => {
    const cm = new app.CacheManager();
    await cm.set('tables_no_true_10000', { tables: [] }, 60000);
    rewriteEntry(cm, 'tables_no_true_10000', { expires: Date.now() - 1000 });

    await cm.cleanup();

    assert.ok(localStorage.getItem(cm.prefix + 'tables_no_true_10000'),
      'utløpt katalognøkkel innen retensjon skal overleve cleanup');
  });

  it('fjerner utløpt tables_-nøkkel utenfor retensjonsvinduet', async () => {
    const cm = new app.CacheManager();
    await cm.set('tables_no_true_10000', { tables: [] }, 60000);
    rewriteEntry(cm, 'tables_no_true_10000', { expires: Date.now() - 8 * DAY_MS });

    await cm.cleanup();

    assert.equal(localStorage.getItem(cm.prefix + 'tables_no_true_10000'), null,
      'katalognøkkel utenfor retensjon skal fjernes');
  });

  it('fjerner fortsatt utløpte ikke-katalognøkler umiddelbart', async () => {
    const cm = new app.CacheManager();
    await cm.set('table_13760_meta', { meta: true }, 60000);
    rewriteEntry(cm, 'table_13760_meta', { expires: Date.now() - 1000 });

    await cm.cleanup();

    assert.equal(localStorage.getItem(cm.prefix + 'table_13760_meta'), null,
      'ikke-katalognøkler følger vanlig utløp i cleanup');
  });

  it('slår opp _ref-nøkler og sletter IndexedDB-data utenfor retensjon', async () => {
    const cm = new app.CacheManager();
    const key = 'tables_nb_no';
    const refKey = cm.prefix + key + '_ref';
    localStorage.setItem(refKey, JSON.stringify({ storage: 'indexeddb', size: 2048 }));

    const deleted = [];
    cm._initPromise = Promise.resolve(true);
    cm.indexedDBCache._getRaw = async (lookupKey) => {
      assert.equal(lookupKey, key);
      return {
        value: { tables: [] },
        stored: Date.now() - 10 * DAY_MS,
        expires: Date.now() - 8 * DAY_MS
      };
    };
    cm.indexedDBCache.delete = async (deleteKey) => { deleted.push(deleteKey); };

    const removed = await cm.cleanup();

    assert.deepEqual(deleted, [key]);
    assert.equal(localStorage.getItem(refKey), null);
    assert.equal(removed, 1);
  });
});
