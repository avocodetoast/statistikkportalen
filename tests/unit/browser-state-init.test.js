/**
 * browser-state.js — _doInit() sin forgrening på AppConfig.catalogIndex.enabled.
 *
 * Med flagget AV (default) skal stien være NØYAKTIG dagens: api.getConfig()
 * først, så api.getAllTables(). Med flagget PÅ skal katalogen komme fra
 * CatalogIndex, statuslaget mates via api.seedSourceStatus, og kun kildene
 * indeksen manglet hentes direkte (options.onlySources).
 *
 * MOCKING: både `api` og `CatalogIndex.load` er nettverksfasader — de to
 * I/O-grensene _doInit snakker over — og stubbes her. Alt annet (MenuHierarchy,
 * filtrene, t()) er den ekte koden. Å stubbe fetch i stedet ville gjort det
 * umulig å assertere at getConfig faktisk BLE kalt i dagens sti, som er hele
 * beviset på at flagget AV lar appen være uendret.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/subjects.js',
  'js/menu-hierarchy.js',
  'js/synonyms.js',
  'js/search-enhanced.js',
  'js/browser-state.js'
]);

const { BrowserState, AppConfig, CatalogIndex } = app;

/** Katalograd i den formen decode()/adapterne leverer. */
function row(id, subject) {
  return {
    id: id,
    label: 'Tabell ' + id,
    updated: '2026-01-01',
    firstPeriod: '2000',
    lastPeriod: '2026',
    subjectCode: subject,
    sortCode: '0000001',
    timeUnit: 'Annual',
    discontinued: false,
    variableNames: [],
    paths: [[{ id: subject, label: 'Emne ' + subject, sortCode: '0000001' }]],
    description: ''
  };
}

/** Kall-logg for den stubbede fasaden. */
let calls;

function installApiStub(getAllTablesResult) {
  calls = { getConfig: 0, getAllTables: [], seedSourceStatus: [] };
  app.api = {
    getConfig: async () => { calls.getConfig++; return {}; },
    getAllTables: async (options) => {
      calls.getAllTables.push(options);
      return getAllTablesResult;
    },
    seedSourceStatus: (meta) => { calls.seedSourceStatus.push(meta); },
    sourceFor: (id) => String(id).startsWith('nb-') ? 'nb' : 'ssb'
  };
}

/** Stub CatalogIndex.load; `null` betyr «skal aldri kalles». */
let indexLoadCalls;
function installIndexStub(result) {
  indexLoadCalls = [];
  CatalogIndex.load = async (options) => {
    indexLoadCalls.push(options);
    if (!result) throw new Error('CatalogIndex.load skulle ikke vært kalt');
    return result;
  };
}

const UNAVAILABLE = { available: false, rows: [], bySource: {}, meta: {}, missingSources: [] };

beforeEach(() => {
  BrowserState.reset();
  AppConfig.catalogIndex.enabled = false;
});

describe('BrowserState._doInit — flagget AV (default)', () => {
  it('bruker dagens sti: getConfig OG getAllTables kalles, indeksen røres ikke', async () => {
    installApiStub({ tables: [row('13760', 'al'), row('07459', 'be')] });
    installIndexStub(null);

    await BrowserState.init();

    assert.equal(calls.getConfig, 1, 'api.getConfig skal fortsatt kalles først');
    assert.equal(calls.getAllTables.length, 1);
    assert.deepEqual(calls.getAllTables[0], { lang: 'no', includeDiscontinued: true });
    assert.equal(calls.getAllTables[0].onlySources, undefined);
    assert.equal(indexLoadCalls.length, 0, 'indeksen skal ikke lastes når flagget er av');

    assert.deepEqual(BrowserState.allTables.map(t => t.id), ['13760', '07459']);
    assert.equal(BrowserState.isLoaded, true);
    assert.ok(BrowserState.menuHierarchy, 'emnehierarkiet skal være bygget');
  });

  it('tom katalog kaster fortsatt (retry-bar feil, ikke stille tomt emnegrid)', async () => {
    installApiStub({ tables: [] });
    installIndexStub(null);

    await assert.rejects(() => BrowserState.init());
    assert.equal(BrowserState.isLoaded, false);
    assert.equal(BrowserState._initPromise, null, 'et nytt forsøk skal være mulig');
  });
});

