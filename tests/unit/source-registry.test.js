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
  it('registers the ssb, nb, fhi and dbh adapters', () => {
    const ids = app.SourceRegistry.adapters.map(a => a.sourceId).sort();
    assert.deepEqual(ids, ['dbh', 'fhi', 'nb', 'ssb']);
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

  it('routes dbh-* ids to the DBH adapter', () => {
    assert.equal(owner('dbh-226'), 'dbh');
  });

  it('routes plain numeric SSB ids to the SSB adapter (fallback)', () => {
    assert.equal(owner('13760'), 'ssb');
  });

  it('rejects nb-* ids when Norges Bank is disabled without calling SSB', () => {
    const ssb = app.SourceRegistry.adapters.find(a => a.sourceId === 'ssb');
    const originalEnabled = app.AppConfig.sources.nb.enabled;
    const originalGetTableMetadata = ssb.getTableMetadata;
    let ssbCalls = 0;

    app.AppConfig.sources.nb.enabled = false;
    ssb.getTableMetadata = () => { ssbCalls += 1; };

    try {
      assert.throws(
        () => app.api.getTableMetadata('nb-IR'),
        /Ingen kilde kan håndtere «nb-IR» \(getTableMetadata\)/
      );
      assert.equal(ssbCalls, 0);
    } finally {
      app.AppConfig.sources.nb.enabled = originalEnabled;
      ssb.getTableMetadata = originalGetTableMetadata;
    }
  });

  it('keeps the SSB fallback for ids no foreign adapter owns', () => {
    const ssb = app.SourceRegistry.adapters.find(a => a.sourceId === 'ssb');
    const originalGetTableMetadata = ssb.getTableMetadata;
    const unknownId = 'unknown-table-id';
    let receivedId = null;

    ssb.getTableMetadata = (id) => {
      receivedId = id;
      return { id: id };
    };

    try {
      assert.deepEqual(app.api.getTableMetadata(unknownId), { id: unknownId });
      assert.equal(receivedId, unknownId);
    } finally {
      ssb.getTableMetadata = originalGetTableMetadata;
    }
  });
});
