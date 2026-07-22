/**
 * menu-hierarchy.js — builds the subject→subtopic→table tree from the flat,
 * cross-source table list. Tested against a small synthetic catalogue.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/subjects.js', 'js/menu-hierarchy.js']);

const TABLES = [
  {
    id: '07459',
    label: 'Befolkning, etter kjønn og alder',
    paths: [[
      { id: 'be', label: 'Befolkning' },
      { id: 'be01', label: 'Folketall' }
    ]]
  },
  {
    id: '05803',
    label: 'Flyttinger',
    paths: [[
      { id: 'be', label: 'Befolkning' },
      { id: 'be02', label: 'Flytting' }
    ]]
  },
  {
    id: 'nb-ir',
    label: 'Styringsrenten',
    updated: '',
    paths: [[
      { id: 'nk', label: 'Nasjonalregnskap og konjunkturer' },
      { id: 'nb-renter', label: 'Renter' }
    ]]
  },
  { id: '99999', label: 'Table without paths' },
  // SSB-tabell dypt i bf-treet — deler 'renter'-noden med NB-tabellen under.
  {
    id: '10701',
    label: 'NIBOR og Norges Banks foliorente',
    paths: [[
      { id: 'bf', label: 'Bank og finansmarked' },
      { id: 'bf03', label: 'Finansinstitusjoner og andre finansielle foretak' },
      { id: 'renter', label: 'Renter i banker og kredittforetak' }
    ]]
  },
  // NB-tabell med SSB-passthrough-id-er ('bf03'/'renter') + NB-leaf: skal MERGE
  // inn i samme 'renter'-node som SSB-tabellen over, ikke lage en dublett.
  {
    id: 'nb-ir-deep',
    label: 'Styringsrenten (dyp)',
    updated: '',
    paths: [[
      { id: 'bf', label: 'Bank og finansmarked' },
      { id: 'bf03', label: 'Finansinstitusjoner og andre finansielle foretak' },
      { id: 'renter', label: 'Renter i banker og kredittforetak' },
      { id: 'nb-pengepolitikk', label: 'Pengepolitikk og pengemarked' }
    ]]
  },
  {
    id: 'nb-exr',
    label: 'Valutakurser',
    updated: '',
    paths: [
      [
        { id: 'nk', label: 'Nasjonalregnskap og konjunkturer' },
        { id: 'nb-valuta', label: 'Valutakurser' }
      ],
      [
        { id: 'nk', label: 'Nasjonalregnskap og konjunkturer' },
        { id: 'nb-valuta-hist', label: 'Historiske valutakurser' }
      ]
    ]
  }
];

describe('MenuHierarchy.buildHierarchy', () => {
  const mh = new app.MenuHierarchy();
  const hierarchy = mh.buildHierarchy(TABLES);

  it('creates one top-level node per subject code', () => {
    assert.deepEqual(Object.keys(hierarchy).sort(), ['be', 'bf', 'nk']);
    assert.equal(hierarchy.be.label, 'Befolkning');
  });

  it('merges NB path with SSB node ids into the existing SSB node (no duplicate)', () => {
    const renter = hierarchy.bf.children.bf03.children.renter;
    assert.ok(renter, 'renter-noden finnes');
    // Én 'renter'-node, ikke to søsken med samme id
    assert.equal(Object.keys(hierarchy.bf.children.bf03.children).length, 1);
    // SSB-tabellen ligger i 'renter'; NB-tabellen i leaf-barnet under
    assert.deepEqual(renter.tables.map(t => t.id), ['10701']);
    assert.deepEqual(
      renter.children['nb-pengepolitikk'].tables.map(t => t.id),
      ['nb-ir-deep']
    );
  });

  it('nests subtopics under the subject', () => {
    assert.deepEqual(Object.keys(hierarchy.be.children).sort(), ['be01', 'be02']);
    assert.equal(hierarchy.be.children.be01.depth, 1);
  });

  it('attaches tables to the leaf node of their path', () => {
    assert.deepEqual(hierarchy.be.children.be01.tables.map(t => t.id), ['07459']);
    assert.deepEqual(hierarchy.nk.children['nb-renter'].tables.map(t => t.id), ['nb-ir']);
  });

  it('skips tables without paths (no crash, not placed)', () => {
    const placed = [];
    const collect = (node) => {
      placed.push(...node.tables.map(t => t.id));
      Object.values(node.children).forEach(collect);
    };
    Object.values(hierarchy).forEach(collect);
    assert.ok(!placed.includes('99999'));
  });

  it('getNodeForPath navigates to a nested node', () => {
    const node = mh.getNodeForPath(['be', 'be02']);
    assert.equal(node.label, 'Flytting');
  });

  it('places a multi-path table under every path (like SSB multi-folder tables)', () => {
    assert.deepEqual(hierarchy.nk.children['nb-valuta'].tables.map(t => t.id), ['nb-exr']);
    assert.deepEqual(hierarchy.nk.children['nb-valuta-hist'].tables.map(t => t.id), ['nb-exr']);
  });

  it('getNodeForPath reaches a multi-path table via either path', () => {
    assert.equal(mh.getNodeForPath(['nk', 'nb-valuta']).tables[0].id, 'nb-exr');
    assert.equal(mh.getNodeForPath(['nk', 'nb-valuta-hist']).tables[0].id, 'nb-exr');
  });

  it('deduplicates a multi-path table in collected/counted results', () => {
    // 'nk'-treet inneholder nb-exr under BÅDE nb-valuta og nb-valuta-hist;
    // innsamling fra felles forfader skal telle den ÉN gang (+ nb-ir = 2).
    const collected = mh._collectAllTables(hierarchy.nk);
    const ids = collected.map(t => t.id);
    assert.equal(ids.filter(id => id === 'nb-exr').length, 1);
    assert.equal(mh._countTables(hierarchy.nk), 2);
  });

  it('getBreadcrumbs prepends the subject group, then one crumb per segment', () => {
    const crumbs = mh.getBreadcrumbs(['be', 'be01']);
    assert.equal(crumbs.length, 3);
    assert.deepEqual(crumbs[0].path, ['befolkning']); // subject group
    assert.deepEqual(crumbs[1].path, ['be']);
    assert.deepEqual(crumbs[2].path, ['be', 'be01']);
    assert.equal(crumbs[2].label, 'Folketall');
  });
});
