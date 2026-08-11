/**
 * norges-bank-adapter.js — multi-path-plasseringer i katalogen.
 * En dataflow-rad kan angi `paths: [[subjekt, node], ...]` (flere plasseringer
 * i emnetreet); legacy-formen `path: [subjekt, node]` skal fortsatt virke.
 * Fetch feiler i testene, så periode-probene degraderer pent (tomme strenger).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// Nettverk nede: periode-prober skal degradere, ikke feile katalogen.
const app = loadApp(SCRIPTS.sources, {
  fetch: async () => { throw new Error('nettverk nede i test'); }
});

const adapter = app.SourceAdapters.find(a => a.sourceId === 'nb');

// Adapteren leser cfg.dataflows ved kalltid — muter config etter last.
app.AppConfig.sources.nb.dataflows = [
  { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
    paths: [['bf', 'nb-valuta'], ['al', 'nb-valuta']],
    label: { nb: 'Valutakurser', en: 'Exchange rates' } },
  { flow: 'IR', version: '1.1', tableId: 'nb-IR',
    path: ['bf', 'nb-pengepolitikk'],
    label: { nb: 'Styringsrenten', en: 'Key policy rate' } },
  // Dyp kryssplassering: subjekt + SSB-passthrough-noder + NB-leaf.
  { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES',
    paths: [['bf', 'bf03', 'renter', 'nb-pengepolitikk']],
    label: { nb: 'Kortsiktige renter', en: 'Short-term rates' } }
];

describe('NBAdapter — multi-path katalogbygging', () => {
  it('emitterer én path per plassering i flow.paths', async () => {
    const { tables } = await adapter.getTables({});
    const exr = tables.find(t => t.id === 'nb-EXR');
    assert.ok(exr);
    assert.equal(exr.paths.length, 2);

    const [first, second] = exr.paths;
    assert.equal(first.length, 2);
    assert.equal(first[0].id, 'bf');
    assert.equal(first[1].id, 'nb-valuta');
    assert.equal(second[0].id, 'al');
    assert.equal(second[1].id, 'nb-valuta');

    // Segmentene må ha label + sortCode (menu-hierarchy-kontrakten)
    exr.paths.flat().forEach(seg => {
      assert.ok(typeof seg.label === 'string' && seg.label.length > 0);
      assert.ok(typeof seg.sortCode === 'string' && seg.sortCode.length > 0);
    });

    // Node-labelen kommer fra AppConfig.sourceNodes
    assert.equal(first[1].label, app.AppConfig.sourceNodes['nb-valuta'].label.nb);
  });

  it('emitterer vilkårlig dyp path (subjekt + passthrough + leaf)', async () => {
    const { tables } = await adapter.getTables({});
    const t = tables.find(t => t.id === 'nb-SHORT_RATES');
    assert.ok(t);
    assert.equal(t.paths.length, 1);
    const path = t.paths[0];
    // 4 segmenter: bf → bf03 → renter → nb-pengepolitikk
    assert.equal(path.length, 4);
    assert.deepEqual(path.map(s => s.id), ['bf', 'bf03', 'renter', 'nb-pengepolitikk']);
    // Passthrough-segmentene henter label/sortCode fra sourceNodes (SSB-verdier)
    assert.equal(path[1].label, app.AppConfig.sourceNodes['bf03'].label.nb);
    assert.equal(path[2].label, app.AppConfig.sourceNodes['renter'].label.nb);
    assert.equal(path[3].label, app.AppConfig.sourceNodes['nb-pengepolitikk'].label.nb);
    // Alle segmenter har ikke-tom label + sortCode
    path.forEach(seg => {
      assert.ok(typeof seg.label === 'string' && seg.label.length > 0);
      assert.ok(typeof seg.sortCode === 'string' && seg.sortCode.length > 0);
    });
  });

  it('subjectCode følger primærplasseringen (paths[0][0])', async () => {
    const { tables } = await adapter.getTables({});
    const exr = tables.find(t => t.id === 'nb-EXR');
    assert.equal(exr.subjectCode, 'bf');
  });

  it('legacy-rader med kun path gir fortsatt én plassering', async () => {
    const { tables } = await adapter.getTables({});
    const ir = tables.find(t => t.id === 'nb-IR');
    assert.ok(ir);
    assert.equal(ir.paths.length, 1);
    assert.equal(ir.paths[0][0].id, 'bf');
    assert.equal(ir.paths[0][1].id, 'nb-pengepolitikk');
    assert.equal(ir.subjectCode, 'bf');
  });

  it('updated er alltid en streng (localeCompare-landminen)', async () => {
    const { tables } = await adapter.getTables({});
    tables.forEach(t => assert.equal(typeof t.updated, 'string'));
  });

  it('bruker options.lang i stedet for globalt UI-språk', async () => {
    const { tables } = await adapter.getTables({ lang: 'en' });
    const exr = tables.find(t => t.id === 'nb-EXR');
    assert.equal(exr.label, 'Exchange rates');
    assert.equal(exr.paths[0][1].label, app.AppConfig.sourceNodes['nb-valuta'].label.en);
  });
});
