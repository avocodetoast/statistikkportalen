/**
 * scripts/lib/nb-periods.mjs — the build-time probe behind
 * data/sources/nb-periods.json.
 *
 * The app used to probe every Norges Bank catalogue row on each cold page load
 * (31 parallel requests, blocking BrowserState.init). The periods are now baked
 * at build time instead. The two pure pieces — which probes to run, and how to
 * read a probe response — are what this file pins down; they must stay in step
 * with fetchCataloguePeriod() in js/sources/norges-bank-adapter.js.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// CJS kan ikke require() en ESM-modul — dynamisk import, delt promise.
const mod = import('../../scripts/lib/nb-periods.mjs');

const appConfig = {
  sources: {
    nb: {
      baseUrl: 'https://data.norges-bank.no/api',
      dataflows: [
        { flow: 'EXR', tableId: 'nb-EXR' },
        { flow: 'REGNET', tableId: 'nb-REGNET' },
        { flow: 'REGNET', tableId: 'nb-REGNET-PROD', probeKey: 'Q.PROD.._X.' },
        { flow: 'LIQUIDITY_FORECAST', tableId: 'nb-LIQ', probeKey: { period: 'D.STAT_S..', time: 'D.FCAST_CBC..' } }
      ]
    }
  }
};

describe('probeTargets', () => {
  it('emits one target per catalogue row, keyed by tableId', async () => {
    const targets = (await mod).probeTargets(appConfig);
    assert.deepEqual(targets.map(t => t.tableId), ['nb-EXR', 'nb-REGNET', 'nb-REGNET-PROD', 'nb-LIQ']);
  });

  it('uses the row\'s own period probe key — rows sharing a flow have different windows', async () => {
    const byId = new Map((await mod).probeTargets(appConfig).map(t => [t.tableId, t]));
    assert.equal(byId.get('nb-REGNET').probeKey, '');
    assert.equal(byId.get('nb-REGNET-PROD').probeKey, 'Q.PROD.._X.');
  });

  it('reads the period key from an object probeKey (period/time split)', async () => {
    const byId = new Map((await mod).probeTargets(appConfig).map(t => [t.tableId, t]));
    assert.equal(byId.get('nb-LIQ').probeKey, 'D.STAT_S..');
  });

  it('groups rows that would issue an identical request under one probeId', async () => {
    const targets = (await mod).probeTargets(appConfig);
    const ids = targets.map(t => t.probeId);
    assert.equal(new Set(ids).size, 4, 'the four rows here are all distinct probes');

    const shared = (await mod).probeTargets({
      sources: { nb: { dataflows: [
        { flow: 'SEC', tableId: 'nb-A' },
        { flow: 'SEC', tableId: 'nb-B' }
      ] } }
    });
    assert.equal(shared[0].probeId, shared[1].probeId,
      'same flow + same key = one request, reused for both rows');
  });

  it('builds the same URL shape as the adapter probe', async () => {
    const byId = new Map((await mod).probeTargets(appConfig).map(t => [t.tableId, t]));
    assert.equal(byId.get('nb-EXR').url,
      'https://data.norges-bank.no/api/data/EXR/?format=sdmx-json&firstNObservations=1&lastNObservations=1');
    assert.equal(byId.get('nb-REGNET-PROD').url,
      'https://data.norges-bank.no/api/data/REGNET/Q.PROD.._X.?format=sdmx-json&firstNObservations=1&lastNObservations=1');
  });

  it('returns an empty list when no dataflows are configured', async () => {
    assert.deepEqual((await mod).probeTargets({ sources: { nb: {} } }), []);
    assert.deepEqual((await mod).probeTargets({}), []);
  });
});

describe('parseProbeResponse', () => {
  const response = (values, prepared) => ({
    meta: prepared ? { prepared } : undefined,
    data: {
      structure: {
        dimensions: { observation: [{ id: 'TIME_PERIOD', values: values.map(id => ({ id })) }] }
      }
    }
  });

  it('returns the year span plus the exact outer period codes', async () => {
    const out = (await mod).parseProbeResponse(response(['2001-01-02', '2026-07-24'], '2026-07-25T05:00:00Z'));
    assert.deepEqual(out, {
      firstPeriod: '2001',
      lastPeriod: '2026',
      firstCode: '2001-01-02',
      lastCode: '2026-07-24',
      updated: '2026-07-25T05:00:00Z'
    });
  });

  it('sorts the codes rather than trusting the response order', async () => {
    const out = (await mod).parseProbeResponse(response(['2026-07-24', '2001-01-02']));
    assert.equal(out.firstCode, '2001-01-02');
    assert.equal(out.lastCode, '2026-07-24');
  });

  it('handles the structures[] array form of SDMX-JSON', async () => {
    const out = (await mod).parseProbeResponse({
      data: { structures: [{ dimensions: { observation: [{ values: [{ id: '2020' }, { id: '2024' }] }] } }] }
    });
    assert.equal(out.firstPeriod, '2020');
    assert.equal(out.lastPeriod, '2024');
  });

  it('leaves updated empty when the response has no prepared timestamp', async () => {
    assert.equal((await mod).parseProbeResponse(response(['2020'])).updated, '');
  });

  it('returns null when there is nothing usable to read', async () => {
    assert.equal((await mod).parseProbeResponse(null), null);
    assert.equal((await mod).parseProbeResponse({}), null);
    assert.equal((await mod).parseProbeResponse(response([])), null);
    assert.equal((await mod).parseProbeResponse(response(['ikke-en-periode'])), null);
  });
});

describe('probeAll', () => {
  it('issues one request per distinct probe and fans the result out to every row', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          meta: { prepared: '2026-07-25T05:00:00Z' },
          data: { structure: { dimensions: { observation: [{ values: [{ id: '2020' }, { id: '2024' }] }] } } }
        })
      };
    };

    const out = await (await mod).probeAll({
      sources: { nb: { baseUrl: 'https://nb.test/api', dataflows: [
        { flow: 'SEC', tableId: 'nb-A' },
        { flow: 'SEC', tableId: 'nb-B' },
        { flow: 'EXR', tableId: 'nb-EXR' }
      ] } }
    }, { fetchImpl, delayMs: 0 });

    assert.equal(calls.length, 2, 'nb-A and nb-B share one request');
    assert.deepEqual(Object.keys(out.tables).sort(), ['nb-A', 'nb-B', 'nb-EXR']);
    assert.equal(out.tables['nb-A'].firstPeriod, '2020');
    assert.equal(out.tables['nb-B'].lastPeriod, '2024');
    assert.ok(out.generatedAt, 'the output records when it was built');
  });

  it('skips failing probes instead of aborting the whole build', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('BROKEN')) throw new Error('network down');
      return {
        ok: true,
        json: async () => ({
          data: { structure: { dimensions: { observation: [{ values: [{ id: '2020' }] }] } } }
        })
      };
    };

    const warnings = [];
    const out = await (await mod).probeAll({
      sources: { nb: { baseUrl: 'https://nb.test/api', dataflows: [
        { flow: 'BROKEN', tableId: 'nb-BROKEN' },
        { flow: 'OK', tableId: 'nb-OK' }
      ] } }
    }, { fetchImpl, delayMs: 0, warn: m => warnings.push(m) });

    assert.deepEqual(Object.keys(out.tables), ['nb-OK']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /nb-BROKEN/);
  });

  it('treats a non-ok HTTP status as a failed probe', async () => {
    const out = await (await mod).probeAll({
      sources: { nb: { baseUrl: 'https://nb.test/api', dataflows: [{ flow: 'X', tableId: 'nb-X' }] } }
    }, { fetchImpl: async () => ({ ok: false, status: 500 }), delayMs: 0, warn: () => {} });

    assert.deepEqual(out.tables, {});
  });
});
