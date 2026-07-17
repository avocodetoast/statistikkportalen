/**
 * js/sources/source-registry.js — multi-source facade: adapter registration
 * and table-id routing (nb-* → Norges Bank, fhi-* → FHI, fallback → SSB).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.sources);

describe('SourceRegistry — adapter registration', () => {
  it('registers the ssb, nb and fhi adapters', () => {
    const ids = app.SourceRegistry.adapters.map(a => a.sourceId).sort();
    assert.deepEqual(ids, ['fhi', 'nb', 'ssb']);
  });

  it('replaces window.api with the facade (not a plain SSBApi)', () => {
    assert.ok(!(app.api instanceof app.SSBApi));
    assert.equal(app.api.baseUrl, 'https://data.ssb.no/api/pxwebapi/v2');
  });
});

describe('SourceRegistry — table-id routing (adapterFor)', () => {
  const owner = (id) => {
    const adapter = app.SourceRegistry.adapterFor
      ? app.SourceRegistry.adapterFor(id)
      : app.SourceRegistry.adapters.find(a => a.ownsTableId(id));
    return adapter && adapter.sourceId;
  };

  it('routes nb-* ids to the Norges Bank adapter', () => {
    assert.equal(owner('nb-exr'), 'nb');
  });

  it('routes fhi-* ids to the FHI adapter', () => {
    assert.equal(owner('fhi-123'), 'fhi');
  });

  it('routes plain numeric SSB ids to the SSB adapter (fallback)', () => {
    assert.equal(owner('13760'), 'ssb');
  });
});
