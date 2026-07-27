/**
 * tests/e2e/helpers/stub-routes.mjs — trimMetadata / trimCodelist / trimTableList
 *
 * Trimmerne kjører bare under fixture-innspilling, men de er den eneste koden
 * mellom SSBs ekte svar og det testene senere ser. En feil her produserer en
 * fixture som er internt inkonsistent — f.eks. size[] som ikke stemmer med
 * antall verdier — og da tester E2E-laget noe som ikke finnes. Innspillingen
 * skjer sjelden og krever nett, så feilen ville ikke blitt oppdaget på lenge.
 * Derfor testes trimmerne rent, med syntetiske svar i ekte form.
 *
 * Testfila ligger under tests/, som check-coverage.mjs ignorerer
 * (INCLUDE_PREFIX = 'js/'), så den påvirker ikke dekningsporten.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let trimMetadata, trimCodelist, trimTableList, MAX_DIM_VALUES;

before(async () => {
  // stub-routes.mjs importerer bare node-innebygde moduler (aldri playwright),
  // så den lastes trygt uten npm install.
  const url = pathToFileURL(
    path.resolve(__dirname, '..', 'e2e', 'helpers', 'stub-routes.mjs')
  ).href;
  ({ trimMetadata, trimCodelist, trimTableList, MAX_DIM_VALUES } = await import(url));
});

/** Metadatasvar i SSBs form: id/size/dimension med kodenøklede sidemapper. */
function makeMetadata(dimSpecs) {
  const id = dimSpecs.map(d => d.name);
  const size = dimSpecs.map(d => d.count);
  const dimension = {};

  for (const spec of dimSpecs) {
    const index = {};
    const label = {};
    for (let i = 0; i < spec.count; i++) {
      const code = `${spec.name}-${i}`;
      index[code] = i;
      label[code] = `Etikett ${i}`;
    }
    dimension[spec.name] = {
      label: spec.name,
      category: { index, label },
      extension: { elimination: true, show: 'code_value', codelists: spec.codelists || [] }
    };
  }

  return { class: 'dataset', id, size, dimension, role: { time: ['Tid'] } };
}

