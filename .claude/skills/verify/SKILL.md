---
name: verify
description: How to actually run and verify Statistikkportalen — static checks, the Playwright E2E smoke suite, screenshots, and how to drive the app manually in a browser. Load whenever you need to confirm a change works in the real app (not just in unit tests), take a screenshot, debug something that only reproduces in a browser, or add a new E2E flow. Answers "how do I run this app" so it never has to be re-derived.
---

# Verifisering — Statistikkportalen

Alt du trenger for å kjøre appen og bekrefte at en endring virker. **Ikke let etter
nettlesere, ikke installer Playwright på nytt, ikke skriv et engangsscript** — det er
allerede satt opp, og dette dokumentet beskriver hvordan.

## Kommandoer

| Kommando | Hva den gjør | Tid |
|---|---|---|
| `npm run check` | Statiske sjekker. Ingen nettleser, ingen nettverk. | ~1 s |
| `npm test` | Enhetssuiten (508 tester). Uendret, null avhengigheter. | ~2 s |
| `npm run coverage` | Dekningsport: feiler hvis ny kode er utestet. | ~2 s |
| `npm run test:e2e` | Røyktest i ekte Chrome mot fixtures. | ~10 s |
| `npm run verify` | Alle fire, i rekkefølge. **Kjør denne før commit.** | ~15 s |

Flagg til `test:e2e`:

| Variabel | Effekt |
|---|---|
| `E2E_LIVE=1` | Kjør mot ekte SSB/NB/FHI-API-er i stedet for fixtures. |
| `E2E_SHOTS=1` | Lagre skjermbilder for hvert steg. |
| `E2E_SHOT_DIR=<sti>` | Hvor skjermbildene havner (standard: `$TMPDIR/statistikkportalen-e2e-shots`). |

## Dette kjører automatisk

To hooks i `.claude/settings.json` kjører uavhengig av hva Claude finner på — de
utføres av selve verktøyet, ikke av modellen:

| Hook | Når | Kjører | Gate |
|---|---|---|---|
| `PostToolUse` (`Edit`/`Write`) | etter hver filendring | `npm run check` (~1 s) | kun `js/`, `css/`, `data/sources/`, `index.html` |
| `Stop` | når Claude avslutter et svar | `npm run verify` (~15 s) | kun hvis arbeidstreet har ucommittede endringer i kode |

Begge avslutter med **exit 2** ved feil, som sender feilmeldingen tilbake til Claude
for retting. Logikken ligger i `scripts/hooks/*.sh` (ikke inline i settings.json), så
den kan pipe-testes:

```bash
echo '{"tool_input":{"file_path":"'$PWD'/js/utils.js"}}' | ./scripts/hooks/post-edit-check.sh
echo '{}' | ./scripts/hooks/stop-verify.sh
```

Stop-hookens git-port er grunnen til at rene spørsmål-og-svar-runder ikke koster 15
sekunder. Er treet rent, avslutter den på ~0,2 s uten å starte npm.

Du kan fortsatt kjøre alt manuelt — hookene erstatter ikke kommandoene under, de
sikrer bare at de ikke blir glemt. Slå dem av med `/hooks`.

## Hvilken kommando til hvilken endring

| Endringen din berører | Kjør |
|---|---|
| Ren logikk (søkescoring, SDMX-konvertering, hierarki, ruter) | `npm test` — TDD, se CLAUDE.md |
| En `*-view.js`, `variable-select-*.js`, `table-display.js` | `npm run verify` |
| CSS, layout, ny rendering | `E2E_SHOTS=1 npm run test:e2e` og **se på bildene** |
| En adapter (`js/sources/*`) | `npm run verify`, deretter `E2E_LIVE=1 npm run test:e2e` |
| `index.html`, `version.js`, en ny asset | `npm run check` fanger det meste |
| Noe som bare reproduseres i nettleser | Se «Drive appen manuelt» nedenfor |

### Når skal du ta skjermbilder?

**Ja:** CSS-endringer, ny eller endret rendering, noe som påvirker layout, og når
brukeren spør «ser det riktig ut?». Bildene er den eneste måten å faktisk svare på det.

**Nei:** ren logikk, adapterendringer uten visuell effekt, refaktorering. Bildene koster
tid og sier ingenting.

Etter `E2E_SHOTS=1` — **les bildene med Read-verktøyet**, ikke bare bekreft at filene
finnes. Poenget er å se resultatet.

## Preflight

E2E hopper over seg selv med en tydelig begrunnelse hvis noe mangler. Ved skip:

