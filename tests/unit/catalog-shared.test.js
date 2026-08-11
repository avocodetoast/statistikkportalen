/**
 * Driftvern for den delte katalogbyggingen: nettleseradapterne og SEO-
 * byggerne skal gi samme rader fra samme config/kataloggrunnlag.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const ROOT = path.resolve(__dirname, '..', '..');
const fhiCatalog = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'data/sources/fhi-catalog.json'), 'utf8'));

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value };
}

const scripts = SCRIPTS.sources.slice();
scripts.splice(scripts.indexOf('js/sources/norges-bank-adapter.js'), 0, 'js/subjects.js');
const app = loadApp(scripts, {
  fetch: async (url) => {
    const value = String(url);
    if (value.includes('fhi-catalog.json')) return jsonResponse(fhiCatalog);
    if (value.endsWith('/Common/source')) {
      return jsonResponse(Object.entries(fhiCatalog.sources).map(([id, source]) => ({
        id,
        title: source.title || id
      })));
    }
    throw new Error('Uventet nettverkskall i katalogekvivalenstest: ' + value);
  }
});

const seoSources = import('../../scripts/lib/seo-sources.mjs');
const withoutPeriods = rows => rows.map(({ updated, firstPeriod, lastPeriod, ...row }) => row);

describe('CatalogShared — adapter/SEO-ekvivalens', () => {
  it('gir identiske Norges Bank-rader modulo periodefeltene', async () => {
    const adapter = app.SourceAdapters.find(candidate => candidate.sourceId === 'nb');
    const { tables } = await adapter.getTables({ lang: 'nb' });
    const { buildNbCatalogue } = await seoSources;
    const seoRows = buildNbCatalogue(app.AppConfig, app.SubjectConfig.subjectNames, 'nb');

    assert.deepEqual(withoutPeriods(tables), withoutPeriods(seoRows));
  });

  it('gir identiske FHI-rader fra katalogfila', async () => {
    const adapter = app.SourceAdapters.find(candidate => candidate.sourceId === 'fhi');
    const { tables } = await adapter.getTables({ lang: 'nb' });
    const { buildFhiCatalogue } = await seoSources;
    const seoRows = buildFhiCatalogue(
      fhiCatalog, app.AppConfig, app.SubjectConfig.subjectNames, 'nb');

    assert.deepEqual(tables, seoRows);
  });
});
