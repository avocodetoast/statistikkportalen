/**
 * fhi-adapter.js — kategorinivå (register → kategori) i emnetre-paths:
 * tabeller med `category` i data/sources/fhi-catalog.json (kuratert via
 * data/sources/fhi-curation.json) skal få et TREDJE path-segment under
 * registernoden; tabeller uten kategori beholder 2-segments plasseringen.
 *
 * Egen testfil (ikke i fhi-adapter-paths.test.js): adapteren cacher
 * katalogfil-promiset i minnet (getCatalog/_catalogPromise), så en test som
 * trenger en FUNGERENDE katalogfil kan ikke dele prosess med tester som
 * kjører uten katalog.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const CATALOG = {
  generatedAt: '2026-07-18T00:00:00Z',
  sources: {
    mfr: {
      title: 'Medisinsk fødselsregister (MFR)',
      categories: {
        fodsler: { label: 'Fødsler og fødte', sortCode: '010' },
        institusjon: { label: 'Fødeinstitusjoner', sortCode: '020' }
      },
      tables: [
        { tableId: 411, title: 'Fødte og fødsler', category: 'fodsler',
          firstPeriod: '1967', lastPeriod: '2025', timeUnit: 'Annual',
          variableNames: [], description: '', updated: '' },
        { tableId: 448, title: 'Uten kategori',
          firstPeriod: '', lastPeriod: '', timeUnit: null,
          variableNames: [], description: '', updated: '' },
        { tableId: 500, title: 'Udefinert kategori', category: 'finnes-ikke',
          firstPeriod: '', lastPeriod: '', timeUnit: null,
          variableNames: [], description: '', updated: '' }
      ]
    }
  }
};

const TABLE_ROWS = {
  mfr: [
    { tableId: 411, title: 'F0: Fødte og fødsler', publishedAt: '2024-01-01', modifiedAt: '2024-06-01' },
    { tableId: 448, title: 'Is3d: Fødsler ved institusjon', publishedAt: '2024-01-01', modifiedAt: '' },
    { tableId: 500, title: 'X: Annet', publishedAt: '2024-01-01', modifiedAt: '' }
  ]
};

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('fhi-catalog.json')) return jsonResponse(CATALOG);
    if (u.endsWith('/Common/source')) {
      return jsonResponse([{ id: 'mfr', title: 'Medisinsk fødselsregister' }]);
    }
    const m = /\/([^/]+)\/table$/.exec(u);
    if (m) return jsonResponse(TABLE_ROWS[m[1]] || []);
    throw new Error('uventet URL i test: ' + u);
  }
});

// Kun mfr i denne testen — de andre kildene har tomme tabellister uansett.
app.AppConfig.sources.fhi.sourceIds = ['mfr'];
// Nullstill reell dyp-plassering fra config.js så default-testene under tester
// fallback-grenen [he, fhi-mfr]; testene som trenger paths setter dem selv.
delete app.AppConfig.sources.fhi.paths;

const adapter = app.SourceAdapters.find(a => a.sourceId === 'fhi');

describe('FHIAdapter — kategorinivå fra katalogen', () => {
  it('tabell med kategori får tredje path-segment under registernoden', async () => {
    const { tables } = await adapter.getTables({});
    const t = tables.find(x => x.id === 'fhi-mfr-411');
    assert.ok(t);
    assert.equal(t.paths.length, 1);
    assert.equal(t.paths[0].length, 3);
    assert.equal(t.paths[0][0].id, 'he');
    assert.equal(t.paths[0][1].id, 'fhi-mfr');
    assert.deepEqual(t.paths[0][2],
      { id: 'fhi-mfr-fodsler', label: 'Fødsler og fødte', sortCode: '010' });
    assert.equal(t.label, 'Fødte og fødsler (FHI)', 'kuratert tittel fra katalogen brukes');
  });

  it('tabell uten kategori (eller med udefinert referanse) beholder 2 segmenter', async () => {
    const { tables } = await adapter.getTables({});
    assert.equal(tables.find(x => x.id === 'fhi-mfr-448').paths[0].length, 2);
    assert.equal(tables.find(x => x.id === 'fhi-mfr-500').paths[0].length, 2);
  });

  it('kategorisegmentet henges på ALLE plasseringer ved cfg.paths-overstyring', async () => {
    app.AppConfig.sources.fhi.paths = { mfr: [['he', 'fhi-mfr'], ['bf', 'fhi-mfr']] };
    try {
      const { tables } = await adapter.getTables({});
      const t = tables.find(x => x.id === 'fhi-mfr-411');
      assert.equal(t.paths.length, 2);
      t.paths.forEach(p => {
        assert.equal(p.length, 3);
        assert.equal(p[2].id, 'fhi-mfr-fodsler');
      });
    } finally {
      delete app.AppConfig.sources.fhi.paths;
    }
  });

  it('kategorisegmentet henges på ENDEN av en dyp base-path (4 base → 5 totalt)', async () => {
    app.AppConfig.sources.fhi.paths = { mfr: [['be', 'be06', 'fodte', 'fhi-mfr']] };
    try {
      const { tables } = await adapter.getTables({});
      const t = tables.find(x => x.id === 'fhi-mfr-411');
      assert.equal(t.paths.length, 1);
      assert.equal(t.paths[0].length, 5);
      assert.deepEqual(t.paths[0].map(s => s.id),
        ['be', 'be06', 'fodte', 'fhi-mfr', 'fhi-mfr-fodsler']);
    } finally {
      delete app.AppConfig.sources.fhi.paths;
    }
  });
});
