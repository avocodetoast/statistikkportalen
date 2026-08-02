/**
 * translations.js — t()/tpl(), language switching, subject label registration.
 * Migrated from the legacy test.html suite.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// subjects.js registers subject.group.* / subject.name.* into the dictionary,
// so it must be loaded for those keys to resolve.
const app = loadApp([...SCRIPTS.core, 'js/subjects.js']);
const { t, setLanguage, getCurrentApiLang } = app;

/** A key "exists" when t() returns something other than the key itself. */
function keyExists(key) {
  return t(key) !== key;
}

describe('Translations — nb (default) language', () => {
  it('defaults to nb', () => {
    assert.equal(app.currentLanguage, 'nb');
  });

  it('returns Norwegian strings', () => {
    assert.equal(t('loading.app'), 'Laster...');
    assert.equal(t('nav.home'), 'Forsiden');
    // Kildenøytral overskrift — søket dekker SSB, Norges Bank og FHI,
    // så det SSB-spesifikke «statistikkbanken» skal ikke brukes her.
    assert.equal(t('search.heading'), 'Søk i statistikken');
  });

  // Footeren viser ikke lenger «Data fra X og Y» — den lenker til «Kilder og
  // vilkår»-dialogen (js/app-terms.js), som bygger kildelisten fra AppConfig.
  // footer.dataFrom/footer.and er derfor fjernet fra ordboken.
  it('has the sources-and-terms strings, and no leftover footer source line', () => {
    for (const key of [
      'terms.link', 'terms.title', 'terms.liabilityHeading', 'terms.liabilityBody',
      'terms.attributionHeading', 'terms.attributionBody', 'terms.sourcesHeading',
      'dialog.close'
    ]) {
      assert.ok(keyExists(key), `missing nb key: ${key}`);
    }
    assert.ok(!keyExists('footer.dataFrom'), 'footer.dataFrom skal være fjernet');
    assert.ok(!keyExists('footer.and'), 'footer.and skal være fjernet');
  });

  it('has save-query dialog labels (table-save-query.js)', () => {
    for (const key of [
      'saveQuery.noActiveQuery', 'saveQuery.dialogTitle', 'saveQuery.saving',
      'saveQuery.saved', 'saveQuery.openInPortal', 'saveQuery.openInSource',
      'saveQuery.copy', 'saveQuery.copied', 'saveQuery.openInSourceLink',
      'saveQuery.noIdInResponse', 'saveQuery.saveFailed'
    ]) {
      assert.ok(keyExists(key), `missing nb key: ${key}`);
    }
  });

  it('returns the key itself for unknown keys', () => {
    assert.equal(t('no.such.key'), 'no.such.key');
  });

  it('has SSB subject group labels (registered by subjects.js)', () => {
    for (const key of ['subject.group.arbeid', 'subject.group.okonomi', 'subject.group.befolkning']) {
      assert.ok(keyExists(key), `missing nb key: ${key}`);
    }
  });

  it('has SSB subject name labels', () => {
    for (const key of ['subject.name.al', 'subject.name.be', 'subject.name.nk', 'subject.name.ud']) {
      assert.ok(keyExists(key), `missing nb key: ${key}`);
    }
  });

  it('has the catalog index refresh/check strings (P7 — source-status.js)', () => {
    for (const key of [
      'apiStatus.indexTitle', 'apiStatus.indexBuiltAt', 'apiStatus.indexStale',
      'apiStatus.checkIndex', 'apiStatus.checkIndexTitle', 'apiStatus.indexUpToDate',
      'apiStatus.indexUpdated', 'apiStatus.indexUnavailable'
    ]) {
      assert.ok(keyExists(key), `missing nb key: ${key}`);
    }
    // refreshTitle skal nevne indeksen, ikke lenger bare mellomlageret — den
    // omfavner nå BÅDE cachen og den nedlastede indeksen (P7).
    assert.match(t('apiStatus.refreshTitle'), /indeks/i);
  });
});

describe('Translations — English', () => {
  it('has en strings for nav and subject labels', (t_) => {
    setLanguage('en');
    t_.after(() => setLanguage('nb'));

    assert.equal(t('nav.home'), 'Home');
    for (const key of [
      'subject.group.arbeid', 'subject.name.al',
      'saveQuery.dialogTitle', 'saveQuery.openInSource',
      'terms.link', 'terms.title', 'terms.liabilityHeading', 'terms.liabilityBody',
      'terms.attributionHeading', 'terms.attributionBody', 'terms.sourcesHeading',
      'dialog.close',
      'apiStatus.indexTitle', 'apiStatus.indexBuiltAt', 'apiStatus.indexStale',
      'apiStatus.checkIndex', 'apiStatus.checkIndexTitle', 'apiStatus.indexUpToDate',
      'apiStatus.indexUpdated', 'apiStatus.indexUnavailable'
    ]) {
      assert.ok(keyExists(key), `missing en key: ${key}`);
    }
    assert.match(t('apiStatus.refreshTitle'), /index/i);
  });

  it('ignores unknown language codes', () => {
    setLanguage('xx');
    assert.equal(app.currentLanguage, 'nb');
  });
});

describe('Translations — getCurrentApiLang', () => {
  it('maps nb to API lang "no"', () => {
    assert.equal(getCurrentApiLang(), 'no');
  });
});
