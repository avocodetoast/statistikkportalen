/**
 * fhi-adapter.js — opprydding av RÅ API-titler (fallback-grenen).
 *
 * Normalt kommer visningstittelen fra den kuraterte katalogen
 * (data/sources/fhi-catalog.json). Klarer ikke appen å laste katalogen, faller
 * adapteren tilbake til FHIs egen /table-tittel — og Legemiddelregisteret
 * (lmr) legger både tidsperiode og oppdateringsdato inn i selve tittelen:
 *
 *   «Legemiddelgruppe – ADHD-midler. 2004-2025. [Oppdatert 16.02.2026] »
 *
 * Verifisert mot live-API-et: 7 av 7 lmr-tabeller gjør dette (og ingen av de
 * øvrige 363 tabellene i de 12 andre kildene). Periode og «sist oppdatert» har
 * egne kolonner i tabellistene, så halen ryddes bort her.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.sources);
const clean = app.SourceCommon.stripTitleMetadataTail;

describe('stripTitleMetadataTail — ekte lmr-titler', () => {
  it('fjerner periode + [Oppdatert] (bindestrek uten mellomrom)', () => {
    assert.equal(
      clean('Legemiddelgruppe – ADHD-midler. 2004-2025. [Oppdatert 16.02.2026] '),
      'Legemiddelgruppe – ADHD-midler'
    );
  });

  it('fjerner periode med mellomrom rundt bindestreken', () => {
    assert.equal(
      clean('Legemiddelgruppe - HjerteKar. 2004 - 2025. [Oppdatert 16.02.2026] '),
      'Legemiddelgruppe - HjerteKar'
    );
  });

  it('tåler FHIs egen skrivefeil med krøllparentes', () => {
    assert.equal(
      clean('Legemiddelgruppe - Vektreduserende. 2004 - 2025. [Oppdatert 16.02.2026} '),
      'Legemiddelgruppe - Vektreduserende'
    );
  });

  it('takler tankestrek i periodeintervallet', () => {
    assert.equal(clean('Per ATC-kode. 2004–2025. [Oppdatert 16.02.2026]'), 'Per ATC-kode');
  });

  it('rydder når bare én av delene finnes', () => {
    assert.equal(clean('Noe. 2004-2025.'), 'Noe');
    assert.equal(clean('Noe [Oppdatert 16.02.2026]'), 'Noe');
  });
});

describe('stripTitleMetadataTail — skal IKKE røre', () => {
  it('lar årstall som er en del av selve tittelen stå', () => {
    // Perioden er ikke en egen setning her — den navngir statistikken.
    assert.equal(
      clean('Grossistbasert legemiddelstatistikk 1999-2025'),
      'Grossistbasert legemiddelstatistikk 1999-2025'
    );
    assert.equal(
      clean('Framskrevet folkemengde 2026–2050'),
      'Framskrevet folkemengde 2026–2050'
    );
    assert.equal(
      clean('Influensavaksinasjon, sesongen 2024/2025 (ukestall)'),
      'Influensavaksinasjon, sesongen 2024/2025 (ukestall)'
    );
  });

  it('lar vanlige titler stå urørt', () => {
    assert.equal(clean('Dødsfall etter dødssted og bostedsfylke'),
      'Dødsfall etter dødssted og bostedsfylke');
    assert.equal(clean('D3a_flagg'), 'D3a_flagg');
  });

  it('takler tomt/manglende input', () => {
    assert.equal(clean(''), '');
    assert.equal(clean(null), '');
    assert.equal(clean(undefined), '');
  });

  it('etterlater aldri en tom tittel, uansett hvor degenerert input er', () => {
    // Titler som nesten bare ER en hale. Kravet er at noe identifiserende blir
    // igjen — blir alt strippet, faller vi tilbake til originalen.
    ['2004-2025. [Oppdatert 16.02.2026]', '[Oppdatert 16.02.2026]', '. 2004-2025.', '...']
      .forEach(input => {
        const out = clean(input);
        assert.ok(out.length > 0, 'tom tittel for input ' + JSON.stringify(input));
      });
  });
});