| Melding | Fiks |
|---|---|
| `playwright-core er ikke installert` | `npm install` (1 pakke, 13 MB, laster **ikke** ned nettlesere) |
| `Fant ingen installert Chrome/Chromium` | Installer Google Chrome |

**Ikke kjør `npx playwright install`.** Oppsettet bruker systemets Chrome via
`channel: 'chrome'`. Playwrights egen Chromium er ~150 MB og pinnet til en eksakt
build-revisjon som driver fra hverandre ved hver oppgradering — akkurat den tilstanden
(cachet build 1228 mot en Playwright som krevde 1234) er grunnen til at dette laget
finnes. Avhengigheten er derfor `playwright-core`, ikke `playwright`.

## Filene

```
scripts/check-static.mjs        statiske sjekker
tests/e2e/
  smoke.e2e.mjs                 røyktesten (.e2e.mjs, ikke .test.js — se under)
  fixtures/*.json               innspilte API-svar (18 filer, ~870 KB, committes)
  helpers/
    app-browser.mjs             launchApp(): Chrome + konsollfangst + skjermbilder
    flows.mjs                   de delte brukerflytene
    serve.mjs                   statisk node:http-server (null deps)
    stub-routes.mjs             nettverkslaget: record/replay/live
    record-fixtures.mjs         spiller inn fixtures på nytt
```

**Filendelsen `.e2e.mjs` er ikke tilfeldig.** `npm test` globber
`tests/**/*.test.js`. Enhetssuiten skal forbli rask og nettverksfri, så E2E-filer må
ikke matche det mønsteret. Døp en ny E2E-fil `*.e2e.mjs`.

## Nettverk: record/replay, ikke MSW

`stub-routes.mjs` bruker Playwrights `page.route()`. **Ikke foreslå MSW** — det ville
krevd en ekte npm-avhengighet, en innsjekket service worker og oppkobling i
`index.html`, i en app uten byggesteg. Appen gjør bare seks API-kall i hele røyktesten.

Tre modi:

- **replay** (standard) — svarer fra `tests/e2e/fixtures/`.
- **record** — går mot ekte API-er og lagrer svarene.
- **live** (`E2E_LIVE=1`) — går mot ekte API-er uten å lagre.

record og replay deler `requestKey()`, så en innspilt fixture treffer alltid i replay.
Derfor skal fixtures **aldri skrives for hånd**:

```bash
node tests/e2e/helpers/record-fixtures.mjs [--table 13760]
```

Fixtures committes. `/tables` trimmes fra ~10 000 til 70 rader som fortsatt dekker alle
23 emner.

**Ustubbede kall feiler testen.** Legger du til et steg som gjør et nytt API-kall, får du
`mangler fixture: …` — svaret er å kjøre innspillingen på nytt, ikke å myke opp
assertionen. Legg da også det nye steget inn i `record-fixtures.mjs`, ellers spilles det
ikke inn.

## Å legge til en ny flyt

1. Skriv steget i `flows.mjs` (driver appen, asserter ikke).
2. Kall det fra `record-fixtures.mjs` **og** `smoke.e2e.mjs`.
3. `node tests/e2e/helpers/record-fixtures.mjs`
4. `npm run test:e2e`

## Selektorkart

Verifisert mot appen slik den faktisk rendrer. Bruk disse — **ikke legg til
`data-testid`**, det finnes stabile id-er allerede.

| Vy | Selektorer |
|---|---|
| Alltid | `#content`, `#error-display`, `#api-status-badge` («3/3 datakilder lastet inn») |
| Forside | `#front-search` (søk utløses av **Enter**, ikke debounce), `[data-subject]`, `.front-subject-link` |
| Emnevy | `.subtopic-card`, `.category-card`, `a[href*="#variables/"]` |
| Variabelvalg | `[data-dimension]`, `#load-default-selection`, `#fetch-data-btn`, `#cell-count-display`, `#selection-status`, `.select-all-btn`, `.dim-pill-group label.api-pill` |
| Tabellvisning | `#data-container table`, `#export-csv-btn`, `#export-quick-btn`, `#export-btn`, `#export-dialog`, `#rotate-table-btn`, `#save-query-btn` |
| Ruter | `#home`, `#search?q=…`, `#topic/al/al03/aku`, `#variables/{id}`, `#table/{id}` |

Fallgruver som har kostet tid — alle observert, ikke antatt:

- **Emnekortene er ikke lenker.** De eneste `a[href*="#topic/"]` på siden er den faste
  menylinja, som er identisk på alle nivåer. Å følge href-er står stille på nivå 1 for
  alltid. Bor nedover ved å **klikke** `.subtopic-card` / `.category-card`.
