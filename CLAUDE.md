# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Statistikkportalen** is a vanilla JavaScript SPA (no build tools, no bundler, no package manager) providing an alternative interface to SSB's (Statistics Norway) data portal via PxWebApi v2. All code runs directly in the browser — open `index.html` to develop and refresh to see changes.

**Language:** Norwegian (UI, comments, variable names)

## Development

There are no build steps, tests, linters, or formatters. Development workflow:

1. Open `index.html` in a modern browser
2. Edit JS/CSS files
3. Refresh browser

**Debug mode:** Set `AppConfig.debug = true` in the browser console. Key globals: `window.AppState`, `window.BrowserState`, `window.api`, `window.clearCache()`.

## Architecture

### No Build Step (By Design)

Scripts load via `<script>` tags in `index.html` in strict dependency order. Breaking this order breaks the app. There is no module bundler — all modules share the global namespace.

### Three-Tier State

- **AppState** (`utils.js`) — Session state: current view, selected table, variable selection, table data/layout. Reset on navigation.
- **BrowserState** (`browser-state.js`) — Long-lived: menu hierarchy, all ~7000 tables, search filters. Lazy-loaded on first search/topic view.
- **Module-level variables** in `variable-select-state.js` — Shared across the six `variable-select-*.js` files via closure (tableMetadata, activeCodelists, dimensionValueOrder).

### View Dispatch

`renderCurrentView()` in `utils.js` dispatches on `AppState.currentView`:
- `'home'` → `renderFrontPage()`
- `'search'` → `renderSearchView()`
- `'topic'` → `renderTopicView()`
- `'variables'` → `renderVariableSelection()`
- `'table'` → `renderTableDisplay()`

### URL Routing

Hash-based routing with Base64-encoded state (URL-safe: `+`→`-`, `/`→`_`, `=`→`~`). All view state is bookmarkable. Router lives in `router.js`.

### Variable Selection Module (6 files)

The variable selection feature is split across six files sharing closure state:
- `variable-select-state.js` — Shared module-level variables
- `variable-select-status.js` — Validation, cell count
- `variable-select-codelists.js` — Codelist dropdown logic
- `variable-select-render.js` — UI rendering
- `variable-select-events.js` — Click/keyboard handlers
- `variable-select-api.js` — API query building, fetch

Entry point: `variable-select.js` → `renderVariableSelection()`

### API Integration (`api.js`)

- Wraps SSB [PxWebApi v2](https://github.com/PxTools/PxApiSpecs/blob/master/PxAPI-2.yml) at `https://data.ssb.no/api/pxwebapi/v2`
- Rate-limited: 100ms minimum between requests (SSB allows 30/min)
- Fetches `/config` on startup to get dynamic cell limits (`maxDataCells`) — falls back to hardcoded defaults if unavailable
- Error responses are parsed as RFC 7807 Problem Detail JSON for specific error messages; handles 400, 403 (cell limit exceeded), 404, and 429
- Hybrid caching: localStorage for small items, IndexedDB for large (≥1MB)
- TTLs: API config 24h, table list 24h, metadata/codelists 7 days, data queries never cached
- Cache staleness compared against SSB update schedule (05:00, 08:00, 11:30 Norwegian time)
- `pastDays` parameter on `getTables()` filters to recently updated tables server-side (used by front page)

### JSON-Stat2 Data Format

API returns flat value arrays. Cell lookup: `flatIndex = dim0_idx × (dim1_size × dim2_size) + dim1_idx × dim2_size + dim2_idx`

### Key Domain Concepts

- **Dimension:** Variable/category in a table (e.g., Kjønn, Region, Tid)
- **Codelist:** Alternative grouping of dimension values (detailed vs aggregated)
- **Elimination:** Optional dimensions that can be omitted; API aggregates across all values
- **Stub/Heading:** Row/column dimensions in table layout
- **Top(N):** Operator selecting last N time periods (e.g., `top(12)`)
- **`¬` character:** SSB uses this for hierarchy depth in labels (`¬ Boliger` = depth 1)
- **MenuHierarchy:** Tree structure with 6 hardcoded subject groups → subjects → topics → tables

### Configuration (`config.js`)

`AppConfig` contains all tunables: API URL, cache TTLs, cell limits (defaults overridden at startup by `/config` endpoint), UI debounce timings, export defaults, SSB update schedule.

## CSS

Plain CSS with CSS variables in `css/main.css`. Color palette uses `--color-*` variables with SSB-inspired colors. No preprocessor.
