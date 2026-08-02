/**
 * index-refresh.js — IndexRefresh.run(): hva som faktisk skjer når
 * bakgrunnssjekken finner (eller ikke finner) en ny katalogindeks.
 *
 * Kontrakten som testes:
 *   - autostien re-rendrer ALDRI (usynlig oppdatering: dataene byttes, DOM-en
 *     står stille til neste navigering) — dette er selve poenget med modulen
 *   - render: true (den manuelle knappen) re-rendrer, men kun i en bla-visning
 *   - applyIndex kalles kun når noe faktisk endret seg; seedSourceStatus
 *     kalles uansett (stale-flaggene er regnet om mot Date.now())
 *   - utilgjengelig indeks eller en kastende checkForUpdate lar gjeldende
 *     tilstand stå urørt og kaster ALDRI videre — en bakgrunnsoppgave som
 *     velter skal ikke kunne ta med seg en rute i fallet
 *   - parallelle kall deler ett arbeid
 *
 * CatalogIndex, BrowserState, api og renderCurrentView stubbes som globaler
 * (samme mønster som browser-state-apply-index.test.js): det som testes her er
 * IndexRefresh sin orkestrering, ikke deres innmat — den har egne tester.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/index-refresh.js']);

const { IndexRefresh, CatalogIndex } = app;

/** Kall-loggen stubbene skriver til. */
let calls;

/** Et vellykket checkForUpdate-svar. */
function indexResult(changed) {
  return {
    available: true,
    changed: changed,
    meta: { ssb: { count: 2, file: 'ssb-no-abc12345.json' } },
    bySource: { ssb: [{ id: '13760' }, { id: '13761' }], fhi: [{ id: 'fhi-daar-301' }] }
  };
}

beforeEach(() => {
  calls = { check: 0, applied: [], seeded: 0, rendered: 0 };

  app.AppState = { currentView: 'home' };
  app.renderCurrentView = () => { calls.rendered++; };
  app.BrowserState = {
    applyIndex: (index) => { calls.applied.push(index.changed); return index.changed; }
  };
  app.api = { seedSourceStatus: () => { calls.seeded++; } };

  CatalogIndex.checkForUpdate = async () => {
    calls.check++;
    return indexResult(['ssb']);
  };
});

describe('IndexRefresh.run', () => {
  it('tar i bruk endrede kilder uten å re-rendre på autostien', async () => {
    const result = await IndexRefresh.run();

    assert.deepEqual(calls.applied, [['ssb']]);
    assert.equal(calls.seeded, 1);
    assert.equal(calls.rendered, 0, 'autostien skal aldri re-rendre');
    assert.deepEqual(result, { available: true, changed: ['ssb'], tableCount: 2 });
  });

  it('re-rendrer når kalleren ber om det (den manuelle knappen)', async () => {
    await IndexRefresh.run({ render: true });
    assert.equal(calls.rendered, 1);
  });

  it('re-rendrer ikke utenfor bla-visningene selv med render: true', async () => {
    app.AppState.currentView = 'table';
    await IndexRefresh.run({ render: true });
    assert.equal(calls.applied.length, 1, 'dataene skal fortsatt byttes');
    assert.equal(calls.rendered, 0);
  });

  it('rører ikke katalogen når ingenting endret seg, men frisker opp statusen', async () => {
    CatalogIndex.checkForUpdate = async () => { calls.check++; return indexResult([]); };

    const result = await IndexRefresh.run({ render: true });

    assert.deepEqual(calls.applied, []);
    assert.equal(calls.seeded, 1, 'stale-flaggene er regnet om — badgen skal oppdateres');
    assert.equal(calls.rendered, 0);
    assert.deepEqual(result, { available: true, changed: [], tableCount: 0 });
  });

  it('lar gjeldende tilstand stå når indeksen er utilgjengelig', async () => {
    CatalogIndex.checkForUpdate = async () => ({ available: false, changed: [] });

    const result = await IndexRefresh.run();

    assert.deepEqual(calls.applied, []);
    assert.equal(calls.seeded, 0);
    assert.deepEqual(result, { available: false, changed: [], tableCount: 0 });
  });

  it('kaster aldri videre når checkForUpdate feiler', async () => {
    CatalogIndex.checkForUpdate = async () => { throw new Error('nettet nede'); };

    const result = await IndexRefresh.run();

    assert.deepEqual(result, { available: false, changed: [], tableCount: 0 });
    assert.deepEqual(calls.applied, []);
  });

  it('deduperer parallelle kall til ett arbeid', async () => {
    let release;
    CatalogIndex.checkForUpdate = async () => {
      calls.check++;
      await new Promise(resolve => { release = resolve; });
      return indexResult(['ssb']);
    };

    const a = IndexRefresh.run();
    const b = IndexRefresh.run();
    assert.equal(a, b, 'parallelle kallere skal dele samme promise');

    release();
    await Promise.all([a, b]);
    assert.equal(calls.check, 1);
    assert.deepEqual(calls.applied, [['ssb']], 'indeksen skal tas i bruk én gang');
  });

  it('summerer tabellantallet over alle endrede kilder', async () => {
    CatalogIndex.checkForUpdate = async () => indexResult(['ssb', 'fhi']);
    const result = await IndexRefresh.run();
    assert.equal(result.tableCount, 3);
  });
});

