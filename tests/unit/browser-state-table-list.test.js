/**
 * browser-state.js — renderTableListHTML, the single table-list renderer shared
 * by the search view, the topic view and the front page's "recently updated"
 * section. Pure string building (escapeHtml + AppConfig only), no DOM.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.browse,
  'js/browser-state.js'
]);

const { BrowserState, displayTableId, AppConfig } = app;

const table = (over) => Object.assign({
  id: '07459',
  label: 'Befolkning',
  firstPeriod: '2010',
  lastPeriod: '2025',
  updated: '2025-01-15T08:00:00Z'
}, over);

describe('displayTableId', () => {
  it('strips the nb-/fhi- source prefix', () => {
    assert.equal(displayTableId('nb-EXR'), 'EXR');
    assert.equal(displayTableId('fhi-mfr-1234'), 'mfr-1234');
  });

  it('leaves SSB ids untouched', () => {
    assert.equal(displayTableId('07459'), '07459');
  });

  it('degrades to an empty string for a missing id', () => {
    assert.equal(displayTableId(null), '');
    assert.equal(displayTableId(undefined), '');
  });
});

describe('BrowserState.renderTableListHTML', () => {
  it('labels the id column "Tabell" — foreign-source ids are not numbers', () => {
    const html = BrowserState.renderTableListHTML([table()]);
    assert.match(html, /<th>Tabell<\/th>/);
    assert.doesNotMatch(html, /Tabellnr/);
  });

  it('adds no source badge for SSB tables', () => {
    const html = BrowserState.renderTableListHTML([table()]);
    assert.doesNotMatch(html, /source-badge/);
  });

  it('badges Norges Bank and FHI tables after the title link', () => {
    const html = BrowserState.renderTableListHTML([
      table({ id: 'nb-EXR', label: 'Valutakurser' }),
      table({ id: 'fhi-mfr-1', label: 'Fødte' })
    ]);
    assert.match(html, /source-badge--nb/);
    assert.match(html, /source-badge--fhi/);
    // Badge sits after the link, inside the title cell
    assert.ok(html.indexOf('Valutakurser</a>') < html.indexOf('source-badge--nb'));
  });

  it('shows foreign ids without their source prefix (the badge carries that now)', () => {
    const html = BrowserState.renderTableListHTML([
      table({ id: 'fhi-mfr-1234', label: 'Fødte' })
    ]);
    assert.match(html, />mfr-1234</);
    assert.doesNotMatch(html, />fhi-mfr-1234</);
    // The full id stays reachable: row dataset for navigation, title for hover
    assert.match(html, /data-table-id="fhi-mfr-1234"/);
    assert.match(html, /title="fhi-mfr-1234"/);
  });

  it('keeps the discontinued badge alongside the source badge', () => {
    const html = BrowserState.renderTableListHTML([
      table({ id: 'nb-GOVT_IRS', label: 'Rentebytteavtaler', discontinued: true })
    ]);
    assert.match(html, /source-badge--nb/);
    assert.match(html, /discontinued-badge/);
  });
});

/**
 * cleanTableLabel rydder tittelhalene som allerede har en egen kolonne i lista:
 * tidsperioden (SSB) og frekvensmerket (FHI). Begge styres av samme flagg,
 * AppConfig.ui.hidePeriodInTableTitles.
 *
 * Titlene under er ekte, hentet fra data/sources/fhi-catalog.json.
 */
describe('BrowserState.cleanTableLabel', () => {
  const clean = (label, first, last) => BrowserState.cleanTableLabel(label, first, last);

  it('fjerner «12345: »-prefikset', () => {
    assert.equal(clean('07459: Befolkning', '2010', '2025'), 'Befolkning');
  });

  it('fjerner periodehalen når den matcher kolonnen (ingen regresjon)', () => {
    assert.equal(clean('Konsumprisindeks 2010-2025', '2010', '2025'), 'Konsumprisindeks');
    assert.equal(clean('Folkemengde (2025)', '2025', '2025'), 'Folkemengde');
  });

  it('lar en tallhale som IKKE er tabellens periode stå', () => {
    assert.equal(clean('Konsumprisindeks 1998-2005', '2010', '2025'),
      'Konsumprisindeks 1998-2005');
  });

  it('fjerner frekvensmerket i parentes', () => {
    assert.equal(clean('Influensavaksinasjon, sesongen 2024/2025 (ukestall)', '2024U17', '2025U22'),
      'Influensavaksinasjon, sesongen 2024/2025');
    assert.equal(clean('Influensa: antall og andel positive (ukestall)', '2024U40', '2026U29'),
      'Influensa: antall og andel positive');
    assert.equal(clean('Koronavaksinasjon blant personer 75 år og eldre (årlige tall)', '2024/2025', '2024/2025'),
      'Koronavaksinasjon blant personer 75 år og eldre');
  });

  it('fjerner «, ettårige tall»', () => {
    assert.equal(clean('Nye krefttilfeller, ettårige tall', '1990', '2024'),
      'Nye krefttilfeller');
    assert.equal(clean('Mottakere av uføretrygd, etter utdanning, ettårige tall', '2011', '2024'),
      'Mottakere av uføretrygd, etter utdanning');
  });

  it('BEHOLDER de flerårige halene — de er aggregeringsvindu, ikke oppdateringstakt, og skiller ellers like titler', () => {
    assert.equal(clean('Nye krefttilfeller, tiårige tall', '1990-1999', '2015-2024'),
      'Nye krefttilfeller, tiårige tall');
    assert.equal(clean('Mobbing, 7. og 10. trinn, treårige tall', '2016/17-2018/19', '2022/23-2024/25'),
      'Mobbing, 7. og 10. trinn, treårige tall');
    assert.equal(clean('Forventet levealder, etter utdanning, femtenårige tall', '1990-2004', '2010-2024'),
      'Forventet levealder, etter utdanning, femtenårige tall');
    assert.equal(clean('Overvekt blant 17-åringer (sesjon 1), fireårige tall', '2011-2014', '2022-2025'),
      'Overvekt blant 17-åringer (sesjon 1), fireårige tall');
  });

  it('rører ikke parenteser som ikke er frekvens', () => {
    assert.equal(clean('Dødsfall etter dødsårsak (antall)', '1986', '2025'),
      'Dødsfall etter dødsårsak (antall)');
    assert.equal(clean('17-åringer som kan svømme 200 meter (sesjon 1)', '2018', '2025'),
      '17-åringer som kan svømme 200 meter (sesjon 1)');
    assert.equal(clean('Covid-19 (SARS-CoV-2): antall og andel positive', '2024U40', '2026U29'),
      'Covid-19 (SARS-CoV-2): antall og andel positive');
    assert.equal(clean('Pasienter innlagt i somatiske sykehus (NPR)', '2012', '2024'),
      'Pasienter innlagt i somatiske sykehus (NPR)');
  });

  it('tar begge haler når de står etter hverandre', () => {
    assert.equal(clean('Dødsfall 1986-2025 (årlige tall)', '1986', '2025'), 'Dødsfall');
  });

  it('lar alt stå når flagget er av', () => {
    const saved = AppConfig.ui.hidePeriodInTableTitles;
    AppConfig.ui.hidePeriodInTableTitles = false;
    try {
      assert.equal(clean('Influensa: antall og andel positive (ukestall)', '2024U40', '2026U29'),
        'Influensa: antall og andel positive (ukestall)');
      assert.equal(clean('Konsumprisindeks 2010-2025', '2010', '2025'), 'Konsumprisindeks 2010-2025');
    } finally {
      AppConfig.ui.hidePeriodInTableTitles = saved;
    }
  });
});
