/**
 * app-terms.js — lisenslinjene i «Kilder og vilkår»-dialogen.
 *
 * Selve dialogen er DOM-kode (js/dialog.js) og dekkes av E2E; det som testes
 * her er den rene delen: hvordan én kildes branding blir til en linje, og at
 * en kilde uten lisensfelt ikke får en tom lisensetikett.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/utils.js', 'js/app-terms.js']);
const { termsSourceLineHTML, listSourceBrandings, AppConfig } = app;

describe('termsSourceLineHTML', () => {
  it('lenker navnet til kildens hjemmeside og lisensnavnet til lisensen', () => {
    const html = termsSourceLineHTML({
      nameFull: 'Statistisk sentralbyrå',
      url: 'https://www.ssb.no/',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://www.ssb.no/diverse/lisens'
    });

    assert.match(html, /<a href="https:\/\/www\.ssb\.no\/"[^>]*>Statistisk sentralbyrå<\/a>/);
    assert.match(html, /<a href="https:\/\/www\.ssb\.no\/diverse\/lisens"[^>]*>CC BY 4\.0<\/a>/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  it('viser lisensnavnet som ren tekst når kilden mangler lisenslenke', () => {
    const html = termsSourceLineHTML({
      nameFull: 'Kilde', url: 'https://example.org/', licenseName: 'NLOD'
    });
    assert.match(html, /— NLOD/);
    assert.doesNotMatch(html, /<a href="[^"]*">NLOD<\/a>/);
  });

  it('utelater lisensetiketten helt for en kilde uten lisensfelt', () => {
    const html = termsSourceLineHTML({ nameFull: 'Kilde', url: 'https://example.org/' });
    assert.doesNotMatch(html, /—/);
  });

  it('faller tilbake til name, så url, når nameFull mangler', () => {
    assert.match(termsSourceLineHTML({ name: 'FHI', url: 'https://x/' }), />FHI</);
    assert.match(termsSourceLineHTML({ url: 'https://only-url/' }), />https:\/\/only-url\/</);
  });

  it('rendrer navnet uten lenke når kilden mangler url', () => {
    const html = termsSourceLineHTML({ nameFull: 'Uten hjemmeside' });
    assert.equal(html, 'Uten hjemmeside');
  });

  it('escaper branding-verdier så en config-verdi ikke kan injisere markup', () => {
    const html = termsSourceLineHTML({
      nameFull: '<img src=x>', url: 'https://x/"onmouseover="alert(1)', licenseName: '<b>'
    });
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /&lt;img/);
    // url havner i et attributt — anførselstegnet må være escapet
    assert.doesNotMatch(html, /href="https:\/\/x\/"onmouseover/);
  });
});

describe('Kildelisten i dialogen', () => {
  it('bygges fra AppConfig, med lisens for hver av de fire kildene', () => {
    const lines = listSourceBrandings().map(termsSourceLineHTML);
    assert.equal(lines.length, 4);
    assert.match(lines.join('\n'), /Statistisk sentralbyrå/);
    assert.match(lines.join('\n'), /Norges Bank/);
    assert.match(lines.join('\n'), /Folkehelseinstituttet/);
    assert.match(lines.join('\n'), /Database for statistikk om høgare utdanning/);
  });

  it('oppgir NLOD for Norges Bank (jf. AppConfig.sources.nb.branding)', () => {
    const nb = AppConfig.sources.nb.branding;
    assert.equal(nb.licenseName, 'NLOD');
    assert.match(termsSourceLineHTML(nb), /<a href="https:\/\/data\.norge\.no\/nlod"[^>]*>NLOD<\/a>/);
  });
});
