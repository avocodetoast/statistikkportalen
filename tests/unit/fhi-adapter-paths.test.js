/**
 * fhi-adapter.js — multi-path-plasseringer + ny feilkontrakt for katalogen:
 *   - cfg.paths[source] kan overstyre standardplasseringen [['he','fhi-<source>']]
 *     med flere plasseringer i emnetreet.
 *   - Alle delkilder nede → getTables() KASTER (fasadens allSettled skal se
 *     FHI feile — dagens stille {tables:[]} brøt kontrakten i source-registry).
 *   - Én av flere delkilder nede → resolver med sourceMeta.partial.
 *   - Delkilde nede med (utløpt) cachet liste → stale fallback, ikke feil.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// Styrbar fake-fetch: delkilder i `failing` får nettverksfeil på /table.
const failing = new Set();

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const TABLE_ROWS = {
  nokkel: [{ tableId: 101, title: 'Nøkkeltabell', publishedAt: '2024-01-01', modifiedAt: '2024-06-01' }],
  mfr: [{ tableId: 201, title: 'MFR-tabell', publishedAt: '2024-02-01', modifiedAt: '' }],
  daar: [{ tableId: 301, title: 'DÅR-tabell', publishedAt: '2024-03-01', modifiedAt: '' }]
};

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('fhi-catalog.json')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.endsWith('/Common/source')) {
      return jsonResponse([
        { id: 'nokkel', title: 'Nøkkeltall om folkehelsen' },
        { id: 'mfr', title: 'Medisinsk fødselsregister' },
        { id: 'daar', title: 'Dødsårsaksregisteret' }
      ]);
    }
    const m = /\/([^/]+)\/table$/.exec(u);
    if (m) {
      const source = m[1];
      if (failing.has(source)) throw new Error('nettverk nede for ' + source);
      return jsonResponse(TABLE_ROWS[source] || []);
    }
    throw new Error('uventet URL i test: ' + u);
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'fhi');

/** Overskriv expires direkte i localStorage-shimen (delt CacheManager, prefiks ssb_). */
function expireKey(key) {
  const raw = localStorage.getItem('ssb_' + key);
  assert.ok(raw, 'forventet cache-oppføring for ' + key);
  const item = JSON.parse(raw);
  item.expires = Date.now() - 1000;
  localStorage.setItem('ssb_' + key, JSON.stringify(item));
}

beforeEach(() => {
  localStorage.clear();
  failing.clear();
  delete app.AppConfig.sources.fhi.paths;
});

describe('FHIAdapter — multi-path katalogbygging', () => {
  it('default: én plassering ["he", "fhi-<source>"] per kilde', async () => {
    const { tables } = await adapter.getTables({});
    const nokkel = tables.find(t => t.id === 'fhi-nokkel-101');
    assert.ok(nokkel);
    assert.equal(nokkel.paths.length, 1);
    assert.equal(nokkel.paths[0][0].id, 'he');
    assert.equal(nokkel.paths[0][1].id, 'fhi-nokkel');
    assert.equal(nokkel.subjectCode, 'he');
  });

  it('cfg.paths[source] gir flere plasseringer; andre kilder beholder default', async () => {
    app.AppConfig.sources.fhi.paths = {
      daar: [['he', 'fhi-daar'], ['bf', 'fhi-daar']]
    };
    const { tables } = await adapter.getTables({});

    const daar = tables.find(t => t.id === 'fhi-daar-301');
    assert.ok(daar);
    assert.equal(daar.paths.length, 2);
    assert.equal(daar.paths[0][0].id, 'he');
    assert.equal(daar.paths[1][0].id, 'bf');
    assert.equal(daar.paths[1][1].id, 'fhi-daar');
    assert.equal(daar.subjectCode, 'he', 'subjectCode følger primærplasseringen');
    daar.paths.flat().forEach(seg => {
      assert.ok(typeof seg.label === 'string' && seg.label.length > 0);
      assert.ok(typeof seg.sortCode === 'string' && seg.sortCode.length > 0);
    });

    const mfr = tables.find(t => t.id === 'fhi-mfr-201');
    assert.equal(mfr.paths.length, 1);
    assert.equal(mfr.paths[0][1].id, 'fhi-mfr');
  });
});

describe('FHIAdapter — feilkontrakt for katalogen', () => {
  it('alle delkilder nede (uten cache) → getTables kaster', async () => {
    app.AppConfig.sources.fhi.sourceIds.forEach(s => failing.add(s));
    await assert.rejects(() => adapter.getTables({}));
  });

  it('én delkilde nede → resolver med sourceMeta.partial', async () => {
    failing.add('mfr');
    const result = await adapter.getTables({});
    assert.deepEqual(result.sourceMeta.partial, ['mfr']);
    assert.ok(result.tables.some(t => t.id === 'fhi-nokkel-101'));
    assert.ok(result.tables.some(t => t.id === 'fhi-daar-301'));
    assert.ok(!result.tables.some(t => t.id.startsWith('fhi-mfr-')));
  });

  it('alle delkilder nede med utløpt cache → stale fallback, ingen feil', async () => {
    // Prime cachen med en vellykket henting, la den utløpe, og slå av nettet.
    await adapter.getTables({});
    ['nokkel', 'mfr', 'daar'].forEach(s => expireKey('tables_fhi_' + s));
    failing.add('nokkel'); failing.add('mfr'); failing.add('daar');

    const result = await adapter.getTables({});
    assert.equal(result.sourceMeta.stale, true);
    assert.equal(result.sourceMeta.fromCache, true);
    assert.equal(result.sourceMeta.partial, undefined);
    assert.ok(result.tables.some(t => t.id === 'fhi-nokkel-101'));
  });

  it('useCache:false tvinger nettverk forbi fersk cache', async () => {
    await adapter.getTables({}); // primer cachen
    app.AppConfig.sources.fhi.sourceIds.forEach(s => failing.add(s));

    // Med fersk cache og useCache:false skal nettverket prøves — og feilen
    // fanges av stale-fallbacken (cachen finnes fortsatt).
    const result = await adapter.getTables({ useCache: false });
    assert.equal(result.sourceMeta.stale, true, 'nettverksfeil ved force → stale fallback');
    assert.equal(result.sourceMeta.fromCache, true);

    // Uten failing skal force gi ferske data (fromCache:false).
    failing.clear();
    const fresh = await adapter.getTables({ useCache: false });
    assert.equal(fresh.sourceMeta.fromCache, false);
    assert.equal(fresh.sourceMeta.stale, false);
  });
});
