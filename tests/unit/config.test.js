/**
 * AppConfig — SSB instance configuration.
 * Migrated from the legacy test.html suite.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);
const { AppConfig } = app;

describe('AppConfig — SSB instance', () => {
  it('has the SSB PxWebApi v2 base URL', () => {
    assert.equal(AppConfig.apiBaseUrl, 'https://data.ssb.no/api/pxwebapi/v2');
  });

  it('has SSB source branding', () => {
    assert.equal(AppConfig.source.name, 'SSB');
    assert.equal(AppConfig.source.nameFull, 'Statistisk sentralbyrå');
    assert.equal(AppConfig.source.licenseName, 'CC BY 4.0');
  });

  it('is branded Statistikkportalen', () => {
    assert.equal(AppConfig.app.name, 'Statistikkportalen');
  });

  it('defaults to Norwegian Bokmål with apiLang no', () => {
    assert.equal(AppConfig.defaultLanguage, 'nb');
    assert.equal(AppConfig.languages[0].code, 'nb');
    assert.equal(AppConfig.languages[0].apiLang, 'no');
  });

  it('has SSB cell limits', () => {
    assert.equal(AppConfig.limits.maxCells, 800000);
    assert.equal(AppConfig.limits.cellWarningThreshold, 600000);
  });

  it('hides high-frequency tables from the front page by default', () => {
    assert.equal(AppConfig.ui.recentUpdates.showHighFrequency, false);
    assert.ok(AppConfig.ui.recentUpdates.highFrequencyTimeUnits.includes('Business'));
  });

  it('has 3 source update times', () => {
    assert.equal(AppConfig.sourceUpdateTimes.length, 3);
  });
});

describe('AppConfig — tagline', () => {
  it('has nb and en taglines', () => {
    assert.equal(typeof AppConfig.app.tagline.nb, 'string');
    assert.equal(typeof AppConfig.app.tagline.en, 'string');
  });

  it('mentions the source in both languages', () => {
    assert.ok(AppConfig.app.tagline.nb.includes('SSB'));
    assert.ok(AppConfig.app.tagline.en.includes('Statistics Norway'));
  });
});

describe('AppConfig — multi-source hub (Statistikkportalen 2.0)', () => {
  it('declares the ssb, nb and fhi sources', () => {
    assert.ok(AppConfig.sources, 'AppConfig.sources missing');
    for (const id of ['ssb', 'nb', 'fhi']) {
      assert.ok(AppConfig.sources[id], `AppConfig.sources.${id} missing`);
      assert.equal(typeof AppConfig.sources[id].enabled, 'boolean');
    }
  });
});

describe('AppConfig — nb collapseDims', () => {
  it('rows declaring collapseDims are well-formed', () => {
    for (const flow of AppConfig.sources.nb.dataflows) {
      if (!flow.collapseDims) continue;
      assert.equal(typeof flow.collapseDims.anchor, 'string',
        flow.flow + ': collapseDims.anchor må være en streng');
      assert.ok(Array.isArray(flow.collapseDims.dims) && flow.collapseDims.dims.length > 0,
        flow.flow + ': collapseDims.dims må være en ikke-tom array');
      assert.ok(flow.collapseDims.dims.every(d => typeof d === 'string'),
        flow.flow + ': collapseDims.dims må inneholde strenger');
      assert.ok(!flow.collapseDims.dims.includes(flow.collapseDims.anchor),
        flow.flow + ': ankeret kan ikke kollapse seg selv');
    }
  });

  it('every dataflow row has a unique tableId (flere rader kan dele flow)', () => {
    const ids = AppConfig.sources.nb.dataflows.map(f => f.tableId);
    assert.deepEqual([...new Set(ids)].sort(), ids.slice().sort(),
      'tableId må være unik — flowForId slår opp på den');
  });

  it('GOVT_PRIMARY_MARKET and CBC_TRANSACTIONS collapse into ISIN', () => {
    const prim = AppConfig.sources.nb.dataflows.find(f => f.flow === 'GOVT_PRIMARY_MARKET');
    const cbc = AppConfig.sources.nb.dataflows.find(f => f.flow === 'CBC_TRANSACTIONS');
    assert.equal(prim.collapseDims.anchor, 'ISIN');
    assert.deepEqual(prim.collapseDims.dims, ['MATURITY', 'COUPON', 'INSTR']);
    assert.equal(cbc.collapseDims.anchor, 'ISIN');
    assert.deepEqual(cbc.collapseDims.dims, ['MATURITY', 'INSTR']);
  });
});

describe('AppConfig — nb slice (kuraterte tabeller)', () => {
  const sliced = () => AppConfig.sources.nb.dataflows.filter(f => f.slice);

  it('rows declaring slice are well-formed', () => {
    for (const flow of sliced()) {
      for (const [dim, codes] of Object.entries(flow.slice)) {
        assert.ok(typeof dim === 'string' && dim.length,
          flow.tableId + ': slice-nøkkel må være et dimensjonsnavn');
        const list = Array.isArray(codes) ? codes : [codes];
        assert.ok(list.length > 0 && list.every(c => typeof c === 'string' && c.length),
          flow.tableId + '.' + dim + ': slice-verdier må være ikke-tomme koder');
      }
    }
  });

  it('snittede rader har probeKey, ellers arver de hele flowens tidsvindu', () => {
    for (const flow of sliced()) {
      assert.equal(typeof flow.probeKey, 'string',
        flow.tableId + ': mangler probeKey');
    }
  });

  it('en kollaps i en snittet rad kan ikke ankre på en pinnet dimensjon', () => {
    for (const flow of sliced()) {
      if (!flow.collapseDims) continue;
      const anchorSlice = flow.slice[flow.collapseDims.anchor];
      assert.ok(!anchorSlice || Array.isArray(anchorSlice) && anchorSlice.length > 1,
        flow.tableId + ': ankeret ' + flow.collapseDims.anchor +
        ' er pinnet til én kode og forsvinner før kollapsen');
    }
  });

  it('REGNET-tematabellene dekker de kuraterte temaene', () => {
    const byId = Object.fromEntries(
      AppConfig.sources.nb.dataflows.filter(f => f.flow === 'REGNET').map(f => [f.tableId, f]));
    assert.equal(byId['nb-REGNET-PROD'].slice.REGNET_TOPIC, 'PROD');
    assert.deepEqual(byId['nb-REGNET-SYSS'].slice.REGNET_TOPIC, ['SYSS', 'SYSSPLAN']);
    assert.equal(byId['nb-REGNET-REGION'].slice.REGNET_SECTOR, '_Z');
    // Årslønnsvekst har TO horisonter og må derfor stå utenfor samletabellen —
    // en kollaps der ville ikke vært funksjonell.
    assert.equal(byId['nb-REGNET-ARSLONN'].collapseDims, undefined);
    assert.ok(!byId['nb-REGNET-KAPASITET'].slice.REGNET_TOPIC.includes('ARSLONN'));
    // Alle REGNET-rader er kvartalsvise, ikke 'Business'.
    for (const f of Object.values(byId)) assert.equal(f.timeUnit, 'Quarterly');
  });
});
