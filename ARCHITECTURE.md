# Architecture

Statistikkportalen is a single-page application built with vanilla JavaScript — an alternative interface for browsing and downloading statistics from SSB (Statistics Norway). No build step, no bundler, no package manager. All modules are loaded via `<script>` tags in `index.html` and communicate through global objects on `window`.

The app fetches the full table catalogue (~7 000 tables) from SSB's PxWebApi v2, lets users search, browse by topic, select variables, and view/export data — all in the browser with aggressive local caching.

## Load order and dependencies

Scripts are loaded in this exact order (each depends on those above it):

```
version.js          — VERSION constant (displayed in footer)
config.js           — AppConfig, logger
translations.js     — t(), tpl(), setLanguage(), getCurrentApiLang(); translation dictionary for all UI strings
cache.js            — CacheManager (IndexedDBCache + localStorage hybrid)
api.js              — SSBApi (uses CacheManager, AppConfig)
utils.js            — AppState, renderCurrentView(), helpers, addEscapeHandler()
router.js           — URLRouter, SSBURLMapper (uses AppState, BrowserState, render*)
subjects.js         — SubjectConfig: subjectGroups + subjectNames (instance-specific, swapped per data source)
menu-hierarchy.js   — MenuHierarchy class (uses SubjectConfig)
browser-state.js    — BrowserState (uses api, MenuHierarchy, SearchEnhanced, AppState)
menu-bar.js         — Filter bar rendering (uses BrowserState)
front-page.js       — renderFrontPage (uses BrowserState, URLRouter)
synonyms.js         — SearchSynonyms: synonym groups for enhanced search (instance-specific)
search-enhanced.js  — SearchEnhanced (uses SearchSynonyms; pure scoring/ranking, no side effects)
search-view.js      — renderSearchView (uses BrowserState, SearchEnhanced, api)
topic-view.js       — renderTopicView (uses BrowserState, URLRouter)
variable-select-state.js     ─┐
variable-select-status.js     │
variable-select-codelists.js  │  All share module-level variables
variable-select-render.js     │  (tableMetadata, activeCodelists, etc.)
variable-select-events.js     │  defined in state.js
variable-select-api.js        │
variable-select.js           ─┘  Main entry: renderVariableSelection()
table-display.js    — renderTableDisplay, displayData, buildHtmlTable (uses api, AppState)
table-metadata.js   — buildMetadataSection (uses currentFullMetadata from table-display)
table-save-query.js — showSaveQueryDialog (uses currentData, AppState, api)
table-rotation.js   — openRotationDialog (uses AppState, re-calls displayData)
export.js           — showExportDialog, quickExportXlsx (uses api, AppState)
```

## Global state objects

There are three primary state holders. Understanding what lives where is critical:

### `AppState` (utils.js)

Current session state for the active view. Resets when the user navigates away from a table.

```
currentView         — 'home' | 'search' | 'topic' | 'variables' | 'table'
selectedTable       — { id, label } or null
variableSelection   — { DimCode: ["val1","val2"] | "*" | "top(N)", ... }
activeCodelistIds   — { DimCode: "codelistId", ... }
tableData           — Raw JSON-Stat2 response (set after fetch)
tableLayout         — { rows: ["Tid"], columns: ["Kjonn","Region"] }
topicPath           — ["be","be02"] (current topic navigation)
navigationRef       — "topic/be/be02?disc=0" (for "back" button and breadcrumbs)
```

### `BrowserState` (browser-state.js)

Long-lived browsing state. Initialized once (lazy, on first use) and persists across views.

```
menuHierarchy       — MenuHierarchy instance (tree of subjects → topics → tables)
allTables           — Full array of ~7000+ table objects from API
recentTables        — Tables updated in the last 7 days (from pastDays=7 API call, used by front page)
isLoaded            — Whether init() has completed
searchFilters       — { query, includeDiscontinued, subjectFilter, frequencyFilter, updatedFilter, enhanced }
topicFilters        — { includeDiscontinued, frequencyFilter, updatedFilter }
_searchIndex        — Lazily built normalized index for enhanced search
```

### Module-level variables in variable-select-state.js

Shared across all six `variable-select-*.js` files via closure over global scope:

```
tableMetadata       — Full JSON-Stat2 metadata for current table
activeCodelists     — { DimCode: { codelistId, values, elimination, ... } }
dimensionValueOrder — { DimCode: ["code1","code2",...] } (ordering from first codelist)
lastClickedIndex    — { DimCode: N } (for shift-click range selection)
```

### Module-level variables in table-display.js

Shared across the four table display files (`table-display.js`, `table-metadata.js`, `table-save-query.js`, `table-rotation.js`):

```
currentData         — Raw JSON-Stat2 data response (the flat value array and dimensions)
currentFullMetadata — Full metadata for the current table (source, notes, contacts, etc.)
```

## What happens when...

### The user opens the app

```
DOMContentLoaded
  → api.cleanupCache()           // Remove expired localStorage/IndexedDB entries
  → URLRouter.handleRoute()      // Parse hash, dispatch to view
     or renderCurrentView()      // Default: home
```

### The front page loads

```
renderFrontPage()
  → BrowserState.init()                        // Lazy: fetches three things in parallel:
     1. Full table list (~7000 tables)          //   for subject grid and search
     2. api.getConfig()                         //   server limits → AppConfig.limits.maxCells
     3. api.getTables({ pastDays: 7 })          //   recently updated tables (small response)
  → _collectRecentUpdateGroups(mh, recentTables)
     → Uses pre-fetched recentTables when available (avoids scanning all 7000 tables)
     → Groups by topic node path from each table's paths[] field
     → Buckets: "I dag", "I går"/"Forrige virkedag", "Siste 7 dager"
     → Falls back to walking the full hierarchy tree if pastDays call failed
  → Render: search input, 6-column subject grid, recently updated tables
```

### The user searches for "arbeidsledighet"

```
renderSearchView()
  → BrowserState.init()                    // Lazy: fetch all ~7000 tables, build MenuHierarchy
  → _handleSearchInput()                   // Debounced (500ms)
     → BrowserState.filterTables()         // Client-side: filter allTables by query + filters
        → If enhanced: SearchEnhanced.buildIndex() (once), then filterAndRank()
           → _expandTokens() adds synonyms: "arbeidsledighet" → also tries "ledige", etc.
           → _scoreEntry() ranks: title match (30) > ID (15) > variable (10) > path (8)
        → If standard: simple substring match on label, id, variableNames
     → _renderSearchResults()              // Show client results immediately
     → If enhanced or 0 results:
        → api.getTables({ query })         // Server-side search (searches VALUES not in local list)
        → Merge server extras with client results, re-render
        → If still 0: buildFuzzyQuery() → retry with ~1 (Lucene edit-distance)
```

### The user selects a table (e.g. table 09772)

```
BrowserState.selectTable("09772")
  → Captures navigationRef ("topic/be/be02" or "search?q=...")
  → sessionStorage.setItem('ssb_navRef', ...)    // Survives page refresh
  → AppState.setSelectedTable(table)
  → AppState.setView('variables')
     → renderVariableSelection()
        → buildNavigationBreadcrumb()             // Show topic path leading to this table
        → api.getTableMetadata("09772")           // Cached 7 days
        → displayVariables()
           → For each dimension in metadata:
              → renderDimensionCard()              // Title, selection mode buttons, value list
              → setupCodelistDropdowns()           // If dimension has extension.codelists[]
              → restoreSelections()                // From AppState.variableSelection (URL state)
           → Wire events: click, shift-click, Ctrl+click, Ctrl+A, filter input, mode buttons
              // Mode buttons per dimension card:
              //   "Velg alle"   → star mode ("*"): API wildcard, all values including future ones
              //   "Opphev alle" → deselect all (specific mode, empty selection)
              //   "Siste N"     → top(N) mode (time dimensions only)
           → updateAllStatus()                     // Validate, show cell count, enable/disable "Hent data"
```

### The user opens the API builder

The API builder panel is rendered inside the variable selection view by `variable-select-api.js`. It generates a live preview of the GET and POST URLs for the current selection, and is updated on every selection change.

```
setupApiBuilder()
  → updateApiPreview()           // Called on every selection change
     → buildGetUrl()             // Constructs GET URL with valueCodes[Dim]=... params
        → Time dimension optimisation:
           1 period   → top(1)
           2 periods  → top(2)
           >2 periods → from(firstPeriod)   // forward-looking: always fetches from fixed start
        → codelist[Dim]=id appended for agg_ codelists
        → URL shown decoded (plaintext) by default
     → buildPostBody()           // Constructs JSON POST body for display
  → Format selector: JSON-stat2 | CSV | Excel | PX | HTML
  → "Kopier URL" button  → copies GET URL to clipboard
  → "Kopier POST-body" button → copies JSON POST body to clipboard
```