- **`#fetch-data-btn` er disabled til noe er valgt.**
- **`.card-auto-hidden`-kort er nullstore.** Et blindt klikk på `.select-all-btn`
  henger 30 sekunder på Playwrights visibility-venting. Filtrer med
  `[data-dimension]:not(.card-auto-hidden)`.
- **Radioknappene i single-select-dimensjoner er visuelt skjulte** inni
  `<label class="api-pill">`. `.check()` henger; klikk labelen.
- **Deep-link ved kald last virker ikke.** `page.goto(url + '#variables/13760')` som
  aller første navigasjon havner på `#home` — for alle tre kildene. Gå via forsiden
  først. (Se «Kjente avvik».)

## Kildene oppfører seg ulikt

Dette er ekte kapabilitetsforskjeller, ikke testartefakter. `runTableFlow()` er
adaptiv og returnerer hva den fant; `smoke.e2e.mjs` asserter matrisen.

| | SSB `13760` | Norges Bank `nb-IR` | FHI `fhi-nokkel-185` |
|---|---|---|---|
| `#load-default-selection` | ✓ | **✗** | ✓ |
| CSV-eksport | ✓ | ✓ | ✓ |
| Excel (`#export-quick-btn`) | ✓ | ✗ | ✗ |
| «Flere alternativer» (`#export-btn`) | ✓ | ✗ | ✗ |
| «Få lenke» (`#save-query-btn`) | ✓ | ✗ | ✗ |
| Roter tabell | ✓ | ✓ | ✓ |

Norges Bank mangler `/defaultselection` fordi det er et PxWebApi-endepunkt som
SDMX-API-et ikke har — NB-tabeller må velges manuelt. Lagrede spørringer er SSB-only
per adapterkontrakten.

## Drive appen manuelt

Når du må inspisere noe interaktivt i stedet for å skrive en test:

```js
const ROOT = process.cwd();
const { launchApp, waitForFrontPage } = await import(`file://${encodeURI(ROOT)}/tests/e2e/helpers/app-browser.mjs`);

const app = await launchApp({ mode: 'http', network: 'replay' });  // eller 'live'
await waitForFrontPage(app.page);

// ... driv app.page fritt ...

console.log(app.problems({ drain: false }) || 'ingen feil');
await app.close();
```

Legg scriptet i scratchpad-katalogen, ikke i repoet. `mode: 'file'` laster over `file://`.

## Hva sjekkene faktisk fanger

`npm run check`:

1. Syntaksfeil i alle `js/**/*.js` og `data/sources/*.js` — repoet har ingen linter og
   ingen bundler, og `npm test` laster bare filene testene ber om.
2. `<script>`/`<link>` i `index.html` som peker på en fil som ikke finnes.
3. `?v=`-strenger ute av synk med `VERSION`. (`VERSION` er `v1.9.4`, `?v=` skrives uten
   `v`-prefikset — sammenligningen normaliserer.)
4. En relativt-referert asset som mangler i asset-path-rewriten i
   `generate-seo-pages.mjs` — ellers 404-er den på hver forhåndsrendret underside.
5. Duplikate id-er i `index.html`.

`npm run test:e2e`: at appen laster, at søk/emnetre/variabelvalg/datahenting/eksport
henger sammen for **alle tre kildene**, at det ikke er konsollfeil eller uncaught
exceptions underveis, at `file://`-modus virker, og at appen degraderer synlig i stedet
for å kræsje når en kilde er nede.

## Dekningsporten — den eneste som krever NYE tester

`npm test` og E2E sjekker at *eksisterende* tester passerer. Ingen av dem oppdager at
det mangler nye: en ny ren-logikk-funksjon uten test lot hele suiten stå grønn.
`npm run coverage` lukker det.

Metrikk: andel navngitte funksjoner som kalles minst én gang, **per fil**, målt mot
`tests/coverage-baseline.json`. Porten feiler når en fil får *flere udekkede
funksjoner* enn basislinjen — så refaktorering og sletting går fint, men ny utestet
logikk gjør ikke:

```
✗ js/search-enhanced.js: 8/8 → 8/9 (1 flere udekkede funksjoner)
      Udekket nå: scoreByRecency
```

Når porten slår ut er svaret **å skrive testen**, ikke å oppdatere basislinjen.
`npm run coverage:baseline` er for bevisste senkninger — typisk ny DOM-tung viewkode
som per `tests/README.md` ikke skal enhetstestes. Bruker du den, si fra til brukeren
hva du senket og hvorfor.

