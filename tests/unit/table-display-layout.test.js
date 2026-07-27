/**
 * table-display.js — standardoppsett og CSV-formatering
 *
 * Rene hjelpere på datainnlastingssiden som ikke var dekket. De avgjør hva
 * brukeren faktisk ser når data kommer inn:
 *
 *   determineDefaultLayout — hvilken dimensjon som blir rader og hvilke som
 *     blir kolonner. Den leser JSON-Stat2s role.time, IKKE dimensjonsnavnet,
 *     nettopp fordi tidsdimensjonen heter «Tid» hos SSB, «TIME_PERIOD» hos
 *     Norges Bank og noe annet igjen på engelsk.
 *   formatNumberForCsv / csvField — CSV-en er semikolonseparert med norsk
 *     desimalkomma, så en verdi som inneholder semikolon eller komma må
 *     håndteres riktig, ellers forskyves kolonnene i regnearket.
 *
 * buildDimensionCombinations testes også: den er ren, og rekkefølgen på
 * kombinasjonene bestemmer radrekkefølgen i tabellen.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/table-display.js'
]);

describe('determineDefaultLayout', () => {
  it('tidsdimensjonen blir rader, resten kolonner', () => {
    // 11189-formen: heading er ContentsCode+Tid, stub Investeringsart+NACE.
    const layout = app.determineDefaultLayout({
      id: ['Investeringsart', 'NACE', 'ContentsCode', 'Tid'],
      role: { time: ['Tid'], metric: ['ContentsCode'] }
    });
    assert.deepEqual(layout, {
      rows: ['Tid'],
      columns: ['Investeringsart', 'NACE', 'ContentsCode']
    });
  });

  it('finner tidsdimensjonen via role.time uansett hva den heter', () => {
    // Norges Bank kaller den TIME_PERIOD.
    const layout = app.determineDefaultLayout({
      id: ['BASE_CUR', 'TIME_PERIOD'],
      role: { time: ['TIME_PERIOD'] }
    });
    assert.deepEqual(layout, { rows: ['TIME_PERIOD'], columns: ['BASE_CUR'] });
  });

  it('tidsdimensjonen alene gir tomme kolonner', () => {
    const layout = app.determineDefaultLayout({
      id: ['Tid'],
      role: { time: ['Tid'] }
    });
    assert.deepEqual(layout, { rows: ['Tid'], columns: [] });
  });

  it('uten role.time blir siste dimensjon kolonne', () => {
    const layout = app.determineDefaultLayout({
      id: ['Region', 'Kjonn', 'ContentsCode']
    });
    assert.deepEqual(layout, { rows: ['Region', 'Kjonn'], columns: ['ContentsCode'] });
  });

  it('role.time som peker på en dimensjon som ikke finnes ignoreres', () => {
    const layout = app.determineDefaultLayout({
      id: ['Region', 'ContentsCode'],
      role: { time: ['Tid'] }
    });
    assert.deepEqual(layout, { rows: ['Region'], columns: ['ContentsCode'] });
  });

  it('én dimensjon uten tid blir kolonne', () => {
    assert.deepEqual(app.determineDefaultLayout({ id: ['ContentsCode'] }), {
      rows: [], columns: ['ContentsCode']
    });
  });
});

describe('formatNumberForCsv', () => {
  it('desimalpunktum blir komma', () => {
    assert.equal(app.formatNumberForCsv(1234.5), '1234,5');
    assert.equal(app.formatNumberForCsv('0.25'), '0,25');
  });

  it('heltall og negative tall står uendret bortsett fra komma', () => {
    assert.equal(app.formatNumberForCsv(42), '42');
    assert.equal(app.formatNumberForCsv(-3.75), '-3,75');
  });

  it('grupperer ikke tusener — regneark må kunne tolke tallet', () => {
    assert.equal(app.formatNumberForCsv(1234567.89), '1234567,89');
  });

  it('tomme verdier gir tom streng', () => {
    assert.equal(app.formatNumberForCsv(null), '');
    assert.equal(app.formatNumberForCsv(undefined), '');
    assert.equal(app.formatNumberForCsv(''), '');
  });

  it('ikke-numeriske verdier sendes uendret gjennom', () => {
    assert.equal(app.formatNumberForCsv('..'), '..');
    assert.equal(app.formatNumberForCsv(':'), ':');
  });

  it('null er ikke det samme som 0', () => {
    assert.equal(app.formatNumberForCsv(0), '0');
  });
});

describe('csvField', () => {
  it('vanlige verdier står ukvotert', () => {
    assert.equal(app.csvField('Oslo'), 'Oslo');
    assert.equal(app.csvField(2024), '2024');
  });

  it('semikolon tvinger kvotering — ellers sprekker kolonnene', () => {
    assert.equal(app.csvField('Bygg; anlegg'), '"Bygg; anlegg"');
  });

  it('anførselstegn dobles inne i kvoteringen', () => {
    assert.equal(app.csvField('Han sa "hei"'), '"Han sa ""hei"""');
  });

  it('linjeskift kvoteres', () => {
    assert.equal(app.csvField('linje1\nlinje2'), '"linje1\nlinje2"');
    assert.equal(app.csvField('linje1\r\nlinje2'), '"linje1\r\nlinje2"');
  });

  it('komma kvoteres IKKE — separatoren er semikolon', () => {
    assert.equal(app.csvField('Oslo, Norge'), 'Oslo, Norge');
  });

  it('null og undefined gir tom streng', () => {
    assert.equal(app.csvField(null), '');
    assert.equal(app.csvField(undefined), '');
  });
});

describe('buildDimensionCombinations', () => {
  const data = {
    dimension: {
      ContentsCode: { category: { index: { DEP: 0, BIF: 1 } } },
      Tid: { category: { index: { 2022: 0, 2023: 1 } } }
    }
  };

  it('siste dimensjon varierer raskest', () => {
    const combos = app.buildDimensionCombinations(['ContentsCode', 'Tid'], data);
    assert.deepEqual(combos.map(c => c.codes.join('/')), [
      'DEP/2022', 'DEP/2023', 'BIF/2022', 'BIF/2023'
    ]);
  });

  it('indices følger category.index, ikke posisjonen i lista', () => {
    const combos = app.buildDimensionCombinations(['Tid'], data);
    assert.deepEqual(combos.map(c => c.indices), [[0], [1]]);
  });

  it('tom dimensjonsliste gir én tom kombinasjon', () => {
    // Tabeller uten radoverskrifter må fortsatt gi nøyaktig én rad.
    assert.deepEqual(app.buildDimensionCombinations([], data), [{ codes: [], indices: [] }]);
  });

  it('ukjent dimensjon hoppes over i stedet for å krasje', () => {
    const combos = app.buildDimensionCombinations(['Finnesikke', 'Tid'], data);
    assert.deepEqual(combos.map(c => c.codes), [['2022'], ['2023']]);
  });
});

describe('suppressedLabel', () => {
  it('oversetter SSBs statuskoder', () => {
    assert.equal(app.suppressedLabel('.'), app.t('table.notApplicable'));
    assert.equal(app.suppressedLabel('..'), app.t('table.notAvailable'));
    assert.equal(app.suppressedLabel(':'), app.t('table.confidential'));
  });

  it('ukjent kode vises som den er', () => {
    assert.equal(app.suppressedLabel('x'), 'x');
  });
});