### The user clicks "Hent data"

```
handleFetchData()
  → getVariableSelection()                 // Read DOM state → { Dim: [codes] | "*" | "top(N)" }
     // Codelist handling in getVariableSelection():
     //   vs_ (filter) codelist active  → expand via valueMap (no-op: valueMap[0] === code)
     //   agg_ (aggregation) codelist active → keep aggregate codes as-is;
     //                                         API resolves them via codelist ID in POST body
  → AppState.variableSelection = selection
  → AppState.setView('table')
     → renderTableDisplay()
        → buildNavigationBreadcrumb()      // Show topic path as breadcrumb
        → api.getTableData("09772", selection, "no", codelistIds)   // POST, never cached
        → determineDefaultLayout(data)     // Time dim → rows, others → columns
        → displayData()
           → buildMetadataSection()        // table-metadata.js: collapsible panel (source, contact, notes)
           → buildHtmlTable()
              → buildDimensionCombinations(rowDims)    // Cartesian product of row values
              → buildDimensionCombinations(colDims)    // Cartesian product of column values
              → For each row × column:
                 → getDataValue() → calculateFlatIndex() → data.value[i]
                 → getDataStatus() → check data.status for suppressed values (".", ":", "..")
           → Wire: rotate button, export buttons, save query button
```

### The user rotates the table

```
openRotationDialog()                       // table-rotation.js
  → Drag-and-drop UI: move dimension chips between "Rader" and "Kolonner"
  → Preset buttons for common layouts (e.g. time as rows)
  → On apply:
     → AppState.tableLayout = { rows: [...], columns: [...] }
     → AppState._updateHash('table')       // Encode new layout into URL
     → displayData()                       // Re-render table with new layout
  → Escape key closes dialog (via addEscapeHandler)
```

### The user saves/shares a query

```
showSaveQueryDialog()                      // table-save-query.js
  → Fingerprint current selection (tableId + variables + codelists + layout)
  → If same fingerprint as last save → reuse cached query ID
  → Otherwise: POST to /savedqueries with selection + placement
  → Display dialog with two shareable links:
     → SSB link: https://data.ssb.no/api/pxwebapi/v2/savedqueries/{id}
     → Statistikkportalen link: #sq/{id}
  → Escape key closes dialog (via addEscapeHandler)
```

### The user exports data

```
quickExportXlsx()                          // One-click Excel download
  → api.downloadTableData(tableId, selection, { format: 'xlsx', stub, heading })
     → POST to /tables/{id}/data?outputFormat=xlsx
     → Response as blob → create <a download> → trigger click → cleanup

showExportDialog()                         // Full options dialog
  → User picks format, display format, separator, layout
  → executeExport()                        // Same API call with chosen options
  → Escape key closes dialog (via addEscapeHandler)
```

## Caching architecture

```
CacheManager (cache.js)
├── localStorage     — Items < 1MB (fast, synchronous read)
│   └── Key format: ssb_{cacheKey}
│       Value: JSON { value, expires, stored }
│
├── IndexedDB        — Items ≥ 1MB (table list is ~2-4MB)
│   └── Database: ssb_cache, Store: cache
│       + localStorage ref: ssb_{key}_ref → { storage: 'indexeddb', size }
│
└── Staleness check  — _isStaleBySSBSchedule(storedTimestamp)
    └── Compares stored timestamp against last SSB update
        SSB updates at 05:00, 08:00, 11:30 Norwegian time daily
        If stored before last update → stale → evict
```

What gets cached:

- **API config** (`api_config`): 24h TTL, ~1KB → localStorage
- **Table list** (`tables_no_true_10000`): 24h TTL, ~2-4MB → IndexedDB
- **Recent tables** (`tables_no_true_10000_pd_7`): 24h TTL, small → localStorage
- **Table metadata** (`table_{id}_no`): 7 day TTL, ~5-50KB → localStorage
- **Codelists** (`codelist_{id}_no`): 7 day TTL, ~1-20KB → localStorage
- **Query results**: Never cached (each user query is unique)
- **Server search results** (`tables_no_true_10000_q_{query}`): 24h TTL