describe('trimMetadata', () => {
  it('kapper dimensjoner over grensen og lar de andre være', () => {
    const body = makeMetadata([
      { name: 'Varekoder', count: 13429 },
      { name: 'Land', count: 262 }
    ]);
    const out = trimMetadata(body, { maxValues: 700 });

    assert.equal(Object.keys(out.dimension.Varekoder.category.index).length, 700);
    assert.equal(Object.keys(out.dimension.Land.category.index).length, 262);
  });

  it('den trimmede dimensjonen er fortsatt over stjerneterskelen på 500', () => {
    // Selve poenget med grensa. Senkes MAX_DIM_VALUES under 500, slutter
    // Ctrl+A→stjerne å bli testet i E2E — da skal denne bli rød først.
    assert.ok(MAX_DIM_VALUES > 500, `MAX_DIM_VALUES er ${MAX_DIM_VALUES}`);
  });

  it('renummererer category.index til 0..N-1 uten hull', () => {
    const out = trimMetadata(makeMetadata([{ name: 'Region', count: 994 }]), { maxValues: 700 });
    const index = out.dimension.Region.category.index;
    const values = Object.values(index).sort((a, b) => a - b);
    assert.deepEqual(values, Array.from({ length: 700 }, (_, i) => i));
  });

  it('beholder de FØRSTE kodene i index-rekkefølge', () => {
    const out = trimMetadata(makeMetadata([{ name: 'X', count: 10 }]), { maxValues: 3 });
    assert.deepEqual(Object.keys(out.dimension.X.category.index), ['X-0', 'X-1', 'X-2']);
  });

  it('holder size[] i synk med id[]', () => {
    // Den enkleste måten å lage en stille ødelagt fixture på: JSON-Stat2s
    // flate value-array indekseres via size, så et utdatert tall ville gitt
    // feil celler uten noen feilmelding.
    const body = makeMetadata([
      { name: 'Varekoder', count: 13429 },
      { name: 'ImpEks', count: 2 },
      { name: 'Land', count: 262 }
    ]);
    const out = trimMetadata(body, { maxValues: 700 });
    assert.deepEqual(out.size, [700, 2, 262]);
    assert.deepEqual(out.id, ['Varekoder', 'ImpEks', 'Land']);
  });

  it('beskjærer kodenøklede sidemapper i category', () => {
    const body = makeMetadata([{ name: 'X', count: 10 }]);
    body.dimension.X.category.unit = {};
    body.dimension.X.category.note = {};
    for (let i = 0; i < 10; i++) {
      body.dimension.X.category.unit[`X-${i}`] = { decimals: 0 };
      body.dimension.X.category.note[`X-${i}`] = `note ${i}`;
    }

    const out = trimMetadata(body, { maxValues: 3 });
    assert.deepEqual(Object.keys(out.dimension.X.category.unit), ['X-0', 'X-1', 'X-2']);
    assert.deepEqual(Object.keys(out.dimension.X.category.note), ['X-0', 'X-1', 'X-2']);
  });

  it('beskjærer kodenøklede sidemapper i extension', () => {
    // Ekte form fra 08801 ContentsCode: refperiod/measuringType/priceType/
    // adjustment/alternativeText er alle nøklet på verdikode.
    const body = makeMetadata([{ name: 'X', count: 10 }]);
    body.dimension.X.extension.refperiod = {};
    body.dimension.X.extension.alternativeText = {};
    for (let i = 0; i < 10; i++) {
      body.dimension.X.extension.refperiod[`X-${i}`] = '31.12.';
      body.dimension.X.extension.alternativeText[`X-${i}`] = `Alt ${i}`;
    }

    const out = trimMetadata(body, { maxValues: 3 });
    assert.deepEqual(Object.keys(out.dimension.X.extension.refperiod), ['X-0', 'X-1', 'X-2']);
    assert.deepEqual(Object.keys(out.dimension.X.extension.alternativeText), ['X-0', 'X-1', 'X-2']);
  });

  it('rører ikke extension-felter som ikke er kodenøklede', () => {
    const codelists = [{ id: 'vs_A', label: 'A', type: 'Valueset' }];
    const body = makeMetadata([{ name: 'X', count: 10, codelists }]);
    const out = trimMetadata(body, { maxValues: 3 });

    assert.deepEqual(out.dimension.X.extension.codelists, codelists);
    assert.equal(out.dimension.X.extension.elimination, true);
    assert.equal(out.dimension.X.extension.show, 'code_value');
  });

  it('fyller keptCodes med kodene som overlevde', () => {
    const keptCodes = new Set();
    trimMetadata(makeMetadata([
      { name: 'Stor', count: 10 },
      { name: 'Liten', count: 2 }
    ]), { maxValues: 3, keptCodes });

    assert.deepEqual([...keptCodes].sort(), ['Stor-0', 'Stor-1', 'Stor-2']);
    // Utrimmede dimensjoner bidrar ikke — de trenger ingen kodelistefiltrering.
    assert.equal(keptCodes.has('Liten-0'), false);
  });

  it('returnerer input uendret når ingen dimensjon er over grensen', () => {
    const body = makeMetadata([{ name: 'X', count: 10 }]);
    assert.equal(trimMetadata(body, { maxValues: 700 }), body);
  });

  it('muterer ikke input', () => {
    const body = makeMetadata([{ name: 'X', count: 10 }]);
    trimMetadata(body, { maxValues: 3 });
    assert.equal(Object.keys(body.dimension.X.category.index).length, 10);
    assert.deepEqual(body.size, [10]);
  });

  it('ikke-JSON-Stat2-svar går uendret gjennom', () => {
    // FHIs /Table/{id}/metadata treffer samme rute-gren, men har ikke id[].
    for (const body of [null, {}, { id: 'ikke-array' }, { id: ['X'] }, { tables: [] }]) {
      assert.equal(trimMetadata(body, { maxValues: 3 }), body);
    }
  });

  it('dimensjon uten category.index hoppes over', () => {
    const body = { id: ['X'], size: [5], dimension: { X: { label: 'X' } } };
    assert.equal(trimMetadata(body, { maxValues: 3 }), body);
  });
});

