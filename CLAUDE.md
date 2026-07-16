# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A client-side web application for browsing and exporting Norwegian statistical data from Statistics Norway's (SSB) PxWebApi v2. Pure vanilla JavaScript — no frameworks, no build tools, no npm dependencies.

**Language:** Norwegian (all UI text, variable names in API responses, documentation)

## Running the Application

Open `index.html` in a browser. No build step or server required. For API testing, use `api-explorer.html`.

There is no test framework, linter, or build system configured.

## Architecture

### Global State & Routing

- `js/utils.js` contains `AppState` — the central state object tracking the current view (`home`/`search`/`topic`/`variables`/`table`), selected table, variable selections, and topic navigation path. `renderCurrentView()` dispatches to the correct view renderer.
- `js/router.js` contains `URLRouter` — hash-based client-side routing. Routes: `#home`, `#search?q=...`, `#topic/be/be02`, `#variables/13760?v=...`, `#table/13760?v=...&l=...`
- `js/browser-state.js` contains `BrowserState` — shared state for browse views (table data, hierarchy, independent search/topic filters)

### Module Load Order (Critical)

Scripts must load in this order in `index.html`:
1. `js/config.js` — AppConfig (API URL, cache TTLs, limits, UI settings)
2. `js/cache.js` — CacheManager (localStorage/IndexedDB wrapper with TTL)
3. `js/api.js` — SSBApi (depends on CacheManager)
4. `js/utils.js` — AppState, renderCurrentView(), helpers (depends on SSBApi, AppConfig)
5. `js/router.js` — URLRouter, SSBURLMapper (depends on AppState)
6. `js/seo-head.js` — SEOHead: keeps canonical/og/meta-description/JSON-LD in sync with the route (depends on URLRouter)
7. `js/menu-hierarchy.js` — MenuHierarchy (builds topic tree from flat table list)
8. `js/browser-state.js` — BrowserState (depends on api, MenuHierarchy, URLRouter)
9. `js/menu-bar.js` — MenuBar shared component (depends on escapeHtml, URLRouter)
10. `js/front-page.js` — Front page view (depends on BrowserState, URLRouter)
11. `js/search-view.js` — Search view (depends on BrowserState, MenuBar, URLRouter)
12. `js/topic-view.js` — Topic navigation view (depends on BrowserState, MenuBar, URLRouter)
13. `js/variable-select-state.js` — Module state variables + `debouncedURLUpdate()`
14. `js/variable-select-status.js` — Visual updates, selection status, cell count, `getVariableSelection()`
15. `js/variable-select-codelists.js` — Codelist fetch/apply/restore + `setupCodelistDropdowns()`
16. `js/variable-select-render.js` — Dimension card rendering, value lists, `restoreSelections()`
17. `js/variable-select-events.js` — Click/keyboard/filter/mode button event wiring
18. `js/variable-select-api.js` — API query preview, API builder UI, `handleFetchData()`
19. `js/variable-select.js` — Main entry: `renderVariableSelection()` + `loadTableMetadata()`
20. `js/table-display.js` — Data fetch and table rendering
21. `js/table-rotation.js` — Drag-and-drop pivot (depends on table-display)
22. `js/export.js` — CSV/Excel export (depends on table-display)

### Views & Data Flow

1. **FrontPage** (`#home`) — landing page with search field + expanded subject grid
2. **SearchView** (`#search?q=...`) — search results with filters (independent from topic filters)
3. **TopicView** (`#topic/be/be02`) — hierarchical browse: cards → subcategories → table list with filters
4. **VariableSelect** (`#variables/13760`) → `api.getTableMetadata(tableId)` → user picks dimension values
5. **TableDisplay** (`#table/13760`) → `api.getTableData(tableId, valueCodes)` → renders HTML table
6. **TableRotation** / **Export** — operate on the already-fetched `AppState.currentData`

All table data (~10,000 tables) is fetched once by `BrowserState.init()` and kept in memory. Search and browse are purely client-side.

### API Integration

Base URL: `https://data.ssb.no/api/pxwebapi/v2`

- `GET /tables?lang=no&query=...` — search/list tables (cached 24h)
- `GET /tables/{id}/metadata?lang=no` — dimension definitions in JSON-Stat2 (cached 7 days)
- `GET /tables/{id}/data?lang=no&valueCodes[Dim]=values` — actual data (not cached)

Rate limit: 30 queries/minute, 800k cell limit per request. Data is CC BY 4.0.

### Caching

