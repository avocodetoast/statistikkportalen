/**
 * js/sources/source-common.js — request queue behind fetchWithTimeout.
 *
 * The Norges Bank and FHI adapters bypass SSB's throttled fetch entirely, so
 * without this queue a page load (or a forced catalogue refresh) fires every
 * request at once. The queue caps concurrency per pool and collapses identical
 * in-flight GETs into a single network request.
 *
 * The timeout clock must start when a request LEAVES the queue, not when it is
 * enqueued — otherwise a queued request can time out before it ever runs.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/sources/sdmx-to-jsonstat.js',
  'js/sources/source-common.js'
]);

const { SourceCommon } = app;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fake fetch that records concurrency. Each call resolves after `delayMs` with
 * a Response-like object carrying the requested url.
 */
function trackingFetch({ delayMs = 10 } = {}) {
  const state = { calls: [], inFlight: 0, maxInFlight: 0 };
  const impl = async (url) => {
    state.calls.push(url);
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await sleep(delayMs);
      return { ok: true, status: 200, url };
    } finally {
      state.inFlight--;
    }
  };
  return { state, impl };
}

describe('SourceCommon.fetchWithTimeout — concurrency cap', () => {
  it('never runs more than `limit` requests at once', async () => {
    const { state, impl } = trackingFetch({ delayMs: 20 });
    global.fetch = impl;

    const urls = Array.from({ length: 12 }, (_, i) => 'https://example.test/cap/' + i);
    const results = await Promise.all(urls.map(url =>
      SourceCommon.fetchWithTimeout(url, {}, { timeoutMs: 5000, queue: 'cap-test', limit: 3 })
    ));

    assert.equal(state.calls.length, 12, 'every request should reach fetch()');
    assert.equal(results.length, 12);
    assert.ok(state.maxInFlight <= 3,
      'expected at most 3 concurrent requests, saw ' + state.maxInFlight);
    assert.ok(state.maxInFlight > 1,
      'expected the queue to run requests in parallel up to the limit');
  });

  it('keeps separate pools independent', async () => {
    const { state, impl } = trackingFetch({ delayMs: 20 });
    global.fetch = impl;

    await Promise.all([
      ...Array.from({ length: 3 }, (_, i) =>
        SourceCommon.fetchWithTimeout('https://example.test/pool-a/' + i, {}, { queue: 'pool-a', limit: 1 })),
      ...Array.from({ length: 3 }, (_, i) =>
        SourceCommon.fetchWithTimeout('https://example.test/pool-b/' + i, {}, { queue: 'pool-b', limit: 1 }))
    ]);

    // Two pools of 1 → at most 2 concurrent overall, never 3+.
    assert.ok(state.maxInFlight <= 2, 'pools must not share their slot budget');
    assert.equal(state.calls.length, 6);
  });

  it('releases its slot when a request fails, so the queue keeps draining', async () => {
    let n = 0;
    global.fetch = async (url) => {
      n++;
      if (n <= 2) throw new Error('network down');
      return { ok: true, status: 200, url };
    };

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        SourceCommon.fetchWithTimeout('https://example.test/fail/' + i, {}, { queue: 'fail-test', limit: 1 }))
    );

    assert.equal(settled.filter(r => r.status === 'rejected').length, 2);
    assert.equal(settled.filter(r => r.status === 'fulfilled').length, 3);
  });

  it('starts the timeout clock when the request leaves the queue', async () => {
    // Limit 1 + a 60 ms request means the second call waits ~60 ms — longer
    // than its own 40 ms timeout. It must still succeed.
    global.fetch = async (url, options) => {
      await sleep(60);
      if (options && options.signal && options.signal.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return { ok: true, status: 200, url };
    };

    const [first, second] = await Promise.all([
      SourceCommon.fetchWithTimeout('https://example.test/slow/1', {}, { timeoutMs: 200, queue: 'clock-test', limit: 1 }),
      SourceCommon.fetchWithTimeout('https://example.test/slow/2', {}, { timeoutMs: 200, queue: 'clock-test', limit: 1 })
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });
});

describe('SourceCommon.fetchWithTimeout — in-flight dedupe', () => {
  it('collapses concurrent GETs for the same URL into one fetch', async () => {
    const { state, impl } = trackingFetch({ delayMs: 20 });
    global.fetch = impl;

    const url = 'https://example.test/dedupe/same';
    const results = await Promise.all([
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'dedupe-test' }),
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'dedupe-test' }),
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'dedupe-test' })
    ]);

    assert.equal(state.calls.length, 1, 'expected a single network request');
    results.forEach(res => assert.equal(res.ok, true));
  });

  it('gives every sharer its own body via clone() when the Response supports it', async () => {
    let cloneCount = 0;
    global.fetch = async (url) => {
      await sleep(10);
      return {
        ok: true, status: 200, url, bodyUsed: false,
        clone() { cloneCount++; return { ok: true, status: 200, url, cloned: true }; }
      };
    };

    const url = 'https://example.test/dedupe/clone';
    const results = await Promise.all([
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'clone-test' }),
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'clone-test' })
    ]);

    assert.equal(cloneCount, 2, 'each sharer needs its own unconsumed body');
    results.forEach(res => assert.equal(res.cloned, true));
  });

  it('does not clone when a request has no sharers', async () => {
    let cloneCount = 0;
    global.fetch = async (url) => ({
      ok: true, status: 200, url,
      clone() { cloneCount++; return { ok: true, status: 200, url, cloned: true }; }
    });

    const res = await SourceCommon.fetchWithTimeout('https://example.test/dedupe/solo', {}, { queue: 'solo-test' });
    assert.equal(cloneCount, 0);
    assert.equal(res.cloned, undefined);
  });

  it('does not dedupe requests that no longer overlap', async () => {
    const { state, impl } = trackingFetch({ delayMs: 5 });
    global.fetch = impl;

    const url = 'https://example.test/dedupe/sequential';
    await SourceCommon.fetchWithTimeout(url, {}, { queue: 'seq-test' });
    await SourceCommon.fetchWithTimeout(url, {}, { queue: 'seq-test' });

    assert.equal(state.calls.length, 2, 'dedupe must not act as a response cache');
  });

  it('does not dedupe non-GET requests', async () => {
    const { state, impl } = trackingFetch({ delayMs: 20 });
    global.fetch = impl;

    const url = 'https://example.test/dedupe/post';
    await Promise.all([
      SourceCommon.fetchWithTimeout(url, { method: 'POST', body: '{"a":1}' }, { queue: 'post-test' }),
      SourceCommon.fetchWithTimeout(url, { method: 'POST', body: '{"a":2}' }, { queue: 'post-test' })
    ]);

    assert.equal(state.calls.length, 2, 'POST bodies differ — sharing one response would be wrong');
  });

  it('rejects every sharer when the shared request fails', async () => {
    const boom = new Error('network down');
    global.fetch = async () => { await sleep(10); throw boom; };

    const url = 'https://example.test/dedupe/boom';
    const settled = await Promise.allSettled([
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'boom-test' }),
      SourceCommon.fetchWithTimeout(url, {}, { queue: 'boom-test' })
    ]);

    assert.equal(settled.length, 2);
    settled.forEach(r => {
      assert.equal(r.status, 'rejected');
      assert.equal(r.reason, boom);
    });
  });
});
