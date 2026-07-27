/**
 * variable-select-codelists.js — sortCodelistOptions + extractCodelistCodes
 *
 * Grupperinger («Kategorisering»-nedtrekket) styrer to ting som er lette å
 * brekke uten at noe synlig feiler: hvilken rekkefølge alternativene får, og
 * hvordan et valg oversettes til koder i API-spørringen.
 *
 * MERK — to uavhengige begreper om «aggregert», og de er IKKE alltid enige:
 *
 *   isAggregationCodelistId(id)   — ren prefikssjekk på 'agg_' (js/api.js:14).
 *                                   Avgjør om outputValues=aggregated sendes.
 *   extractCodelistCodes().isAggregated — utledes av valueMap-FORMEN.
 *                                   Avgjør hva getVariableSelection() sender.
 *
 * Verifisert mot ekte SSB-svar: agg_Fylker2024 har type «Aggregation», men
 * identitets-valueMap (["31"] for koden "31"), fordi fylkeskodene allerede
 * finnes i Region-dimensjonen — den gir isAggregated=false. agg_KommFylker
 * har ekte mange-til-én-valueMap (F-31 ← 40 kommunekoder) og gir true.
 * Begge formene testes her, ellers dekker vi bare halve virkeligheten.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/variable-select-state.js',
  'js/variable-select-codelists.js'
]);

describe('sortCodelistOptions', () => {
  it('vs_ først, så øvrige, så agg_', () => {
    const sorted = app.sortCodelistOptions([
      { id: 'agg_Fylker2024' },
      { id: 'kommune_spesial' },
      { id: 'vs_Kommun' },
      { id: 'agg_KommFylker' },
      { id: 'vs_Fylker' }
    ]);
    assert.deepEqual(sorted.map(c => c.id), [
      'vs_Kommun', 'vs_Fylker', 'kommune_spesial', 'agg_Fylker2024', 'agg_KommFylker'
    ]);
  });

  it('rekkefølgen innad i hver gruppe er stabil', () => {
    // 08801 Varekoder: 20 agg_Kap* + 1 vs_. preloadCodelistOrdering() henter
    // den FØRSTE i lista, så vs_-en må alltid havne fremst uansett hvor i
    // metadataen den sto.
    const codelists = [];
    for (let i = 1; i <= 20; i++) codelists.push({ id: 'agg_Kap' + String(i).padStart(2, '0') });
    codelists.push({ id: 'vs_VareKoderKN8Siff' });

    const sorted = app.sortCodelistOptions(codelists);
    assert.equal(sorted[0].id, 'vs_VareKoderKN8Siff');
    assert.deepEqual(sorted.slice(1).map(c => c.id), codelists.slice(0, 20).map(c => c.id));
  });

  it('prefiksene matches uavhengig av store/små bokstaver', () => {
    const sorted = app.sortCodelistOptions([{ id: 'AGG_X' }, { id: 'VS_Y' }]);
    assert.deepEqual(sorted.map(c => c.id), ['VS_Y', 'AGG_X']);
  });

  it('tom liste gir tom liste', () => {
    assert.deepEqual(app.sortCodelistOptions([]), []);
  });
});

describe('extractCodelistCodes — valueset (filter)', () => {
  // Form fra vs_NRInvArtAgg3 (11189 Investeringsart).
  const valueset = {
    id: 'vs_NRInvArtAgg3',
    type: 'Valueset',
    elimination: true,
    values: [
      { code: 'NR08_', label: 'Alle investeringsarter', valueMap: ['NR08_'] },
      { code: 'NR0815', label: 'Bygg og anlegg', valueMap: ['NR0815'] }
    ]
  };

  it('identitets-valueMap gir isAggregated=false', () => {
    assert.equal(app.extractCodelistCodes(valueset).isAggregated, false);
  });

  it('originalCodes er kodene selv', () => {
    const { originalCodes } = app.extractCodelistCodes(valueset);
    assert.deepEqual([...originalCodes].sort(), ['NR0815', 'NR08_']);
  });

  it('values beholder kode, etikett og valueMap', () => {
    const { values } = app.extractCodelistCodes(valueset);
    assert.deepEqual(values[0], {
      code: 'NR08_', label: 'Alle investeringsarter', valueMap: ['NR08_']
    });
  });
});

describe('extractCodelistCodes — ekte aggregering', () => {
  // Form fra agg_KommFylker (13472 Region): F-31 ← flere kommunekoder.
  const aggregation = {
    id: 'agg_KommFylker',
    type: 'Aggregation',
    values: [
      { code: 'F-31', label: 'Østfold', valueMap: ['0101', '3124', '0103'] },
      { code: 'F-32', label: 'Akershus', valueMap: ['0211', '0213'] }
    ]
  };

  it('mange-til-én-valueMap gir isAggregated=true', () => {
    assert.equal(app.extractCodelistCodes(aggregation).isAggregated, true);
  });

  it('originalCodes er unionen av alle valueMap, ikke kodelistas egne koder', () => {
    const { originalCodes } = app.extractCodelistCodes(aggregation);
    assert.deepEqual([...originalCodes].sort(), ['0101', '0103', '0211', '0213', '3124']);
    assert.equal(originalCodes.has('F-31'), false);
  });

  it('overlappende valueMap telles én gang', () => {
    const { originalCodes } = app.extractCodelistCodes({
      values: [
        { code: 'A', valueMap: ['1', '2'] },
        { code: 'B', valueMap: ['2', '3'] }
      ]
    });
    assert.equal(originalCodes.size, 3);
  });
});

describe('extractCodelistCodes — agg_ med identitets-valueMap', () => {
  // agg_Fylker2024: type «Aggregation», men valueMap er identitet fordi
  // fylkeskodene allerede finnes i Region-dimensjonen. Da behandler
  // getVariableSelection() den som et filter (utvider via valueMap), mens
  // URL-byggeren likevel legger på outputValues=aggregated på grunn av
  // agg_-prefikset. Begge deler er riktig — dette låser fast at de to
  // mekanismene får lov til å være uenige.
  const aggIdentity = {
    id: 'agg_Fylker2024',
    type: 'Aggregation',
    values: [
      { code: '31', label: 'Østfold', valueMap: ['31'] },
      { code: '32', label: 'Akershus', valueMap: ['32'] }
    ]
  };

  it('utledet isAggregated er false selv om id-en er agg_', () => {
    assert.equal(app.extractCodelistCodes(aggIdentity).isAggregated, false);
    assert.equal(app.isAggregationCodelistId(aggIdentity.id), true);
  });
});

describe('extractCodelistCodes — kantverdier', () => {
  it('manglende valueMap faller tilbake til koden selv', () => {
    const { values, originalCodes, isAggregated } = app.extractCodelistCodes({
      values: [{ code: '0301', label: 'Oslo' }]
    });
    assert.deepEqual(values[0].valueMap, ['0301']);
    assert.deepEqual([...originalCodes], ['0301']);
    assert.equal(isAggregated, false);
  });

  it('tomt valueMap-array faller også tilbake til koden', () => {
    const { values } = app.extractCodelistCodes({
      values: [{ code: '0301', valueMap: [] }]
    });
    assert.deepEqual(values[0].valueMap, ['0301']);
  });

  it('ett element i valueMap som er ULIKT koden er en aggregering', () => {
    // Grensetilfellet i inferensen: valueMap.length === 1 er ikke nok.
    assert.equal(app.extractCodelistCodes({
      values: [{ code: 'F-31', valueMap: ['0101'] }]
    }).isAggregated, true);
  });

  it('etikett faller tilbake til koden', () => {
    const { values } = app.extractCodelistCodes({ values: [{ code: '0301' }] });
    assert.equal(values[0].label, '0301');
  });

  it('verdier uten kode hoppes over', () => {
    const { values } = app.extractCodelistCodes({
      values: [{ label: 'Uten kode' }, { code: '0301', valueMap: ['0301'] }]
    });
    assert.deepEqual(values.map(v => v.code), ['0301']);
  });

  it('svar uten values-array gir et tomt, trygt resultat', () => {
    for (const bad of [{}, { values: null }, { values: 'nei' }]) {
      const result = app.extractCodelistCodes(bad);
      assert.deepEqual(result.values, []);
      assert.equal(result.originalCodes.size, 0);
      assert.equal(result.isAggregated, false);
    }
  });

  it('originalCodes normaliseres til strenger', () => {
    const { originalCodes } = app.extractCodelistCodes({
      values: [{ code: 'A', valueMap: [1, 2] }]
    });
    assert.deepEqual([...originalCodes], ['1', '2']);
  });
});