`npm run coverage:report` viser dekningen per fil uten å porte.

To ting å vite om målingen:

- **`node --test --experimental-test-coverage` rapporterer ingenting for `js/*.js`.**
  Harnessen laster appfilene med `vm.runInThisContext()`, og Nodes egen rapport tar
  bare med filer den selv lastet som moduler. Rå `NODE_V8_COVERAGE` ser dem derimot,
  under den relative stien fra `filename`-opsjonen. Det er derfor porten gjør
  målingen selv.
- **Per fil, ikke globalt.** Totalen er 53 %, men det er ikke en karakter — de
  DOM-tunge view-modulene er bevisst uten enhetstester. En global terskel måtte enten
  vært for lav til å fange noe, eller tvunget fram nettopp de DOM-mockene repoet
  unngår.

### Arbeidsdelingen mellom lagene

E2E asserter **struktur**, ikke **verdier**. Det er verifisert, ikke antatt: en bevisst
innført feil i `computeStrides()` i `sdmx-to-jsonstat.js` (reverserte strides, altså
riktig tabell med gale tall) ga

- `npm run test:e2e`: **10/10 grønt** — tabellen rendret fortsatt med rader
- `npm test`: **8 feil** i `dataToJsonStat`- og `NBAdapter`-testene

Så: tallriktighet hører hjemme i enhetstestene, og en grønn røyktest sier ingenting om
den. Ikke bruk E2E som argument for at en konverterings- eller beregningsendring er
riktig — kjør `npm run verify`, som gjør begge.

**Ikke dekket i det hele tatt:** eksportfilenes innhold, andre nettlesere enn Chrome,
mobil-layout, tilgjengelighet. Ikke påstå at noe av dette er verifisert.

## Kjente avvik

- **Deep-link ved kald last havner på forsiden.** Å åpne
  `…/index.html#variables/13760` som første navigasjon ender på `#home`. Gjelder alle
  tre kildene, altså ikke en kildespesifikk feil. Verifisert manuelt; ikke undersøkt
  om det påvirker produksjon (de forhåndsrendrede SEO-sidene bruker sti-URL-er,
  `/table/{id}/`, ikke hash). Det finnes **ingen** test som dekker dette ennå.
- **`js/router.js` har null funksjonsdekning** (0/15) — `encode`, `decode`,
  `parseHash`, `buildHash` og rutehåndtererne er alle utestet, selv om CLAUDE.md
  nevner «router.js encode/decode» som en av de beste TDD-kandidatene.
  `tests/unit/router-utils.test.js` tester bare `detectSavedQueryId` og gjør en
  `typeof`-sjekk på `SSBURLMapper.fromSSB` uten å kalle den. Basislinjen fastholder
  dagens nivå, så det blir ikke verre — men det er en åpenbar plass å begynne hvis
  du skal øke dekningen.

## Appens egne feil er usynlige uten et triks

`AppConfig.debug` er `false`, og **hele appen logger gjennom `logger.*`** (config.js),
som er no-ops når debug er av. Uten mottiltak ser E2E-testene ingen av appens egne
feilmeldinger — en tabell som stille feiler å laste ville sett ut som en bestått test.

`app-browser.mjs` løser dette med en `addInitScript` som setter en setter-felle på
`window.logger` og **muterer** objektet når config.js tilordner det (appkoden holder
sin egen referanse til det samme objektet, så en erstatning ville ikke virket), samtidig
som `AppConfig.debug` skrus på. Feil fra `logger.error`/`logger.warn` dukker opp i
konsollfangsten med prefiks `[app]`.

Skriver du et eget nettleserscript utenom `launchApp()`: husk dette, ellers debugger du
i blinde.

## Invarianter du ikke skal brekke

- **`npm test` må kjøre uten `npm install`.** Enhetssuiten har null avhengigheter og
  skal fortsette å ha det. Derfor importeres `playwright-core` dynamisk inne i
  `launchApp()` — en statisk import ville krasjet testfila på et rent checkout i stedet
  for å skippe.
- **Norges Bank og FHI gjør null nettverkskall ved oppstart.** Katalogene er bakt inn i
  `data/sources/*.js`. `file://`-testen sjekker dette ved å kreve at alle `nb-`/`fhi-`
  tabeller har perioder — mangler de, lastes en bakt datafil ikke som `<script>`.
  Se CLAUDE.md.
- **Ikke myk opp en assertion for å få grønt.** Samme regel som for enhetstestene.
