/**
 * Test harness: loads the app's global-scope browser scripts into the Node.js
 * process so they can be unit-tested with `node --test` — no browser, no npm
 * dependencies, no changes to the app files themselves.
 *
 * The app has no build step and no ES modules: every file in js/ attaches its
 * exports to `window`, and top-level const/let/class declarations share the
 * global lexical scope across <script> tags. `vm.runInThisContext()` gives
 * exactly those semantics in Node: each file runs as a classic script in the
 * process's global scope, in the same dependency order as index.html, against
 * small in-memory shims for window/localStorage/document/location/indexedDB
 * that loadApp() installs first.
 *
 * Because scripts run in the host realm (not a separate vm context), objects
 * they create are ordinary Node objects — assert.deepEqual() etc. work with
 * no cross-realm surprises.
 *
 * ONE loadApp() CALL PER TEST FILE: scripts declare top-level const/let and
 * cannot be evaluated twice in the same process. `node --test` runs each test
 * file in its own process, so call loadApp() once at the top of the file and
 * share the returned `app` between tests. Tests that need mutually isolated
 * app state belong in separate files.
 *
 * Usage:
 *
 *   const { describe, it } = require('node:test');
 *   const assert = require('node:assert/strict');
 *   const { loadApp, SCRIPTS } = require('../helpers/app-env.js');
 *
 *   const app = loadApp(SCRIPTS.core);              // preset script list
 *   // or: loadApp([...SCRIPTS.core, 'js/menu-hierarchy.js'])
 *
 *   describe('SearchEnhanced', () => {
 *     it('normalizes diacritics', () => {
 *       assert.equal(app.SearchEnhanced.normalizeText('Årbok'), 'arbok');
 *     });
 *   });
 *
 * Network is disabled by default: any fetch() throws with a clear message.
 * Pass a fake via options.fetch to stub API responses (use fixtures from
 * tests/fixtures/, never live requests).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Minimal in-memory Storage (localStorage/sessionStorage) shim.
 * Items are stored as own enumerable properties so that
 * `Object.keys(localStorage)` works the way cache.js expects.
 */
class MemoryStorage {
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
  }
  setItem(key, value) {
    this[key] = String(value);
  }
  removeItem(key) {
    delete this[key];
  }
  clear() {
    for (const key of Object.keys(this)) delete this[key];
  }
}
Object.defineProperty(MemoryStorage.prototype, 'length', {
  get() { return Object.keys(this).length; }
});

/** Minimal DOM element stub — enough for load-time code paths, not for rendering. */
function createElementStub(tagName) {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    className: '',
    innerHTML: '',
    textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild() {},
    remove() {},
    insertBefore(child) { this.children.push(child); return child; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementsByTagName() { return []; },
    focus() {},
    blur() {},
    click() {}
  };
}

/** Minimal document stub. getElementById returns null (like a page without that element). */
function createDocumentStub() {
  return {
    documentElement: createElementStub('html'),
    head: createElementStub('head'),
    body: createElementStub('body'),
    title: '',
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return createElementStub(tag); },
    createTextNode(text) { return { textContent: text }; },
    addEventListener() {},
    removeEventListener() {}
  };
}

/**
 * Preset script lists (paths relative to repo root), in the same dependency
 * order as index.html. Compose your own list from `core` when a preset
 * loads more than the test needs.
 */
const SCRIPTS = {
  /** version + config + translations + cache + api — the minimum most modules depend on */
  core: [
    'js/version.js',
    'js/config.js',
    'js/translations.js',
    'js/cache.js',
    'js/api.js'
  ],

  /** core + everything needed for search/browse logic tests */
  browse: [
    'js/version.js',
    'js/config.js',
    'js/translations.js',
    'js/cache.js',
    'js/api.js',
    'js/utils.js',
    'js/router.js',
    'js/subjects.js',
    'js/menu-hierarchy.js',
    'js/synonyms.js',
    'js/search-enhanced.js'
  ],

  /** core + the multi-source adapter layer (window.api becomes the facade) */
  sources: [
    'js/version.js',
    'js/config.js',
    'js/translations.js',
    'js/cache.js',
    'js/api.js',
    'js/sources/sdmx-to-jsonstat.js',
    'js/sources/source-common.js',
    'js/sources/norges-bank-adapter.js',
    'js/sources/fhi-adapter.js',
    'js/sources/ssb-adapter.js',
    'js/sources/source-registry.js'
  ]
};

let _loaded = false;

/**
 * Install browser-global shims on globalThis and evaluate app scripts in the
 * process's global scope (same semantics as sequential <script> tags).
 *
 * @param {string[]} scripts - Repo-relative script paths, in dependency order.
 * @param {object} [options]
 * @param {function} [options.fetch] - Fake fetch; default throws (network is
 *   disabled in unit tests — use fixtures instead).
 * @param {object} [options.globals] - Extra globals installed before scripts
 *   run (e.g. a pre-seeded `localStorage` MemoryStorage instance).
 * @returns {object} `globalThis` (=== window): `app.AppConfig`,
 *   `app.SearchEnhanced`, `app.t(...)`, `app.detectSavedQueryId` etc.
 */
function loadApp(scripts, options = {}) {
  if (_loaded) {
    throw new Error(
      'loadApp() was already called in this process. App scripts declare ' +
      'top-level const/let and cannot be evaluated twice — call loadApp() ' +
      'once per test file (node --test runs each file in its own process).'
    );
  }
  _loaded = true;

  const g = globalThis;

  const shims = {
    window: g,
    self: g,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    document: createDocumentStub(),
    location: {
      hash: '',
      origin: 'http://localhost',
      pathname: '/',
      href: 'http://localhost/',
      search: '',
      hostname: 'localhost',
      protocol: 'http:'
    },
    navigator: {
      language: 'nb',
      languages: ['nb'],
      userAgent: 'node-test',
      clipboard: { writeText: async () => {} }
    },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },

    // No real IndexedDB in Node: open() throws synchronously, which cache.js
    // catches and falls back to localStorage-only mode (isAvailable = false).
    indexedDB: {
      open() { throw new Error('indexedDB is not available in the Node test environment'); }
    },

    // Network is off by default — unit tests must not hit live APIs.
    fetch: options.fetch || (async (url) => {
      throw new Error(
        'fetch() is disabled in unit tests (requested: ' + url + '). ' +
        'Pass a fake via loadApp(scripts, { fetch }) or use a fixture.'
      );
    }),

    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    alert() {},
    confirm() { return true; },
    prompt() { return null; },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    scrollTo() {},
    open() { return null; },
    ...options.globals
  };

  for (const [name, value] of Object.entries(shims)) {
    // defineProperty, not plain assignment: some names (navigator, fetch)
    // already exist on Node's globalThis as getters/readonly.
    Object.defineProperty(g, name, { value, writable: true, configurable: true });
  }

  for (const rel of scripts) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInThisContext(code, { filename: rel });
    } catch (err) {
      err.message = `Failed loading ${rel}: ${err.message}`;
      throw err;
    }
  }

  return g;
}

/** Read a JSON fixture from tests/fixtures/. */
function loadFixture(name) {
  const file = path.join(ROOT, 'tests', 'fixtures', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadApp, loadFixture, SCRIPTS, MemoryStorage };
