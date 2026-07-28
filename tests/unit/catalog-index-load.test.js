/**
 * catalog-index.js — runtime-lasting av den innsjekkede katalogindeksen
 * (CatalogIndex.load / available / invalidate).
 *
 * Fixturene er de EKTE snapshot-filene i data/index/, lest fra disk og servert
 * gjennom den stubbede fetch-en — da tester vi mot nøyaktig den formen
 * scripts/build-catalog-index.mjs faktisk produserer, ikke mot en håndlaget
 * kopi som kan drive fra hverandre.
 *
 * KONTRAKTEN SOM TESTES: lastingen skal DEGRADERE, aldri kaste. Ett ødelagt
 * shard tar bare ned SIN kilde (den havner i missingSources, og BrowserState
 * henter den direkte i stedet); et manglende/ugyldig manifest gir
 * { available: false } og dagens direkte kildehenting.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_DIR = path.join(ROOT, 'data', 'index');
const MANIFEST_PATH = 'data/index/catalog-manifest.json';

/** Rå tekst fra en innsjekket indeksfil (som over nett — ikke ferdig parset). */
function readIndexFile(name) {
  return fs.readFileSync(path.join(INDEX_DIR, name), 'utf8');
}

const MANIFEST = JSON.parse(readIndexFile('catalog-manifest.json'));
const SHARD = {};
MANIFEST.shards.forEach(s => { SHARD[s.source] = s; });

const TOTAL_ROWS = MANIFEST.shards.reduce((sum, s) => sum + s.count, 0);

function jsonResponse(text) {
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

function notFound() {
  return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
}

/** url → handler. Byttes ut per test for å simulere 404/korrupsjon. */
let routes = {};
let fetchCalls = [];

function defaultRoutes() {
  const r = {};
  r[MANIFEST_PATH] = () => jsonResponse(readIndexFile('catalog-manifest.json'));
  MANIFEST.shards.forEach(s => {
    r['data/index/' + s.file] = () => jsonResponse(readIndexFile(s.file));
  });
  return r;
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    const handler = routes[u];
    return handler ? handler() : notFound();
  }
});

const CatalogIndex = app.CatalogIndex;

beforeEach(() => {
  routes = defaultRoutes();
  fetchCalls = [];
  CatalogIndex.invalidate();
  app.localStorage.clear();
});

describe('CatalogIndex.load — full indeks', () => {
  it('(a) manifest + 3 shards gir bySource, tom missingSources og radsummen', async () => {
    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, true);
    assert.equal(CatalogIndex.available(), true);
    assert.deepEqual(Object.keys(index.bySource).sort(), ['fhi', 'nb', 'ssb']);
    assert.equal(index.bySource.ssb.length, SHARD.ssb.count);
    assert.equal(index.bySource.nb.length, SHARD.nb.count);
    assert.equal(index.bySource.fhi.length, SHARD.fhi.count);
    assert.equal(index.rows.length, TOTAL_ROWS);
    assert.deepEqual(index.missingSources, []);
  });

  it('(a) meta bærer count/generatedAt/stale/bytes per kilde', async () => {
    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.meta.nb.count, SHARD.nb.count);
    assert.equal(index.meta.nb.generatedAt, SHARD.nb.generatedAt);
    assert.equal(index.meta.nb.bytes, SHARD.nb.bytes);
    assert.equal(typeof index.meta.nb.stale, 'boolean');
  });

  it('(a) radene er rehydrert til appens flate katalogform', async () => {
    const index = await CatalogIndex.load({ lang: 'no' });
    const row = index.bySource.ssb[0];

    assert.equal(typeof row.id, 'string');
    assert.equal(typeof row.label, 'string');
    assert.equal(typeof row.discontinued, 'boolean');
    assert.ok(Array.isArray(row.paths));
    assert.ok(Array.isArray(row.variableNames));
    // Feltene flere callsites kaller .localeCompare() rett på skal aldri være null
    assert.equal(typeof row.updated, 'string');
    assert.equal(typeof row.sortCode, 'string');
  });
});