## URL state encoding

All view state is encoded into the URL hash so any view can be bookmarked and shared.

```
#home
#search?q=bnp&disc=0&subj=nk&freq=Quarterly&upd=30&enh=1
#topic/be/be02?disc=0&freq=Monthly
#variables/09772?v={base64}&c={base64}
#table/09772?v={base64}&c={base64}&l={base64}
#sq/30116027
```

The `v`, `c`, and `l` parameters are JSON objects encoded as URL-safe Base64:

- Standard Base64, then `+`→`-`, `/`→`_`, `=`→`~`
- `v` = variableSelection: `{ "Kjonn": ["1","2"], "Tid": "top(5)" }`
- `c` = activeCodelistIds: `{ "Region": "vs_RegionKommune" }`
- `l` = tableLayout: `{ "rows": ["Tid"], "columns": ["Kjonn","Region"] }`

## SSB API integration

All API calls go through `SSBApi` (api.js) which enforces 100ms minimum spacing between requests (SSB rate limit: 30/min). The API follows the [PxWebApi v2 spec](https://github.com/PxTools/PxApiSpecs/blob/master/PxAPI-2.yml).

```
GET  /config                          — API limits and capabilities (cached 24h)
GET  /tables?lang=no&pageSize=10000&includeDiscontinued=true[&query=...][&pastDays=7]
GET  /tables/{id}/metadata?lang=no
GET  /tables/{id}/data?lang=no&valueCodes[Dim]=codes[&codelist[Dim]=id][&outputFormat=...]
POST /tables/{id}/data?lang=no[&outputFormat=xlsx&outputFormatParams=...]
GET  /codeLists/{id}?lang=no
POST /savedqueries                    — Create saved query
GET  /savedqueries/{id}               — Fetch saved query
```

### Dynamic configuration

On startup, `api.getConfig()` fetches the `/config` endpoint and updates `AppConfig.limits.maxCells` with the server's `maxDataCells` value. This means the cell limit in the variable selection view adapts automatically if SSB changes their limits. The warning threshold is set to 75% of the max. If the `/config` call fails, the hardcoded defaults in `config.js` are used.

### Error handling

All API methods use `_handleErrorResponse()` which parses RFC 7807 Problem Detail responses. SSB returns structured JSON errors with a `detail` field containing specific messages (e.g. "Value, xxx is not a valid value code for variable yyy"). Status codes handled:

- **400** — Bad request (invalid value codes, malformed query). Shows the `detail` message.
- **403** — Forbidden (query exceeds cell limit). Shows `t('error.cellLimit')` (falls back to API `detail` if present).
- **404** — Not found (table/codelist doesn't exist). Shows the `detail` message.
- **429** — Rate limited. Shows `t('error.rateLimit')`.

### POST body for data requests

```json
{
  "selection": [
    { "variableCode": "Kjonn", "valueCodes": ["1","2"], "codelist": "vs_Kjonn" },
    { "variableCode": "Alder", "valueCodes": ["005","1014"], "codelist": "agg_FemAarigGruppering" },
    { "variableCode": "Tid", "valueCodes": ["top(5)"] }
  ],
  "placement": {
    "heading": ["Kjonn"],
    "stub": ["Tid"]
  }
}
```

Dimensions omitted from `selection` are "eliminated" — the API aggregates across all values. Only dimensions with `extension.elimination=true` in metadata can be omitted.

**Codelist types and how they affect `valueCodes`:**

- **`vs_` (valueset/filter):** `valueCodes` contains original dimension codes. The codelist restricts which codes are valid; `valueMap` is a no-op (`valueMap[0] === code`).
- **`agg_` (aggregation):** `valueCodes` contains the codelist's own aggregate codes (e.g. `"005"` for "0–4 år"). The API uses the `codelist` field to resolve these to underlying values and return grouped totals. Sending expanded original codes here would be wrong.

## JSON-Stat2 response format

The API returns data in JSON-Stat2 format. Key structure:

```json
{
  "id": ["Region", "Kjonn", "Tid"],
  "size": [3, 2, 5],
  "dimension": {
    "Region": {
      "label": "region",
      "category": {
        "index": { "0301": 0, "1103": 1, "4601": 2 },
        "label": { "0301": "Oslo", "1103": "Stavanger", "4601": "Bergen" }
      }
    }
  },
  "value": [1234, 5678, ...],
  "status": { "7": ".", "15": ":" }
}
```

Values are stored in a flat array. To look up a specific cell:

```
flatIndex = Region_index × (size_Kjonn × size_Tid)
          + Kjonn_index × size_Tid
          + Tid_index
```

This is implemented in `calculateFlatIndex()` (table-display.js).

The optional `status` field maps flat indices (as strings) to suppression codes:
- `"."` — value not available
- `":"` — confidential
- `".."` — not applicable

When a status code is present for a cell, the UI shows the symbol instead of a number and adds a tooltip with the Norwegian explanation.

## Dimension hierarchy in value labels

SSB uses the `¬` character to encode depth in value labels:

- `"Bygg og anlegg"` — depth 0
- `"¬ Boliger"` — depth 1 (child of above)
- `"¬¬ Eneboliger"` — depth 2

The UI strips these and converts to `padding-left` for visual indentation.

## Search architecture

Two search paths, selectable via "Smart søk (beta)" checkbox:

**Standard search** — Pure client-side substring matching:

```
query.toLowerCase() → match against table.label, table.id, table.variableNames
```

**Enhanced search** — Client-side scoring + server-side augmentation:

1. Build normalized index (once, cached on `BrowserState._searchIndex`)
2. Expand tokens via synonym groups (e.g. "bnp" → also try "bruttonasjonalprodukt")
3. Score each table: title start (30) > title contains (20) > ID (15) > variable (10) > path (8)
4. AND logic: every token must match somewhere
5. Server augmentation: API search finds tables by VALUE matches not in local list
6. Fuzzy fallback: if 0 results, retry with Lucene `~1` edit-distance

## Internationalisation (i18n)

`translations.js` is a self-contained i18n module loaded immediately after `config.js`. It manages all UI strings and the active language.

**Public API:**

- **`t(key)`** — returns the translation string for `key` in the current language, falling back to `nb`
- **`tpl(key, ...args)`** — same as `t()`, but replaces `{0}`, `{1}`, … placeholders with positional `args`
- **`setLanguage(code)`** — switches the active language and persists the choice to `localStorage`
- **`getCurrentApiLang()`** — returns the `apiLang` value for the active language (sent as `lang=` to the API)

**Language codes:** UI codes (`'nb'`, `'en'`) are distinct from API codes (`'no'`, `'en'`). The mapping lives in `AppConfig.languages`.

**Language selector:** If `AppConfig.languages` contains more than one entry, `index.html` renders language toggle buttons inside `#header-lang`. Clicking a button calls `setLanguage()` then `applyTranslatableUI()` (an inline function in `index.html`) which re-applies all static UI strings (tagline, footer labels, cache-clear link) without a full re-render.

**Instance-specific strings** (app name, source name, URLs) are in `AppConfig`, not in the translation dictionary, so the same `translations.js` works across different deployments.

## Stylesheets

CSS is split into three plain files (no preprocessor):

- **`css/main.css`** — Global layout, typography, CSS variables (`--color-*`, `--spacing-*`, `--border-radius`), header, footer, buttons, forms, and shared component styles.
- **`css/table.css`** — Styles specific to the data table display view: table container, controls bar, frozen headers, cell formatting, status symbols.
- **`css/menu-navigator.css`** — Styles for the front page, search view, topic browser, and navigation elements (subject grid, breadcrumbs, filter bar, search input, table list cards).

All three are loaded unconditionally via `<link>` tags in `index.html`.

## Shared utilities

`utils.js` provides several helpers used across views:

- **`addEscapeHandler(closeFn)`** — Registers a one-shot Escape key listener that closes a dialog. Returns a cleanup function. Used by the rotation dialog, export dialog, and save-query dialog.
- **`buildNavigationBreadcrumb(tableId, tableLabel)`** — Builds breadcrumb HTML from the topic path that led to the current table. Uses `AppState.navigationRef` (from topic navigation) or falls back to the table's first known path in the menu hierarchy.
- **`escapeHtml(text)`** — HTML-escapes user-supplied strings.
- **`formatNumber(value, decimals)`** — Formats numbers with Norwegian locale (space as thousands separator, comma as decimal).
- **`updatePageTitle(parts)`** — Sets the browser tab title dynamically per view.
