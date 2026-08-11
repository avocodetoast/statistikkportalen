'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.browse, 'js/browser-state.js', 'js/front-page.js']);

function recent(id, path) {
  return {
    id,
    label: id,
    updated: new Date().toISOString(),
    discontinued: false,
    paths: [path.map(([segmentId, label]) => ({ id: segmentId, label, sortCode: '1' }))]
  };
}

describe('_collectRecentUpdateGroups fallback addEntry', () => {
  it('walks leaf categories and keeps only tables whose first path matches that entry', () => {
    const mh = new app.MenuHierarchy();
    mh.buildHierarchy([
      recent('age', [['be', 'Befolkning'], ['be01', 'Folketall'], ['age', 'Alder']]),
      recent('sex', [['be', 'Befolkning'], ['be01', 'Folketall'], ['sex', 'Kjønn']]),
      recent('direct', [['al', 'Arbeid'], ['al01', 'Sysselsetting']])
    ]);

    const today = app._collectRecentUpdateGroups(mh, null).find(bucket => bucket.key === 'today');
    assert.deepEqual(today.groups.map(group => ({
      label: group.label,
      path: group.path,
      ids: group.tables.map(table => table.id)
    })), [
      { label: 'Alder', path: ['be', 'be01', 'age'], ids: ['age'] },
      { label: 'Kjønn', path: ['be', 'be01', 'sex'], ids: ['sex'] },
      { label: 'Sysselsetting', path: ['al', 'al01'], ids: ['direct'] }
    ]);
  });
});
