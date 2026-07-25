/**
 * fhi-adapter.js — berikelse av tabellmetadata fra FHIs /Table/{id}/metadata,
 * /Table/{id}/flag og /Common/source.
 *
 * Egen testfil (ikke slått sammen med fhi-adapter-paths/-categories): adapteren
 * memoiserer katalogfil-promiset i minnet (getCatalog/_catalogPromise), så en
 * test som trenger en FUNGERENDE katalogfil kan ikke dele prosess med tester
 * som kjører uten katalog.
 *
 * Avsnittsstrukturen i fixturene er hentet fra ekte svar (daar/268, nokkel/670,
 * ngs/914): beskrivende avsnitt først, så en tom {header:'',content:''}-
 * separator, så ett avsnitt PER DIMENSJON som ramser opp alle verdiene i
 * klartekst. De siste er redundante (variabelvelgeren viser det samme) og kan
 * være enorme — de skal filtreres bort.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const CATALOG = {
  generatedAt: '2026-07-18T00:00:00Z',
  sources: {
    daar: {
      title: 'Dødsårsaksregisteret (DÅR)',
      tables: [
        {
          tableId: 268,
          title: 'Dødsfall etter dødssted og bostedsfylke',
          description: 'Dødsfall etter dødssted og bostedsfylke. Antall døde per år.',
          firstPeriod: '1986', lastPeriod: '2025*', timeUnit: 'Annual',
          variableNames: [], updated: '2026-04-22T11:08:52Z'
        },
        { tableId: 999, title: 'Uten beskrivelse', description: '',
          firstPeriod: '', lastPeriod: '', timeUnit: null, variableNames: [], updated: '' }
      ]
    }
  }
};

const TABLE_ROWS = [
  { tableId: 268, title: 'D3a_flagg', publishedAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-04-22T11:08:52Z' },
  { tableId: 999, title: 'X_annet', publishedAt: '2026-01-01T00:00:00Z', modifiedAt: '' }
];

const DIMENSIONS = {
  dimensions: [
    {
      code: 'aar', label: 'Dødsår',
      categories: [
        { value: '1986', label: '1986' },
        { value: '2024', label: '2024' },
        { value: '2025', label: '2025*' }
      ]
    },
    {
      code: 'bofylke', label: 'Bofylke',
      categories: [
        { value: '0', label: 'Hele landet' },
        { value: '3', label: 'Oslo' }
      ]
    },
    {
      code: 'MEASURE_TYPE', label: 'Måltall',
      categories: [{ value: 'antall', label: 'Antall' }]
    }
  ]
};

const METADATA = {
  name: 'D3a_flagg',
  isOfficialStatistics: true,
  paragraphs: [
    { header: 'Om statistikken',
      content: '<p><strong>Sammendrag</strong></p><p>Dødsfall etter dødssted og bostedsfylke.</p>' },
    { header: 'Definisjoner',
      content: '<p><strong>Kategorier for dødssted</strong></p><ul><li>Sykehus: somatisk og psykiatrisk</li><li>Annen helseinstitusjon</li></ul>' },
    { header: 'Administrative opplysninger',
      content: '<p>Se <a href="https://www.fhi.no/op/dodsarsaksregisteret/">registeret</a> for mer.</p>' },
    { header: 'Relatert materiale', content: '' },
    { header: '', content: '' },
    // Redundante dimensjonslister — skal filtreres bort:
    { header: 'Dødsår', content: '1986, 1987, … og 2025*' },
    { header: 'Bofylke', content: 'Hele landet, Oslo, …' },
    { header: 'Måltall', content: 'Antall' }
  ]
};

const FLAGS = [
  { value: 0, symbol: '', description: 'Verdi finnes i tabellen' },
  { value: 1, symbol: '..', description: 'Manglende data' },
  { value: 3, symbol: ':', description: 'Anonymisert eller skjult av andre årsaker' }
];

const COMMON_SOURCE = [
  {
    id: 'daar',
    title: 'Dødsårsaksregisteret (DÅR)',
    aboutUrl: 'https://www.fhi.no/op/dodsarsaksregisteret/',
    publishedBy: 'Folkehelseinstituttet'
  }
];

/** Slås av i enkelttester for å teste at metadata fortsatt lastes uten dem. */
const failing = { metadata: false, flag: false };

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('fhi-catalog.json')) return jsonResponse(CATALOG);
    if (u.endsWith('/Common/source')) return jsonResponse(COMMON_SOURCE);
    if (/\/Table\/\d+\/dimension$/.test(u)) return jsonResponse(DIMENSIONS);
    if (/\/Table\/\d+\/query$/.test(u)) return jsonResponse({ dimensions: [] });
    if (/\/Table\/\d+\/metadata$/.test(u)) {
      if (failing.metadata) {
        return { ok: false, status: 404, json: async () => ({ detail: 'Table not found' }) };
      }
      return jsonResponse(METADATA);
    }
    if (/\/Table\/\d+\/flag$/.test(u)) {
      if (failing.flag) throw new Error('nettverksfeil');
      return jsonResponse(FLAGS);
    }
    if (/\/[^/]+\/table$/.test(u)) return jsonResponse(TABLE_ROWS);
    throw new Error('uventet URL i test: ' + u);
  }
});

app.AppConfig.sources.fhi.sourceIds = ['daar'];

const adapter = app.SourceAdapters.find(a => a.sourceId === 'fhi');

/** Alltid uten cache — hver test skal treffe fixture-fetchen på nytt. */
const meta = (id, lang) => adapter.getTableMetadata(id, false, lang || 'no');

