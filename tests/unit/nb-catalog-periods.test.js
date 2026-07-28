/**
 * norges-bank-adapter.js — katalogperioder UTEN nettverk ved oppstart.
 *
 * Adapteren probet tidligere hver katalograd ved hver app-init (31 samtidige
 * kall mot data.norges-bank.no, blokkerende for BrowserState.init()). Etter
 * P1–P4 kommer katalogen normalt fra den forhåndsbygde katalogindeksen
 * (data/index/, se js/catalog-index.js) — denne adapterens getTables() er kun
 * fallback-stien når indeksen mangler eller er ubrukelig, og den bygger
 * fortsatt periodefeltene UTEN nettverk: kun en fersk per-tabell
 * cache-oppføring — skrevet av fetchCataloguePeriod forrige gang tabellen ble
 * åpnet — kan fylle dem. Uten en slik oppføring står feltene tomme til
 * tabellen faktisk åpnes; det er ikke en regresjon, se CLAUDE.md
 * («file:// er en dokumentert degradert modus»).
 *
 * Harnesset slår av fetch(), så et hvilket som helst nettverkskall her ville
 * kastet — testen ville dermed også fanget en probe som «bare» degraderer pent.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

let fetchCalls = 0;
const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    fetchCalls++;
    throw new Error('getTables skal ikke gå på nettet (forsøkte: ' + url + ')');
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

// Adapteren leser cfg.dataflows ved kalltid — muter config etter last.
app.AppConfig.sources.nb.dataflows = [
  { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
    path: ['bf', 'nb-valuta'], label: { nb: 'Valutakurser', en: 'Exchange rates' } },
  { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-PROD', probeKey: 'Q.PROD.._X.',
    path: ['bf', 'nb-regnet'], label: { nb: 'Produksjon', en: 'Production' } },
  { flow: 'NYFLOW', version: '1.0', tableId: 'nb-NYFLOW',
    path: ['bf', 'nb-valuta'], label: { nb: 'Ny flow', en: 'New flow' } }
];

describe('NBAdapter.getTables — ingen nettverkskall', () => {
  it('bygger hele katalogen uten å røre fetch()', async () => {
    fetchCalls = 0;
    const { tables } = await adapter.getTables({});
    assert.equal(fetchCalls, 0, 'katalogbygging skal være nettverksfri');
    assert.equal(tables.length, 3);
  });

  it('degraderer alle rader til tomme felt uten cache-oppføring', async () => {
    // Ingen byggetids-fil å falle tilbake til lenger (se CLAUDE.md) — kun
    // cache-overstyringen lenger ned i fila kan fylle disse feltene.
    const { tables } = await adapter.getTables({});
    for (const t of tables) {
      assert.equal(t.firstPeriod, '', `${t.id}.firstPeriod`);
      assert.equal(t.lastPeriod, '', `${t.id}.lastPeriod`);
      assert.equal(t.updated, '', `${t.id}.updated MÅ være en streng — menu-hierarchy sorterer på den`);
    }
  });

  it('rapporterer katalogen som ikke-nettverkshentet i sourceMeta', async () => {
    const { sourceMeta } = await adapter.getTables({});
    assert.equal(sourceMeta.fromCache, true, 'ingenting ble hentet over nett');
    assert.equal(sourceMeta.stale, false);
    assert.ok(sourceMeta.fetchedAt, 'statuspanelet viser når katalogen er fra');
  });

  it('lar en fersk cache-oppføring fylle periodefeltene', async () => {
    // Skrives av fetchCataloguePeriod når tabellen faktisk åpnes.
    const cache = app.SourceRegistry.ssb.instance.cache;
    await cache.set('nb-catperiod-v2-EXR', {
      firstPeriod: '1960', lastPeriod: '2027',
      firstCode: '1960', lastCode: '2027-01-02',
      updated: '2027-01-02T05:00:00'
    }, 24 * 60 * 60 * 1000);

    fetchCalls = 0;
    const { tables } = await adapter.getTables({});
    assert.equal(fetchCalls, 0);
    const exr = tables.find(t => t.id === 'nb-EXR');
    assert.equal(exr.firstPeriod, '1960');
    assert.equal(exr.lastPeriod, '2027');
    assert.equal(exr.updated, '2027-01-02T05:00:00');

    // Radene UTEN en cache-oppføring er upåvirket — fortsatt tomme felt.
    const regnet = tables.find(t => t.id === 'nb-REGNET-PROD');
    assert.equal(regnet.firstPeriod, '');
    assert.equal(regnet.lastPeriod, '');
  });

  it('`force` (useCache:false) hopper over cachen — tomme felt selv med en fersk oppføring', async () => {
    const cache = app.SourceRegistry.ssb.instance.cache;
    await cache.set('nb-catperiod-v2-EXR', {
      firstPeriod: '1960', lastPeriod: '2027',
      firstCode: '1960', lastCode: '2027-01-02',
      updated: '2027-01-02T05:00:00'
    }, 24 * 60 * 60 * 1000);

    fetchCalls = 0;
    const { tables } = await adapter.getTables({ useCache: false });
    assert.equal(fetchCalls, 0, 'fortsatt ingen nettverkskall — bare cachen forbigås');
    const exr = tables.find(t => t.id === 'nb-EXR');
    assert.equal(exr.firstPeriod, '', 'force skal ikke lese cachen');
  });

  it('svarer tomt på server-søk/nylig-oppdatert (SSB-only semantikk)', async () => {
    assert.deepEqual((await adapter.getTables({ query: 'valuta' })).tables, []);
    assert.deepEqual((await adapter.getTables({ pastDays: 7 })).tables, []);
  });
});
