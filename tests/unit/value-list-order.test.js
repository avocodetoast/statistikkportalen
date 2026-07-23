/**
 * variable-select-render.js — verdilistas rekkefølge og filtrering
 * (orderedValueCodes/renderValueList er rene strengbyggere; de rører ikke DOM-en
 * ved kall, så de laster trygt i harnessen).
 *
 * Rekkefølgen MÅ leses fra `category.index`, ikke fra `Object.keys(label)`:
 * JavaScript sorterer heltallslignende objektnøkler numerisk stigende uansett
 * innsettingsrekkefølge, så en dimensjon med tallkoder (Norges Banks
 * «Prognoseår») ville ignorert både kildens og dimSort-ens rekkefølge.
 *
 * Filtreringen søker i HELE verdilista (ikke bare de første
 * AppConfig.ui.maxDisplayValues), og beholder alltid kodene i keepCodes —
 * kortets utvalg skal aldri forsvinne fordi brukeren skriver i filterfeltet.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/variable-select-state.js',
  'js/variable-select-render.js'
]);

/** Dimensjon med index i ØNSKET rekkefølge (label-objektet får samme rekkefølge). */
function dim(codesInOrder, labels) {
  const index = {};
  const label = {};
  codesInOrder.forEach((c, i) => {
    index[c] = i;
    label[c] = (labels && labels[c]) || c;
  });
  return { label: 'Testdim', category: { index, label } };
}

function renderedCodes(html) {
  return Array.from(html.matchAll(/data-code="([^"]+)"/g)).map(m => m[1]);
}

describe('orderedValueCodes', () => {
  it('følger category.index for talllignende koder (synkende prognoseår)', () => {
    const d = dim(['2026', '2025', '2024', '2014']);
    assert.deepEqual(app.orderedValueCodes('FORECAST_YEAR', d, false),
      ['2026', '2025', '2024', '2014']);
  });

  it('følger category.index for vanlige koder', () => {
    const d = dim(['tab1_linje01', 'tab1_linje08', 'tab2_linje01']);
    assert.deepEqual(app.orderedValueCodes('DETAILS', d, false),
      ['tab1_linje01', 'tab1_linje08', 'tab2_linje01']);
  });

  it('snur tidsdimensjoner (nyeste først)', () => {
    const d = dim(['2023', '2024', '2025']);
    assert.deepEqual(app.orderedValueCodes('Tid', d, true), ['2025', '2024', '2023']);
  });
});

describe('renderValueList — filtrering over hele lista', () => {
  it('finner treff langt utenfor visningstaket', () => {
    const codes = [];
    for (let i = 0; i < 1200; i++) codes.push('kode' + String(i).padStart(4, '0'));
    const d = dim(codes);

    const all = renderedCodes(app.renderValueList('D', d, false));
    assert.equal(all.length, app.AppConfig.ui.maxDisplayValues);
    assert.ok(!all.includes('kode1100'), 'verdien skal være avkortet bort uten filter');

    const hit = renderedCodes(app.renderValueList('D', d, false, 'kode1100'));
    assert.deepEqual(hit, ['kode1100']);
  });

  it('matcher både kode og etikett, uavhengig av store/små bokstaver', () => {
    const d = dim(['a1', 'b2'], { a1: 'Statens konti', b2: 'Folioinnskudd' });
    assert.deepEqual(renderedCodes(app.renderValueList('D', d, false, 'statens')), ['a1']);
    assert.deepEqual(renderedCodes(app.renderValueList('D', d, false, 'B2')), ['b2']);
  });

  it('beholder valgte koder (keepCodes) selv uten treff', () => {
    const d = dim(['a1', 'b2', 'c3'], { a1: 'Statens konti', b2: 'Folioinnskudd', c3: 'D-lån' });
    const html = app.renderValueList('D', d, false, 'folio', new Set(['c3']));
    assert.deepEqual(renderedCodes(html), ['b2', 'c3']);
  });
});