describe('trimCodelist', () => {
  const varekoderKept = new Set(['V-0', 'V-1', 'V-2']);

  it('filtrerer valueMap mot kodene som overlevde metadatatrimmingen', () => {
    // vs_VareKoderKN8Siff: identitets-valueMap over hele dimensjonen.
    const body = {
      id: 'vs_VareKoderKN8Siff',
      values: [
        { code: 'V-0', valueMap: ['V-0'] },
        { code: 'V-1', valueMap: ['V-1'] },
        { code: 'V-9', valueMap: ['V-9'] }
      ]
    };
    const out = trimCodelist(body, { keptCodes: varekoderKept, maxValues: 700 });
    assert.deepEqual(out.values.map(v => v.code), ['V-0', 'V-1']);
  });

  it('aggregater beholdes med bare de overlevende originalkodene', () => {
    // agg_KommFylker-formen: F-31 ← mange kommunekoder.
    const out = trimCodelist({
      values: [{ code: 'F-31', label: 'Østfold', valueMap: ['V-0', 'V-9', 'V-2'] }]
    }, { keptCodes: varekoderKept, maxValues: 700 });

    assert.deepEqual(out.values[0].valueMap, ['V-0', 'V-2']);
    assert.equal(out.values[0].label, 'Østfold');
  });

  it('aggregater som mister alle originalkodene droppes', () => {
    const out = trimCodelist({
      values: [
        { code: 'F-31', valueMap: ['V-0'] },
        { code: 'F-99', valueMap: ['V-8', 'V-9'] }
      ]
    }, { keptCodes: varekoderKept, maxValues: 700 });

    assert.deepEqual(out.values.map(v => v.code), ['F-31']);
  });

  it('kodelister for UTRIMMEDE dimensjoner røres ikke', () => {
    // Nøkkelegenskapen: keptCodes er unionen over alle trimmede dimensjoner, og
    // URL-en /codeLists/{id} sier ikke hvilken dimensjon kodelista hører til.
    // Uten overlapp-sjekken ville vs_LandKoderAlf1 blitt tømt fullstendig.
    const landCodelist = {
      id: 'vs_LandKoderAlf1',
      values: [
        { code: 'SE', valueMap: ['SE'] },
        { code: 'DK', valueMap: ['DK'] }
      ]
    };
    const out = trimCodelist(landCodelist, { keptCodes: varekoderKept, maxValues: 700 });
    assert.equal(out, landCodelist);
  });

  it('kapper til maxValues etter filtreringen', () => {
    const values = Array.from({ length: 1000 }, (_, i) => ({ code: `C${i}` }));
    const out = trimCodelist({ values }, { maxValues: 700 });
    assert.equal(out.values.length, 700);
  });

  it('uten keptCodes gjøres bare kappingen', () => {
    const body = { values: [{ code: 'A', valueMap: ['X'] }] };
    assert.equal(trimCodelist(body, { maxValues: 700 }), body);
    assert.equal(trimCodelist(body, { maxValues: 700, keptCodes: new Set() }), body);
  });

  it('verdier uten valueMap overlever filtreringen', () => {
    const out = trimCodelist({
      values: [{ code: 'V-0', valueMap: ['V-0'] }, { code: 'X' }]
    }, { keptCodes: varekoderKept, maxValues: 700 });
    assert.deepEqual(out.values.map(v => v.code), ['V-0', 'X']);
  });

  it('svar uten values-array går uendret gjennom', () => {
    for (const body of [null, {}, { values: 'nei' }]) {
      assert.equal(trimCodelist(body, { maxValues: 3 }), body);
    }
  });

  it('muterer ikke input', () => {
    const body = { values: [{ code: 'F', valueMap: ['V-0', 'V-9'] }] };
    trimCodelist(body, { keptCodes: varekoderKept, maxValues: 700 });
    assert.deepEqual(body.values[0].valueMap, ['V-0', 'V-9']);
  });
});

describe('trimTableList', () => {
  function makeTables(specs) {
    return {
      tables: specs.map(([id, subject]) => ({
        id, label: `Tabell ${id}`, paths: [[{ id: subject }]]
      }))
    };
  }

  it('beholder alltid keep-ID-ene, uansett emnekvote', () => {
    const body = makeTables([
      ['00001', 'al'], ['00002', 'al'], ['00003', 'al'], ['00004', 'al'], ['08801', 'al']
    ]);
    const out = trimTableList(body, { keep: ['08801'], perSubject: 2 });
    assert.ok(out.tables.some(t => t.id === '08801'));
  });

  it('begrenser til perSubject per emne', () => {
    const body = makeTables([
      ['1', 'al'], ['2', 'al'], ['3', 'al'], ['4', 'bf'], ['5', 'bf']
    ]);
    const out = trimTableList(body, { perSubject: 2 });
    assert.deepEqual(out.tables.map(t => t.id), ['1', '2', '4', '5']);
  });

  it('svar uten tables-array går uendret gjennom', () => {
    const body = { noe: 'annet' };
    assert.equal(trimTableList(body), body);
  });
});
