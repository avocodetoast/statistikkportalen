/**
 * source-common.js — htmlToPlainLines()
 *
 * FHIs /Table/{id}/metadata returnerer avsnittsinnhold som HTML (<p>, <strong>,
 * <ul><li>, av og til <a>). table-metadata.js escaper alt før rendring (via
 * convertMarkdownLinks → escapeHtml), så rå HTML ville vist som synlige tagger.
 * Hjelperen konverterer derfor til rene tekstlinjer i adapterlaget, og lar
 * lenker passere som markdown slik at convertMarkdownLinks plukker dem opp.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.sources);
const htmlToPlainLines = app.SourceCommon.htmlToPlainLines;

describe('SourceCommon.htmlToPlainLines', () => {
  it('splitter på avsnitt', () => {
    assert.deepEqual(
      htmlToPlainLines('<p>Første avsnitt.</p><p>Andre avsnitt.</p>'),
      ['Første avsnitt.', 'Andre avsnitt.']
    );
  });

  it('splitter på <br> i alle skrivemåter', () => {
    assert.deepEqual(
      htmlToPlainLines('Linje 1<br>Linje 2<br/>Linje 3<BR />Linje 4'),
      ['Linje 1', 'Linje 2', 'Linje 3', 'Linje 4']
    );
  });

  it('gjør listepunkter til kulepunkter', () => {
    assert.deepEqual(
      htmlToPlainLines('<p>Kategorier:</p><ul><li>Sykehus</li><li>Sykehjem</li></ul>'),
      ['Kategorier:', '• Sykehus', '• Sykehjem']
    );
  });

  it('beholder <strong>-tekst som egen linje når den står som avsnittsetikett', () => {
    assert.deepEqual(
      htmlToPlainLines('<p><strong>Sammendrag</strong></p><p>Dødsfall etter dødssted.</p>'),
      ['Sammendrag', 'Dødsfall etter dødssted.']
    );
  });

  it('beholder <strong>-tekst inline når den står midt i en setning', () => {
    assert.deepEqual(
      htmlToPlainLines('<p>Tallene er <strong>foreløpige</strong> for 2025.</p>'),
      ['Tallene er foreløpige for 2025.']
    );
  });

  it('konverterer lenker til markdown', () => {
    assert.deepEqual(
      htmlToPlainLines('<p>Se <a href="https://www.fhi.no/op/mfr">MFR</a> for mer.</p>'),
      ['Se [MFR](https://www.fhi.no/op/mfr) for mer.']
    );
  });

  it('håndterer lenker med enkeltfnutter og ekstra attributter', () => {
    assert.deepEqual(
      htmlToPlainLines("<a target='_blank' href='https://fhi.no/x'>FHI</a>"),
      ['[FHI](https://fhi.no/x)']
    );
  });

  it('dekoder entiteter', () => {
    assert.deepEqual(
      htmlToPlainLines('<p>Tolkning&nbsp;&amp; feilkilder &lt;10 &quot;skjult&quot; &#39;x&#39; &#8211; ok</p>'),
      ['Tolkning & feilkilder <10 "skjult" \'x\' – ok']
    );
  });

  it('kollapser whitespace og fjerner tomme linjer', () => {
    assert.deepEqual(
      htmlToPlainLines('<p>  For   mye\n\n rom </p><p></p><p>   </p><p>Neste</p>'),
      ['For mye rom', 'Neste']
    );
  });

  it('takler ren tekst uten markup', () => {
    assert.deepEqual(htmlToPlainLines('Årlig'), ['Årlig']);
  });

  it('returnerer tom liste for tomt/manglende innhold', () => {
    assert.deepEqual(htmlToPlainLines(''), []);
    assert.deepEqual(htmlToPlainLines(null), []);
    assert.deepEqual(htmlToPlainLines(undefined), []);
    assert.deepEqual(htmlToPlainLines('<p></p>'), []);
  });
});
