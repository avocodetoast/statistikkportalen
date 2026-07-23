/**
 * Local pure-string-builder helpers extracted during the dedup cleanup in
 * search-view.js/topic-view.js — _searchRenderSubjectOptions and
 * _topicRenderCardGrid. Both are plain functions with no DOM dependency at
 * call time (only escapeHtml/t, which the harness provides), so they load
 * safely without MenuBar/URLRouter/seoContentMatchesRoute etc. — those are
 * only referenced inside functions this file never calls.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([
  ...SCRIPTS.browse,
  'js/browser-state.js',
  'js/front-page.js',
  'js/search-view.js',
  'js/topic-view.js'
]);

describe('_searchRenderSubjectOptions', () => {
  const mh = {
    subjectGroups: {
      g1: { id: 'g1', subjects: ['al', 'be'] }
    }
  };
  const hitCounts = { al: 3, be: 0 };

  it('marks the empty option selected and no subject option when selected is omitted', () => {
    const html = app._searchRenderSubjectOptions(mh, hitCounts, 3);
    assert.doesNotMatch(html, /selected/);
  });

  it('marks the matching subject option selected when selected is given', () => {
    const html = app._searchRenderSubjectOptions(mh, hitCounts, 3, 'al');
    assert.match(html, /<option value="al" [^>]*selected[^>]*>/);
    assert.doesNotMatch(html, /<option value="be" [^>]*\bselected\b[^>]*>/);
  });

  it('disables subject options with a zero hit count', () => {
    const html = app._searchRenderSubjectOptions(mh, hitCounts, 3);
    assert.match(html, /<option value="be" disabled[^>]*>/);
    assert.doesNotMatch(html, /<option value="al" disabled/);
  });

  it('includes a group with all subjects, each with its count', () => {
    const html = app._searchRenderSubjectOptions(mh, hitCounts, 3);
    assert.match(html, /value="al"[^>]*>.*\(3\)<\/option>/);
    assert.match(html, /value="be"[^>]*>.*\(0\)<\/option>/);
  });
});

describe('_topicRenderCardGrid', () => {
  const items = [
    { id: 'al', label: 'Arbeid & lønn', tableCount: 1 },
    { id: 'be', label: 'Befolkning', tableCount: 5 }
  ];

  it('renders the given grid/card CSS classes', () => {
    const html = app._topicRenderCardGrid('subtopic-cards', 'subtopic-card', items, 'subject-id');
    assert.match(html, /<div class="subtopic-cards">/);
    assert.match(html, /<div class="subtopic-card"/g);
  });

  it('renders a data-{dataAttr} attribute per item, matching the kebab-case → dataset camelCase read in the click handlers', () => {
    const html = app._topicRenderCardGrid('category-cards', 'category-card', items, 'category-id');
    assert.match(html, /data-category-id="al"/);
    assert.match(html, /data-category-id="be"/);
  });

  it('escapes the label', () => {
    const html = app._topicRenderCardGrid('subtopic-cards', 'subtopic-card', items, 'subject-id');
    assert.match(html, /Arbeid &amp; lønn/);
  });

  it('uses singular vs. plural table-count wording based on tableCount', () => {
    const html = app._topicRenderCardGrid('subtopic-cards', 'subtopic-card', items, 'subject-id');
    assert.match(html, /1 tabell(?!er)/); // singular for the al item (tableCount: 1)
    assert.match(html, /5 tabeller/);     // plural for the be item (tableCount: 5)
  });
});

describe('_topicRenderSubtree table-group chrome', () => {
  const mh = new app.MenuHierarchy();
  const filters = { includeDiscontinued: true, frequencyFilter: '', updatedFilter: '' };

  function node(tables) {
    return { label: 'Statsgjeld og statspapirer', sortCode: '01', tables, children: {} };
  }

  // No base year and no SSB-style timeUnit → everything lands in the generic
  // "Andre tabeller" catch-all (typical for NB/FHI tables).
  const fallbackTables = [
    { id: 'nb-GOVT_KEYFIGURES', label: 'Nøkkeltall for statsgjelden', sortCode: 'a', timeUnit: null },
    { id: 'nb-SEC', label: 'Statspapirer – kurser og renter', sortCode: 'b', timeUnit: null }
  ];

  it('wraps a fallback-only table list in a headerless .table-group card', () => {
    const html = app._topicRenderSubtree(node(fallbackTables), 0, mh, filters);
    assert.match(html, /<div class="table-group table-group--plain">/);
    assert.match(html, /<table class="table-list">/);
    assert.doesNotMatch(html, /table-group-header/);
    assert.doesNotMatch(html, new RegExp(app.MenuHierarchy.FALLBACK_GROUP_LABEL));
  });

  it('still renders a collapsible group with a summary header for real groups', () => {
    const tables = [
      { id: '07511', label: 'Offentlig forvaltnings fordringer og gjeld', sortCode: 'a', timeUnit: 'Annual' }
    ];
    const html = app._topicRenderSubtree(node(tables), 0, mh, filters);
    assert.match(html, /<details class="table-group" open>/);
    assert.match(html, /<summary class="table-group-header">/);
    assert.match(html, /Årsstall/);
    assert.doesNotMatch(html, /table-group--plain/);
  });
});

/**
 * The two ensureLoaded() renderSpinner callbacks actually wired up in
 * front-page.js/topic-view.js — the generic BrowserState.ensureLoaded tests
 * (browser-state-filter-options.test.js) only check that a custom callback
 * is invoked, not that THESE specific closures do the right thing. Both
 * renderFrontPage/renderTopicView return immediately after ensureLoaded
 * fails, so we can exercise them without any BrowserState/MenuHierarchy data
 * by holding BrowserState._doInit() pending, inspecting the container right
 * after the synchronous renderSpinner call, then letting init() fail.
 */
