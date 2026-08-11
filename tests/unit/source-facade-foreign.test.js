'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const queryFixture = require('../e2e/fixtures/statistikk-data-fhi-no__api-open-v1-nokkel-table-185-query__0fe623a1.json');
const calls = [];

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/nokkel/Table/185/query')) {
      return { ok: true, status: 200, json: async () => queryFixture };
    }
    throw new Error('Uventet URL i test: ' + url);
  }
});

beforeEach(async () => {
  calls.length = 0;
  await app.api.clearCache();
});

describe('utenlandske kildeadaptere gjennom api-fasaden', () => {
  it('sourceFor velger prefikseier før SSB-fallback', () => {
    assert.equal(app.api.sourceFor('13760'), 'ssb');
    assert.equal(app.api.sourceFor('nb-IR'), 'nb');
    assert.equal(app.api.sourceFor('fhi-nokkel-185'), 'fhi');
  });

  it('ruter FHI defaultselection og bevarer selection-shape', async () => {
    const result = await app.api.getDefaultSelection('fhi-nokkel-185', 'no');

    assert.ok(Array.isArray(result.selection));
    assert.ok(result.selection.length > 0);
    assert.ok(result.selection.every(item =>
      typeof item.variableCode === 'string' && Array.isArray(item.valueCodes)));
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/nokkel\/Table\/185\/query$/);
  });

  it('ruter kodeliste og servereksport til FHI og returnerer adapterens tydelige feil', async () => {
    await assert.rejects(app.api.getCodeList('fhi-nokkel-codes'), /FHI har ikke kodelister/);
    await assert.rejects(
      app.api.downloadTableData('fhi-nokkel-185', {}, {}),
      /Server-eksport støttes ikke/
    );
    assert.equal(calls.length, 0);
  });

  it('ruter kodeliste, servereksport og defaultselection til Norges Bank', async () => {
    await assert.rejects(app.api.getCodeList('nb-IR-codes'), /Norges Bank har ikke kodelister/);
    await assert.rejects(app.api.downloadTableData('nb-IR', {}, {}), /Server-eksport støttes ikke/);
    await assert.rejects(app.api.getDefaultSelection('nb-IR', 'no'), /ingen defaultselection/);
    assert.equal(calls.length, 0);
  });

  it('avviser deaktivert fremmed kilde i stedet for å falle tilbake til SSB', () => {
    app.AppConfig.sources.nb.enabled = false;
    try {
      assert.equal(app.api.sourceFor('nb-IR'), null);
      assert.throws(
        () => app.api.getTableData('nb-IR', {}, 'no'),
        /Ingen kilde kan håndtere «nb-IR» \(getTableData\)/
      );
    } finally {
      app.AppConfig.sources.nb.enabled = true;
    }
  });
});
