/**
 * subjects.js — SSB subject groups and names.
 * Migrated from the legacy test.html suite.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/subjects.js']);
const { SubjectConfig } = app;

describe('SubjectConfig — SSB subjects', () => {
  it('has 6 subject groups', () => {
    assert.equal(typeof SubjectConfig.subjectGroups, 'object');
    assert.equal(Object.keys(SubjectConfig.subjectGroups).length, 6);
  });

  it('groups arbeid and okonomi contain the expected subjects', () => {
    assert.ok(SubjectConfig.subjectGroups.arbeid.subjects.includes('al'));
    assert.ok(SubjectConfig.subjectGroups.arbeid.subjects.includes('ud'));
    assert.ok(SubjectConfig.subjectGroups.okonomi.subjects.includes('nk'));
  });

  it('has Norwegian names for known subjects', () => {
    assert.equal(SubjectConfig.subjectNames.al.nb, 'Arbeid og lønn');
    assert.equal(SubjectConfig.subjectNames.be.nb, 'Befolkning');
  });

  it('every subject referenced by a group has a name', () => {
    const allGroupSubjects = Object.values(SubjectConfig.subjectGroups)
      .flatMap(g => g.subjects);
    const missing = allGroupSubjects.filter(s => !SubjectConfig.subjectNames[s]);
    assert.deepEqual(missing, []);
  });
});
