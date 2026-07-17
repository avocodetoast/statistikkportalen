/**
 * synonyms.js — Norwegian search synonym groups.
 * Migrated from the legacy test.html suite.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/synonyms.js']);
const { SearchSynonyms } = app;

describe('SearchSynonyms — Norwegian', () => {
  it('is an array with at least 10 groups', () => {
    assert.ok(Array.isArray(SearchSynonyms));
    assert.ok(SearchSynonyms.length >= 10, `only ${SearchSynonyms.length} groups`);
  });

  it('has a BNP group including bruttonasjonalprodukt', () => {
    const group = SearchSynonyms.find(g => g.includes('bnp'));
    assert.ok(group, 'no group contains "bnp"');
    assert.ok(group.includes('bruttonasjonalprodukt'));
  });

  it('has a KPI group including konsumprisindeks', () => {
    const group = SearchSynonyms.find(g => g.includes('kpi'));
    assert.ok(group, 'no group contains "kpi"');
    assert.ok(group.includes('konsumprisindeks'));
  });

  it('every group has at least two lowercase terms', () => {
    for (const group of SearchSynonyms) {
      assert.ok(Array.isArray(group) && group.length >= 2,
        `group too small: ${JSON.stringify(group)}`);
      for (const term of group) {
        assert.equal(term, term.toLowerCase(), `term not lowercase: ${term}`);
      }
    }
  });
});