`CacheManager` in `cache.js` wraps localStorage with key prefix `ssb_`, TTL expiration, and automatic cleanup on app start. Cache failures are non-fatal. `window.clearCache()` is available from the console.

## Key Conventions

- All modules use ES6 classes or plain functions attached to the global scope (no ES modules/import)
- HTML is sanitized via `escapeHtml()` in utils.js before rendering user-facing API data
- Search input is debounced at 500ms
- Export uses semicolon-delimited CSV with UTF-8 BOM for Norwegian character support
- Console logging is used extensively for debugging

## File Guide

| File | Responsibility | Key exports | Depends on | Modify when… |
|------|---------------|-------------|------------|--------------|
| `config.js` | All tunable constants | `AppConfig` | — | Changing API URL, cache TTLs, cell limits, debounce delays, export defaults |
| `cache.js` | Hybrid localStorage/IndexedDB cache with TTL | `CacheManager` | — | Changing cache storage strategy, size threshold (1 MB), or cleanup logic |
| `api.js` | SSB API wrapper; throttled fetch + caching | `api` (SSBApi instance) | AppConfig, CacheManager | Adding/changing API endpoints, request parameters, download behaviour |
| `utils.js` | Global state + shared helpers | `AppState`, `renderCurrentView()`, `escapeHtml()`, `debounce()`, `formatNumber()`, `showError()` | AppConfig, URLRouter | Changing AppState shape, adding global helpers, changing error display |
| `router.js` | Hash-based routing; encode/decode URL state | `URLRouter`, `SSBURLMapper` | AppState, BrowserState | Adding a new route, changing URL param encoding, handling legacy redirects |
| `seo-head.js` | Route-driven `<head>` sync: canonical, og:-tags, meta description, removal of stale generator JSON-LD; lazy-loads `/seo-map.json` (fail-silent) | `SEOHead` | URLRouter, AppConfig, BrowserState | Changing canonical/meta behaviour on navigation, seo-map.json format |
| `menu-hierarchy.js` | Builds subject→subtopic→table tree from flat table list; hardcoded subject groupings | `MenuHierarchy` | — | Renaming/regrouping subjects, changing breadcrumb logic, changing table grouping (e.g. by base year) |
| `browser-state.js` | Shared state for browse views: table list, independent search/topic filters, shared render helpers | `BrowserState` | api, MenuHierarchy, URLRouter, AppState | Adding/renaming filter fields, changing filter↔URL sync, changing table-list HTML, shared search input behaviour |
| `menu-bar.js` | Compact hover-dropdown subject-group menu bar (search + topic views) | `MenuBar` | escapeHtml, URLRouter | Changing menu bar layout or adding items to the navigation bar |
| `front-page.js` | Landing page: search input + expanded subject grid | `renderFrontPage()` | BrowserState, URLRouter | Changing front-page layout or adding widgets to the home view |
| `search-view.js` | Search results: filters (subject, frequency, updated), live hit counts, grouped results | `renderSearchView()` | BrowserState, MenuBar, URLRouter | Adding/changing search filters, changing result grouping or display |
| `topic-view.js` | Hierarchical browse at all depth levels; recursive subtree renderer; breadcrumbs | `renderTopicView()` | BrowserState, MenuBar, URLRouter, AppState | Changing topic view layout, adding topic-level filters, changing how tables are listed under a topic |
| `variable-select.js` | Main entry: renders the view shell (HTML template), loads metadata, wires up the fetch button; renders the Tabellinfo section (via `buildMetadataSection`) after metadata load | `renderVariableSelection()`, `loadTableMetadata()` | All variable-select-* files, table-metadata.js | Changing the view layout/HTML template |
| `variable-select-state.js` | Module-level state variables shared across all variable-select files | `tableMetadata`, `activeCodelists`, `dimensionValueOrder`, `debouncedURLUpdate()` | AppState, URLRouter | Adding/renaming shared state variables |
| `variable-select-status.js` | Visual mode indicators, per-card value counters, selection status bar, cell count, `getVariableSelection()`, `validateSelection()` | `updateModeVisuals()`, `updateValueCounter()`, `updateSelectionStatus()`, `getVariableSelection()`, `validateSelection()` | AppState, AppConfig | Changing how selection state is reported, cell-count logic, validation rules |
| `variable-select-codelists.js` | Codelist fetch/apply/restore; codelist dropdown events; `sortCodelistOptions()` | `setupCodelistDropdowns()`, `applyCodelistToValueList()`, `renderCodelistValues()`, `extractCodelistCodes()` | api, AppState | Changing codelist behaviour, how aggregated/filter codelists work |
| `variable-select-render.js` | Dimension card HTML generation; value list rendering with hierarchy/ordering; `restoreSelections()`; auto-select single-value dimensions | `displayVariables()`, `renderValueList()`, `restoreSelections()`, `parseHierarchyLabel()` | AppState, api | Changing dimension card layout, value list ordering, selection restore logic |
| `variable-select-events.js` | Event wiring: click/shift-click/ctrl-click on values, text filter, Ctrl+A, mode buttons (Alle/Velg alle/Opphev/Siste N) | `setupVariableEvents()`, `setupListSelectionEvents()`, `setupModeButtons()` | — | Adding new interaction modes or keyboard shortcuts |
| `variable-select-api.js` | Live API query preview URL; API builder section (format selectors, copy/open buttons); `handleFetchData()` | `updateQueryPreview()`, `setupApiBuilderEvents()`, `handleFetchData()` | AppState, AppConfig | Changing API builder options, URL construction, fetch flow |
| `table-display.js` | Fetches data and renders HTML table; owns `currentData`/`currentFullMetadata` globals used by rotation and export | `renderTableDisplay()`, `loadTableData()` | AppState, URLRouter, api | Changing table rendering, number formatting in cells, back-navigation buttons |
| `table-metadata.js` | Collapsible «Tabellinfo» section (notes, source, contact, official-statistics status, Klass/VarDok links); shared by table-display and variable-select views | `buildMetadataSection(meta)` (defaults to `currentFullMetadata`), `setupMetadataToggle()`, `convertMarkdownLinks()` | AppState, BrowserState | Changing Tabellinfo content or toggle behaviour |
| `table-rotation.js` | Drag-and-drop pivot dialog (rows ↔ columns) | `openRotationDialog()` | currentData (table-display), AppState | Changing pivot UI or preset layouts |
| `export.js` | Export dialog: format/display options → triggers SSB API download | `showExportDialog()` | currentData, AppState, api | Adding export formats or options, changing default export settings |

