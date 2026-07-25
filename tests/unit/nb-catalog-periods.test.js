/**
 * norges-bank-adapter.js — katalogperioder UTEN nettverk ved oppstart.
 *
 * Adapteren probet tidligere hver katalograd ved hver app-init (31 samtidige
 * kall mot data.norges-bank.no, blokkerende for BrowserState.init()). Periodene
 * kommer nå fra den innsjekkede data/sources/nb-periods.js (window.NbPeriods),
 * med en fersk cache-oppføring — skrevet forrige gang tabellen ble åpnet — som
 * overstyring. getTables() skal ikke røre nettverket i det hele tatt.
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
  },
  globals: {
    NbPeriods: {
      generatedAt: '2026-07-25T09:53:03.921Z',
      tables: {
        'nb-EXR': {
          firstPeriod: '1960', lastPeriod: '2026',
          firstCode: '1960', lastCode: '2026-07-24',
          updated: '2026-07-25T09:52:54'
        },
        'nb-REGNET-PROD': {
          firstPeriod: '2003', lastPeriod: '2026',
          firstCode: '2003-Q1', lastCode: '2026-Q2',
          updated: '2026-07-25T09:53:02'
        }
      }
    }
  }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

// Adapteren leser cfg.dataflows ved kalltid — muter config etter last.
app.AppConfig.sources.nb.dataflows = [
  { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
    path: ['bf', 'nb-valuta'], label: { nb: 'Valutakurser', en: 'Exchange rates' } },
  { flow: 'REGNET', version: '1.0', tableId: 'nb-REGNET-PROD', probeKey: 'Q.PROD.._X.',
    path: ['bf', 'nb-regnet'], label: { nb: 'Produksjon', en: 'Production' } },
  // Ingen oppføring i NbPeriods — skal degradere til tomme felt, ikke kaste.
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

  it('fyller periode- og oppdatert-feltene fra window.NbPeriods', async () => {
    const { tables } = await adapter.getTables({});
    const exr = tables.find(t => t.id === 'nb-EXR');
    assert.equal(exr.firstPeriod, '1960');
    assert.equal(exr.lastPeriod, '2026');
    assert.equal(exr.updated, '2026-07-25T09:52:54');
  });

  it('bruker radens egen oppføring når flere rader deler samme flow', async () => {
    const { tables } = await adapter.getTables({});
    const prod = tables.find(t => t.id === 'nb-REGNET-PROD');
    assert.equal(prod.firstPeriod, '2003');
    assert.equal(prod.lastPeriod, '2026');
  });

  it('degraderer til tomme felt for rader uten bakt periode', async () => {
    const { tables } = await adapter.getTables({});
    const ny = tables.find(t => t.id === 'nb-NYFLOW');
    assert.equal(ny.firstPeriod, '');
    assert.equal(ny.lastPeriod, '');
    assert.equal(ny.updated, '', 'updated MÅ være en streng — menu-hierarchy sorterer på den');
  });

  it('rapporterer katalogen som ikke-nettverkshentet i sourceMeta', async () => {
    const { sourceMeta } = await adapter.getTables({});
    assert.equal(sourceMeta.fromCache, true, 'ingenting ble hentet over nett');
    assert.equal(sourceMeta.stale, false);
    assert.ok(sourceMeta.fetchedAt, 'statuspanelet viser når katalogen er fra');
  });

  it('lar en fersk cache-oppføring overstyre den bakte perioden', async () => {
    // Skrives av fetchCataloguePeriod når tabellen åpnes — ferskere enn fila.
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
    assert.equal(exr.lastPeriod, '2027');
    assert.equal(exr.updated, '2027-01-02T05:00:00');
  });

  it('svarer tomt på server-søk/nylig-oppdatert (SSB-only semantikk)', async () => {
    assert.deepEqual((await adapter.getTables({ query: 'valuta' })).tables, []);
    assert.deepEqual((await adapter.getTables({ pastDays: 7 })).tables, []);
  });
});
