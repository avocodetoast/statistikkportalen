/**
 * js/sources/source-common.js — pickLabel/uiLabelLang/fetchWithTimeout, the
 * helpers shared by norges-bank-adapter.js and fhi-adapter.js (extracted
 * from two near-identical copies — see CLAUDE.md's source-common.js row).
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

describe('SourceCommon.pickLabel', () => {
  it('picks the requested language when present', () => {
    assert.equal(SourceCommon.pickLabel({ nb: 'Norsk', en: 'English' }, 'en'), 'English');
    assert.equal(SourceCommon.pickLabel({ nb: 'Norsk', en: 'English' }, 'nb'), 'Norsk');
  });

  it('maps the SSB API language code "no" to "nb"', () => {
    assert.equal(SourceCommon.pickLabel({ nb: 'Norsk', en: 'English' }, 'no'), 'Norsk');
  });

  it('falls back to nb when the requested language is missing', () => {
    assert.equal(SourceCommon.pickLabel({ nb: 'Bare norsk' }, 'en'), 'Bare norsk');
  });

  it('falls back to en when nb is also missing', () => {
    assert.equal(SourceCommon.pickLabel({ en: 'Only English' }, 'de'), 'Only English');
  });

  it('returns an empty string for a falsy label object', () => {
    assert.equal(SourceCommon.pickLabel(null, 'nb'), '');
    assert.equal(SourceCommon.pickLabel(undefined, 'nb'), '');
  });

  it('defaults to nb when no language is given', () => {
    assert.equal(SourceCommon.pickLabel({ nb: 'Norsk', en: 'English' }), 'Norsk');
  });
});

describe('SourceCommon.uiLabelLang', () => {
  it('maps "no" to "nb"', () => {
    assert.equal(SourceCommon.uiLabelLang('no'), 'nb');
  });

  it('passes other language codes through unchanged (lowercased)', () => {
    assert.equal(SourceCommon.uiLabelLang('EN'), 'en');
  });

  it('defaults to nb for a falsy input', () => {
    assert.equal(SourceCommon.uiLabelLang(), 'nb');
    assert.equal(SourceCommon.uiLabelLang(''), 'nb');
  });
});

describe('SourceCommon.fetchWithTimeout', () => {
  it('returns the fetch Response on success', async () => {
    const fakeResponse = { ok: true, status: 200 };
    global.fetch = async () => fakeResponse;
    const res = await SourceCommon.fetchWithTimeout('https://example.test/x', {}, { timeoutMs: 1000 });
    assert.equal(res, fakeResponse);
  });

  it('wraps a TimeoutError into a friendly Error carrying the prefix, timeout, and URL', async () => {
    global.fetch = async () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    };
    await assert.rejects(
      () => SourceCommon.fetchWithTimeout('https://example.test/slow', {}, {
        timeoutMs: 5000, timeoutErrorPrefix: '[TestAdapter] Tidsavbrudd'
      }),
      (err) => {
        assert.match(err.message, /^\[TestAdapter\] Tidsavbrudd/);
        assert.match(err.message, /5000 ms/);
        assert.match(err.message, /https:\/\/example\.test\/slow/);
        return true;
      }
    );
  });

  it('wraps an AbortError the same way as a TimeoutError', async () => {
    global.fetch = async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    await assert.rejects(
      () => SourceCommon.fetchWithTimeout('https://example.test/y', {}, { timeoutMs: 1000 }),
      /Tidsavbrudd etter 1000 ms/
    );
  });

  it('rethrows non-timeout errors unchanged', async () => {
    const networkError = new Error('network down');
    global.fetch = async () => { throw networkError; };
    await assert.rejects(
      () => SourceCommon.fetchWithTimeout('https://example.test/z', {}, { timeoutMs: 1000 }),
      (err) => err === networkError
    );
  });

  it('passes fetchOptions through and always sets an AbortSignal', async () => {
    let received = null;
    global.fetch = async (url, options) => { received = { url, options }; return { ok: true }; };
    await SourceCommon.fetchWithTimeout('https://example.test/opts', { headers: { Accept: 'application/json' } }, { timeoutMs: 2000 });
    assert.equal(received.url, 'https://example.test/opts');
    assert.deepEqual(received.options.headers, { Accept: 'application/json' });
    assert.ok(received.options.signal, 'expected an AbortSignal to be attached');
  });
});