describe('FHIAdapter — metadataberikelse', () => {
  it('setter offisiell-statistikk-flagget der API-et sier true', async () => {
    const m = await meta('fhi-daar-268');
    assert.equal(m.extension.px['official-statistics'], true);
  });

  it('tar med de beskrivende avsnittene i API-ets rekkefølge', async () => {
    const m = await meta('fhi-daar-268');
    assert.deepEqual(
      m.extension.sections.map(s => s.header),
      ['Om statistikken', 'Definisjoner', 'Administrative opplysninger']
    );
  });

  it('filtrerer bort avsnitt som bare ramser opp en dimensjons verdier', async () => {
    const m = await meta('fhi-daar-268');
    const headers = m.extension.sections.map(s => s.header);
    ['Dødsår', 'Bofylke', 'Måltall'].forEach(dimLabel => {
      assert.ok(!headers.includes(dimLabel),
        'dimensjonsavsnittet «' + dimLabel + '» skal ikke vises');
    });
  });

  it('filtrerer bort tomme avsnitt og separatoren', async () => {
    const m = await meta('fhi-daar-268');
    const headers = m.extension.sections.map(s => s.header);
    assert.ok(!headers.includes('Relatert materiale'), 'tomt innhold → droppes');
    assert.ok(!headers.includes(''), 'separatoren → droppes');
  });

  it('konverterer avsnittsinnhold til rene linjer med kulepunkt og markdown-lenker', async () => {
    const m = await meta('fhi-daar-268');
    const byHeader = Object.fromEntries(m.extension.sections.map(s => [s.header, s.lines]));

    assert.deepEqual(byHeader['Om statistikken'],
      ['Sammendrag', 'Dødsfall etter dødssted og bostedsfylke.']);
    assert.deepEqual(byHeader['Definisjoner'], [
      'Kategorier for dødssted',
      '• Sykehus: somatisk og psykiatrisk',
      '• Annen helseinstitusjon'
    ]);
    assert.deepEqual(byHeader['Administrative opplysninger'],
      ['Se [registeret](https://www.fhi.no/op/dodsarsaksregisteret/) for mer.']);
  });

  it('tar med tegnforklaringen, men ikke raden uten symbol', async () => {
    const m = await meta('fhi-daar-268');
    assert.deepEqual(m.extension.flags, [
      { symbol: '..', description: 'Manglende data' },
      { symbol: ':', description: 'Anonymisert eller skjult av andre årsaker' }
    ]);
  });

  it('henter aboutUrl og publishedBy fra /Common/source', async () => {
    const m = await meta('fhi-daar-268');
    assert.equal(m.extension.aboutUrl, 'https://www.fhi.no/op/dodsarsaksregisteret/');
    assert.equal(m.extension.publishedBy, 'Folkehelseinstituttet');
  });

  it('utleder første/siste periode fra tidsdimensjonen', async () => {
    const m = await meta('fhi-daar-268');
    assert.deepEqual(m.extension.periods, { first: '1986', last: '2025*' });
  });

  it('beholder katalogbeskrivelsen som note, og legger EN-noten i tillegg', async () => {
    const nb = await meta('fhi-daar-268', 'no');
    assert.deepEqual(nb.note, ['Dødsfall etter dødssted og bostedsfylke. Antall døde per år.']);

    const en = await meta('fhi-daar-268', 'en');
    assert.equal(en.note.length, 2);
    assert.equal(en.note[0], 'Dødsfall etter dødssted og bostedsfylke. Antall døde per år.');
    assert.match(en.note[1], /only available in Norwegian/);
  });

  it('blander ikke avsnittene inn i note[]', async () => {
    const m = await meta('fhi-daar-268');
    assert.ok(!m.note.some(n => /Kategorier for dødssted/.test(n)));
  });

  it('lar tabellen åpne selv om /metadata og /flag feiler', async () => {
    failing.metadata = true;
    failing.flag = true;
    try {
      const m = await meta('fhi-daar-268');
      // Kjernen fra /dimension er intakt …
      assert.deepEqual(m.id, ['aar', 'bofylke', 'MEASURE_TYPE']);
      assert.deepEqual(m.size, [3, 2, 1]);
      assert.equal(m.label, 'Dødsfall etter dødssted og bostedsfylke');
      assert.deepEqual(m.role.time, ['aar']);
      // … og periodene, som kommer fra /dimension, finnes fortsatt.
      assert.deepEqual(m.extension.periods, { first: '1986', last: '2025*' });
      // … mens berikelsen fra de feilende kallene mangler stille.
      assert.ok(!m.extension.sections);
      assert.ok(!m.extension.flags);
      assert.ok(!m.extension.px['official-statistics']);
      // aboutUrl kommer fra /Common/source og er upåvirket.
      assert.equal(m.extension.aboutUrl, 'https://www.fhi.no/op/dodsarsaksregisteret/');
    } finally {
      failing.metadata = false;
      failing.flag = false;
    }
  });

  it('beholder heading/stub-oppsettet fra før', async () => {
    const m = await meta('fhi-daar-268');
    assert.deepEqual(m.extension.px.heading, ['bofylke', 'MEASURE_TYPE']);
    assert.deepEqual(m.extension.px.stub, ['aar']);
  });

  it('katalogtittel/-kilde er uendret av berikelsen', async () => {
    const m = await meta('fhi-daar-268');
    assert.equal(m.source, 'FHI/Dødsårsaksregisteret (DÅR)');
    assert.equal(m.updated, '2026-04-22T11:08:52Z');
  });
});