describe('IndexRefresh.maybeRun', () => {
  it('struper seg selv rett etter en kjøring', async () => {
    await IndexRefresh.run();
    assert.equal(IndexRefresh.maybeRun('test'), false,
      'run() skal telle som et forsøk, ellers ville hver navigering gitt et kall');
  });

  it('gjør ingenting når autosjekken er slått av i konfigurasjonen', async () => {
    const previous = app.AppConfig.catalogIndex.autoCheck;
    app.AppConfig.catalogIndex.autoCheck = false;
    try {
      assert.equal(IndexRefresh.maybeRun('test'), false);
      assert.equal(calls.check, 0);
    } finally {
      app.AppConfig.catalogIndex.autoCheck = previous;
    }
  });

  it('bruker requestIdleCallback når nettleseren har den', async () => {
    // Node har den ikke, så stien må stubbes for å bli verifisert i det hele
    // tatt — og den er den som faktisk brukes i nettleseren.
    let idleOptions = null;
    app.requestIdleCallback = (fn, options) => { idleOptions = options; return setTimeout(fn, 0); };
    try {
      await withoutThrottle(async () => {
        assert.equal(IndexRefresh.maybeRun('test'), true);
        assert.deepEqual(idleOptions, { timeout: 5000 },
          'timeout, ellers kan en travel fane utsette sjekken i det uendelige');
        await tick();
        assert.equal(calls.check, 1);
      });
    } finally {
      delete app.requestIdleCallback;
    }
  });

  it('planlegger kjøringen i stedet for å kjøre den synkront', async () => {
    // Navigeringen skal aldri vente på sjekken: maybeRun returnerer FØR
    // checkForUpdate er kalt, og kjøringen faller ut i en senere tick.
    await withoutThrottle(async () => {
      assert.equal(IndexRefresh.maybeRun('test'), true);
      assert.equal(calls.check, 0, 'ikke synkront');
      await tick();
      assert.equal(calls.check, 1);
    });
  });
});

describe('IndexRefresh.init', () => {
  it('seeder strupen og sjekker når fanen blir synlig igjen', async () => {
    const listeners = installDocumentStub();

    IndexRefresh.init();

    assert.equal(typeof listeners.visibilitychange, 'function');
    assert.equal(IndexRefresh.maybeRun('rett etter init'), false,
      'sidelasting har nettopp hentet manifestet — en sjekk med én gang er bortkastet');

    await withoutThrottle(async () => {
      listeners.visibilitychange();
      await tick();
      assert.equal(calls.check, 1);
    });
  });

  it('sjekker ikke når fanen nettopp ble skjult', async () => {
    const listeners = installDocumentStub();
    IndexRefresh.init();

    await withoutThrottle(async () => {
      app.document.hidden = true;
      listeners.visibilitychange();
      await tick();
      assert.equal(calls.check, 0);
    });
  });
});

/** Bytt ut document-stubben med én som fanger lytterne init() registrerer. */
function installDocumentStub() {
  const listeners = {};
  app.document = {
    hidden: false,
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  return listeners;
}

/** La neste planlagte kjøring slippe gjennom strupen. */
async function withoutThrottle(fn) {
  const previous = app.AppConfig.catalogIndex.autoCheckMs;
  app.AppConfig.catalogIndex.autoCheckMs = 0;
  try {
    await fn();
  } finally {
    app.AppConfig.catalogIndex.autoCheckMs = previous;
  }
}

/** Én makrotick — nok til at den planlagte kjøringen har startet og fullført. */
function tick() {
  return new Promise(resolve => setTimeout(resolve, 0)).then(
    () => new Promise(resolve => setTimeout(resolve, 0)));
}
