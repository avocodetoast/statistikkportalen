'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');
const app = loadApp(SCRIPTS.core);

describe('DBH-katalog', () => {
  it('har nøyaktig de 14 kuraterte tabellene', () => {
    assert.deepEqual(app.DbhCatalog.tables.map(t => t.id),
      [379,571,124,900,905,704,560,370,373,222,226,390,555,947].map(id => 'dbh-' + id));
  });
  it('har Årstall, måltall og dokumentasjonslenke på alle rader', () => {
    app.DbhCatalog.tables.forEach(t => {
      assert.equal(t.dimensions[0].code, 'Årstall');
      assert.ok(t.measures.length);
      assert.match(t.aboutUrl, new RegExp('/' + t.rawId + '$'));
    });
  });
});