## Common Tasks

| Task | Files to touch |
|------|---------------|
| Add a new search filter | `browser-state.js` (add field + URL sync), `search-view.js` (render + apply filter) |
| Add a topic filter | `browser-state.js` (add field + URL sync), `topic-view.js` (render + apply filter) |
| Add a new route / view | `router.js` (new `_handle*Route`), `utils.js` (`renderCurrentView` switch), new view file |
| Change the subject groupings | `menu-hierarchy.js` (`subjectGroups`, `subjectNames`) |
| Change search result display | `search-view.js` (`_searchPerformSearch`, `_searchGroupBySubject`) |
| Change topic table listing | `topic-view.js` (`_topicRenderTables`, `_topicRenderSubtree`) |
| Change how table list rows look | `browser-state.js` (`renderTableListHTML`) |
| Change dimension selection UI | `variable-select-render.js` (card/list HTML), `variable-select-events.js` (interactions), `variable-select-status.js` (counters/validation) |
| Change pivot/rotation behaviour | `table-rotation.js` |
| Change export options/formats | `export.js`, `config.js` (`export` defaults) |
| Change API request details | `api.js` |
| Change URL encoding for state | `router.js` (`encode`/`decode`), `utils.js` (`AppState._updateHash`) |
| Adjust caching behaviour | `config.js` (TTLs), `cache.js` (storage logic) |
| Change how numbers render in table | `table-display.js`, `utils.js` (`formatNumber`) |
| Change static SEO table pages (/table/{id}/) | `scripts/generate-seo-pages.mjs` (`buildTableContentHtml`, `buildEnrichedSections`, `enrichDatasetJsonLd`); local metadata files in `data/table-metadata/{id}.json` (contract in `data/table-metadata/README.md`, dir overridable with `--metadata-dir`) |
| Downloading/updating local table metadata | `scripts/update-table-metadata.mjs` |

## Reference Documentation

- [API-FINDINGS.md](API-FINDINGS.md) — discovered API behavior and corrections to spec. Add new API findings or knowledge here.
- [README.md](README.md) — feature list, system requirements, known limitations

- [SSB documentation for the API](https://data.ssb.no/api/pxwebapi/v2/index.html)
- [PXWebAPi 2 User guide](https://www.pxtools.net/PxWebApi/documentation/user-guide/) Describes how the PxWebApi works in general
