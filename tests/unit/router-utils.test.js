/**
 * utils.js / router.js / api.js — saved-query detection, URL mapping and the
 * global api object. Migrated from the legacy test.html suite.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/utils.js', 'js/router.js']);

describe('detectSavedQueryId', () => {
  const detect = app.detectSavedQueryId;

  it('matches #sq/{id} deep links', () => {
    assert.equal(detect('#sq/30121434'), '30121434');
  });

  it('matches ?sq={id} query parameters', () => {
    assert.equal(detect('https://example.com?sq=30121434'), '30121434');
  });

  it('matches SSB /statbank/ URLs with sq param', () => {
    assert.equal(detect('https://www.ssb.no/statbank/table/14704?sq=30121434'), '30121434');
  });

  it('matches SSB /statbank/sq/{id} paths', () => {
    assert.equal(detect('https://www.ssb.no/statbank/sq/30121434'), '30121434');
  });

  it('returns null for plain text and empty input', () => {
    assert.equal(detect('hello world'), null);
    assert.equal(detect(''), null);
  });
});

describe('URLRouter / SSBURLMapper', () => {
  it('exposes SSBURLMapper with a fromSSB/fromSource method', () => {
    assert.equal(typeof app.SSBURLMapper, 'object');
    assert.ok(
      typeof app.SSBURLMapper.fromSSB === 'function' ||
      typeof app.SSBURLMapper.fromSource === 'function'
    );
  });
});

describe('api global (without source adapters loaded)', () => {
  it('is an SSBApi instance pointing at the SSB base URL', () => {
    assert.ok(app.api instanceof app.SSBApi);
    assert.equal(app.api.baseUrl, 'https://data.ssb.no/api/pxwebapi/v2');
  });
});
