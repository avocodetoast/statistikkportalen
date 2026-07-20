/**
 * utils.js — per-source branding helpers (sourceKeyForTableId,
 * sourceBrandingForTable, listSourceBrandings) used by the multi-source
 * footer and per-table attribution (export dialog, table metadata).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/utils.js']);
const { AppConfig, sourceKeyForTableId, sourceBrandingForTable, listSourceBrandings } = app;

describe('sourceKeyForTableId', () => {
  it('routes nb- prefixed ids to nb', () => {
    assert.equal(sourceKeyForTableId('nb-EXR'), 'nb');
  });

  it('routes fhi- prefixed ids to fhi', () => {
    assert.equal(sourceKeyForTableId('fhi-mfr-123'), 'fhi');
  });

  it('falls back to ssb for plain table ids', () => {
    assert.equal(sourceKeyForTableId('13760'), 'ssb');
  });

  it('falls back to ssb for missing ids', () => {
    assert.equal(sourceKeyForTableId(null), 'ssb');
    assert.equal(sourceKeyForTableId(undefined), 'ssb');
    assert.equal(sourceKeyForTableId(''), 'ssb');
  });
});

describe('sourceBrandingForTable', () => {
  it('returns Norges Bank branding for nb- tables', () => {
    const b = sourceBrandingForTable('nb-EXR');
    assert.equal(b.name, 'Norges Bank');
    assert.ok(b.url.includes('norges-bank.no'));
  });

  it('returns FHI branding for fhi- tables', () => {
    const b = sourceBrandingForTable('fhi-mfr-123');
    assert.equal(b.name, 'FHI');
    assert.equal(b.nameFull, 'Folkehelseinstituttet');
  });

  it('returns the global source (SSB) for plain table ids', () => {
    const b = sourceBrandingForTable('07459');
    assert.equal(b, AppConfig.source);
  });
});

describe('listSourceBrandings', () => {
  it('lists one branding per enabled source, in config order', () => {
    const list = listSourceBrandings();
    assert.equal(list.length, 3);
    // ssb has no per-source branding → global AppConfig.source fallback
    assert.equal(list[0], AppConfig.source);
    assert.equal(list[1].name, 'Norges Bank');
    assert.equal(list[2].name, 'FHI');
  });

  it('skips disabled sources', () => {
    const original = AppConfig.sources.fhi.enabled;
    AppConfig.sources.fhi.enabled = false;
    try {
      const list = listSourceBrandings();
      assert.equal(list.length, 2);
      assert.ok(!list.some(b => b.name === 'FHI'));
    } finally {
      AppConfig.sources.fhi.enabled = original;
    }
  });

  it('falls back to the global source when no sources config exists (single-source instance)', () => {
    const original = AppConfig.sources;
    delete AppConfig.sources;
    try {
      const list = listSourceBrandings();
      assert.equal(list.length, 1);
      assert.equal(list[0], AppConfig.source);
    } finally {
      AppConfig.sources = original;
    }
  });

  it('ignores non-source entries like fetchTimeoutMs', () => {
    // fetchTimeoutMs is a number living alongside the source entries
    assert.equal(typeof AppConfig.sources.fetchTimeoutMs, 'number');
    const list = listSourceBrandings();
    assert.ok(list.every(b => b && typeof b === 'object' && (b.name || b.nameFull)));
  });
});