describe('CatalogIndex.load — degradering', () => {
  it('(b) 404 på FHI-shardet degraderer kun FHI', async () => {
    delete routes['data/index/' + SHARD.fhi.file];

    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, true);
    assert.deepEqual(index.missingSources, ['fhi']);
    assert.deepEqual(Object.keys(index.bySource).sort(), ['nb', 'ssb']);
    assert.equal(index.rows.length, SHARD.ssb.count + SHARD.nb.count);
  });

  it('(c) manifest-404 gir available false og kaster ikke', async () => {
    routes = {};

    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, false);
    assert.equal(CatalogIndex.available(), false);
    assert.deepEqual(index.rows, []);
    assert.deepEqual(index.bySource, {});
  });

  it('(c) manifest med ukjent format gir available false', async () => {
    routes[MANIFEST_PATH] = () => jsonResponse(JSON.stringify(
      Object.assign({}, MANIFEST, { format: 2 })));

    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, false);
    assert.equal(CatalogIndex.available(), false);
  });

  it('(d) korrupt JSON i ett shard degraderer kun den kilden', async () => {
    routes['data/index/' + SHARD.nb.file] = () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
    });

    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, true);
    assert.deepEqual(index.missingSources, ['nb']);
    assert.equal(index.rows.length, SHARD.ssb.count + SHARD.fhi.count);
  });

  it('(g) decode-feil (format 2 i ett shard) degraderer kun den kilden', async () => {
    const bad = JSON.parse(readIndexFile(SHARD.ssb.file));
    bad.format = 2;
    routes['data/index/' + SHARD.ssb.file] = () => jsonResponse(JSON.stringify(bad));

    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, true);
    assert.deepEqual(index.missingSources, ['ssb']);
    assert.deepEqual(Object.keys(index.bySource).sort(), ['fhi', 'nb']);
    assert.equal(index.rows.length, SHARD.nb.count + SHARD.fhi.count);
  });

  it('alle shards ubrukelige → 0 rader → available false', async () => {
    MANIFEST.shards.forEach(s => { delete routes['data/index/' + s.file]; });

    const index = await CatalogIndex.load({ lang: 'no' });

    assert.equal(index.available, false);
    assert.deepEqual(index.rows, []);
  });
});

describe('CatalogIndex.load — caching', () => {
  it('(e) andre load() gjør ingen nye fetch-kall — verken memoisert eller via CacheManager', async () => {
    const first = await CatalogIndex.load({ lang: 'no' });
    const afterFirst = fetchCalls.length;
    assert.ok(afterFirst >= 4, 'manifest + 3 shards skal hentes én gang hver');

    // Memoisert tilstand
    await CatalogIndex.load({ lang: 'no' });
    assert.equal(fetchCalls.length, afterFirst, 'memoisert load skal ikke hente på nytt');

    // Uten memoen må CacheManager svare — det er dette som lar en offline
    // klient fortsatt boote fra indeksen.
    CatalogIndex.invalidate();
    const third = await CatalogIndex.load({ lang: 'no' });
    assert.equal(fetchCalls.length, afterFirst, 'CacheManager skal dekke andre runde');
    assert.equal(third.available, true);
    assert.equal(third.rows.length, first.rows.length);
  });

  it('invalidate() nullstiller available()', async () => {
    await CatalogIndex.load({ lang: 'no' });
    assert.equal(CatalogIndex.available(), true);
    CatalogIndex.invalidate();
    assert.equal(CatalogIndex.available(), false);
  });
});

describe('CatalogIndex.meta / builtAt', () => {
  it('meta() og builtAt() gjenspeiler siste fullførte load()', async () => {
    assert.deepEqual(CatalogIndex.meta(), {}, 'ingenting lastet ennå');
    assert.equal(CatalogIndex.builtAt(), '');

    await CatalogIndex.load({ lang: 'no' });

    assert.equal(CatalogIndex.meta().ssb.count, SHARD.ssb.count);
    assert.equal(CatalogIndex.builtAt(), MANIFEST.generatedAt);
  });
});

