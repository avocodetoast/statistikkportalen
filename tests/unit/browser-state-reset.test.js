/**
 * browser-state.js — reset invaliderer pågående init og alle avledede
 * katalogobjekter. Språket snapshots ved init-start, så ett init-løp aldri
 * blander katalogspråk over en await-grense.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.core,
  'js/utils.js',
  'js/router.js',
  'js/subjects.js',
  'js/menu-hierarchy.js',
  'js/synonyms.js',
  'js/search-enhanced.js',
  'js/browser-state.js'
]);

const { BrowserState, AppConfig } = app;

function row(id) {
  return {
    id, label: 'Tabell ' + id, updated: '', firstPeriod: '', lastPeriod: '',
    subjectCode: 'al', sortCode: '1', timeUnit: 'Annual', discontinued: false,
    variableNames: [], paths: [[{ id: 'al', label: 'Arbeid', sortCode: '1' }]],
    description: ''
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  BrowserState.reset();
  AppConfig.catalogIndex.enabled = false;
});

describe('BrowserState.reset — init-generasjon', () => {
  it('lar ikke et eldre init-løp committe etter reset og et nytt init', async () => {
    const firstConfig = deferred();
    let configCalls = 0;
    const tableLangs = [];
    let lang = 'no';
    app.getCurrentApiLang = () => lang;
    app.api = {
      getConfig: async () => (++configCalls === 1 ? firstConfig.promise : {}),
      getAllTables: async (options) => {
        tableLangs.push(options.lang);
        return { tables: [row(options.lang)] };
      }
    };

    const oldInit = BrowserState.init();
    await Promise.resolve();
    BrowserState.reset();
    lang = 'en';
    await BrowserState.init();

    firstConfig.resolve({});
    await oldInit;

    assert.deepEqual(tableLangs, ['en'], 'det invaliderte løpet skal stoppe etter await');
    assert.deepEqual(BrowserState.allTables.map(t => t.id), ['en']);
    assert.equal(BrowserState.isLoaded, true);
  });

  it('bruker samme språk før og etter await i ett init-løp', async () => {
    const config = deferred();
    let lang = 'no';
    let tableOptions;
    app.getCurrentApiLang = () => lang;
    app.api = {
      getConfig: () => config.promise,
      getAllTables: async (options) => {
        tableOptions = options;
        return { tables: [row(options.lang)] };
      }
    };

    const init = BrowserState.init();
    await Promise.resolve();
    lang = 'en';
    config.resolve({});
    await init;

    assert.equal(tableOptions.lang, 'no');
    assert.deepEqual(BrowserState.allTables.map(t => t.id), ['no']);
  });
});

describe('BrowserState.reset — avledet søketilstand', () => {
  it('nullstiller _searchIndex sammen med tabellista', () => {
    BrowserState._searchIndex = { rows: [row('gammel')] };
    BrowserState.reset();
    assert.equal(BrowserState._searchIndex, null);
  });
});
