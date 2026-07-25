# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A client-side web application for browsing and exporting statistical data exposed via PxWebApi v2. Pure vanilla JavaScript — no frameworks, no build tools, no npm dependencies.

The default instance browses Statistics Norway's (SSB) statistics bank and is called **Statistikkportalen**. As of **Statistikkportalen 2.0** (see [ROADMAP.md](ROADMAP.md)) it is a multi-source hub: alongside SSB it also integrates **Norges Bank** (interest rates, exchange rates, via SDMX) and **FHI** (Norwegian Institute of Public Health, native JSON-Stat2) through a source-adapter layer, so tables from all three appear side by side in the same topic tree and search.

The app is also designed to be re-pointed at other PxWebApi v2 instances (e.g. Sweden's SCB, "Statistikportalen") by swapping a few files — see `config-sv.js` / `subjects-sv.js` for a working example, and the "Multi-instance / re-skinning" section below.

**Language:** UI strings are translated via `js/translations.js` (`t()`/`tpl()`). Shipped instances use Norwegian Bokmål (`nb`) + English (`en`) for the SSB instance, or Swedish (`sv`) + English for the SCB instance — see `AppConfig.languages`. API response data itself (labels, variable names) comes back in whatever `lang=` was requested and is not translated client-side.

## Running the Application

Open `index.html` in a browser. No build step or server required.

This works over `file://` too, but only because every local data file the app needs is delivered as a `<script>` (a global), never via `fetch()` — browsers block `fetch()` of local files (`origin 'null'`, CORS). That's why the FHI catalogue ships as **both** `data/sources/fhi-catalog.js` (a `window.FhiCatalog` global, loaded from `index.html`) and `data/sources/fhi-catalog.json` (read from disk by the Node scripts) — and the Norges Bank periods likewise as `data/sources/nb-periods.js` (`window.NbPeriods`) + `.json`. **If you add another local data file the browser needs, give it the same treatment** — otherwise it silently fails over `file://` and the affected source degrades (FHI would fall back to internal code names like `D3a_flagg` with empty period columns; NB tables would show empty period columns).

### Startup is network-free for the foreign sources

`BrowserState.init()` waits for the whole catalogue aggregation, so anything an adapter fetches there blocks first paint. Both foreign sources therefore build their catalogue **entirely from checked-in build-time files** — zero HTTP requests on a cold load:

- **Norges Bank** — `data/sources/nb-periods.js` supplies the Tidsperiode/Sist oppdatert columns (previously one probe per catalogue row, 31 parallel requests per cold load). Fresh periods arrive when a table is actually opened: `getTableMetadata` probes the flow anyway and returns `extension.periods`, which `BrowserState.syncTablePeriodsFromMetadata()` writes back into the in-memory catalogue.
- **FHI** — `data/sources/fhi-catalog.js` supplies the table list, titles, periods, categories *and* the source info (`title`/`aboutUrl`/`publishedBy`), replacing `/Common/source` + one `/{source}/table` call per register (14 requests).

The live paths remain as fallbacks — a source missing from the baked file, or a forced refresh (`useCache: false`, i.e. the status panel's «Oppdater») — so newly published tables are still reachable without a rebuild. Whatever still goes out runs through the per-source request queue in `js/sources/source-common.js` (max `AppConfig.sources.maxConcurrentRequests` concurrent, identical in-flight GETs deduped). **Don't reintroduce a per-row or per-source fetch into an adapter's `getTables()`** — bake it instead.

## Testing & TDD

Tests live in `tests/` and run on Node's built-in test runner — **zero npm dependencies** (Node ≥ 20). See [tests/README.md](tests/README.md) for the harness details.

```bash
npm test                                        # whole suite
node --test tests/unit/search-enhanced.test.js  # one file (prefer this while iterating)
node --test --test-name-pattern="synonym" "tests/**/*.test.js"
```

The harness (`tests/helpers/app-env.js`) loads the unmodified `js/*.js` files into Node's global scope with browser shims, mirroring the `<script>`-tag load order — call `loadApp()` **once per test file**.

Workflow rules:

- **New pure-logic behaviour** (search scoring, SDMX conversion, hierarchy building, URL encoding, helpers): write the failing test FIRST, run it, confirm it fails for the right reason, then implement until green.
- **Changing existing logic**: run that module's tests in `tests/unit/` first — they define the current contract.
- **NEVER weaken, skip, or delete an existing test assertion to make it pass.** Fix the implementation, or stop and flag the conflict to the user.
- Mock only true I/O boundaries (`fetch`, storage — the harness already disables network). Never mock internal functions or pure collaborators just to isolate a unit.
- DOM-heavy view modules are exempt from unit-test-first: test extractable pure helpers, don't build elaborate DOM mocks.
- A change isn't done until `npm test` passes — run it before every commit and show the output as evidence.
- There is no linter or build system configured.

## Subagent Model Selection

When spawning subagents (via the `Agent`/`Task` tool) to work in this repo, pick the model to match the task's complexity rather than defaulting to the same model every time:

- **Sonnet — default for most work.** Code changes, multi-file investigation, writing or refactoring adapters/views, debugging, and any task that requires reading this file's architecture notes and applying judgement. Use Sonnet unless the task clearly falls into one of the tiers below.
- **Opus — escalate for high-stakes or architecturally significant work.** Cross-cutting refactors that touch the module load order or the source-adapter contract, non-trivial debugging with an unclear root cause, security-relevant changes, or planning/design work where getting the approach wrong is costly to unwind.
- **Haiku — acceptable only for small, mechanical, well-defined tasks.** Simple lookups, formatting/renaming, single-file grep-and-report summaries, or other tasks with no real judgement calls and an easily verifiable output.

Default to Sonnet when in doubt — it's the safe middle ground. Don't route a task to Haiku just to save cost if it involves multi-step reasoning or touches shared state (`AppState`, `BrowserState`, the source-adapter facade); a wrong or shallow subagent result there costs more to debug than the model savings are worth.

## Architecture

### Global State & Routing

- `js/utils.js` contains `AppState` — the central state object tracking the current view (`home`/`search`/`topic`/`variables`/`table`), selected table, variable selections, and topic navigation path. `renderCurrentView()` dispatches to the correct view renderer.
- `js/router.js` contains `URLRouter` — hash-based client-side routing. Routes: `#home`, `#search?q=...`, `#topic/be/be02`, `#variables/13760?v=...`, `#table/13760?v=...&l=...`, `#sq/{savedQueryId}` (opens a previously saved SSB query)
- `js/browser-state.js` contains `BrowserState` — shared state for browse views (table data aggregated across all sources, hierarchy, independent search/topic filters)
- `js/translations.js` holds the active UI language (`currentLanguage`, persisted in `localStorage`) and exposes `t()`/`tpl()`/`setLanguage()`/`getCurrentApiLang()`.
- `js/sources/source-registry.js` builds `window.api` as a facade over one or more source adapters (SSB / Norges Bank / FHI), routing calls by table-id prefix. Everything else in the app calls the same global `api` as before — the multi-source layer is transparent to callers.

### Module Load Order (Critical)

Scripts must load in this order in `index.html`:
1. `js/version.js` — `VERSION` constant (shown in footer; also used in cache-busting `?v=` query strings — bump both together)
1a. `js/sources/nb-catalog.js` — `window.NbCatalog` (Norges Bank dataflow catalogue + shared path/dim constants + per-flow search keywords). **Must load before `config.js`**, which references it.
1b. `js/sources/source-topology.js` — `window.SourceTopology` (foreign-source topic-tree nodes `sourceNodes` + FHI register list/placements). **Must load before `config.js`**, which references it.
2. `js/config.js` — AppConfig (API URL, source branding, languages, cache TTLs, limits, UI settings, source adapter wiring; `sources.nb.dataflows`/`variableNames`, `sources.fhi.sourceIds`/`paths` and `sourceNodes` are pulled in by reference from `NbCatalog`/`SourceTopology`), `logger`
3. `js/translations.js` — `t()`, `tpl()`, `setLanguage()`, `getCurrentApiLang()`; translation dictionary for all UI strings
4. `js/cache.js` — CacheManager (localStorage/IndexedDB wrapper with TTL)
5. `js/api.js` — SSBApi (depends on CacheManager)
5a. `data/sources/fhi-catalog.js` — `window.FhiCatalog` (autogenerated by `scripts/update-fhi-catalog.mjs`; FHI table list, titles, periods, categories, per-source `title`/`aboutUrl`/`publishedBy`). Loaded as a `<script>` so it also works over `file://`; `fhi-adapter.js` prefers the global and falls back to fetching the `.json` twin.
5b. `data/sources/nb-periods.js` — `window.NbPeriods` (autogenerated by `scripts/update-nb-periods.mjs`; per-`tableId` first/last period + `firstCode`/`lastCode` + `updated`). Same `file://` rationale; `norges-bank-adapter.js` reads it in `getTables()` and degrades to empty period columns if it's missing.
6. `js/sources/sdmx-to-jsonstat.js`, `source-common.js`, `norges-bank-adapter.js`, `fhi-adapter.js`, `ssb-adapter.js`, `source-registry.js` — source adapters + facade. Each adapter pushes itself onto `window.SourceAdapters`; `source-registry.js` loads last and replaces `window.api` with the multi-source facade (depends on `SSBApi`/`window.api` from api.js)
7. `js/utils.js` — AppState, renderCurrentView(), helpers (depends on `api`, AppConfig)
8. `js/router.js` — URLRouter, SSBURLMapper (depends on AppState)
9. `js/seo-head.js` — SEOHead: keeps canonical/og/meta-description/JSON-LD in sync with the route (depends on URLRouter)
10. `js/subjects.js` — SubjectConfig: subject groups + subject names (instance-specific; registers `subject.group.*`/`subject.name.*` keys into the translation dictionary)
11. `js/menu-hierarchy.js` — MenuHierarchy (builds the topic tree from the flat, cross-source table list; depends on SubjectConfig)
12. `js/browser-state.js` — BrowserState (depends on api, MenuHierarchy, URLRouter)
13. `js/menu-bar.js` — MenuBar shared component (depends on escapeHtml, URLRouter)
14. `js/front-page.js` — Front page view (depends on BrowserState, URLRouter)
15. `js/source-status.js` — SourceStatusUI: API-statusbadge i headeren + statuspanel med per-kilde retry/refresh (depends on api-fasaden, BrowserState, translations)
16. `js/synonyms.js` — SearchSynonyms: synonym groups for enhanced search (instance-specific)
17. `js/search-enhanced.js` — SearchEnhanced (uses SearchSynonyms; pure scoring/ranking, no side effects)
18. `js/search-view.js` — Search view (depends on BrowserState, SearchEnhanced, MenuBar, URLRouter)
19. `js/topic-view.js` — Topic navigation view (depends on BrowserState, MenuBar, URLRouter)
20. `js/variable-select-state.js` — Module state variables + `debouncedURLUpdate()`
21. `js/variable-select-status.js` — Visual updates, selection status, cell count, `getVariableSelection()`
22. `js/variable-select-codelists.js` — Codelist fetch/apply/restore + `setupCodelistDropdowns()`
23. `js/variable-select-render.js` — Dimension card rendering, value lists, `restoreSelections()`
24. `js/variable-select-events.js` — Click/keyboard/filter/mode button event wiring
25. `js/variable-select-api.js` — API query preview, API builder UI, `handleFetchData()`
26. `js/variable-select.js` — Main entry: `renderVariableSelection()` + `loadTableMetadata()`
27. `js/table-display.js` — Data fetch and table rendering; owns `currentData`/`currentFullMetadata` globals
28. `js/table-metadata.js` — Collapsible "Tabellinfo" section (depends on table-display)
29. `js/table-save-query.js` — Save/share query dialog (SSB-only; depends on table-display, api)
30. `js/table-rotation.js` — Drag-and-drop pivot (depends on table-display)
31. `js/export.js` — CSV/Excel export (depends on table-display)

### Views & Data Flow

1. **FrontPage** (`#home`) — landing page with search field + expanded subject grid
2. **SearchView** (`#search?q=...`) — search results with filters (independent from topic filters); standard substring search or "Smart søk" (enhanced, synonym-aware scoring via `SearchEnhanced`)
3. **TopicView** (`#topic/be/be02`) — hierarchical browse: cards → subcategories → table list with filters
4. **VariableSelect** (`#variables/13760`) → `api.getTableMetadata(tableId)` → user picks dimension values
5. **TableDisplay** (`#table/13760`) → `api.getTableData(tableId, valueCodes)` → renders HTML table
6. **TableRotation** / **Export** / **Save query** — operate on the already-fetched `AppState.currentData` (save-query is SSB-only)
7. **SavedQuery** (`#sq/{id}`) → fetches a previously saved SSB query and opens it directly in TableDisplay

`api` here is always the multi-source facade from `source-registry.js` — callers never talk to `SSBApi` (or the Norges Bank/FHI adapters) directly. All table data (SSB ~10,000 tables, plus the Norges Bank and FHI catalogues) is fetched once by `BrowserState.init()` and kept in memory. Search and browse are purely client-side.

### Multi-source architecture (Statistikkportalen 2.0)

- `js/sources/source-registry.js` defines the adapter contract (documented in full in that file's header comment) and builds the `window.api` facade every other module calls.
- Each adapter (`ssb-adapter.js`, `norges-bank-adapter.js`, `fhi-adapter.js`) registers itself onto `window.SourceAdapters` before `source-registry.js` loads, exposing `sourceId`, `capabilities`, `ownsTableId(id)`, and the same method surface as `SSBApi` (`getTableMetadata`, `getTableData`, `getTables`, etc.).
- Table-id prefixes decide ownership/routing: `nb-*` → Norges Bank, `fhi-*` → FHI, everything else → SSB (fallback). `getTables`/`getAllTables` aggregate all enabled sources with `Promise.allSettled` (one source failing doesn't break the catalogue); `getConfig` and the saved-query methods are SSB-only.
- Norges Bank's SDMX responses are converted to JSON-Stat2 by `js/sources/sdmx-to-jsonstat.js`; its catalogue rows come from config, and their time windows from the checked-in `data/sources/nb-periods.json` (built by `scripts/update-nb-periods.mjs`). FHI's API returns JSON-Stat2 natively but has no friendly title field, so `scripts/update-fhi-catalog.mjs` pre-builds `data/sources/fhi-catalog.json` (table list, titles, periods, descriptions, source info) at build time; `fhi-adapter.js` builds the whole catalogue from it and falls back to the live `/table` list + raw API titles for sources the file doesn't cover. Hand-curated display titles and per-register categories live in `data/sources/fhi-curation.json` and are merged into the catalogue on every regeneration (`scripts/lib/fhi-curation.mjs`) — curation survives rebuilds. Tables with a `category` get a third topic-path segment (register → category) built by `fhi-adapter.js`/`seo-sources.mjs`. At table-open time the adapter additionally fetches FHI's `/Table/{id}/metadata` and `/flag` (in parallel with `/dimension` + `/query`) to fill the Tabellinfo section, and returns the table's live first/last period as `extension.periods` — `BrowserState.syncTablePeriodsFromMetadata()` uses that to refresh the build-time catalogue in memory. FHI has **no** bulk endpoint for periods or metadata (verified against its OpenAPI spec): both cost one call per table, which is why the catalogue is pre-built.
- Sources are enabled/configured in `AppConfig.sources` (`ssb`/`nb`/`fhi`, each with `enabled: true/false`); foreign tables are placed in the topic tree via synthetic `paths[]` built from `AppConfig.sourceNodes`. Foreign tables can be placed under MULTIPLE topic paths (like SSB multi-folder tables): NB dataflows via `paths: [[subject, node], ...]` (legacy single `path` still works), FHI via `AppConfig.sources.fhi.paths[sourceId]`.
- **Per-source status & resilience:** the facade tracks catalogue status per source (`api.getSourceStatus()`, `api.onSourceStatusChange(cb)`, `api.reloadSource(id, {force})`) for full `getAllTables` aggregations. Adapters attach `sourceMeta { fromCache, stale, fetchedAt, partial? }` (never cached, never leaked to callers) and must throw when a source has NO data at all (FHI throws only when every sub-source fails). Stale-if-error: when a source's network fetch fails, an expired cached catalogue is served instead (marked stale); expired `tables_*` cache keys are retained for `AppConfig.cache.staleRetentionMs` (7 days) as fallback copies. The header badge + status panel (`js/source-status.js`) surface this and offer per-source retry/refresh via `BrowserState.reloadSource()` (merges one source's tables, invalidates the search index, rebuilds the hierarchy).
- See [ROADMAP.md](ROADMAP.md) for what's currently enabled vs. queued (additional Norges Bank dataflows, additional FHI sources, per-source update schedules, etc.).
- **SEO builder is multi-source too:** `scripts/generate-seo-pages.mjs` enumerates every enabled source in `AppConfig.sources` via per-source catalogue providers in `scripts/lib/seo-sources.mjs` (both network-free: NB from config + the checked-in `data/sources/nb-periods.json`, FHI from the checked-in `data/sources/fhi-catalog.json`), so `nb-*`/`fhi-*` tables get static `/table/{id}/` pages and appear in topic pages/sitemap/`seo-map.json`. Attribution (JSON-LD creator/license, «Kilde:» lines) resolves per table id via `AppConfig.sources.<key>.branding` with the global `AppConfig.source` as fallback — both in the generator and in `js/seo-head.js`. The `--min-tables` abort guard applies to SSB only; failing foreign sources are logged and skipped. See the "SEO pre-rendering pipeline" section in [ARCHITECTURE.md](ARCHITECTURE.md).
- **Asset paths in generated pages:** SEO pages live 1–4 directories deep, so the generator rewrites relative `css/`, `js/` **and `data/`** asset paths in `index.html` to absolute ones. Adding a new relatively-referenced asset to `index.html` means adding it to that rewrite too, or every pre-rendered subpage 404s on it.
- **Keep the SEO builder in sync:** the generator re-derives catalogue, hierarchy and page content from `config.js` (+ `nb-catalog.js`/`source-topology.js`, loaded into the same vm sandbox) / `subjects.js` and mirrors `topic-view.js`/`front-page.js`. When you change `AppConfig.sources`/`sourceNodes`/branding, the NB dataflow catalogue, subject groupings, `ui.topicCardDepth`, an adapter's catalogue entry shape, or the front page's layout/texts, review `scripts/generate-seo-pages.mjs` + `scripts/lib/seo-sources.mjs` — they may need the same change.

### API Integration

Default (SSB) base URL: `https://data.ssb.no/api/pxwebapi/v2`. Requests for `nb-*`/`fhi-*` table ids are routed by the facade to Norges Bank's SDMX API (`data.norges-bank.no`) or FHI's open API (`statistikk-data.fhi.no`) respectively — see `AppConfig.sources`.

SSB endpoints (used directly by `ssb-adapter.js`, cache TTLs from `AppConfig.cache`):
- `GET /tables?lang=no&query=...` — search/list tables (cached 24h)
- `GET /tables/{id}/metadata?lang=no` — dimension definitions in JSON-Stat2 (cached 7 days)
- `GET /tables/{id}/data?lang=no&valueCodes[Dim]=values` — actual data (not cached)
- `POST /savedqueries` / `GET /savedqueries/{id}` — save/open a shareable query (SSB-only)

Rate limit: 30 queries/minute, 800k cell limit per request (both overridden at runtime from `GET /config`). Data is CC BY 4.0.

### Caching

`CacheManager` in `cache.js` wraps localStorage with key prefix `ssb_`, TTL expiration, and automatic cleanup on app start. Foreign-source cache keys use an infix (`nb_`/`fhi_`) and skip the SSB update-schedule staleness check, using a plain 24h TTL instead. Cache failures are non-fatal. `window.clearCache()` is available from the console.

## Key Conventions

- All modules use ES6 classes or plain functions attached to the global scope (no ES modules/import)
- HTML is sanitized via `escapeHtml()` in utils.js before rendering user-facing API data
- All UI strings go through `t(key)` / `tpl(key, ...args)` (`translations.js`) — never hard-code a UI string or a source/brand name (SSB, SCB, ...) outside `AppConfig`/`subjects.js`
- Search input is debounced at 500ms
- Export uses semicolon-delimited CSV with UTF-8 BOM for Norwegian character support
- Console logging goes through `logger.*` (config.js), gated on `AppConfig.debug` — never call `console.*` directly

## Multi-instance / re-skinning

Pointing the app at a different PxWebApi v2 instance (or adding a language) touches only a few files:
- `config.js` — API URL, source branding, `languages`/`defaultLanguage`, source adapter wiring. `config-sv.js` is a working example for SCB (Sweden). The Norges Bank dataflow catalogue lives in `js/sources/nb-catalog.js` and the foreign-source topic-tree topology (`sourceNodes` + FHI placements) in `js/sources/source-topology.js`; both load before `config.js` and are referenced from it.
- `subjects.js` — subject grouping + names, per-language. `subjects-sv.js` is the SCB counterpart (also registers its labels into `translations.js` at load).
- `synonyms.js` — search synonym groups (instance/language-specific).

`scripts/generate-seo-pages.mjs` reads `config.js` via `node:vm` (in `loadAppConfig`) — and, in the same sandbox first, `js/sources/nb-catalog.js` + `js/sources/source-topology.js` so `config.js`'s references to `window.NbCatalog`/`window.SourceTopology` resolve — plus `subjects.js`. Keep all four compatible with the sandboxed (no-`translations`) execution path when editing them.

## File Guide

| File | Responsibility | Key exports | Depends on | Modify when… |
|------|---------------|-------------|------------|--------------|
| `version.js` | App version constant | `VERSION` | — | Bumping the version (update all `?v=` in `index.html` too) |
| `config.js` | All tunable constants for the default (SSB) instance; source adapter wiring/branding. The bulk of the foreign-source catalogue data lives in `nb-catalog.js`/`source-topology.js` and is pulled in by reference | `AppConfig`, `logger` | `NbCatalog`, `SourceTopology` (loaded first) | Changing API URL, cache TTLs, cell limits, debounce delays, export defaults, enabled sources, per-source SEO `branding` |
| `sources/nb-catalog.js` | Norges Bank dataflow catalogue (the 31 curated rows), shared path/dim constants (`GOVT_*`/`REGNET_*`), and per-flow search keywords. Loads before `config.js`, which exposes it as `AppConfig.sources.nb.dataflows`/`variableNames` | `window.NbCatalog` (`dataflows`, `variableNames`) | — | Adding/changing a Norges Bank dataflow row or its curation options (`slice`/`collapseDims`/`dropDims`/`dimOrder`/…), or the per-flow keyword lists |
| `sources/source-topology.js` | Foreign-source topic-tree topology: `sourceNodes` (NB/FHI synthetic nodes + SSB passthrough ids) and FHI's `sourceIds`/`paths`. Loads before `config.js`, which exposes them as `AppConfig.sourceNodes`/`sources.fhi.*` | `window.SourceTopology` (`sourceNodes`, `fhi`) | — | Adding/renaming a topic-tree node, changing FHI register list or placements |
| `config-sv.js` | Drop-in `config.js` replacement for the SCB (Sweden) instance | `AppConfig`, `logger` | — | Adjusting the SCB instance's settings |
| `translations.js` | i18n dictionary + language switching | `t()`, `tpl()`, `setLanguage()`, `getCurrentApiLang()`, `translations` | — | Adding/changing UI strings or languages |
| `cache.js` | Hybrid localStorage/IndexedDB cache with TTL | `CacheManager` | — | Changing cache storage strategy, size threshold (1 MB), or cleanup logic |
| `api.js` | SSB API wrapper; throttled fetch + caching | `SSBApi` | AppConfig, CacheManager | Adding/changing SSB API endpoints, request parameters, download behaviour |
| `sources/source-registry.js` | Multi-source facade: routes calls to the owning adapter, aggregates catalogues | `window.api`, `window.SourceRegistry` | api.js, all adapters | Changing routing rules, the adapter contract, or catalogue aggregation |
| `sources/ssb-adapter.js` | Thin adapter wrapping `SSBApi` as the fallback source | pushes onto `window.SourceAdapters` | api.js | Rarely — SSB behaviour lives in api.js |
| `sources/norges-bank-adapter.js` | Adapter for Norges Bank's SDMX REST API. `getTables()` is **network-free** (periods from `window.NbPeriods`, overridden by a fresh cache entry); `getTableMetadata` probes the flow and returns `extension.periods` so the catalogue is corrected on table open | pushes onto `window.SourceAdapters` | AppConfig.sources.nb, `data/sources/nb-periods.js`, sdmx-to-jsonstat.js | Enabling more dataflows, changing NB-specific query/key building, curating topic tables via `slice` |
| `sources/fhi-adapter.js` | Adapter for FHI's open statistics API (native JSON-Stat2). `getTables()` builds from `window.FhiCatalog` — **no network** unless a source is missing from the file or the caller forces a refresh. `buildMetadataCore` fetches `/dimension`, `/query`, `/metadata` and `/flag` **in parallel** — only `/dimension` is critical; the rest enrich `extension.*` and fail silently. The live `/{source}/table` lookup there is fallback-only (the catalogue entry supplies title/updated) | pushes onto `window.SourceAdapters` | AppConfig.sources.fhi, `data/sources/fhi-catalog.js`, `SourceCommon.htmlToPlainLines` | Enabling more FHI sources, changing role-detection heuristics, changing what Tabellinfo shows for FHI tables |
| `sources/sdmx-to-jsonstat.js` | Converts Norges Bank SDMX-JSON responses to JSON-Stat2; `orderDims` applies a config-curated display order (`dimOrder`) to metadata and data alike | `window.SdmxToJsonStat` | — | Fixing SDMX↔JSON-Stat2 conversion edge cases, changing dimension display order semantics |
| `sources/source-common.js` | Shared helpers used by multiple adapters (label lookup, HTML→plain-text lines for API-supplied prose, stripping period/updated tails from raw source titles) + the **request queue**: `fetchWithTimeout` caps concurrency per pool (`opts.queue`, one per source) and dedupes identical in-flight GETs. The timeout clock starts when a request leaves the queue | `window.SourceCommon` (`pickLabel`, `uiLabelLang`, `fetchWithTimeout`, `htmlToPlainLines`, `stripTitleMetadataTail`) | — | Adding another cross-adapter helper, changing the concurrency cap/dedupe or timeout/label-fallback behaviour, changing how source HTML or raw titles are cleaned for display |
| `scripts/lib/nb-periods.mjs` | Build-time probe for the Norges Bank catalogue's time windows (mirrors `fetchCataloguePeriod` in the adapter — keep the two in sync). Pure `probeTargets`/`parseProbeResponse` + a sequential, fault-tolerant `probeAll` | `probeTargets()`, `parseProbeResponse()`, `probeAll()` | — | Changing which probes run, the probe URL shape, or how a probe response is read |
| `utils.js` | Global state + shared helpers | `AppState`, `renderCurrentView()`, `escapeHtml()`, `debounce()`, `formatNumber()`, `showError()`, `addEscapeHandler()` | AppConfig, api, URLRouter | Changing AppState shape, adding global helpers, changing error display |
| `router.js` | Hash-based routing; encode/decode URL state | `URLRouter`, `SSBURLMapper` | AppState, BrowserState | Adding a new route, changing URL param encoding, handling legacy redirects |
| `seo-head.js` | Route-driven `<head>` sync: canonical, og:-tags, meta description (per-source attribution via `sources.*.branding`), removal of stale generator JSON-LD; lazy-loads `/seo-map.json` (fail-silent) | `SEOHead` | URLRouter, AppConfig, BrowserState | Changing canonical/meta behaviour on navigation, seo-map.json format, source attribution |
| `scripts/lib/seo-sources.mjs` | Per-source catalogue providers + attribution for the SEO builder (NB from config, FHI from `fhi-catalog.json`, `sourceBrandingFor`, `isoPeriod`) — the extension point for new sources | `buildNbCatalogue()`, `buildFhiCatalogue()`, `sourceBrandingFor()`, `isoPeriod()` | AppConfig (`sources`/`sourceNodes`), subjects.js | Adding a source to the SEO builder, adapter catalogue-shape changes |
| `scripts/lib/fhi-catalog-merge.mjs` | Incremental FHI catalogue refresh: picks the tables whose `modifiedAt` is newer than the catalogue's `generatedAt` (plus unknown ids), and merges freshly probed rows into the existing catalogue using the live table list as the authority on membership | `selectStaleTableIds()`, `mergeCatalogSource()` | — | Changing the staleness rule or the merge/removal semantics |
| `scripts/lib/fhi-curation.mjs` | Merges the hand-curated FHI file (`data/sources/fhi-curation.json`: display titles + register→category assignments) into the API-built catalogue; warns on orphaned ids/undefined categories | `applyCuration()` | — | Changing the curation file format or merge/warning rules |
| `subjects.js` | Subject group/name config for the default (SSB) instance; registers labels into `translations.js` | `SubjectConfig` | translations.js (optional) | Renaming/regrouping subjects |
| `subjects-sv.js` | Drop-in `subjects.js` replacement for the SCB (Sweden) instance | `SubjectConfig` | translations.js (optional) | Adjusting the SCB instance's subject grouping |
| `menu-hierarchy.js` | Builds subject→subtopic→table tree from the flat, cross-source table list | `MenuHierarchy` | SubjectConfig | Changing breadcrumb logic, changing table grouping (e.g. by base year) |
| `browser-state.js` | Shared state for browse views: aggregated table list, independent search/topic filters, shared render helpers | `BrowserState` | api, MenuHierarchy, SearchEnhanced, URLRouter, AppState | Adding/renaming filter fields, changing filter↔URL sync, changing table-list HTML, shared search input behaviour |
| `menu-bar.js` | Compact hover-dropdown subject-group menu bar (search + topic views) | `MenuBar` | escapeHtml, URLRouter | Changing menu bar layout or adding items to the navigation bar |
| `front-page.js` | Landing page: search input + expanded subject grid | `renderFrontPage()` | BrowserState, URLRouter | Changing front-page layout or adding widgets to the home view |
| `source-status.js` | API-statusbadge i headeren («3/3 API-er lastet inn», grønn/gul/rød) + statuspanel med per-kilde status, cache-info, retry/refresh, «Oppdater alle» og tøm cache per kilde | `SourceStatusUI` (`init()`, `refresh()`) | api-fasaden (`getSourceStatus`/`onSourceStatusChange`/`reloadSource`), BrowserState, translations | Changing badge/panel layout, colour semantics, or per-source actions |
| `synonyms.js` | Search synonym groups for enhanced search (instance-specific) | `SearchSynonyms` | — | Adding/removing synonym groups |
| `search-enhanced.js` | Beta search engine: multi-word AND matching, diacritic normalization, relevance ranking, synonym expansion | `SearchEnhanced` | SearchSynonyms | Changing search scoring/ranking logic |
| `search-view.js` | Search results: filters (subject, frequency, updated), live hit counts, grouped results, standard/enhanced toggle | `renderSearchView()` | BrowserState, SearchEnhanced, MenuBar, URLRouter | Adding/changing search filters, changing result grouping or display |
| `topic-view.js` | Hierarchical browse at all depth levels; recursive subtree renderer; breadcrumbs | `renderTopicView()` | BrowserState, MenuBar, URLRouter, AppState | Changing topic view layout, adding topic-level filters, changing how tables are listed under a topic |
| `variable-select.js` | Main entry: renders the view shell (HTML template), loads metadata, wires up the fetch button; renders the Tabellinfo section (via `buildMetadataSection`) after metadata load | `renderVariableSelection()`, `loadTableMetadata()` | All variable-select-* files, table-metadata.js | Changing the view layout/HTML template |
| `variable-select-state.js` | Module-level state variables shared across all variable-select files | `tableMetadata`, `activeCodelists`, `dimensionValueOrder`, `debouncedURLUpdate()` | AppState, URLRouter | Adding/renaming shared state variables |
| `variable-select-status.js` | Visual mode indicators, per-card value counters, selection status bar, cell count, `getVariableSelection()`, `validateSelection()`; cross-filter for validKeys sources (one-way for `role.metric` dims — measure selections never constrain filter dims) | `updateModeVisuals()`, `updateValueCounter()`, `updateSelectionStatus()`, `getVariableSelection()`, `validateSelection()`, `computeCrossFilterEnabled()` | AppState, AppConfig | Changing how selection state is reported, cell-count logic, validation rules, cross-filter semantics |
| `variable-select-codelists.js` | Codelist fetch/apply/restore; codelist dropdown events; `sortCodelistOptions()` | `setupCodelistDropdowns()`, `applyCodelistToValueList()`, `renderCodelistValues()`, `extractCodelistCodes()` | api, AppState | Changing codelist behaviour, how aggregated/filter codelists work |
| `variable-select-render.js` | Dimension card HTML generation; value list rendering with hierarchy/ordering; `restoreSelections()`; auto-select single-value dimensions; sectioned layout (filters vs. measures) for tables with `validKeys` + `role.metric` (NB) — single-value cards hidden behind an «Automatisk valgt»-info line | `displayVariables()`, `renderValueList()`, `restoreSelections()`, `parseHierarchyLabel()`, `sectionedDimensionLayout()` | AppState, api | Changing dimension card layout, value list ordering, selection restore logic, section grouping |
| `variable-select-events.js` | Event wiring: click/shift-click/ctrl-click on values, text filter, Ctrl+A, mode buttons (Alle/Velg alle/Opphev/Siste N) | `setupVariableEvents()`, `setupListSelectionEvents()`, `setupModeButtons()` | — | Adding new interaction modes or keyboard shortcuts |
| `variable-select-api.js` | Live API query preview URL; API builder section (format selectors, copy/open buttons); `handleFetchData()` | `updateQueryPreview()`, `setupApiBuilderEvents()`, `handleFetchData()` | AppState, AppConfig | Changing API builder options, URL construction, fetch flow |
| `table-display.js` | Fetches data and renders HTML table; owns `currentData`/`currentFullMetadata` globals used by rotation, export, and save-query | `renderTableDisplay()`, `loadTableData()` | AppState, URLRouter, api | Changing table rendering, number formatting in cells, back-navigation buttons |
| `table-metadata.js` | Collapsible «Tabellinfo» section (notes, source, publisher, contact, official-statistics status, «Om statistikken»-link, source-supplied `extension.sections`, symbol legend `extension.flags`, Klass/VarDok links); shared by table-display and variable-select views. Source-agnostic: every row is conditional, so a source that doesn't supply a field simply omits the row | `buildMetadataSection(meta)` (defaults to `currentFullMetadata`), `setupMetadataToggle()`, `convertMarkdownLinks()` | AppState, BrowserState, `t()` (`metadata.*` keys) | Changing Tabellinfo content or toggle behaviour |
| `table-save-query.js` | Save/share dialog: POSTs the current selection to `/savedqueries`, shows an SSB link and a `#sq/{id}` deep link | `showSaveQueryDialog()` | currentData, AppState, api (SSB-only) | Changing save-query behaviour or dialog content |
| `table-rotation.js` | Drag-and-drop pivot dialog (rows ↔ columns) | `openRotationDialog()` | currentData (table-display), AppState | Changing pivot UI or preset layouts |
| `export.js` | Export dialog: format/display options → triggers source API download | `showExportDialog()` | currentData, AppState, api | Adding export formats or options, changing default export settings |

## Common Tasks

| Task | Files to touch |
|------|---------------|
| Add or change tests | `tests/unit/{module}.test.js`; harness + fixtures documented in [tests/README.md](tests/README.md) |
| Add a new search filter | `browser-state.js` (add field + URL sync), `search-view.js` (render + apply filter) |
| Add a topic filter | `browser-state.js` (add field + URL sync), `topic-view.js` (render + apply filter) |
| Add a new route / view | `router.js` (new `_handle*Route`), `utils.js` (`renderCurrentView` switch), new view file |
| Change the subject groupings | `subjects.js` (`subjectGroups`, `subjectNames`) |
| Change search result display | `search-view.js` (`_searchPerformSearch`, `_searchGroupBySubject`) |
| Show/hide near-daily tables under «Nylig oppdatert» | `config.js` (`ui.recentUpdates`), `front-page.js` (`_isHighFrequencyTable`) |
| Change enhanced search scoring/synonyms | `search-enhanced.js` (scoring), `synonyms.js` (synonym groups) |
| Change topic table listing | `topic-view.js` (`_topicRenderTables`, `_topicRenderSubtree`) |
| Change how table list rows look | `browser-state.js` (`renderTableListHTML`) |
| Change dimension selection UI | `variable-select-render.js` (card/list HTML), `variable-select-events.js` (interactions), `variable-select-status.js` (counters/validation) |
| Change pivot/rotation behaviour | `table-rotation.js` |
| Change export options/formats | `export.js`, `config.js` (`export` defaults) |
| Change save/share query behaviour | `table-save-query.js` |
| Change SSB API request details | `api.js` |
| Add/change a curated Norges Bank topic table (`slice`) | `js/sources/nb-catalog.js` (`window.NbCatalog.dataflows`: `slice` + `probeKey` + `timeUnit`/`keywords`/`description`/`dimLabels`); several rows may share one `flow`. Worked examples: REGNET (six rows sliced on `REGNET_TOPIC`) and the statspapir tables (GOVT_PRIMARY_MARKET sliced on `ISSUE_TYPE`, GOVT_SECONDARY_MARKET on `UNIT_MEASURE` — both keeping the full table alongside, and combining `slice` with `collapseDims`). Use `dimOrder` when the DSD lists dimensions in an unhelpful order (display only — the API key keeps DSD order via `extension.fullDimId`). Logic in `norges-bank-adapter.js` (`applySlice`/`applyPinnedDims`) and `sdmx-to-jsonstat.js` (`orderDims`), tests in `tests/unit/nb-slice.test.js` and `tests/unit/sdmx-dim-order.test.js`. Bump the `_meta_vN_` cache key when the metadata shape changes |
| Enable more Norges Bank dataflows / FHI sources | `js/sources/nb-catalog.js` (`window.NbCatalog.dataflows`) / `js/sources/source-topology.js` (`window.SourceTopology.fhi.sourceIds` + `sourceNodes`), see [ROADMAP.md](ROADMAP.md); NB rows support `collapseDims: {anchor, dims, labelStyle?}` for characteristic dims functionally dependent on an anchor (`labelStyle`: `security` default, `suffix`, `prefix`); for FHI also curate titles/categories in `data/sources/fhi-curation.json` and rerun `scripts/update-fhi-catalog.mjs` |
| Clean up a Norges Bank table's dimensions | `js/sources/nb-catalog.js` row options (logic in `norges-bank-adapter.js`, tests in `tests/unit/nb-drop-dims.test.js`/`nb-dim-sort.test.js`/`nb-collapse-dims.test.js`): `dropDims: [dimId, …]` removes a duplicate-identity dim entirely (empty key segment = all values; e.g. FAUCTION.AUCTION_ID once the bid-deadline time axis identifies each auction); `dimSort: {dimId: 'asc'\|'desc'}` sorts a value list the API returns unordered (FORECAST_DATE); `intervalPicker: {granularity}` gives the from/til picker to the time dim in flows without a FREQ dimension. Bump the `_meta_vN_` cache key when the metadata shape changes |
| Change FHI table titles or categories | `data/sources/fhi-curation.json` (per-source `categories` + per-table `title`/`category`), then `node scripts/update-fhi-catalog.mjs`; merge logic in `scripts/lib/fhi-curation.mjs` |
| Add or change a source adapter | `js/sources/{source}-adapter.js`, contract documented in `js/sources/source-registry.js` |
| Change the API status badge / status panel | `source-status.js` (UI), `source-registry.js` (status tracking), `translations.js` (`apiStatus.*` keys) |
| Change the per-table source badge (NB/FHI) or the source filter | `config.js` (`sources.*.branding.shortName`/`nameFull`), `utils.js` (`sourceBadgeHTML`, `listEnabledSources`), `browser-state.js` (`renderTableListHTML`, `renderSourceFilterCheckboxes`, `calcSourceCounts`, `src` URL param), `css/menu-navigator.css` (`.source-badge`), plus the mirror `sourceBadgeHtml()` in `scripts/lib/seo-sources.mjs` |
| Place a foreign (NB/FHI) table under more topic paths | `js/sources/nb-catalog.js` (`dataflows[].paths`) / `js/sources/source-topology.js` (`fhi.paths` + `sourceNodes`; subjects must exist in `subjects.js`) |
| Add/change a UI string or language | `translations.js` (dictionary), `config.js` (`languages`/`defaultLanguage`) |
| Re-skin for another PxWebApi v2 instance | `config.js`, `subjects.js`, `synonyms.js` (see `config-sv.js`/`subjects-sv.js` for a worked example) |
| Change URL encoding for state | `router.js` (`encode`/`decode`), `utils.js` (`AppState._updateHash`) |
| Adjust caching behaviour | `config.js` (TTLs), `cache.js` (storage logic) |
| Change how numbers render in table | `table-display.js`, `utils.js` (`formatNumber`) |
| Change static SEO table pages (/table/{id}/) | `scripts/generate-seo-pages.mjs` (`buildTableContentHtml`, `buildEnrichedSections`, `enrichDatasetJsonLd`); local metadata files in `data/table-metadata/{id}.json` (contract in `data/table-metadata/README.md`, dir overridable with `--metadata-dir`; SSB-only — NB/FHI pages build from catalogue entries alone) |
| Add a new source to the SEO builder | `config.js` (`sources.<key>` with `branding`), provider in `scripts/lib/seo-sources.mjs`, dispatch in `enumerateAllTables()` (`generate-seo-pages.mjs`), tests in `tests/unit/seo-sources.test.js` |
| Downloading/updating local table metadata | `scripts/update-table-metadata.mjs` |
| Rebuilding the FHI catalogue (titles/periods) | `scripts/update-fhi-catalog.mjs` → writes **both** `data/sources/fhi-catalog.json` (Node tooling) and `data/sources/fhi-catalog.js` (`window.FhiCatalog`, loaded by `index.html`; the only variant that works over `file://`) — commit both (auto-merges `data/sources/fhi-curation.json`). Prefer `--incremental`: the per-source table list carries `modifiedAt`, so only new/changed tables are re-probed (~30 calls vs. ~740); merge logic in `scripts/lib/fhi-catalog-merge.mjs`. Run a full rebuild occasionally — `lastFullBuildAt` in the output records when that last happened. **The app builds its whole FHI catalogue from this file**, so a new FHI table only appears after a rerun (or a forced refresh in the status panel) |
| Rebuilding the Norges Bank periods | `node scripts/update-nb-periods.mjs` (~31 sequential probes, `--delay` between them) → writes **both** `data/sources/nb-periods.json` and `data/sources/nb-periods.js` (`window.NbPeriods`) — commit both. Weekly is plenty: this is display metadata for the table lists, and an opened table refreshes its own row. Probe logic in `scripts/lib/nb-periods.mjs`; aborts without touching the file if every probe fails |
| Change what Tabellinfo shows for a foreign source | The adapter fills `meta.extension.{sections,flags,aboutUrl,publishedBy,periods}` (see `fhi-adapter.js`); `table-metadata.js` renders whatever is present — deliberately source-agnostic, so NB can supply the same fields without touching the view |

## Reference Documentation

- [API-FINDINGS.md](API-FINDINGS.md) — discovered API behavior and corrections to spec. Add new API findings or knowledge here.
- [README.md](README.md) — feature list, system requirements, known limitations
- [ROADMAP.md](ROADMAP.md) — Statistikkportalen 2.0 multi-source status: what's enabled vs. queued for Norges Bank/FHI
- [ARCHITECTURE.md](ARCHITECTURE.md) — deep dive into state flow, caching, URL encoding, and the multi-source facade

- [SSB documentation for the API](https://data.ssb.no/api/pxwebapi/v2/index.html)
- [PXWebAPi 2 User guide](https://www.pxtools.net/PxWebApi/documentation/user-guide/) Describes how the PxWebApi works in general
