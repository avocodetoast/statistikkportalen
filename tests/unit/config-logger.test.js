'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const calls = [];
const fakeConsole = {};
for (const method of ['log', 'warn', 'error', 'info', 'debug', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd']) {
  fakeConsole[method] = (...args) => calls.push([method, ...args]);
}

const app = loadApp(SCRIPTS.core, { globals: { console: fakeConsole } });

describe('logger wrappers', () => {
  it('suppress all wrappers while debug logging is disabled', () => {
    app.AppConfig.debug = false;
    app.logger.debug('d');
    app.logger.info('i');
    app.logger.group('g');
    app.logger.groupCollapsed('gc');
    app.logger.groupEnd();
    app.logger.time('timer');
    app.logger.timeEnd('timer');
    assert.deepEqual(calls, []);
  });

  it('forwards each wrapper to the matching console method when enabled', () => {
    app.AppConfig.debug = true;
    app.logger.debug('d', 1);
    app.logger.info('i');
    app.logger.group('g');
    app.logger.groupCollapsed('gc');
    app.logger.groupEnd();
    app.logger.time('timer');
    app.logger.timeEnd('timer');
    app.AppConfig.debug = false;

    assert.deepEqual(calls, [
      ['debug', 'd', 1], ['info', 'i'], ['group', 'g'], ['groupCollapsed', 'gc'],
      ['groupEnd'], ['time', 'timer'], ['timeEnd', 'timer']
    ]);
  });
});
