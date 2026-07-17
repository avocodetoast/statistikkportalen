/**
 * buildApiQuery(tableId, valueCodes, {meta, lang}) — API-bygger-spørringer for
 * fremmede kilder (Norges Bank / FHI), rutet via fasaden i source-registry.js.
 * Synkron, ren logikk: bygger samme URL/POST-body som getTableData sender.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.sources);

// Minimal JSON-Stat2-metadata slik NB-adapterens getTableMetadata leverer den
// (kun feltene buildApiQuery trenger: id-rekkefølge + role.time).
const nbMeta = {
  id: ['FREQ', 'BASE_CUR', 'QUOTE_CUR', 'TENOR', 'TIME_PERIOD'],
  role: { time: ['TIME_PERIOD'] },
  dimension: {}
};

// Minimal FHI-metadata: id-rekkefølge, role.time og tidsdimensjonens
// kategoriindeks (trengs for top(N)-oppløsning, jf. fhi-adapter.js).
const fhiMeta = {
  id: ['AAR', 'GEO', 'MEASURE_TYPE'],
  role: { time: ['AAR'], geo: ['GEO'], metric: ['MEASURE_TYPE'] },
  dimension: {
    AAR: { label: 'År', category: { index: { 2020: 0, 2021: 1, 2022: 2 }, label: {} } },
    GEO: { label: 'Geografi', category: { index: { 0: 0 }, label: {} } },
    MEASURE_TYPE: { label: 'Måltall', category: { index: { RATE: 0 }, label: {} } }
  }
};

describe('Norges Bank — buildApiQuery', () => {
  it('builds a GET SDMX data URL with key segments in DSD order', () => {
    const q = app.api.buildApiQuery('nb-EXR', {
      FREQ: ['B'],
      BASE_CUR: ['USD', 'EUR'],
      QUOTE_CUR: ['NOK'],
      TENOR: ['SP'],
      TIME_PERIOD: 'top(10)'
    }, { meta: nbMeta, lang: 'no' });

    assert.equal(q.method, 'GET');
    assert.equal(q.body, null);
    assert.equal(
      q.url,
      'https://data.norges-bank.no/api/data/EXR/B.USD+EUR.NOK.SP' +
      '?format=sdmx-json&locale=no&lastNObservations=10'
    );
  });

  it("maps '*' to an empty key segment and explicit time lists to start/endPeriod", () => {
    const q = app.api.buildApiQuery('nb-EXR', {
      FREQ: ['B'],
      BASE_CUR: ['USD'],
      QUOTE_CUR: '*',
      TENOR: ['SP'],
      TIME_PERIOD: ['2024-02-01', '2023-12-29']
    }, { meta: nbMeta, lang: 'no' });

    assert.equal(
      q.url,
      'https://data.norges-bank.no/api/data/EXR/B.USD..SP' +
      '?format=sdmx-json&locale=no&startPeriod=2023-12-29&endPeriod=2024-02-01'
    );
  });

  it('uses locale=en when lang is en', () => {
    const q = app.api.buildApiQuery('nb-EXR', { TIME_PERIOD: '*' }, { meta: nbMeta, lang: 'en' });
    assert.ok(q.url.includes('locale=en'));
  });

  it('returns the DSD (datastructure) URL as metadataUrl', () => {
    const q = app.api.buildApiQuery('nb-EXR', {}, { meta: nbMeta, lang: 'no' });
    assert.equal(
      q.metadataUrl,
      'https://data.norges-bank.no/api/datastructure/NB/DSD_EXR' +
      '?references=codelist&format=sdmx-json'
    );
  });

  it('throws for an unknown nb table id and for missing meta', () => {
    assert.throws(() => app.api.buildApiQuery('nb-NOPE', {}, { meta: nbMeta }));
    assert.throws(() => app.api.buildApiQuery('nb-EXR', {}, {}));
  });

  it("maps a 'range(from,to)' time token to startPeriod/endPeriod", () => {
    const q = app.api.buildApiQuery('nb-EXR', {
      FREQ: ['B'],
      BASE_CUR: ['USD'],
      QUOTE_CUR: ['NOK'],
      TENOR: ['SP'],
      TIME_PERIOD: 'range(2023-12-29,2024-02-01)'
    }, { meta: nbMeta, lang: 'no' });

    assert.equal(
      q.url,
      'https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP' +
      '?format=sdmx-json&locale=no&startPeriod=2023-12-29&endPeriod=2024-02-01'
    );
  });

  it('supports open-ended ranges (empty side → param omitted)', () => {
    const from = app.api.buildApiQuery('nb-EXR', { TIME_PERIOD: 'range(2020-01,)' },
      { meta: nbMeta, lang: 'no' });
    assert.ok(from.url.includes('startPeriod=2020-01'));
    assert.ok(!from.url.includes('endPeriod'));

    const to = app.api.buildApiQuery('nb-EXR', { TIME_PERIOD: 'range(,2024-06)' },
      { meta: nbMeta, lang: 'no' });
    assert.ok(to.url.includes('endPeriod=2024-06'));
    assert.ok(!to.url.includes('startPeriod'));
  });

  it('treats a fully open range like * (no period params)', () => {
    const q = app.api.buildApiQuery('nb-EXR', { TIME_PERIOD: 'range(,)' },
      { meta: nbMeta, lang: 'no' });
    assert.ok(!q.url.includes('startPeriod') && !q.url.includes('endPeriod') &&
              !q.url.includes('lastNObservations'));
  });
});

describe('FHI — buildApiQuery', () => {
  it('builds a POST query with the same body shape as getTableData sends', () => {
    const q = app.api.buildApiQuery('fhi-nokkel-123', {
      AAR: 'top(2)',
      GEO: ['0'],
      MEASURE_TYPE: '*'
    }, { meta: fhiMeta });

    assert.equal(q.method, 'POST');
    assert.equal(q.url, 'https://statistikk-data.fhi.no/api/open/v1/nokkel/Table/123/data');
    assert.deepEqual(q.body, {
      dimensions: [
        // top(2) på tidsdimensjonen løses til de to siste kodene (jf. adapteren)
        { code: 'AAR', filter: 'item', values: ['2021', '2022'] },
        { code: 'GEO', filter: 'item', values: ['0'] },
        { code: 'MEASURE_TYPE', filter: 'all', values: ['*'] }
      ],
      response: { format: 'json-stat2', maxRowCount: 50000 }
    });
  });

  it('returns the /dimension endpoint as metadataUrl', () => {
    const q = app.api.buildApiQuery('fhi-nokkel-123', {}, { meta: fhiMeta });
    assert.equal(q.metadataUrl, 'https://statistikk-data.fhi.no/api/open/v1/nokkel/Table/123/dimension');
  });

  it('throws for a malformed fhi id and for missing meta', () => {
    assert.throws(() => app.api.buildApiQuery('fhi-badid', {}, { meta: fhiMeta }));
    assert.throws(() => app.api.buildApiQuery('fhi-nokkel-123', {}, {}));
  });
});

describe('Norges Bank — buildApiQuery byggervalg (format/detail/includeHistory/bom)', () => {
  const codes = { FREQ: ['B'], BASE_CUR: ['USD'], QUOTE_CUR: ['NOK'], TENOR: ['SP'], TIME_PERIOD: '*' };

  it('setter format-parameteren for hvert gyldig formatvalg', () => {
    ['csv', 'csv-ts', 'excel-both', 'excel-ts'].forEach(format => {
      const q = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no', format });
      assert.ok(q.url.includes('?format=' + format + '&locale=no'),
        format + ': ' + q.url);
    });
  });

  it('faller tilbake til sdmx-json for ukjent eller utelatt format', () => {
    const unknown = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no', format: 'xml' });
    assert.ok(unknown.url.includes('format=sdmx-json'));
    const omitted = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no' });
    assert.ok(omitted.url.includes('format=sdmx-json'));
  });

  it("legger til detail-parameteren for ikke-standard verdier, aldri for 'full'/utelatt", () => {
    ['dataonly', 'serieskeysonly', 'nodata'].forEach(detail => {
      const q = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no', detail });
      assert.ok(q.url.includes('detail=' + detail), detail + ': ' + q.url);
    });
    const full = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no', detail: 'full' });
    assert.ok(!full.url.includes('detail='));
    const none = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no' });
    assert.ok(!none.url.includes('detail='));
  });

  it('legger til includeHistory=true og bom=true kun når de er valgt', () => {
    const q = app.api.buildApiQuery('nb-EXR', codes,
      { meta: nbMeta, lang: 'no', format: 'csv', includeHistory: true, bom: true });
    assert.ok(q.url.includes('includeHistory=true'));
    assert.ok(q.url.includes('bom=true'));

    const off = app.api.buildApiQuery('nb-EXR', codes, { meta: nbMeta, lang: 'no' });
    assert.ok(!off.url.includes('includeHistory') && !off.url.includes('bom'));
  });

  it('endrer ikke metadataUrl uansett byggervalg', () => {
    const q = app.api.buildApiQuery('nb-EXR', codes,
      { meta: nbMeta, lang: 'no', format: 'excel-both', detail: 'dataonly', includeHistory: true });
    assert.equal(
      q.metadataUrl,
      'https://data.norges-bank.no/api/datastructure/NB/DSD_EXR?references=codelist&format=sdmx-json'
    );
  });
});

describe('FHI — buildApiQuery byggervalg (format/maxRowCount)', () => {
  const codes = { AAR: '*', GEO: ['0'], MEASURE_TYPE: '*' };

  it('setter response.format for hvert gyldig formatvalg (maxRowCount uendret)', () => {
    ['csv2', 'csv3', 'parquet'].forEach(format => {
      const q = app.api.buildApiQuery('fhi-nokkel-123', codes, { meta: fhiMeta, format });
      assert.equal(q.body.response.format, format);
      assert.equal(q.body.response.maxRowCount, 50000);
    });
  });

  it('faller tilbake til json-stat2 for ukjent format', () => {
    const q = app.api.buildApiQuery('fhi-nokkel-123', codes, { meta: fhiMeta, format: 'csv' });
    assert.equal(q.body.response.format, 'json-stat2');
  });

  it('respekterer eksplisitt maxRowCount og utelater feltet ved null (= ubegrenset)', () => {
    const explicit = app.api.buildApiQuery('fhi-nokkel-123', codes, { meta: fhiMeta, maxRowCount: 10000 });
    assert.equal(explicit.body.response.maxRowCount, 10000);

    const unlimited = app.api.buildApiQuery('fhi-nokkel-123', codes, { meta: fhiMeta, maxRowCount: null });
    assert.ok(!('maxRowCount' in unlimited.body.response));

    const dflt = app.api.buildApiQuery('fhi-nokkel-123', codes, { meta: fhiMeta });
    assert.equal(dflt.body.response.maxRowCount, 50000);
  });

  it('faller tilbake til 50000 for ugyldig maxRowCount', () => {
    [-5, 0, 1.5, 'abc', NaN].forEach(bad => {
      const q = app.api.buildApiQuery('fhi-nokkel-123', codes, { meta: fhiMeta, maxRowCount: bad });
      assert.equal(q.body.response.maxRowCount, 50000, 'maxRowCount=' + String(bad));
    });
  });
});

describe('Facade — apiBuilderOptionsFor', () => {
  it('beskriver Norges Banks formater og avanserte valg', () => {
    const opts = app.api.apiBuilderOptionsFor('nb-EXR');
    assert.deepEqual(opts.formats.map(f => f.value),
      ['sdmx-json', 'csv', 'csv-ts', 'excel-both', 'excel-ts']);
    assert.equal(opts.defaultFormat, 'sdmx-json');
    assert.deepEqual(opts.csvFormats, ['csv', 'csv-ts']);
    assert.equal(opts.nbAdvanced, true);
    assert.equal(opts.maxRowCount, null);
    opts.formats.forEach(f => assert.ok(f.label || f.labelKey, f.value + ' mangler etikett'));
  });

  it('beskriver FHIs formater og maxRowCount', () => {
    const opts = app.api.apiBuilderOptionsFor('fhi-nokkel-123');
    assert.deepEqual(opts.formats.map(f => f.value),
      ['json-stat2', 'csv2', 'csv3', 'parquet']);
    assert.equal(opts.defaultFormat, 'json-stat2');
    assert.equal(opts.maxRowCount.default, 50000);
    assert.ok(!opts.nbAdvanced);
  });

  it('returnerer null for SSB-tabeller (fullt panel brukes der)', () => {
    assert.equal(app.api.apiBuilderOptionsFor('13760'), null);
  });
});

describe('Facade — routing & capabilities', () => {
  it('exposes supportsApiQuery=true for nb/fhi and false for ssb', () => {
    assert.equal(app.api.capabilitiesFor('nb-EXR').supportsApiQuery, true);
    assert.equal(app.api.capabilitiesFor('fhi-nokkel-123').supportsApiQuery, true);
    assert.equal(!!app.api.capabilitiesFor('13760').supportsApiQuery, false);
  });

  it('keeps the SSB GET-URL builder capability unchanged', () => {
    assert.equal(app.api.capabilitiesFor('13760').supportsGetUrlBuilder, true);
    assert.equal(app.api.capabilitiesFor('nb-EXR').supportsGetUrlBuilder, false);
    assert.equal(app.api.capabilitiesFor('fhi-nokkel-123').supportsGetUrlBuilder, false);
  });

  it('throws when buildApiQuery is called for an SSB table (dedicated panel is used there)', () => {
    assert.throws(() => app.api.buildApiQuery('13760', {}, { meta: { id: [] } }));
  });
});