describe('BrowserState._doInit — flagget PÅ', () => {
  it('indeks tilgjengelig: allTables kommer fra indeksen, ingen getAllTables', async () => {
    AppConfig.catalogIndex.enabled = true;
    const rows = [row('13760', 'al'), row('nb-IR', 'os')];
    installApiStub({ tables: [row('SKAL-IKKE-BRUKES', 'be')] });
    installIndexStub({
      available: true,
      rows: rows,
      bySource: { ssb: [rows[0]], nb: [rows[1]] },
      meta: { ssb: { count: 1 }, nb: { count: 1 } },
      missingSources: []
    });

    await BrowserState.init();

    assert.deepEqual(indexLoadCalls, [{ lang: 'no' }]);
    assert.deepEqual(BrowserState.allTables.map(t => t.id), ['13760', 'nb-IR']);
    assert.equal(calls.getAllTables.length, 0, 'ingen direkte kildehenting når indeksen dekker alt');

    // Hovedmålet: NULL eksterne kall før første paint. getConfig() setter kun
    // AppConfig.limits.maxCells, som ingen browse-visning leser, og hentes nå
    // lat ved første tabellåpning (ensureApiLimits() i js/variable-select.js).
    // Kommer den tilbake hit, er en hel sekvensiell tur-retur til SSB tilbake
    // foran første paint — derfor er dette en egen, uttrykt assertion.
    assert.equal(calls.getConfig, 0, 'getConfig skal IKKE kalles når katalogen kommer fra indeksen');
    assert.deepEqual(calls.seedSourceStatus, [{ ssb: { count: 1 }, nb: { count: 1 } }]);
    assert.equal(BrowserState.isLoaded, true);
    assert.ok(BrowserState.menuHierarchy);
  });

  it('indeks utilgjengelig: nøyaktig dagens fallback-sti', async () => {
    AppConfig.catalogIndex.enabled = true;
    installApiStub({ tables: [row('13760', 'al')] });
    installIndexStub(UNAVAILABLE);

    await BrowserState.init();

    assert.equal(indexLoadCalls.length, 1);
    assert.equal(calls.getConfig, 1, 'fallback skal fortsatt hente API-config først');
    assert.equal(calls.getAllTables.length, 1);
    assert.deepEqual(calls.getAllTables[0], { lang: 'no', includeDiscontinued: true });
    assert.equal(calls.seedSourceStatus.length, 0);
    assert.deepEqual(BrowserState.allTables.map(t => t.id), ['13760']);
  });

  it('delvis indeks: manglende kilde hentes med onlySources og konkateneres', async () => {
    AppConfig.catalogIndex.enabled = true;
    const indexed = [row('13760', 'al'), row('nb-IR', 'os')];
    installApiStub({ tables: [row('fhi-daar-301', 'he')] });
    installIndexStub({
      available: true,
      rows: indexed,
      bySource: { ssb: [indexed[0]], nb: [indexed[1]] },
      meta: { ssb: { count: 1 }, nb: { count: 1 } },
      missingSources: ['fhi']
    });

    await BrowserState.init();

    assert.equal(calls.getAllTables.length, 1);
    assert.deepEqual(calls.getAllTables[0], {
      lang: 'no',
      includeDiscontinued: true,
      onlySources: ['fhi']
    });
    assert.deepEqual(BrowserState.allTables.map(t => t.id),
      ['13760', 'nb-IR', 'fhi-daar-301']);
    assert.equal(calls.seedSourceStatus.length, 1);
    assert.equal(BrowserState.isLoaded, true);
  });
});
