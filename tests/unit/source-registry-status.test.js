/**
 * source-registry.js — per-kilde statusrapportering og reloadSource().
 *
 * Fasadens getAllTables skal fortsatt returnere kun { tables } (bakover-
 * kompatibelt), mens status flyter out-of-band via api.getSourceStatus() og
 * api.onSourceStatusChange(). Søk (query/pastDays) skal ALDRI overskrive
 * statusmappet — ellers flipper badgen ved hvert søk.
 *
 * Scenario: SSB nede (nettverksfeil), NB og FHI oppe.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const state = { ssbDown: true };

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('data.ssb.no')) {
      if (state.ssbDown) throw new Error('SSB er nede i test');
      return jsonResponse({
        tables: [{ id: '13760', label: 'SSB-tabell', paths: [] }],
        page: { totalPages: 1 }
      });
    }
    if (u.includes('data.norges-bank.no')) {
      return { ok: false, status: 404, json: async () => null }; // prober degraderer pent
    }
    if (u.includes('fhi-catalog.json')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.endsWith('/Common/source')) {
      return jsonResponse([{ id: 'nokkel', title: 'Nøkkeltall' }]);
    }
    const m = /\/([^/]+)\/table$/.exec(u);
    if (m) {
      return jsonResponse([{ tableId: 101, title: 'FHI-tabell', publishedAt: '2024-01-01' }]);
    }
    throw new Error('uventet URL i test: ' + u);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

function statusFor(sourceId) {
  return app.api.getSourceStatus().find(s => s.sourceId === sourceId);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SourceRegistry — per-kilde status', () => {
  it('SSB nede: getAllTables resolver med NB/FHI-tabeller, status viser feilen', async () => {
    const events = [];
    const listener = (statuses) => events.push(statuses);
    app.api.onSourceStatusChange(listener);

    const result = await app.api.getAllTables({ lang: 'no', includeDiscontinued: true });
    app.api.offSourceStatusChange(listener);

    // Bakoverkompatibelt: kun { tables }, ingen sourceMeta-lekkasje
    assert.deepEqual(Object.keys(result), ['tables']);
    assert.ok(result.tables.some(t => t.id === 'nb-EXR'), 'NB-tabeller med');
    assert.ok(result.tables.some(t => String(t.id).startsWith('fhi-')), 'FHI-tabeller med');
    assert.ok(!result.tables.some(t => t.id === '13760'), 'ingen SSB-tabeller');

    const ssb = statusFor('ssb');
    assert.equal(ssb.status, 'error');
    assert.ok(String(ssb.error).includes('SSB er nede'), 'feilmeldingen bevares');
    assert.equal(ssb.tableCount, 0);

    assert.equal(statusFor('nb').status, 'ok');
    assert.ok(statusFor('nb').tableCount > 0);
    assert.equal(statusFor('fhi').status, 'ok');

    assert.ok(events.length > 0, 'onSourceStatusChange skal ha fyrt');
  });

  it('søk (query) overskriver ikke statusmappet', async () => {
    const before = JSON.stringify(app.api.getSourceStatus());
    // SSB er fortsatt nede — et søk feiler for SSB, men statusen skal bestå urørt
    await app.api.getTables({ query: 'befolkning' });
    assert.equal(JSON.stringify(app.api.getSourceStatus()), before);
  });

  it('utløpt SSB-cache → stale fallback med status ok/fromCache/stale', async () => {
    // Forhåndsse en utløpt cachet katalog under nøkkelen getAllTables bruker
    const pageSize = app.AppConfig.limits.tablePageBatchSize || 10000;
    const key = 'ssb_tables_no_true_' + pageSize;
    localStorage.setItem(key, JSON.stringify({
      value: { tables: [{ id: '99999', label: 'Gammel SSB-tabell', paths: [] }] },
      stored: Date.now() - 2 * DAY_MS,
      expires: Date.now() - 1000
    }));

    const result = await app.api.getAllTables({ lang: 'no', includeDiscontinued: true });
    assert.ok(result.tables.some(t => t.id === '99999'), 'stale SSB-tabeller serveres');

    const ssb = statusFor('ssb');
    assert.equal(ssb.status, 'ok');
    assert.equal(ssb.fromCache, true);
    assert.equal(ssb.stale, true);
    assert.ok(ssb.tableCount > 0);
  });

  it('reloadSource("ssb", {force:true}) etter at SSB er oppe → fersk ok', async () => {
    state.ssbDown = false;
    const result = await app.api.reloadSource('ssb', { force: true });
    assert.ok(result.tables.some(t => t.id === '13760'));

    const ssb = statusFor('ssb');
    assert.equal(ssb.status, 'ok');
    assert.equal(ssb.fromCache, false);
    assert.equal(ssb.stale, false);
    assert.equal(ssb.tableCount, 1);
  });

  it('reloadSource på ukjent kilde kaster', async () => {
    await assert.rejects(() => app.api.reloadSource('finnes-ikke'));
  });

  it('eldre aggregering overskriver ikke status fra en nyere reload', async () => {
    const ssb = app.SourceRegistry.adapters.find(a => a.sourceId === 'ssb');
    const originalGetAllTables = ssb.getAllTables;
    const aggregation = deferred();
    const reload = deferred();
    let calls = 0;

    ssb.getAllTables = () => {
      calls += 1;
      return calls === 1 ? aggregation.promise : reload.promise;
    };

    try {
      const aggregatePromise = app.api.getAllTables({
        lang: 'no',
        includeDiscontinued: true
      });
      const reloadPromise = app.api.reloadSource('ssb', { force: true });

      reload.resolve({
        tables: [{ id: 'ny', label: 'Ny reload-tabell', paths: [] }],
        sourceMeta: { fromCache: false, stale: false, fetchedAt: 200 }
      });
      await reloadPromise;

      aggregation.resolve({
        tables: [
          { id: 'gammel-1', label: 'Gammel tabell 1', paths: [] },
          { id: 'gammel-2', label: 'Gammel tabell 2', paths: [] }
        ],
        sourceMeta: { fromCache: true, stale: true, fetchedAt: 100 }
      });
      await aggregatePromise;

      const status = statusFor('ssb');
      assert.equal(status.status, 'ok');
      assert.equal(status.tableCount, 1);
      assert.equal(status.fromCache, false);
      assert.equal(status.stale, false);
      assert.equal(status.fetchedAt, 200);
    } finally {
      ssb.getAllTables = originalGetAllTables;
    }
  });
});

describe('SourceRegistry — aggregateTables options.onlySources', () => {
  it('filtrerer aggregeringen til de oppgitte kildene (delvis-indeks-fallbacken)', async () => {
    const result = await app.api.getAllTables({
      lang: 'no',
      includeDiscontinued: true,
      onlySources: ['nb']
    });

    assert.ok(result.tables.length > 0, 'NB skal svare');
    assert.ok(result.tables.every(t => String(t.id).startsWith('nb-')),
      'kun NB-tabeller når onlySources = [nb]');
    assert.deepEqual(Object.keys(result), ['tables'], 'fortsatt kun { tables }');
  });

  it('rører ikke statusen til kilder som ikke ble spurt', async () => {
    const ssbBefore = JSON.stringify(statusFor('ssb'));
    await app.api.getAllTables({ lang: 'no', includeDiscontinued: true, onlySources: ['nb'] });
    assert.equal(JSON.stringify(statusFor('ssb')), ssbBefore);
  });

  it('tom/utelatt onlySources aggregerer alle kilder som før', async () => {
    const all = await app.api.getAllTables({ lang: 'no', includeDiscontinued: true, onlySources: [] });
    assert.ok(all.tables.some(t => String(t.id).startsWith('nb-')));
    assert.ok(all.tables.some(t => String(t.id).startsWith('fhi-')));
  });
});
