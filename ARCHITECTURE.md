# Architecture

Statistikkportalen is a single-page application built with vanilla JavaScript — an alternative interface for browsing and downloading statistics. No build step, no bundler, no package manager. All modules are loaded via `<script>` tags in `index.html` and communicate through global objects on `window`.

As of **Statistikkportalen 2.0** the app is a multi-source hub: a source-adapter layer (`js/sources/`) sits behind the SSB API client and lets additional PxWebApi-incompatible sources — currently **Norges Bank** (SDMX) and **FHI** (native JSON-Stat2) — plug into the same catalogue, topic tree and search as SSB. See "Multi-source architecture" below and [ROADMAP.md](ROADMAP.md) for what's enabled. The app fetches the full SSB table catalogue (~10 000 tables) plus the Norges Bank/FHI catalogues via `BrowserState.init()`, lets users search, browse by topic, select variables, and view/export data — all in the browser with aggressive local caching. `tests/` holds a CLI test suite on Node's built-in runner (`npm test`, zero npm dependencies — see `tests/README.md`); there is no linter or bundler.

The app is also designed to be re-pointed at other PxWebApi v2 instances (e.g. SCB, Sweden's statistics bank) by swapping `config.js`, `subjects.js` and `synonyms.js` — `config-sv.js`/`subjects-sv.js` are a working example of the SCB variant.

## Load order and dependencies

Scripts are loaded in this exact order (each depends on those above it):

```
version.js          — VERSION constant (displayed in footer; also used in cache-busting ?v= query strings)
config.js           — AppConfig, logger
translations.js     — t(), tpl(), setLanguage(), getCurrentApiLang(); translation dictionary for all UI strings
cache.js            — CacheManager (IndexedDBCache + localStorage hybrid)
api.js              — SSBApi (uses CacheManager, AppConfig)
sources/sdmx-to-jsonstat.js    ─┐
sources/norges-bank-adapter.js  │  Source adapters: each pushes itself onto
sources/fhi-adapter.js          │  window.SourceAdapters (uses AppConfig.sources.*)
sources/ssb-adapter.js          │  Thin wrapper around the SSBApi instance from api.js
sources/source-registry.js     ─┘  Loads LAST: consumes window.SourceAdapters and
                                    REPLACES window.api with the multi-source facade
utils.js            — AppState, renderCurrentView(), helpers, addEscapeHandler() (uses api = facade)
router.js           — URLRouter, SSBURLMapper (uses AppState, BrowserState, render*)
seo-head.js         — SEOHead: syncs canonical/og:-tags/meta description/JSON-LD with the route (uses URLRouter, AppConfig, BrowserState)
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
table-save-query.js — showSaveQueryDialog (uses currentData, AppState, api — SSB-only)
table-rotation.js   — openRotationDialog (uses AppState, re-calls displayData)
export.js           — showExportDialog, quickExportXlsx (uses api, AppState)
```

Everything from `utils.js` onward calls the global `api` object as if it were a single source — `window.api` is a mutable property, not a lexical `const`, so `source-registry.js` swapping it out after `api.js` has already run is transparent to every module that references `api` at call time (see the comment at the top of `sources/source-registry.js`).

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
allTables           — Full array of ~10 000+ table objects, aggregated across all enabled sources (SSB + Norges Bank + FHI)
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

## Multi-source architecture (Statistikkportalen 2.0)

```
window.api (facade, built by sources/source-registry.js)
├── ssb-adapter.js           — sourceId 'ssb', fallback owner of every table id
│     wraps the existing SSBApi instance from api.js 1:1
├── norges-bank-adapter.js   — sourceId 'nb', owns ids prefixed 'nb-'
│     SDMX REST (data.norges-bank.no) → sources/sdmx-to-jsonstat.js → JSON-Stat2
└── fhi-adapter.js           — sourceId 'fhi', owns ids prefixed 'fhi-'
      statistikk-data.fhi.no, JSON-Stat2 native; catalogue enriched from
      data/sources/fhi-catalog.json (pre-built, see scripts/update-fhi-catalog.mjs)
```

`sources/source-registry.js` documents the full adapter contract in its header comment. The key points:

- **Registration**: each adapter file pushes one adapter object onto `window.SourceAdapters` before `source-registry.js` runs. `source-registry.js` loads last among `js/sources/*.js` and consumes that list, then **replaces `window.api`** with the facade — so `ssb-adapter.js`'s adapter must exist and be pulled in first for the facade to have an SSB fallback.
- **Method surface**: every adapter implements the same async methods as `SSBApi` (`getTables`, `getTableMetadata`, `getTableData`, `getCodeList`, `downloadTableData`, `getDefaultSelection`, plus cache introspection). A method a source can't support must still exist — throw or return a degraded value — because the facade never checks before calling.
- **Routing by table id**: `getTableMetadata`, `getTableData`, `getCodeList`, `downloadTableData`, `getDefaultSelection` are routed to whichever adapter's `ownsTableId(id)` returns true. Foreign adapters (`nb`, `fhi`) are checked first; SSB is the fallback (`ownsTableId` always `true`), so unprefixed ids always land on SSB.
- **Catalogue aggregation**: `getTables`/`getAllTables` call every *enabled* adapter (per `AppConfig.sources.<id>.enabled`) via `Promise.allSettled` and concatenate the fulfilled results. A source that throws is logged with `logger.warn` and simply omitted — one source being down never breaks the rest of the portal. Server-side search (`options.query`) and "recently updated" (`options.pastDays`) are SSB-only semantics; foreign adapters return `[]` for those calls.
- **SSB-only methods**: `getConfig()` and the saved-query methods (`saveSavedQuery`, `getSavedQuery`, `getSavedQueryData`) always go straight to the SSB adapter — Norges Bank and FHI have no equivalent concept.
- **Shared cache**: `cleanupCache`/`clearCache`/`getCacheStats` delegate to the SSB adapter's underlying `CacheManager`, which all adapters actually share — foreign adapters just use different key infixes (`nb_`/`fhi_`) so `cache.js`'s SSB-update-schedule staleness check skips them in favor of a plain 24h TTL.
- **Catalogue entry shape**: foreign adapters synthesize a `paths[]` array (subject code + a node from `AppConfig.sourceNodes`) so their tables slot into the existing `menu-hierarchy.js` topic tree without any view-layer changes. `AppConfig.sources` (`ssb`/`nb`/`fhi`) holds each source's adapter name, `enabled` flag, and adapter-specific config (Norges Bank's `dataflows`, FHI's `sourceIds`). A foreign table can be placed under **multiple** topic paths (like SSB's multi-folder tables): NB dataflows accept `paths: [[subject, node], ...]` (legacy single `path` still works), FHI accepts a per-source override in `AppConfig.sources.fhi.paths` — `menu-hierarchy.js` already walks every entry in `paths[]` and deduplicates by table id when collecting/counting.
- **Failure isolation**: the `nb` adapter treats its own HTTP 404 as an empty result (not an error) since that's how SDMX APIs signal "no observations." FHI's API is different: there 404 means the resource genuinely doesn't exist (invalid queries are 400/422), so the `fhi` adapter correctly surfaces 404 as an error. A genuinely down foreign source is isolated by the `Promise.allSettled` aggregation above and never blocks SSB.
- **The catalogue costs zero requests at startup — normally not even the adapters' own `getTables()`.** `AppConfig.catalogIndex.enabled` (default on) makes `BrowserState._doInit()` load a prebuilt, per-source-sharded index from `data/index/` (`js/catalog-index.js`, built by `scripts/build-catalog-index.mjs`) instead of calling `api.getAllTables()` at all; a source without a usable shard is fetched directly (`onlySources`), so a partial index degrades per source, never for the whole app. Only when the index is unavailable entirely (missing manifest, or `location.protocol === 'file:'` — a documented degraded mode, see CLAUDE.md) does `_doInit()` fall back to the pre-index path: `api.getConfig()` + `api.getAllTables()`, which *does* call every adapter's `getTables()`. On that fallback path, Norges Bank fills its per-row time windows only from a fresh per-table cache entry (written by `fetchCataloguePeriod` the last time the table was opened — no baked file to fall back to further); FHI's `getTables()` builds its whole table list, titles, periods, categories and source info from `data/sources/fhi-catalog.json`, fetched once and memoized (`getCatalog()`), instead of calling `/Common/source` + `/{source}/table` per register (14 requests) — a source absent from that file, or `options.useCache === false` (the status panel's refresh), still falls further to the live per-source `/table` list. Freshness comes back on demand regardless of path: opening an NB table probes its flow anyway and returns `extension.periods`, which `BrowserState.syncTablePeriodsFromMetadata()` writes back into the in-memory catalogue (the same field FHI already used).
- **Request queue**: `SourceCommon.fetchWithTimeout` caps concurrency per pool (`opts.queue` — one per source, `AppConfig.sources.maxConcurrentRequests`, default 4) and collapses identical in-flight GETs into one request, handing each sharer a `clone()`. It is *not* a response cache: the entry is dropped as soon as the request settles. The timeout clock starts when a request leaves the queue, so a queued request can't expire before it runs. SSB is unaffected — it has its own throttle in `js/api.js`.

