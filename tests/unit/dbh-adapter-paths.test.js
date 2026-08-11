'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');
const app = loadApp(SCRIPTS.sources);
const adapter = app.SourceAdapters.find(a => a.sourceId === 'dbh');

describe('DBHAdapter — katalogstier', () => {
  it('eier dbh-prefikset og har full metodeflate', () => {
    assert.equal(adapter.ownsTableId('dbh-900'), true);
    assert.equal(adapter.ownsTableId('900'), false);
    ['getTables','getAllTables','getTableMetadata','getTableData','getCodeList',
      'downloadTableData','saveSavedQuery','getSavedQuery','getSavedQueryData',
      'getDefaultSelection','buildPostBody','buildApiQuery','cleanupCache','clearCache','getCacheStats']
      .forEach(name => assert.equal(typeof adapter[name], 'function', name));
  });
  it('bygger 14 nettverksfrie katalograder med gyldige paths', async () => {
    const out = await adapter.getTables({ lang: 'nb' });
    assert.equal(out.tables.length, 14);
    out.tables.forEach(row => {
      assert.match(row.id, /^dbh-/);
      assert.equal(row.paths[0][0].id, 'ud');
      row.paths.flat().forEach(seg => { assert.ok(seg.label); assert.ok(seg.sortCode); });
    });
  });
  it('bygger item/between bare for årsfilteret', () => {
    const one = adapter.buildApiQuery('dbh-900', { 'Årstall': ['2024'], Institusjonskode: ['1234'] });
    assert.equal(one.method, 'POST');
    assert.equal(one.body.filter[0].selection.filter, 'item');
    assert.equal(one.body.filter.length, 1);
    const many = adapter.buildApiQuery('dbh-900', { 'Årstall': ['2024','2022'] });
    assert.equal(many.body.filter[0].selection.filter, 'between');
    assert.deepEqual(many.body.filter[0].selection.values, ['2022','2024']);
    assert.equal(many.body.statuslinje, 'J');
    assert.equal(many.body.kodetekst, 'J');
  });
});
