'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const scripts = SCRIPTS.sources.filter(file => file !== 'js/sources/ssb-adapter.js');
const app = loadApp(scripts, {
  fetch: async url => { throw new Error('Nettverk skal ikke brukes: ' + url); }
});

describe('api-fasaden uten registrert SSB-adapter', () => {
  it('requireSSB gir metode-spesifikk feil for config', () => {
    assert.throws(
      () => app.api.getConfig(),
      /SSB-adapteren er ikke registrert \(getConfig\)/
    );
  });

  it('requireSSB gir metode-spesifikk feil for synkron buildPostBody', () => {
    assert.throws(
      () => app.api.buildPostBody({ Tid: ['2025'] }),
      /SSB-adapteren er ikke registrert \(buildPostBody\)/
    );
  });

  it('requireSSB beskytter saved-query- og cachemetodene', () => {
    assert.throws(() => app.api.saveSavedQuery('13760', {}), /\(saveSavedQuery\)/);
    assert.throws(() => app.api.getSavedQuery('id'), /\(getSavedQuery\)/);
    assert.throws(() => app.api.getSavedQueryData('id'), /\(getSavedQueryData\)/);
    assert.throws(() => app.api.cleanupCache(), /\(cleanupCache\)/);
    assert.throws(() => app.api.clearCache(), /\(clearCache\)/);
    assert.throws(() => app.api.getCacheStats(), /\(getCacheStats\)/);
  });
});
