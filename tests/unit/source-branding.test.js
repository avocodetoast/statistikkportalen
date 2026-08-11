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
const {
  AppConfig, sourceKeyForTableId, sourceBrandingForTable, displayTableId,
  listSourceBrandings, listEnabledSources, sourceBadgeHTML
} = app;

describe('sourceKeyForTableId', () => {
  it('deriverer ruting og visnings-id fra en syntetisk kilde i config', () => {
    AppConfig.sources.test = { enabled: true, idPrefix: 'test-' };
    try {
      assert.equal(sourceKeyForTableId('test-tabell'), 'test');
      assert.equal(displayTableId('test-tabell'), 'tabell');
    } finally {
      delete AppConfig.sources.test;
    }
  });

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

describe('listEnabledSources', () => {
  it('pairs each enabled source key with its branding, in config order', () => {
    const list = listEnabledSources();
    assert.deepEqual(list.map(s => s.key), ['ssb', 'nb', 'fhi']);
    assert.equal(list[0].branding, AppConfig.source); // ssb → global fallback
    assert.equal(list[1].branding.shortName, 'NB');
    assert.equal(list[2].branding.shortName, 'FHI');
  });

  it('skips disabled sources', () => {
    const original = AppConfig.sources.nb.enabled;
    AppConfig.sources.nb.enabled = false;
    try {
      assert.deepEqual(listEnabledSources().map(s => s.key), ['ssb', 'fhi']);
    } finally {
      AppConfig.sources.nb.enabled = original;
    }
  });

  it('falls back to a single ssb entry when no sources config exists', () => {
    const original = AppConfig.sources;
    delete AppConfig.sources;
    try {
      const list = listEnabledSources();
      assert.deepEqual(list.map(s => s.key), ['ssb']);
      assert.equal(list[0].branding, AppConfig.source);
    } finally {
      AppConfig.sources = original;
    }
  });
});

describe('sourceBadgeHTML', () => {
  it('renders nothing for SSB tables (the default source is not badged)', () => {
    assert.equal(sourceBadgeHTML('07459'), '');
  });

  it('renders a NB badge with the full name as tooltip', () => {
    const html = sourceBadgeHTML('nb-EXR');
    assert.match(html, /class="source-badge source-badge--nb"/);
    assert.match(html, /data-tooltip="Norges Bank"/);
    assert.match(html, />NB</);
  });

  it('renders a FHI badge with Folkehelseinstituttet as tooltip', () => {
    const html = sourceBadgeHTML('fhi-mfr-123');
    assert.match(html, /class="source-badge source-badge--fhi"/);
    assert.match(html, /data-tooltip="Folkehelseinstituttet"/);
    assert.match(html, />FHI</);
  });

  it('falls back to branding.name when shortName is absent', () => {
    const original = AppConfig.sources.nb.branding.shortName;
    delete AppConfig.sources.nb.branding.shortName;
    try {
      assert.match(sourceBadgeHTML('nb-EXR'), />Norges Bank</);
    } finally {
      AppConfig.sources.nb.branding.shortName = original;
    }
  });

  it('escapes branding text so a config value cannot inject markup', () => {
    const original = AppConfig.sources.nb.branding.shortName;
    AppConfig.sources.nb.branding.shortName = '<img src=x>';
    try {
      const html = sourceBadgeHTML('nb-EXR');
      assert.doesNotMatch(html, /<img/);
      assert.match(html, /&lt;img/);
    } finally {
      AppConfig.sources.nb.branding.shortName = original;
    }
  });

  it('renders nothing for a source without branding', () => {
    const original = AppConfig.sources.nb.branding;
    delete AppConfig.sources.nb.branding;
    try {
      // sourceBrandingForTable falls back to the global (SSB) source — badging
      // an NB table as SSB would be wrong, so render nothing at all.
      assert.equal(sourceBadgeHTML('nb-EXR'), '');
    } finally {
      AppConfig.sources.nb.branding = original;
    }
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
