# Tests — Statistikkportalen

CLI-runnable test suite built on Node's built-in test runner (`node:test`).
**Zero npm dependencies** — in keeping with the app itself. Requires Node ≥ 20
(the repo's `scripts/*.mjs` utilities already assume Node).

## Running

```bash
npm test                                        # whole suite
node --test "tests/**/*.test.js"                # same, without npm
node --test tests/unit/search-enhanced.test.js  # one file (preferred while iterating)
node --test --test-name-pattern="synonym" "tests/**/*.test.js"  # by test name
```

Exit code 0 = all pass, 1 = failures. No watch mode by default (use
`--watch` manually if you want it). The suite must stay fast (< a few
seconds) and fully deterministic — no network, no timing dependence.

## How it works

The app has no build step and no ES modules: `js/*.js` files attach their
exports to `window` and are loaded via sequential `<script>` tags.
`tests/helpers/app-env.js` reproduces exactly that in Node: `loadApp(scripts)`
installs small in-memory shims (`window`, `localStorage`, `sessionStorage`,
`document`, `location`, `indexedDB`, `fetch`) on `globalThis`, then evaluates
the app files with `vm.runInThisContext()` in the same dependency order as
`index.html`. The app source is tested **unchanged** — no test-only rewrites.

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/synonyms.js', 'js/search-enhanced.js']);

describe('SearchEnhanced.normalizeText', () => {
  it('strips Norwegian diacritics', () => {
    assert.equal(app.SearchEnhanced.normalizeText('Årbok'), 'arbok');
  });
});
```

Rules imposed by the harness:

- **One `loadApp()` call per test file.** App scripts declare top-level
  `const`/`let` and can't be evaluated twice in a process. `node --test` runs
  each test file in its own process, so this is per-file, not per-suite.
  Tests needing mutually isolated app state go in separate files.
- **Network is disabled.** Any `fetch()` throws. Stub responses with
  `loadApp(scripts, { fetch: async (url) => ... })` returning fixture data —
  never hit live APIs from tests.
- Script presets: `SCRIPTS.core` (config/translations/cache/api),
  `SCRIPTS.browse` (+ utils/router/subjects/hierarchy/search),
  `SCRIPTS.sources` (+ the multi-source adapter layer). Compose your own list
  from `core` when a preset loads more than the test needs.

## Layout

```
tests/
  helpers/app-env.js   # the harness (loadApp, loadFixture, SCRIPTS)
  unit/*.test.js       # one file per app module under test
  fixtures/            # recorded API responses (JSON) for adapter/contract tests
  e2e/                 # browser smoke suite — separate layer, see below
```

## The E2E layer (`tests/e2e/`)

A Playwright smoke suite covering what unit tests deliberately don't: that the
app actually loads and that the main flows hang together in a real browser.

```bash
npm run check        # static checks (syntax, assets, ?v= sync) — no browser
npm run coverage     # coverage gate — fails when new code is untested
npm run test:e2e     # smoke suite against recorded fixtures
npm run verify       # all of the above + npm test — run before every commit
```

## The coverage gate (`tests/coverage-baseline.json`)

`npm test` proves existing tests pass; it cannot notice a *missing* test. The
gate closes that: it measures named-function coverage per app file and fails
when a file gains uncovered functions relative to the committed baseline.
Refactoring and deleting code stay free — only adding untested logic trips it.

```
✗ js/search-enhanced.js: 8/8 → 8/9 (1 flere udekkede funksjoner)
      Udekket nå: scoreByRecency
```

When it fires, **write the test**. `npm run coverage:baseline` exists for
deliberate drops only — typically new DOM-heavy view code that this file
already exempts from unit testing.

Two implementation notes worth knowing:

- `node --test --experimental-test-coverage` reports **nothing** for `js/*.js`,
  because `app-env.js` loads those files through `vm.runInThisContext()` and
  Node's built-in report only covers modules it loaded itself. Raw
  `NODE_V8_COVERAGE` does see them, keyed by the relative path passed as the
  `filename` option — which is why `scripts/check-coverage.mjs` does its own
  measurement.
- The overall number (currently 53%) is **not** a quality score. View modules
  are deliberately unit-test-free, so the gate is per-file: each file holds its
  own line rather than being averaged into a threshold that would either catch
  nothing or force the elaborate DOM mocks this file warns against.

Two properties keep it from leaking into the unit suite:

- **Files are named `*.e2e.mjs`**, so `npm test`'s `tests/**/*.test.js` glob
  never picks them up. The unit suite stays fast and network-free.
- **The only dependency is `playwright-core`**, imported dynamically and
  declared as a `devDependency`. On a checkout without `npm install`, `npm test`
  still passes and the E2E suites skip with a reason. The zero-dependency rule
  above is unchanged for everything except this layer.

It drives the **system's Chrome** (`channel: 'chrome'`) rather than a
Playwright-downloaded Chromium — no 150 MB download, and no browser-revision
drift to repair every time Playwright is upgraded.

One table per source is covered (SSB `13760`, Norges Bank `nb-IR`, FHI
`fhi-nokkel-185`) since all three take different paths through the adapter
layer, and the per-source capability matrix is asserted rather than assumed.

**The E2E layer checks structure, not values.** A deliberate stride bug in
`sdmx-to-jsonstat.js` — right table shape, wrong numbers — passed every E2E
test and failed 8 unit tests. Numeric correctness belongs in `tests/unit/`.

Network is handled by `page.route()` in record/replay mode (`helpers/stub-routes.mjs`),
not MSW. Fixtures are recorded by running the real flows once
(`node tests/e2e/helpers/record-fixtures.mjs`) and are committed, so they cannot
drift from what the app actually requests. Unstubbed calls fail the test rather
than passing silently.

Full guidance — selector map, when to take screenshots, how to add a flow, how
to drive the app manually — is in the **`verify` skill**
(`.claude/skills/verify/SKILL.md`).

## What to test where

| Kind | Target | Approach |
|------|--------|----------|
| Pure logic (best TDD fit) | `search-enhanced.js`, `sdmx-to-jsonstat.js`, `menu-hierarchy.js`, `router.js` encode/decode, `utils.js` helpers, config/subjects invariants | Unit tests against small synthetic inputs, written **test-first** |
| Adapter contracts | `js/sources/*-adapter.js` | Record a real API response once into `tests/fixtures/`, stub `fetch` with it, assert the adapter's output shape (JSON-Stat2, `ownsTableId`, catalogue entries) |
| DOM-heavy views | `*-view.js`, `variable-select-*.js`, `table-display.js` | Don't force these into unit tests with elaborate DOM mocks — that's the over-mocking trap. Test any extractable pure helpers; cover the rest with the E2E smoke suite (`tests/e2e/`, see below) |

## TDD conventions (also summarized in CLAUDE.md)

1. For new pure-logic behaviour: write the failing test first, run it and
   confirm it fails **for the right reason**, then implement until green.
2. For changes to existing logic: run the module's existing tests first —
   they define the current contract.
3. **Never weaken, skip, or delete an existing assertion to make a test
   pass.** Fix the implementation, or stop and flag the conflict.
4. Mock only true I/O boundaries (`fetch`, storage). Don't mock internal
   functions or pure collaborators just to isolate a unit.
5. A change isn't done until the whole suite passes — show the output.

## History

The suite replaced the legacy browser-run `test.html` (removed 2026-07).
Its assertions were migrated here — three had silently rotted (string vs.
per-language-object `subjectNames`, a renamed cache method, and saveQuery.*
translation keys that never existed), which is exactly why the suite is now
CLI-run and expected to pass on every commit.