### Per-source catalogue status, stale-if-error and the API status badge

- **Status tracking**: for full `getAllTables` aggregations (not search/`pastDays` calls) the registry records per-source status — `{ sourceId, status: 'loading'|'ok'|'partial'|'error', tableCount, fromCache, stale, fetchedAt, lastAttemptAt, partial, error }` — exposed via `api.getSourceStatus()` / `api.onSourceStatusChange(cb)`. Adapters attach a `sourceMeta` object (`fromCache`/`stale`/`fetchedAt`/`partial`) to their catalogue result; the facade consumes it and never leaks it to callers, so `api.getAllTables()` still resolves to exactly `{ tables }`.
- **Contract sharpening**: a source with NO data at all must throw (FHI previously resolved `{tables:[]}` when every sub-source failed — it now throws, and reports partial outages via `sourceMeta.partial`). Catalogue methods honor `options.useCache === false` (cache bypass for manual refresh).
- **Stale-if-error**: when a source's network fetch fails and a cached catalogue exists — even an expired one — it is served instead, marked `stale`. `CacheManager.getEntry()` reads entries non-destructively (including expired/schedule-stale ones), and `cleanup()` retains expired `tables_*` keys for `AppConfig.cache.staleRetentionMs` (7 days) so the fallback copy survives the startup cleanup.
- **Per-source reload**: `api.reloadSource(id, {force})` re-fetches one source's catalogue; `BrowserState.reloadSource()` wraps it and merges the result into `allTables` (`mergeSourceTables` — ownership decided by `api.sourceFor(id)`), **invalidates `_searchIndex`**, and rebuilds the `MenuHierarchy`. If `BrowserState` never loaded (cold start with everything down), it re-runs `init()` instead.
- **UI**: `js/source-status.js` renders the header badge («3/3 API-er lastet inn»; green = all fresh, yellow = all loaded but ≥1 stale/partial/loading, red = ≥1 source without data) and the click-to-open status panel with per-source retry/refresh, "Refresh all" and per-source cache clear (`CacheManager.clearForSource`). After a reload it re-renders the browse views (`home`/`search`/`topic`) only.

