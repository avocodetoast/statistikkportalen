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
