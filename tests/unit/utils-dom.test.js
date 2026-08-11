'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

function element(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(), children: [], style: {}, innerHTML: '', textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { this.listener = { type, fn }; }
  };
}

const elements = {
  'loading-indicator': element(),
  'error-display': element(),
  content: element()
};
const listeners = new Map();
const timers = new Map();
let nextTimerId = 1;
const documentStub = {
  title: '',
  getElementById(id) { return elements[id] || null; },
  createElement: element,
  createTextNode(text) { return { textContent: text }; },
  addEventListener(type, fn) { listeners.set(type, fn); },
  removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }
};

const app = loadApp([...SCRIPTS.core, 'js/utils.js', 'js/router.js'], {
  globals: {
    document: documentStub,
    setTimeout(fn) {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  }
});
const state = vm.runInThisContext('AppState');

describe('DOM-adjacent utilities', () => {
  beforeEach(() => {
    elements['loading-indicator'].style = {};
    elements['error-display'].innerHTML = '';
    elements['error-display'].children = [];
    elements.content.innerHTML = '';
    listeners.clear();
    timers.clear();
    delete app.lastError;
  });

  it('showLoading toggles visibility and message', () => {
    app.showLoading(true, 'Henter');
    assert.equal(elements['loading-indicator'].textContent, 'Henter');
    assert.equal(elements['loading-indicator'].style.display, 'block');
    app.showLoading(false, 'Ferdig');
    assert.equal(elements['loading-indicator'].style.display, 'none');
  });

  it('showError renders safe text nodes and clearError removes it', () => {
    const error = new Error('teknisk');
    app.showError('<ikke html>', error);
    const message = elements['error-display'].children[0];
    assert.equal(message.className, 'error-message');
    assert.equal(message.children[1].textContent, '<ikke html>');
    assert.equal(app.lastError, error);
    app.clearError();
    assert.equal(elements['error-display'].innerHTML, '');
  });

  it('safeApiCall balances loading on success and reports failure', async () => {
    const value = await app.safeApiCall(async () => 42, 'mislyktes');
    assert.equal(value, 42);
    assert.equal(elements['loading-indicator'].style.display, 'none');

    const failed = await app.safeApiCall(async () => { throw new Error('boom'); }, 'Kunne ikke hente');
    assert.equal(failed, null);
    assert.equal(app.lastError.message, 'boom');
    assert.equal(elements['error-display'].children.length, 1);
  });

  it('addEscapeHandler ignores other keys, closes once on Escape and supports cleanup', () => {
    let closes = 0;
    const cleanup = app.addEscapeHandler(() => { closes += 1; });
    listeners.get('keydown')({ key: 'Enter' });
    assert.equal(closes, 0);
    listeners.get('keydown')({ key: 'Escape' });
    assert.equal(closes, 1);
    assert.equal(listeners.has('keydown'), false);

    app.addEscapeHandler(() => { closes += 1; });
    cleanup();
    assert.equal(listeners.has('keydown'), true, 'cleanup only removes its own handler');
  });

  it('updatePageTitle updates document title and synchronizes SEO title', () => {
    let syncs = 0;
    app.SEOHead = { syncTitle() { syncs += 1; } };
    app.updatePageTitle(['Befolkning', 'Folkemengde']);
    assert.equal(documentStub.title, `Befolkning – Folkemengde – ${app.AppConfig.app.name}`);
    assert.equal(syncs, 1);
    delete app.SEOHead;
  });

  it('renderCurrentView dispatches every view renderer and handles unknown views', () => {
    const calls = [];
    app.renderFrontPage = () => calls.push('home');
    app.renderSearchView = () => calls.push('search');
    app.renderTopicView = () => calls.push('topic');
    app.renderVariableSelection = () => calls.push('variables');
    app.renderTableDisplay = () => calls.push('table');
    app.__SEO_TOPIC_PATH__ = ['not-home'];
    for (const view of ['home', 'search', 'topic', 'variables', 'table']) {
      state.currentView = view;
      app.renderCurrentView();
    }
    assert.deepEqual(calls, ['home', 'search', 'topic', 'variables', 'table']);
    state.currentView = 'unexpected';
    app.renderCurrentView();
    assert.match(elements.content.innerHTML, /<p>/);
    delete app.__SEO_TOPIC_PATH__;
  });

  it('handleHashChange delegates to URLRouter.handleRoute', () => {
    let calls = 0;
    const original = app.URLRouter.handleRoute;
    app.URLRouter.handleRoute = () => { calls += 1; };
    app.handleHashChange();
    app.URLRouter.handleRoute = original;
    assert.equal(calls, 1);
  });
});
