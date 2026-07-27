/**
 * api.js — buildPostBody + isAggregationCodelistId
 *
 * POST-kroppen er den eneste veien data faktisk hentes for SSB (getTableData
 * er POST-only), og den var utestet. To ting er lette å knekke ved en refaktor:
 *
 *   1. Skalar-innpakningen. getVariableSelection() returnerer STRENGER for
 *      stjerne-/topp-/intervallvalg ('*', 'top(12)', 'range(2020,2024)') og
 *      ARRAY for eksplisitte valg. API-et krever alltid array, så en manglende
 *      Array.isArray-sjekk gir «valueCodes: "*"» — som SSB avviser.
 *   2. outputValues: 'aggregated'. Uten den returnerer en agg_-kodeliste de
 *      underliggende verdiene i stedet for summene, dvs. feil tall i tabellen
 *      uten noen feilmelding. Se 13472 Region (agg_Fylker2024).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);
const ssb = new app.SSBApi();

describe('isAggregationCodelistId', () => {
  it('kjenner igjen agg_-prefikset uavhengig av store/små bokstaver', () => {
    assert.equal(app.isAggregationCodelistId('agg_Fylker2024'), true);
    assert.equal(app.isAggregationCodelistId('AGG_Fylker2024'), true);
  });

  it('valuesets og tomme verdier er ikke aggregeringer', () => {
    assert.equal(app.isAggregationCodelistId('vs_Fylker'), false);
    assert.equal(app.isAggregationCodelistId('vs_VareKoderKN8Siff'), false);
    assert.equal(app.isAggregationCodelistId(''), false);
    assert.equal(app.isAggregationCodelistId(undefined), false);
    assert.equal(app.isAggregationCodelistId(null), false);
  });
});

describe('SSBApi.buildPostBody', () => {
  it('pakker skalarvalg i array — stjerne, topp og intervall', () => {
    // 08801: Ctrl+A på Varekoder (13429 verdier) gir '*', ikke en kodeliste.
    assert.deepEqual(ssb.buildPostBody({ Varekoder: '*' }), {
      selection: [{ variableCode: 'Varekoder', valueCodes: ['*'] }]
    });
    assert.deepEqual(ssb.buildPostBody({ Tid: 'top(12)' }), {
      selection: [{ variableCode: 'Tid', valueCodes: ['top(12)'] }]
    });
    assert.deepEqual(ssb.buildPostBody({ Tid: 'range(2020,2024)' }), {
      selection: [{ variableCode: 'Tid', valueCodes: ['range(2020,2024)'] }]
    });
  });

  it('lar eksplisitte kodelister gå gjennom som de er', () => {
    const body = ssb.buildPostBody({
      ContentsCode: ['DEP', 'BIF', 'KAPN'],
      Tid: ['2020', '2021']
    });
    assert.deepEqual(body, {
      selection: [
        { variableCode: 'ContentsCode', valueCodes: ['DEP', 'BIF', 'KAPN'] },
        { variableCode: 'Tid', valueCodes: ['2020', '2021'] }
      ]
    });
  });

  it('tomt utvalg gir tom selection, ikke null eller undefined', () => {
    assert.deepEqual(ssb.buildPostBody({}), { selection: [] });
  });

  it('aggregeringskodeliste får både codelist og outputValues', () => {
    const body = ssb.buildPostBody(
      { Region: ['30', '03'] },
      { codelistIds: { Region: 'agg_Fylker2024' } }
    );
    assert.deepEqual(body.selection, [{
      variableCode: 'Region',
      valueCodes: ['30', '03'],
      codelist: 'agg_Fylker2024',
      outputValues: 'aggregated'
    }]);
  });

  it('valueset-kodeliste får codelist, men ALDRI outputValues', () => {
    const body = ssb.buildPostBody(
      { Region: ['0301'] },
      { codelistIds: { Region: 'vs_Kommun' } }
    );
    assert.deepEqual(body.selection, [{
      variableCode: 'Region',
      valueCodes: ['0301'],
      codelist: 'vs_Kommun'
    }]);
    assert.equal('outputValues' in body.selection[0], false);
  });

  it('kodeliste settes bare på dimensjonen den gjelder', () => {
    const body = ssb.buildPostBody(
      { Region: ['30'], Tid: ['2024'] },
      { codelistIds: { Region: 'agg_Fylker2024' } }
    );
    const tid = body.selection.find(e => e.variableCode === 'Tid');
    assert.equal('codelist' in tid, false);
    assert.equal('outputValues' in tid, false);
  });

  it('placement utelates når verken stub eller heading er oppgitt', () => {
    assert.equal('placement' in ssb.buildPostBody({ Tid: ['2024'] }), false);
  });

  it('tomt stub-array gir et tomt placement-objekt (karakterisering)', () => {
    // `options.stub || options.heading` er sann for [], så placement opprettes,
    // men fylles ikke. UI-et treffer aldri dette: buildSsbPreviewUrls setter
    // stubDims til undefined eller et ikke-tomt array. Låst fast her så en
    // framtidig endring av grenen er et bevisst valg, ikke et uhell.
    assert.deepEqual(ssb.buildPostBody({ Tid: ['2024'] }, { stub: [] }).placement, {});
  });

  it('placement fylles fra stub og heading', () => {
    const pivot = ssb.buildPostBody(
      { Region: ['30'], Tid: ['2024'] },
      { stub: ['Region', 'Tid'] }
    );
    assert.deepEqual(pivot.placement, { stub: ['Region', 'Tid'] });

    const both = ssb.buildPostBody(
      { Region: ['30'], Tid: ['2024'] },
      { stub: ['Region'], heading: ['Tid'] }
    );
    assert.deepEqual(both.placement, { heading: ['Tid'], stub: ['Region'] });
  });
});
