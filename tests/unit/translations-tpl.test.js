'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp(SCRIPTS.core);

describe('tpl', () => {
  it('interpolates numbered placeholders in a translated string', () => {
    assert.equal(app.tpl('status.exceedsLimit', '12 345'), app.t('status.exceedsLimit').replace('{0}', '12 345'));
  });

  it('leaves missing placeholders intact and stringifies supplied values', () => {
    assert.equal(app.tpl('unknown {0} {1}', 0), 'unknown 0 {1}');
  });
});
