/**
 * fhi-catalog.json lastes LAT — først ved den FØRSTE FHI-tabellåpningen,
 * ikke ved sideoppstart.
 *
 * Før P1–P4 kalte BrowserState.init() alltid FHIAdapter.getTables(), som
 * (via buildSourceCatalogue) alltid kalte getCatalog() — de 289 KB ble parset
 * ved HVER sidelasting. Med katalogindeksen (js/catalog-index.js) på —
 * standard, se AppConfig.catalogIndex.enabled — kommer katalogen ved
 * oppstart i stedet fra de forhåndsbygde snapshot-shardene i data/index/
 * (dekodet med CatalogIndex.decode, se hierarchy-real-catalog.test.js).
 * BrowserState kaller da ALDRI api.getAllTables() for FHI (indeksen dekker
 * kilden), og dermed aldri FHIAdapter.getTables() — så getCatalog() først
 * trigges når brukeren faktisk åpner en FHI-tabell (getTableMetadata).
 *
 * Fixturene for indeksen er de EKTE snapshot-filene i data/index/, samme
 * mønster som tests/unit/catalog-index-load.test.js.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_DIR = path.join(ROOT, 'data', 'index');
const FHI_CATALOG_URL = 'data/sources/fhi-catalog.json';

function readIndexFile(name) {
  return fs.readFileSync(path.join(INDEX_DIR, name), 'utf8');
}

const MANIFEST = JSON.parse(readIndexFile('catalog-manifest.json'));
const FHI_CATALOG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'sources', 'fhi-catalog.json'), 'utf8')
);

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}
function notFound() {
  return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
}

const fetchCalls = [];
const app = loadApp([
  ...SCRIPTS.sources,
  'js/utils.js',
  'js/router.js',
  'js/subjects.js',
  'js/menu-hierarchy.js',
  'js/synonyms.js',
  'js/search-enhanced.js',
  'js/browser-state.js'
], {
  fetch: async (url) => {
    const u = String(url);
    fetchCalls.push(u);

    if (u === 'data/index/catalog-manifest.json') return jsonResponse(MANIFEST);
    const shard = MANIFEST.shards.find(s => u === 'data/index/' + s.file);
    if (shard) return jsonResponse(JSON.parse(readIndexFile(shard.file)));

    if (u === FHI_CATALOG_URL) return jsonResponse(FHI_CATALOG);

    // FHI-tabellendepunktene buildMetadataCore henter ved tabellåpning — kun
    // /dimension er kritisk (se fhi-adapter.js), resten kan trygt feile.
    if (/\/dimension$/.test(u)) {
      return jsonResponse({
        dimensions: [{ code: 'AAR', label: 'År', categories: [{ value: '2020', label: '2020' }] }]
      });
    }
    return notFound();
  }
});

describe('FHI-katalogen lastes lat, ikke ved oppstart', () => {
  it('BrowserState.init() med tilgjengelig katalogindeks henter aldri fhi-catalog.json', async () => {
    app.AppConfig.catalogIndex.enabled = true;
    await app.BrowserState.init();

    const totalRows = MANIFEST.shards.reduce((n, s) => n + s.count, 0);
    assert.equal(app.BrowserState.allTables.length, totalRows, 'katalogen skal komme fra indeksen');
    assert.ok(
      !fetchCalls.includes(FHI_CATALOG_URL),
      'getTables() kalles ikke for FHI når indeksen dekker kilden, så getCatalog() skal ikke trigges ved oppstart'
    );
  });

  it('å åpne en FHI-tabell trigger nøyaktig ett fetch av fhi-catalog.json', async () => {
    assert.equal(fetchCalls.filter(u => u === FHI_CATALOG_URL).length, 0);

    const firstSource = Object.keys(FHI_CATALOG.sources)[0];
    const firstTableId = FHI_CATALOG.sources[firstSource].tables[0].tableId;
    const tableId = 'fhi-' + firstSource + '-' + firstTableId;

    await app.api.getTableMetadata(tableId, true, 'no');

    assert.equal(
      fetchCalls.filter(u => u === FHI_CATALOG_URL).length,
      1,
      'getCatalog() skal fetche fhi-catalog.json nøyaktig én gang ved tabellåpning'
    );
  });

  it('å åpne en ANNEN FHI-tabell rett etter gjør IKKE et nytt fetch (memoisert)', async () => {
    const firstSource = Object.keys(FHI_CATALOG.sources)[0];
    const tables = FHI_CATALOG.sources[firstSource].tables;
    const secondTableId = 'fhi-' + firstSource + '-' + tables[Math.min(1, tables.length - 1)].tableId;

    await app.api.getTableMetadata(secondTableId, true, 'no');

    assert.equal(
      fetchCalls.filter(u => u === FHI_CATALOG_URL).length,
      1,
      '_catalogPromise skal gjenbrukes — fortsatt bare ett fetch totalt'
    );
  });
});