describe('renderFrontPage / renderTopicView spinner (real ensureLoaded renderSpinner callbacks)', () => {
  function withPendingInit(fn) {
    return async () => {
      app.BrowserState.isLoaded = false;
      app.BrowserState._initPromise = null;
      const originalDoInit = app.BrowserState._doInit;
      let rejectInit;
      app.BrowserState._doInit = () => new Promise((resolve, reject) => { rejectInit = reject; });
      const reject = () => rejectInit(new Error('boom'));
      try {
        await fn(reject);
      } finally {
        app.BrowserState._doInit = originalDoInit;
        app.BrowserState.isLoaded = true;
        app.BrowserState._initPromise = null;
      }
    };
  }

  it('front-page: swaps .front-seo-intro outerHTML in place when seoContentMatchesRoute([]) is true', withPendingInit(async (reject) => {
    const originalSeo = app.seoContentMatchesRoute;
    app.seoContentMatchesRoute = () => true;
    const seoIntroEl = { outerHTML: '<div class="front-seo-intro">seo placeholder</div>' };
    const container = {
      innerHTML: '',
      querySelector: (sel) => (sel === '.front-seo-intro' ? seoIntroEl : null)
    };

    const renderPromise = app.renderFrontPage(container);
    await Promise.resolve(); await Promise.resolve(); // let the synchronous renderSpinner run

    assert.match(seoIntroEl.outerHTML, /loading-spinner/);
    assert.equal(container.innerHTML, '', 'container.innerHTML should be untouched — the swap targets the sub-element');

    reject();
    await renderPromise;
    app.seoContentMatchesRoute = originalSeo;
  }));

  it('front-page: falls back to container.innerHTML when no .front-seo-intro element is present', withPendingInit(async (reject) => {
    const originalSeo = app.seoContentMatchesRoute;
    app.seoContentMatchesRoute = () => true;
    const container = { innerHTML: '', querySelector: () => null };

    const renderPromise = app.renderFrontPage(container);
    await Promise.resolve(); await Promise.resolve();

    assert.match(container.innerHTML, /loading-spinner/);

    reject();
    await renderPromise;
    app.seoContentMatchesRoute = originalSeo;
  }));

  it('topic-view: skips the spinner entirely when seoContentMatchesRoute(topicPath) is true (keeps pre-rendered SEO content)', withPendingInit(async (reject) => {
    const originalSeo = app.seoContentMatchesRoute;
    app.seoContentMatchesRoute = () => true;
    const container = { innerHTML: '<p>pre-rendered SEO content</p>' };

    const renderPromise = app.renderTopicView(container);
    await Promise.resolve(); await Promise.resolve();

    assert.equal(container.innerHTML, '<p>pre-rendered SEO content</p>');

    reject();
    await renderPromise;
    app.seoContentMatchesRoute = originalSeo;
  }));

  it('topic-view: renders the spinner when seoContentMatchesRoute(topicPath) is false', withPendingInit(async (reject) => {
    const originalSeo = app.seoContentMatchesRoute;
    app.seoContentMatchesRoute = () => false;
    const container = { innerHTML: '<p>stale content</p>' };

    const renderPromise = app.renderTopicView(container);
    await Promise.resolve(); await Promise.resolve();

    assert.match(container.innerHTML, /loading-spinner/);

    reject();
    await renderPromise;
    app.seoContentMatchesRoute = originalSeo;
  }));
});
