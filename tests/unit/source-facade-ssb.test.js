'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, loadFixture, SCRIPTS } = require('../helpers/app-env.js');

const fixture = loadFixture('source-facade.json');
const calls = [];

function response(data, overrides = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
    blob: async () => new Blob(['fixture']),
    ...overrides
  };
}

const app = loadApp([...SCRIPTS.sources, 'js/utils.js'], {
  fetch: async (url, options = {}) => {
    const call = { url: String(url), options };
    calls.push(call);
    const path = new URL(call.url).pathname;
    if (path.endsWith('/config')) return response(fixture.config);
    if (path.includes('/codeLists/')) return response(fixture.codelist);
    if (path.endsWith('/metadata')) return response(fixture.metadata);
    if (path.endsWith('/defaultselection')) return response(fixture.defaultSelection);
    if (path.endsWith('/savedqueries')) return response({ id: fixture.savedQuery.id });
    if (path.includes('/savedqueries/') && path.endsWith('/data')) return response(fixture.data);
    if (path.includes('/savedqueries/')) return response(fixture.savedQuery);
    if (path.endsWith('/data')) return response(fixture.data);
    throw new Error('Uventet URL i test: ' + call.url);
  }
});

const ssb = app.SourceAdapters.find(adapter => adapter.sourceId === 'ssb');

beforeEach(async () => {
  calls.length = 0;
  ssb.instance._lastRequestTime = 0;
  await app.api.clearCache();
});

describe('SSB-ruting gjennom api-fasaden', () => {
  it('ruter metadata og data for numerisk tabell-id og bevarer JSON-stat2-shape', async () => {
    const metadata = await app.api.getTableMetadata('13760', false, 'no');
    const data = await app.api.getTableData('13760', { Region: ['0'], Tid: ['2025'] }, 'no');

    assert.deepEqual(metadata.id, ['Region', 'Tid']);
    assert.deepEqual(data.value, [42]);
    assert.equal(app.api.sourceFor('13760'), 'ssb');
    assert.match(calls[0].url, /\/tables\/13760\/metadata\?lang=no$/);
    assert.match(calls[1].url, /\/tables\/13760\/data\?lang=no$/);
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      selection: [
        { variableCode: 'Region', valueCodes: ['0'] },
        { variableCode: 'Tid', valueCodes: ['2025'] }
      ]
    });
  });

  it('ruter kodeliste og defaultselection til SSB', async () => {
    const codelist = await app.api.getCodeList('vs_Region', false, 'en');
    const selection = await app.api.getDefaultSelection('13760', 'no');

    assert.equal(codelist.type, 'Valueset');
    assert.deepEqual(selection.selection[0].valueCodes, ['2025']);
    assert.match(calls[0].url, /\/codeLists\/vs_Region\?lang=en$/);
    assert.match(calls[1].url, /\/tables\/13760\/defaultselection\?lang=no$/);
  });

  it('delegerer config og oppdaterer SSB-grensene', async () => {
    const config = await app.api.getConfig();

    assert.equal(config.maxDataCells, 123456);
    assert.equal(app.AppConfig.limits.bySource.ssb.maxCells, 123456);
    assert.equal(app.AppConfig.apiVersion, 'test-v2');
    assert.match(calls[0].url, /\/config$/);
  });

  it('delegerer alle saved-query-metodene til SSB med forventet shape', async () => {
    const saved = await app.api.saveSavedQuery('13760', { Tid: ['2025'] }, { lang: 'no' });
    const query = await app.api.getSavedQuery('saved/id');
    const data = await app.api.getSavedQueryData('saved/id', 'en');

    assert.equal(saved.id, 'saved/id');
    assert.equal(query.tableId, '13760');
    assert.deepEqual(data.value, [42]);
    assert.match(calls[0].url, /\/savedqueries$/);
    assert.equal(JSON.parse(calls[0].options.body).selection.selection[0].variableCode, 'Tid');
    assert.match(calls[1].url, /\/savedqueries\/saved%2Fid$/);
    assert.match(calls[2].url, /\/savedqueries\/saved%2Fid\/data\?lang=en&outputFormat=json-stat2$/);
  });

  it('bygger POST-body gjennom begge fasadelag', () => {
    assert.deepEqual(app.api.buildPostBody({ Tid: 'top(2)' }), {
      selection: [{ variableCode: 'Tid', valueCodes: ['top(2)'] }]
    });
  });

  it('delegerer cache-statistikk, opprydding og tømming til delt SSB-cache', async () => {
    await ssb.instance.cache.set('facade_expired', { stale: true }, -1);
    const before = app.api.getCacheStats();
    const removed = await app.api.cleanupCache();
    await ssb.instance.cache.set('facade_fresh', { fresh: true }, 60000);
    await app.api.clearCache();

    assert.ok(before.localStorage.totalEntries >= 1);
    assert.ok(removed >= 1);
    assert.equal(app.api.getCacheStats().localStorage.totalEntries, 0);
  });
});

describe('SSB-eksport og feilsemantikk gjennom fasaden', () => {
  it('laster ned data med riktig adapter, URL og POST-shape', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:fixture';
    URL.revokeObjectURL = () => {};
    try {
      await app.api.downloadTableData('13760', { Tid: ['2025'] }, {
        format: 'csv', lang: 'no', stub: ['Tid'], formatParams: ['UseTexts']
      });
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }

    assert.match(calls[0].url, /\/tables\/13760\/data\?lang=no&outputFormat=csv&outputFormatParams=UseTexts$/);
    assert.deepEqual(JSON.parse(calls[0].options.body).placement, { stub: ['Tid'] });
  });

  it('returnerer oversatt rate-limit-feil uten å parse body', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => response(null, {
      ok: false, status: 429, statusText: 'Too Many Requests',
      json: async () => { throw new Error('skal ikke parses'); }
    });
    ssb.instance._lastRequestTime = 0;
    try {
      await assert.rejects(app.api.getTableMetadata('99999', false, 'no'), {
        message: app.t('error.rateLimit')
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('bruker RFC 7807-detail og generisk HTTP-feil ved andre svar', async () => {
    await assert.rejects(
      ssb.instance._handleErrorResponse(response(null, {
        ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ detail: 'For mange celler' })
      })),
      { message: 'For mange celler' }
    );
    await assert.rejects(
      ssb.instance._handleErrorResponse(response(null, {
        ok: false, status: 500, statusText: 'Server Error', json: async () => { throw new Error('ikke JSON'); }
      })),
      { message: 'HTTP 500: Server Error' }
    );
  });

  it('defaultLang følger gjeldende API-språk', () => {
    assert.equal(ssb.instance.defaultLang, app.getCurrentApiLang());
  });
});
