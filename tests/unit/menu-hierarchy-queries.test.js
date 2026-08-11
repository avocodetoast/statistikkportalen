'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/subjects.js', 'js/menu-hierarchy.js']);
const mh = new app.MenuHierarchy();

function row(id, updated, path, discontinued = false) {
  return {
    id, label: id, updated, discontinued,
    paths: [path.map(([segmentId, label, sortCode]) => ({ id: segmentId, label, sortCode }))]
  };
}

mh.buildHierarchy([
  row('new', '2026-02-01', [['be', 'Befolkning', '1'], ['be01', 'Folketall', '1'], ['age', 'Alder', '2']]),
  row('old', '2025-01-01', [['be', 'Befolkning', '1'], ['be01', 'Folketall', '1'], ['sex', 'Kjønn', '1']]),
  row('multi', '2026-01-01', [['be', 'Befolkning', '1'], ['be01', 'Folketall', '1'], ['age', 'Alder', '2']]),
  row('multi', '2026-01-01', [['be', 'Befolkning', '1'], ['be01', 'Folketall', '1'], ['sex', 'Kjønn', '1']]),
  row('work', '2024-01-01', [['al', 'Arbeid', '2'], ['al01', 'Sysselsetting', '1']])
]);

describe('MenuHierarchy pure queries', () => {
  it('getCategoriesForSubtopic returns sorted child summaries and recursive counts', () => {
    assert.deepEqual(mh.getCategoriesForSubtopic('be', 'be01'), [
      { id: 'sex', label: 'Kjønn', sortCode: '1', tableCount: 2, hasChildren: false },
      { id: 'age', label: 'Alder', sortCode: '2', tableCount: 2, hasChildren: false }
    ]);
    assert.deepEqual(mh.getCategoriesForSubtopic('missing', 'x'), []);
  });

  it('getSubjectsForGroup includes only populated subjects with deduplicated counts', () => {
    const subjects = mh.getSubjectsForGroup('befolkning');
    assert.ok(subjects.some(subject => subject.id === 'be' && subject.tableCount === 3));
    assert.ok(!subjects.some(subject => subject.id === 'al'));
    assert.deepEqual(mh.getSubjectsForGroup('missing'), []);
  });

  it('getTablesForPath collects descendants, deduplicates, and sorts newest first', () => {
    assert.deepEqual(mh.getTablesForPath(['be', 'be01']).map(table => table.id), [
      'new', 'multi', 'old'
    ]);
    assert.deepEqual(mh.getTablesForPath(['missing']), []);
  });
});
