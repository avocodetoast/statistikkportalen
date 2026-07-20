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
    assert.equal(t('footer.and'), 'og');
  });

  // NB: the legacy test.html asserted saveQuery.* keys, but no such keys
  // exist in the dictionary — table-save-query.js hard-codes its Norwegian
  // strings (a known convention gap). Re-add assertions here when that
  // dialog is migrated to t().

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
});

describe('Translations — English', () => {
  it('has en strings for nav and subject labels', (t_) => {
    setLanguage('en');
    t_.after(() => setLanguage('nb'));

    assert.equal(t('nav.home'), 'Home');
    for (const key of ['subject.group.arbeid', 'subject.name.al']) {
      assert.ok(keyExists(key), `missing en key: ${key}`);
    }
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
