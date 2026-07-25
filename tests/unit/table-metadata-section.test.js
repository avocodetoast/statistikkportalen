/**
 * table-metadata.js — buildMetadataSection: bygger «Tabellinfo»-blokken.
 * Ren strengbygging (escapeHtml + t() + AppState), ingen DOM.
 *
 * Hovedpoenget her er at seksjonen er KILDEAGNOSTISK: kilder som leverer
 * extension.sections/flags/aboutUrl/publishedBy får ekstra rader, mens SSB/NB
 * er upåvirket. Kildenes egne avsnittstitler kolliderer i praksis med våre
 * faste etiketter (FHI har både «Kilde» og «Om statistikken» som avsnitt), og
 * kolliderende rader skal SLÅS SAMMEN, ikke dupliseres.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.browse,
  'js/browser-state.js',
  'js/table-metadata.js'
]);

const { buildMetadataSection } = app;

// AppState/BrowserState er top-level `const` i app-filene og ligger dermed i
// det leksikalske skopet, ikke på globalThis — de kan ikke settes herfra.
// Standardtilstanden (ingen valgt tabell) er nettopp det vi vil ha: SSBs
// kortnavn-baserte «Om statistikken»-lenke slår ikke inn, så testene under
// treffer adapter-grenen (extension.aboutUrl).

/** Alle <dt>-etikettene i rekkefølge. */
const labels = (html) =>
  [...html.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map(m => m[1].trim());

/** Innholdet i <dd> som følger etikettene med gitt navn. */
const contentFor = (html, label) => {
  const re = new RegExp('<dt>' + label + '</dt><dd>([\\s\\S]*?)</dd>');
  const m = html.match(re);
  return m ? m[1] : null;
};

const base = {
  source: 'FHI/Dødsårsaksregisteret (DÅR)',
  updated: '2026-04-22T11:08:52Z'
};

describe('buildMetadataSection — kildeleverte felter', () => {
  it('viser avsnitt fra extension.sections med kildens egne overskrifter', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      extension: {
        sections: [
          { header: 'Definisjoner', lines: ['Kategorier', '• Sykehus'] },
          { header: 'Oppdateringsfrekvens', lines: ['Årlig'] }
        ]
      }
    }));
    assert.ok(labels(html).includes('Definisjoner'));
    assert.ok(labels(html).includes('Oppdateringsfrekvens'));
    assert.match(contentFor(html, 'Definisjoner'), /<p>Kategorier<\/p><p>• Sykehus<\/p>/);
  });

  it('slår sammen et avsnitt som kolliderer med en fast etikett («Kilde»)', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      extension: { sections: [{ header: 'Kilde', lines: ['National Influenza Center'] }] }
    }));
    const kildeRader = labels(html).filter(l => l === 'Kilde');
    assert.equal(kildeRader.length, 1, 'kun én Kilde-rad');
    const dd = contentFor(html, 'Kilde');
    assert.match(dd, /Dødsårsaksregisteret/);
    assert.match(dd, /National Influenza Center/);
  });

  it('slår «Om statistikken»-avsnittet sammen med aboutUrl-lenka', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      extension: {
        aboutUrl: 'https://www.fhi.no/op/dodsarsaksregisteret/',
        sections: [{ header: 'Om statistikken', lines: ['Sammendrag', 'Dødsfall etter dødssted.'] }]
      }
    }));
    assert.equal(labels(html).filter(l => l === 'Om statistikken').length, 1);
    const dd = contentFor(html, 'Om statistikken');
    assert.match(dd, /href="https:\/\/www\.fhi\.no\/op\/dodsarsaksregisteret\/"/);
    assert.match(dd, /Dødsfall etter dødssted\./);
  });

  it('dropper en note som allerede står ordrett i et avsnitt', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      note: ['Dødsfall etter dødssted og bostedsfylke.'],
      extension: {
        sections: [{ header: 'Om statistikken', lines: ['Dødsfall etter dødssted og bostedsfylke.'] }]
      }
    }));
    assert.ok(!labels(html).includes('Merknader'), 'ingen duplisert Merknader-rad');
    assert.equal(
      (html.match(/Dødsfall etter dødssted og bostedsfylke\./g) || []).length, 1
    );
  });

  it('beholder noter som IKKE finnes i avsnittene (f.eks. EN-språknoten)', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      note: ['Beskrivelse fra katalogen.', 'FHI data is only available in Norwegian.'],
      extension: {
        sections: [{ header: 'Beskrivelse', lines: ['Beskrivelse fra katalogen.'] }]
      }
    }));
    const dd = contentFor(html, 'Merknader');
    assert.ok(dd, 'Merknader-raden finnes fortsatt');
    assert.match(dd, /only available in Norwegian/);
    assert.ok(!/Beskrivelse fra katalogen\.<\/p>/.test(dd), 'den dupliserte noten er borte');
  });

  it('viser tegnforklaring fra extension.flags', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      extension: { flags: [{ symbol: '..', description: 'Manglende data' }] }
    }));
    assert.match(contentFor(html, 'Tegnforklaring'), /<code>\.\.<\/code> Manglende data/);
  });

  it('viser «Publisert av» kun når utgiver avviker fra kildenavnet', () => {
    const avvik = buildMetadataSection(Object.assign({}, base, {
      source: 'FHI/Folkehelsestatistikk',
      extension: { publishedBy: 'Helsedirektoratet' }
    }));
    assert.equal(contentFor(avvik, 'Publisert av'), 'Helsedirektoratet');

    const likt = buildMetadataSection(Object.assign({}, base, {
      source: 'FHI/Folkehelseinstituttet',
      extension: { publishedBy: 'Folkehelseinstituttet' }
    }));
    assert.ok(!labels(likt).includes('Publisert av'));
  });

  it('escaper kildeleverte overskrifter og innhold', () => {
    const html = buildMetadataSection(Object.assign({}, base, {
      extension: {
        sections: [{ header: '<img src=x onerror=alert(1)>', lines: ['<script>alert(2)</script>'] }],
        flags: [{ symbol: '<b>', description: '<i>x</i>' }]
      }
    }));
    assert.ok(!html.includes('<img src=x'), 'overskrift er escapet');
    assert.ok(!html.includes('<script>alert(2)'), 'innhold er escapet');
    assert.ok(html.includes('&lt;img src=x'));
    assert.ok(html.includes('&lt;b&gt;'));
  });
});

describe('buildMetadataSection — kilder uten de nye feltene', () => {
  it('rendrer SSB-metadata som før (ingen tomme rader)', () => {
    const html = buildMetadataSection({
      source: 'Statistisk sentralbyrå',
      updated: '2026-07-21T06:00:00Z',
      note: ['En merknad.'],
      extension: {
        px: { 'official-statistics': true },
        contact: [{ name: 'Arbeidsmarked', phone: '62 88 50 00', mail: 'am@ssb.no' }]
      }
    });
    assert.deepEqual(labels(html), ['Kilde', 'Sist oppdatert', 'Status', 'Merknader', 'Kontakt']);
    assert.match(contentFor(html, 'Kontakt'), /tlf: 62 88 50 00/);
    assert.match(contentFor(html, 'Kontakt'), /mailto:am@ssb\.no/);
  });

  it('takler metadata helt uten extension', () => {
    const html = buildMetadataSection({ source: 'Norges Bank', updated: '' });
    assert.deepEqual(labels(html), ['Kilde']);
  });

  it('returnerer tom streng uten metadata', () => {
    assert.equal(buildMetadataSection(null), '');
  });
});
