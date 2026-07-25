# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A client-side web application for browsing and exporting statistical data exposed via PxWebApi v2. Pure vanilla JavaScript — no frameworks, no build tools, no npm dependencies.

The default instance browses Statistics Norway's (SSB) statistics bank and is called **Statistikkportalen**. As of **Statistikkportalen 2.0** (see [ROADMAP.md](ROADMAP.md)) it is a multi-source hub: alongside SSB it also integrates **Norges Bank** (interest rates, exchange rates, via SDMX) and **FHI** (Norwegian Institute of Public Health, native JSON-Stat2) through a source-adapter layer, so tables from all three appear side by side in the same topic tree and search.

The app is also designed to be re-pointed at other PxWebApi v2 instances (e.g. Sweden's SCB, "Statistikportalen") by swapping a few files — see `config-sv.js` / `subjects-sv.js` for a working example, and the "Multi-instance / re-skinning" section of the `repo-map` skill.

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
- **`npm run coverage` enforces that new logic gets tested.** It compares per-file function coverage against `tests/coverage-baseline.json` and fails when a file gains uncovered functions. When it fires, write the test — don't run `npm run coverage:baseline`. That command is only for deliberate drops (e.g. new DOM-heavy view code that per `tests/README.md` isn't unit-tested), and using it must be reported to the user.
- Mock only true I/O boundaries (`fetch`, storage — the harness already disables network). Never mock internal functions or pure collaborators just to isolate a unit.
- DOM-heavy view modules are exempt from unit-test-first: test extractable pure helpers, don't build elaborate DOM mocks — cover them with the E2E smoke suite instead (below).
- A change isn't done until `npm run verify` passes — run it before every commit and show the output as evidence.
- There is no linter or build system configured; `npm run check` covers the cheap part of that gap (syntax, missing assets, `?v=` sync).

## Verifying in a real browser

`npm test` covers pure logic only. To confirm a change works in the actual app there is a browser layer:

```bash
npm run check        # statiske sjekker, ingen nettleser        (~1 s)
npm run coverage     # dekningsport: er ny kode testet?         (~2 s)
npm run test:e2e     # røyktest i ekte Chrome mot fixtures      (~10 s)
npm run verify       # check + test + coverage + test:e2e       (~15 s)
```

It drives the **system's Chrome** via `playwright-core` (the repo's only devDependency) — never `npx playwright install`, which downloads a 150 MB Chromium pinned to a build revision that drifts. `npm test` still runs on a checkout without `npm install`; the E2E suites skip with a reason.

The suite covers one table per source (SSB `13760`, Norges Bank `nb-IR`, FHI `fhi-nokkel-185`) because the three take genuinely different paths through the adapter layer — and asserts the per-source capability matrix (NB has no `/defaultselection`; Excel export and saved queries are SSB-only).

**Two hooks in `.claude/settings.json` run this automatically** (`scripts/hooks/*.sh`): `npm run check` after every edit to `js/`/`css/`/`data/sources/`/`index.html`, and `npm run verify` when a response ends with uncommitted code changes. Both feed failures back for fixing. Don't remove them without asking.

**E2E asserts structure, not values.** A deliberate bug in `sdmx-to-jsonstat.js` that produced a correctly-shaped table with wrong numbers passed all 10 E2E tests and failed 8 unit tests. Never cite a green smoke run as evidence that a conversion or calculation is correct.

**Load the `verify` skill** (`.claude/skills/verify/SKILL.md`) before running or extending this layer — it has the selector map, the record/replay fixture workflow, when to take screenshots, and how to drive the app manually. Don't re-derive it, and don't write a one-off browser script.

## Subagent Model Selection

When spawning subagents (via the `Agent`/`Task` tool) to work in this repo, pick the model to match the task's complexity rather than defaulting to the same model every time:

- **Sonnet — default for most work.** Code changes, multi-file investigation, writing or refactoring adapters/views, debugging, and any task that requires reading this file's architecture notes and applying judgement. Use Sonnet unless the task clearly falls into one of the tiers below.
- **Opus — escalate for high-stakes or architecturally significant work.** Cross-cutting refactors that touch the module load order or the source-adapter contract, non-trivial debugging with an unclear root cause, security-relevant changes, or planning/design work where getting the approach wrong is costly to unwind.
- **Haiku — acceptable only for small, mechanical, well-defined tasks.** Simple lookups, formatting/renaming, single-file grep-and-report summaries, or other tasks with no real judgement calls and an easily verifiable output.

Default to Sonnet when in doubt — it's the safe middle ground. Don't route a task to Haiku just to save cost if it involves multi-step reasoning or touches shared state (`AppState`, `BrowserState`, the source-adapter facade); a wrong or shallow subagent result there costs more to debug than the model savings are worth.

## Architecture

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

SSB endpoints are used directly by `ssb-adapter.js` (cache TTLs from `AppConfig.cache`); the saved-query endpoints are SSB-only.

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

## Repo map (File Guide, Common Tasks, re-skinning)

The per-file responsibility table, the task→files routing table, and the multi-instance/re-skinning guide live in the **`repo-map` skill** (`.claude/skills/repo-map/SKILL.md`) — invoke it when you need to find which file owns a behaviour or which files a given change touches.

## Reference Documentation

- [API-FINDINGS.md](API-FINDINGS.md) — discovered API behavior and corrections to spec. Add new API findings or knowledge here.
- [README.md](README.md) — feature list, system requirements, known limitations
- [ROADMAP.md](ROADMAP.md) — Statistikkportalen 2.0 multi-source status: what's enabled vs. queued for Norges Bank/FHI
- [ARCHITECTURE.md](ARCHITECTURE.md) — deep dive into state flow, caching, URL encoding, and the multi-source facade

- [SSB documentation for the API](https://data.ssb.no/api/pxwebapi/v2/index.html)
- [PXWebAPi 2 User guide](https://www.pxtools.net/PxWebApi/documentation/user-guide/) Describes how the PxWebApi works in general
