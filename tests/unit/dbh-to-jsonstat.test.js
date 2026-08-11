'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers/app-env.js');
const app = loadApp(['js/sources/dbh-to-jsonstat.js']);
const converter = app.DbhToJsonStat;
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/dbh-data-900.json'), 'utf8'));

describe('DbhToJsonStat', () => {
  it('konverterer et ekte svar og lager syntetisk måltallsdimensjon', () => {
    const rows = fixture.slice(0, 4);
    const out = converter.convert(rows, {
      dimensions: [
        { code: 'Årstall', label: 'Årstall' },
        { code: 'Institusjonskode', label: 'Institusjon', nameColumn: 'Institusjonsnavn' }
      ],
      measures: ['Ny produksjon totalt', 'Ny produksjon ekstern'],
      label: 'Studiepoeng', source: 'DBH'
    });
    assert.deepEqual(Array.from(out.id), ['Årstall', 'Institusjonskode', 'dbh-måltall']);
    assert.deepEqual(Array.from(out.size), [1, 3, 2]);
    assert.equal(out.role.time[0], 'Årstall');
    assert.equal(out.role.metric[0], 'dbh-måltall');
    assert.equal(out.dimension.Institusjonskode.category.label['8208'], 'VID vitenskapelige høgskole');
    assert.deepEqual(Array.from(out.value), [3751.399774, 0, 9441.999864, 0, 11642.007728, 755.052491]);
  });

  it('foretrekker labelMap fra byggetidsmetadata over navnekolonner og koder', () => {
    const rows = fixture.slice(0, 4);
    const out = converter.convert(rows, {
      dimensions: [
        { code: 'Årstall', label: 'Årstall' },
        { code: 'Institusjonskode', label: 'Institusjon', nameColumn: 'Institusjonsnavn',
          labelMap: { '8208': 'VID (fra metadata)' } }
      ],
      measures: ['Ny produksjon totalt'],
      label: 'Studiepoeng', source: 'DBH'
    });
    // labelMap vinner over nameColumn der den har en oppføring …
    assert.equal(out.dimension.Institusjonskode.category.label['8208'], 'VID (fra metadata)');
    // … og nameColumn beholdes som fallback for koder labelMap ikke kjenner.
    assert.equal(out.dimension.Institusjonskode.category.label['8253'], 'Høyskolen Kristiania');
  });

  it('parser tallstrenger og null, og fyller manglende kombinasjoner med null', () => {
    const response = [
      { status: { returkode: 0, antall: 2 } },
      { 'Årstall': '2023', Kjønn: 'K', Antall: '0.00' },
      { 'Årstall': '2024', Kjønn: 'M', Antall: null }
    ];
    const out = converter.convert(response, {
      dimensions: [{ code: 'Årstall' }, { code: 'Kjønn' }], measures: ['Antall']
    });
    assert.deepEqual(Array.from(out.id), ['Årstall', 'Kjønn']);
    assert.deepEqual(Array.from(out.size), [2, 2]);
    assert.deepEqual(Array.from(out.value), [0, null, null, null]);
  });

  it('godtar tomt resultat med returkode 0', () => {
    const out = converter.convert([{ status: { returkode: 0, antall: 0 } }], {
      dimensions: [{ code: 'Årstall' }], measures: ['Antall']
    });
    assert.deepEqual(Array.from(out.value), []);
    assert.deepEqual(Array.from(out.size), [0]);
  });
});