describe('CatalogIndex.checkForUpdate — «Se etter ny indeks»', () => {
  it('(a) uendret manifest gir changed: [] og rører ikke gjeldende tilstand', async () => {
    await CatalogIndex.load({ lang: 'no' });
    const beforeMeta = CatalogIndex.meta();

    const result = await CatalogIndex.checkForUpdate({ lang: 'no' });

    assert.equal(result.available, true);
    assert.deepEqual(result.changed, []);
    assert.equal(result.rows.length, TOTAL_ROWS);
    // Fortsatt tilgjengelig og med samme shard-identitet som før sjekken.
    assert.equal(CatalogIndex.available(), true);
    assert.equal(CatalogIndex.meta().ssb.file, beforeMeta.ssb.file);
  });

  it('(a) sjekken gjør et ekte nettverkskall mot manifestet selv når memoisert', async () => {
    await CatalogIndex.load({ lang: 'no' });
    const afterFirstLoad = fetchCalls.length;

    await CatalogIndex.checkForUpdate({ lang: 'no' });

    // Minst ett nytt kall mot manifest-URL-en — «sjekk nå» skal ALDRI bare
    // returnere en memoisert/cachet kopi uten å faktisk spørre serveren.
    const manifestCallsAfter = fetchCalls.filter(u => u === MANIFEST_PATH).length;
    assert.ok(manifestCallsAfter >= 2, 'manifestet skal hentes på nytt ved hver sjekk');
    assert.ok(fetchCalls.length > afterFirstLoad || manifestCallsAfter >= 2);
  });

  it('(b) endret SSB-hash → changed inneholder «ssb» og de nye radene kommer med', async () => {
    await CatalogIndex.load({ lang: 'no' });

    // Nytt SSB-shard med et annet (innholdshashet) filnavn og én ekstra rad.
    const ssbDoc = JSON.parse(readIndexFile(SHARD.ssb.file));
    ssbDoc.tables = ssbDoc.tables.concat([ssbDoc.tables[0]]); // dupliser én rad → count+1
    ssbDoc.generatedAt = new Date().toISOString();
    const newFile = 'ssb-no-deadbeef.json';
    routes['data/index/' + newFile] = () => jsonResponse(JSON.stringify(ssbDoc));

    const newManifest = JSON.parse(JSON.stringify(MANIFEST));
    newManifest.generatedAt = new Date().toISOString();
    newManifest.shards.find(s => s.source === 'ssb').file = newFile;
    newManifest.shards.find(s => s.source === 'ssb').count = ssbDoc.tables.length;
    routes[MANIFEST_PATH] = () => jsonResponse(JSON.stringify(newManifest));

    const result = await CatalogIndex.checkForUpdate({ lang: 'no' });

    assert.deepEqual(result.changed, ['ssb']);
    assert.equal(result.available, true);
    assert.equal(result.bySource.ssb.length, SHARD.ssb.count + 1);
    // NB/FHI var uendret og skal IKKE dukke opp i changed.
    assert.ok(!result.changed.includes('nb'));
    assert.ok(!result.changed.includes('fhi'));
    // Den committede tilstanden reflekterer nå det nye shardet.
    assert.equal(CatalogIndex.meta().ssb.file, newFile);
  });

  it('(c) manifest utilgjengelig ved sjekk degraderer pent og kaster ikke', async () => {
    await CatalogIndex.load({ lang: 'no' });
    assert.equal(CatalogIndex.available(), true);

    routes[MANIFEST_PATH] = () => notFound();

    // Kaster IKKE — feiler testen ellers ved en avvist promise, akkurat som
    // dagens load()-degraderingstester over.
    const result = await CatalogIndex.checkForUpdate({ lang: 'no' });

    assert.equal(result.available, false);
    assert.deepEqual(result.changed, []);
    // Gjeldende, allerede brukbare tilstand skal IKKE poisones av en
    // forbigående feil på en frivillig «se etter oppdatering»-sjekk.
    assert.equal(CatalogIndex.available(), true);
  });
});

describe('api.seedSourceStatus', () => {
  it('(f) gir source-status.js et lesbart snapshot — ferskt shard er ikke stale', () => {
    const staleAfterMs = app.AppConfig.catalogIndex.staleAfterMs;
    const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    app.api.seedSourceStatus({
      ssb: { count: 83, generatedAt: fresh, stale: false, bytes: 26568 }
    });

    const ssb = app.api.getSourceStatus().find(s => s.sourceId === 'ssb');
    assert.equal(ssb.status, 'ok');
    assert.equal(ssb.tableCount, 83);
    assert.equal(ssb.fromCache, true);
    assert.equal(ssb.stale, false);
    assert.equal(ssb.fetchedAt, Date.parse(fresh));
    assert.equal(ssb.partial, null);
    assert.equal(ssb.error, null);
    assert.ok(staleAfterMs > 0);
  });

  it('(f) shard eldre enn staleAfterMs merkes stale', () => {
    const staleAfterMs = app.AppConfig.catalogIndex.staleAfterMs;
    const old = new Date(Date.now() - staleAfterMs - 60 * 60 * 1000).toISOString();

    app.api.seedSourceStatus({
      nb: { count: 31, generatedAt: old, stale: true, bytes: 9753 }
    });

    const nb = app.api.getSourceStatus().find(s => s.sourceId === 'nb');
    assert.equal(nb.status, 'ok');
    assert.equal(nb.tableCount, 31);
    assert.equal(nb.fromCache, true);
    assert.equal(nb.stale, true);
    assert.equal(nb.fetchedAt, Date.parse(old));
  });

  it('(f) meta fra en ekte load() kan mates rett inn', async () => {
    const index = await CatalogIndex.load({ lang: 'no' });
    app.api.seedSourceStatus(index.meta);

    const snapshot = app.api.getSourceStatus();
    assert.deepEqual(snapshot.map(s => s.sourceId).sort(), ['fhi', 'nb', 'ssb']);
    snapshot.forEach(s => {
      assert.equal(s.status, 'ok');
      assert.equal(s.fromCache, true);
      assert.ok(Number.isFinite(s.fetchedAt), 'fetchedAt må være et tall source-status.js kan regne alder av');
      assert.equal(typeof s.stale, 'boolean');
    });
    assert.equal(snapshot.find(s => s.sourceId === 'fhi').tableCount, SHARD.fhi.count);
  });
});
