/**
 * search-enhanced.js — pure scoring/ranking logic ("Smart søk").
 * Behavioral tests against a small synthetic table list — the reference
 * example of how to unit-test pure logic modules in this repo.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/synonyms.js', 'js/search-enhanced.js']);
const { SearchEnhanced } = app;

/** Minimal synthetic catalogue in the shape BrowserState.allTables uses. */
const TABLES = [
  {
    id: '09189',
    label: 'Bruttonasjonalprodukt og andre hovedstørrelser',
    variableNames: ['makrostørrelse', 'statistikkvariabel', 'år'],
    paths: [[
      { id: 'nk', label: 'Nasjonalregnskap og konjunkturer' },
      { id: 'nk01', label: 'Nasjonalregnskap' },
      { id: 'nk0101', label: 'Årlig nasjonalregnskap' }
    ]]
  },
  {
    id: '03013',
    label: 'Konsumprisindeksen, etter konsumgruppe',
    variableNames: ['konsumgruppe', 'statistikkvariabel', 'måned'],
    paths: [[
      { id: 'pp', label: 'Priser og prisindekser' },
      { id: 'pp01', label: 'Konsumpriser' }
    ]]
  },
  {
    id: '13760',
    label: 'Årsverk i kommunene',
    variableNames: ['region', 'statistikkvariabel', 'år'],
    paths: [[
      { id: 'os', label: 'Offentlig sektor' },
      { id: 'os01', label: 'KOSTRA' },
      { id: 'os0101', label: 'Kommuneøkonomi' }
    ]]
  }
];

const INDEX = SearchEnhanced.buildIndex(TABLES);

describe('SearchEnhanced.normalizeText', () => {
  it('lowercases and strips Norwegian diacritics', () => {
    assert.equal(SearchEnhanced.normalizeText('Årbok'), 'arbok');
    assert.equal(SearchEnhanced.normalizeText('LØNN'), 'lonn');
    assert.equal(SearchEnhanced.normalizeText('næring'), 'naering');
  });

  it('handles empty/undefined input', () => {
    assert.equal(SearchEnhanced.normalizeText(''), '');
    assert.equal(SearchEnhanced.normalizeText(undefined), '');
  });
});

describe('SearchEnhanced.buildIndex', () => {
  it('creates one entry per table with normalized fields', () => {
    assert.equal(INDEX.length, TABLES.length);
    assert.equal(INDEX[0].normLabel, 'bruttonasjonalprodukt og andre hovedstorrelser');
    assert.equal(INDEX[0].normId, '09189');
  });

  it('indexes path segments from level 3+ only (path.slice(2))', () => {
    // First two segments (subject/subtopic) are excluded from path search
    assert.deepEqual(INDEX[0].normPathLabels, ['arlig nasjonalregnskap']);
    assert.deepEqual(INDEX[1].normPathLabels, []);
  });
});

describe('SearchEnhanced.filterAndRank', () => {
  const rank = (query) =>
    SearchEnhanced.filterAndRank(INDEX, { query }).map(t => t.id);

  it('returns all tables unchanged for an empty query', () => {
    assert.deepEqual(rank(''), ['09189', '03013', '13760']);
  });

  it('matches with diacritics normalized (årsverk ↔ arsverk)', () => {
    assert.deepEqual(rank('arsverk'), ['13760']);
    assert.deepEqual(rank('Årsverk'), ['13760']);
  });

  it('expands synonyms: kpi finds Konsumprisindeksen', () => {
    assert.deepEqual(rank('kpi'), ['03013']);
  });

  it('expands synonyms: bnp finds Bruttonasjonalprodukt', () => {
    assert.deepEqual(rank('bnp'), ['09189']);
  });

  it('requires every token to match somewhere (AND logic)', () => {
    assert.deepEqual(rank('årsverk kommunene'), ['13760']);
    assert.deepEqual(rank('årsverk finnesikke'), []);
  });

  it('ranks label matches above path-only matches', () => {
    // "nasjonalregnskap" hits table 09189 only via its path (level 3+),
    // while a label-prefix query must rank first when both match.
    const ids = rank('nasjonalregnskap');
    assert.ok(ids.includes('09189'));
  });
});

describe('SearchEnhanced.getServerQuery', () => {
  it('OR-expands single-token synonym queries', () => {
    const q = SearchEnhanced.getServerQuery('bnp');
    assert.ok(q.includes(' OR '));
    assert.ok(q.includes('bruttonasjonalprodukt'));
  });

  it('excludes short (<4 char) synonym variants from expansion', () => {
    const q = SearchEnhanced.getServerQuery('bruttonasjonalprodukt');
    assert.ok(!q.split(' OR ').some(v => v.trim().length < 4 && v.trim() !== ''));
  });

  it('leaves multi-token queries unchanged', () => {
    assert.equal(SearchEnhanced.getServerQuery('bnp per innbygger'), 'bnp per innbygger');
  });

  it('leaves non-synonym tokens unchanged', () => {
    assert.equal(SearchEnhanced.getServerQuery('reinsdyr'), 'reinsdyr');
  });
});

describe('SearchEnhanced.buildFuzzyQuery', () => {
  it('appends ~1 to plain tokens', () => {
    assert.equal(SearchEnhanced.buildFuzzyQuery('sysselseting'), 'sysselseting~1');
    assert.equal(SearchEnhanced.buildFuzzyQuery('arbeids marked'), 'arbeids~1 marked~1');
  });

  it('leaves Lucene operators and special tokens untouched', () => {
    assert.equal(SearchEnhanced.buildFuzzyQuery('bnp OR kpi'), 'bnp~1 OR kpi~1');
    assert.equal(SearchEnhanced.buildFuzzyQuery('syssel*'), 'syssel*');
  });

  it('passes through empty input', () => {
    assert.equal(SearchEnhanced.buildFuzzyQuery(''), '');
  });
});