Enabling more of either source (additional Norges Bank dataflows, additional FHI `sourceIds`) is pure configuration in `AppConfig.sources` plus a `sourceNodes` entry — see [ROADMAP.md](ROADMAP.md) for the current status and the list of what's queued but not yet turned on.

## SEO pre-rendering pipeline

The app is hash-routed (`#topic/...`), which is invisible to crawlers, so `scripts/generate-seo-pages.mjs` (run periodically via cron, see README) pre-renders static pages directly into the webroot:

```
enumerate     →  hierarchy   →  pages                    →  outputs
read+decode      buildHierarchy  topic pages (pretty URLs)   {webroot}/{slug}/index.html
catalog index    (duplicate of   + one page per table        {webroot}/table/{id}/index.html
                 MenuHierarchy)  (/table/{id}/)              sitemap.xml, robots.txt,
                                                             seo-map.json, root index.html
```

- **Enumeration reads the catalog index, it doesn't build it (P6)**: `enumerateAllTables()` reads `{webroot}/data/index/catalog-manifest.json` + per-source shards (built by `scripts/build-catalog-index.mjs`, which must have run against the same webroot first — see README for the cron ordering) and decodes them with `CatalogIndex.decode()` via `scripts/lib/seo-enumerate.mjs`. SSB is the hard guarantee: a missing/invalid manifest, a missing SSB shard, or fewer than `--min-tables` decoded SSB rows aborts the whole run without touching the webroot. A foreign source's shard that's missing or fails to decode is logged and skipped, mirroring the runtime facade's `Promise.allSettled` isolation. The row-building that feeds the index itself (SSB's live `/tables`, Norges Bank from `AppConfig.sources.nb.dataflows` + `sourceNodes` + the checked-in `data/sources/nb-periods.json`, FHI from the checked-in `data/sources/fhi-catalog.json`) lives in `scripts/lib/catalog-sources.mjs` + `scripts/lib/seo-sources.mjs`, and runs at `build-catalog-index.mjs` time, not here.
- **The providers re-derive, not import, adapter logic**: the adapters are browser-global scripts with fetch/cache dependencies, so `seo-sources.mjs` deliberately re-implements their config-/catalogue-derived entry building (same convention as the generator's `buildHierarchy` duplicate of `MenuHierarchy`). If an adapter's catalogue shape changes, the matching provider must be updated too, and the catalog index rebuilt before the SEO generator picks it up. The providers are unit-tested in `tests/unit/seo-sources.test.js`; the index-reading side in `tests/unit/seo-enumerate.test.js`.
- **Per-source attribution**: JSON-LD `creator`/`license`, «Kilde:» lines and meta descriptions resolve branding per table id via `sourceBrandingFor()` — `AppConfig.sources.<key>.branding` for `nb-*`/`fhi-*` ids, falling back to the global `AppConfig.source` (SSB). This is read directly from `config.js` at generation time, not baked into the index, so a branding change takes effect without rebuilding the index. Norges Bank's branding intentionally has no `licenseUrl` (their open data is free to use with attribution but not CC-labelled), so license links/fields are simply omitted for NB datasets. Topic pages mixing sources list every distinct source name in their description and carry no catalog-level license (each `Dataset` carries its own).
- **SSB-only enrichment**: the local-metadata pipeline (`scripts/update-table-metadata.mjs` → `data/table-metadata/{id}.json`) only covers SSB; foreign table pages are built from the catalogue entry alone (title, periods, variable names, description).
- **Runtime counterpart**: `js/seo-head.js` keeps `<head>` metadata in sync during client-side navigation, using the generated `seo-map.json` (topic hash-path → pretty URL, plus the set of table ids that actually have `/table/{id}/` pages — now including `nb-*`/`fhi-*`). Its table descriptions use the same per-id branding lookup (`SEOHead._brandingFor`).
- **Safety model**: the generator only ever deletes files it wrote itself (tracked in `{webroot}/.seo-manifest.json`), writes atomically, and aborts without touching the webroot on a missing/invalid catalog index or a suspiciously small SSB shard.

The generator no longer re-derives the catalogue (P6 — it reads the pre-built index instead), but still re-derives the hierarchy and view content from `config.js`/`subjects.js` and mirrors `topic-view.js`/`front-page.js`. Changes to `ui.topicCardDepth`, subject groupings or the front-page layout should prompt a review of the SEO builder directly; changes to `AppConfig.sourceNodes`, adapter catalogue shapes or a source's path placements need the catalog index rebuilt (`build-catalog-index.mjs`) before the SEO builder picks them up.

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
  → BrowserState.init()                        // Lazy, once per session:
     catalogIndex.enabled (default) →
        CatalogIndex.load()                    //   manifest + per-source shards from data/index/
        + api.getAllTables({ onlySources })    //   only for sources without a usable shard
     else (or index unavailable) →
        api.getConfig()                        //   server limits → AppConfig.limits.bySource.ssb (SSB-only)
        + api.getAllTables()                   //   full catalogue, aggregated across all enabled
                                                //   sources (SSB + Norges Bank + FHI)
  → _collectRecentUpdateGroups(mh, recentTables)
     → BrowserState.recentTables is always null — nothing populates it (no dedicated
       "recently updated" fetch exists) — so this always walks the full hierarchy tree,
       grouping by each table's `updated` field into "I dag" / "I går" / "Siste 7 dager"
  → Render: search input, 6-column subject grid, recently updated tables
```

### The user searches for "arbeidsledighet"

```
renderSearchView()
  → BrowserState.init()                    // Lazy: fetch full aggregated table list, build MenuHierarchy
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
           → Look up roleByDim from tableMetadata.role (time/geo/metric)
           → For each dimension in metadata:
              → renderDimensionCard()              // Title, role badge (Tid/Geografi/Statistikkvariabel),
                                                   // elimination badge, selection mode buttons, value list
                                                   // Time dimensions get a format hint as the filter placeholder
                                                   // (sampled from the latest period code, e.g. "Format: 2024M06")
              → setupCodelistDropdowns()           // If dimension has extension.codelists[]
              → restoreSelections()                // From AppState.variableSelection (URL state)
           → Wire events: click, shift-click, Ctrl+click, Ctrl+A, filter input, mode buttons
              // Mode buttons per dimension card:
              //   "Velg alle"   → star mode ("*"): API wildcard, all values including future ones
              //   "Opphev alle" → deselect all (specific mode, empty selection)
              //   "Siste N"     → top(N) mode (time dimensions only)
           → updateAllStatus()                     // Validate, show cell count, enable/disable "Hent data"
```

Two alternative card representations exist besides the value list, both gated on metadata (not source):

- **Interval time picker** (`dimension.extension.intervalPicker`, set by the Norges Bank adapter): the SDMX API is interval-based (`startPeriod`/`endPeriod`/`lastNObservations`), so the time card renders three mode pills — «Siste N» (default N=10, emits `top(N)`), «Fra–til» (emits the `range(from,to)` selection token → `startPeriod`/`endPeriod`), «Hele historikken» (emits `*`) — instead of a value list. The from/til inputs' granularity follows the selected frequency (`extension.timePeriodsByFreq`): B→`type=date`, M→`type=month`, Q→year+quarter select, A→year, with values converted/clamped on frequency change (`syncTimePicker` in variable-select-status.js, period math in `SdmxToJsonStat`). An inverted range (fra > til) blocks «Hent data».
- **Radio pills** (`dimension.extension.singleSelect` with ≤12 values, e.g. Norges Bank FREQ): rendered as an `.api-pill-group` radio row — mutual exclusivity is inherent in the control. A lone pill is auto-checked (so single-frequency NB tables are immediately fetchable together with the Siste-10 default).

### The user opens the API builder

The API builder panel is rendered inside the variable selection view by `variable-select-api.js`. It generates a live preview of the GET and POST URLs for the current selection, and is updated on every selection change.

The panel comes in two variants, gated on the owning source's capabilities (`api.capabilitiesFor(tableId)`):

- **SSB** (`supportsGetUrlBuilder`): the full builder described below, with method (GET/POST), output format, display, and separator options.
- **Norges Bank / FHI** (`supportsApiQuery`): a simplified builder. `updateQueryPreview()` delegates to `updateForeignQueryPreview()`, which calls the facade's synchronous `api.buildApiQuery(tableId, selection, { meta, lang })`. The owning adapter returns `{ method, url, body, metadataUrl }` describing **exactly** the request its own `getTableData` would send (the URL/body building is shared code inside the adapter): a GET URL against Norges Bank's SDMX API (`/data/{FLOW}/{key}?format=sdmx-json&...`), or FHI's POST endpoint plus the JSON body (`{dimensions:[...], response:{format:'json-stat2',...}}`). Copy/open buttons and the metadata URL section work as in the full panel; "open in browser" is disabled for FHI's POST-only data endpoint.

```
setupApiBuilder()
  → updateApiPreview()           // Called on every selection change
     → buildGetUrl()             // Constructs GET URL with valueCodes[Dim]=... params
        → Time dimension optimisation:
           1 period   → top(1)
           2 periods  → top(2)
           >2 periods → from(firstPeriod)   // forward-looking: always fetches from fixed start
        → codelist[Dim]=id appended whenever a codelist is active
        → outputValues[Dim]=aggregated appended for agg_* codelists
        → URL shown decoded (plaintext) by default
     → buildPostBody()           // Constructs JSON POST body for display
  → Format selector: JSON-stat2 | CSV | Excel | PX | HTML
     → On render, options not present in AppConfig.limits.dataFormats
       (populated from /config) are removed; the export dialog filters
       its radio group the same way
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
           → buildMetadataSection()        // table-metadata.js: collapsible panel (source, contact, notes,
                                          // "Om statistikken"-link built from paths[*][2].id kortnavn,
                                          // and Klass/VarDok links from link.describedby URNs)
           → buildHtmlTable()
              → buildDimensionCombinations(rowDims)    // Cartesian product of row values
              → buildDimensionCombinations(colDims)    // Cartesian product of column values
              → computeFlatIndexOffsets()              // per-row & per-col flat-index offsets, once
              → For each row × column:
                 → flatIndex = rowOffsets[r] + colOffsets[c]   // single addition per cell
                 → valueAtFlatIndex(flatIndex) → data.value[i]
                 → statusAtFlatIndex(flatIndex) → check data.status for suppressed values (".", ":", "..")
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
- **Foreign source catalogue/metadata** (`tables_nb_no`, `table_nb-IR_no`, `table_fhi-daar-344_no`, ...): same CacheManager, key infix `nb_`/`fhi_`; plain 24h TTL (the SSB-update-schedule staleness check below is skipped for these keys — see "Multi-source architecture")

### Keeping the cached index in step with the server

Cron rebuilds `data/index/` several times a day while the client's manifest lives on a 24h TTL revalidated only at SSB's two fixed times — so a tab left open overnight can browse a stale catalogue. `js/index-refresh.js` closes that gap. It owns nothing but the *trigger*: detection is `CatalogIndex.checkForUpdate()` (re-fetches the ~600 B manifest and diffs the content-hashed shard filenames), application is `BrowserState.applyIndex()`.

- **Triggers**: the tab becoming visible again, and `URLRouter.handleRoute()`. Deliberately no `setInterval`. All triggers share one throttle (`AppConfig.catalogIndex.autoCheckMs`, default 30 min), so request count is independent of how much the user clicks, and the run is scheduled through `requestIdleCallback` so navigation never waits on it. `IndexRefresh.init()` seeds the throttle with the load timestamp — page load has just fetched the manifest, so an immediate check would be a duplicate request on *every* load.
- **Silent by design**: the auto path swaps `BrowserState.allTables` and refreshes the status badge but **never** calls `renderCurrentView()` — rebuilding the list under the user's cursor would cost scroll position and focus for an update they didn't ask for. The next navigation renders from `allTables` anyway, so it shows fresh data for free. Only the status panel's «Se etter ny indeks» passes `render: true`, sharing the exact same path.
- **Gated to browse views** (`home`/`search`/`topic`): in `variables`/`table` the catalogue isn't on screen, and rebuilding the topic tree mid-route buys nothing.
- **Free recovery**: if the app booted on the fallback path (manifest was down), the first successful background check sees an empty `prevMeta`, reports every source as changed, and lifts the app back onto the index without a reload.

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

Every call from the app goes through `window.api`, the multi-source facade built by `sources/source-registry.js` (see "Multi-source architecture" above); this section covers the SSB leg specifically, which is the one implemented directly in `api.js`/`ssb-adapter.js` and used as the fallback for any table id without a foreign prefix. `SSBApi` (api.js) enforces 100ms minimum spacing between requests (SSB rate limit: 30/min). The API follows the [PxWebApi v2 spec](https://github.com/PxTools/PxApiSpecs/blob/master/PxAPI-2.yml). Norges Bank (SDMX REST, `data.norges-bank.no`) and FHI (JSON-Stat2-native, `statistikk-data.fhi.no`) have their own endpoint shapes, documented in the header comments of `sources/norges-bank-adapter.js` and `sources/fhi-adapter.js` respectively.

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

`api.getConfig()` fetches the `/config` endpoint and updates **`AppConfig.limits.bySource.ssb`** with the server's `maxDataCells` value (warning threshold = 75% of the max), so the cell limit adapts automatically if SSB changes theirs. If the call fails, the defaults in `config.js` are used. The call is lazy and SSB-only — see `ensureApiLimits()` in `variable-select.js`.

It writes only into SSB's slot, and deliberately so: **the 800 000 cell limit is an SSB rule, not a universal one.** Norges Bank and FHI have no cell limit at all (measured 2026-08-02, see the `api-ssb`/`api-norges-bank`/`api-fhi` skills). `AppConfig.limits.bySource` therefore holds one entry per source, read through `cellLimitsFor(tableId)` in `js/utils.js`:

- `maxCells` — **hard** limit; blocks the fetch button. Only SSB has one (403 on breach); `null` for NB/FHI means the button is never blocked on size.
- `warnCells` / `slowWarnCells` / `denseWarnCells` — **soft** thresholds that only colour the cell counter and add a warning. For Norges Bank the estimate is measured against *series × periods*, not the dense cross-product, because SDMX is sparse (GOVT_PRIMARY_MARKET: 5.2 trillion dense cells vs 11 264 actual observations).

The top-level `AppConfig.limits.maxCells`/`cellWarningThreshold` remain as the fallback for sources without an entry — which is what `config-sv.js` (no `sources` block) relies on.

### Two fetch timeouts for foreign sources

`AppConfig.sources` carries two deliberately different timeouts, and they must not be merged:

- **`fetchTimeoutMs` (15 s)** — catalogue and metadata calls. This protects first paint: `BrowserState` waits for the whole catalogue aggregation, so a hanging source must fail fast.
- **`dataFetchTimeoutMs` (90 s)** — `getTableData` only. A large extract is not a hanging source: FHI serves 2 million cells in 39 s and 6 million in 116 s. Under the short timeout, a 2-million-cell FHI table was unfetchable no matter what the user did.

Both adapters thread this through an optional third argument on their fetch helper (`fetchJson` in `fhi-adapter.js`, `fetchSdmx` in `norges-bank-adapter.js`); `tests/unit/fetch-timeout-split.test.js` guards the split.

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
    { "variableCode": "Alder", "valueCodes": ["005","1014"], "codelist": "agg_FemAarigGruppering", "outputValues": "aggregated" },
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
- **`agg_` (aggregation):** `valueCodes` contains the codelist's own aggregate codes (e.g. `"005"` for "0–4 år"). The API uses the `codelist` field to resolve these to underlying values and return grouped totals. Sending expanded original codes here would be wrong. `buildPostBody()` also adds `"outputValues": "aggregated"` for any `agg_*` codelist so the API returns the summed values rather than the underlying single values (critical for e.g. `agg_KommSummer` time-consistent municipality totals); the GET-URL preview emits the matching `outputValues[Dim]=aggregated` query parameter.

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

`buildHtmlTable()` (table-display.js) precomputes this per row and per column via
`computeFlatIndexOffsets()`, so each cell's flat index is a single addition
(`rowOffsets[r] + colOffsets[c]`) instead of recomputing the full weighting per cell.

The optional `status` field maps flat indices (as strings) to suppression codes (per SSB convention):
- `"."` — not applicable (ikke mulig å oppgi tall)
- `".."` — not available (tallgrunnlag mangler)
- `":"` — confidential (konfidensielt)

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
