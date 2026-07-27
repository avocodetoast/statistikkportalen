# CLAUDE.md

Klientside-webapp i ren vanilla JS — ingen rammeverk, ingen byggesteg, ingen
runtime-avhengigheter. Bla i og eksporter statistikk fra PxWebApi v2 (SSB), Norges Bank
(SDMX) og FHI (JSON-Stat2) gjennom et kildeadapter-lag. Åpnes direkte som `index.html`.

## Slå opp her

| Trenger du å vite… | Les |
|---|---|
| hvilken fil eier hva, hvilke filer en endring treffer, re-skinning | `repo-map`-skillen |
| hvordan kjøre og verifisere appen, E2E, fixtures, skjermbilder, feilsøking | `verify`-skillen |
| tilstandsflyt, kildefasaden, caching, URL-koding, SEO-pipelinen | [ARCHITECTURE.md](ARCHITECTURE.md) |
| testharnessen, dekningsporten, hva som testes hvor | [tests/README.md](tests/README.md) |
| API-atferd som avviker fra spec | [API-FINDINGS.md](API-FINDINGS.md) |
| hva som er aktivert vs. planlagt av NB-/FHI-kilder | [ROADMAP.md](ROADMAP.md) |

Lastrekkefølgen er `<script>`-rekkefølgen i `index.html`. Adapterkontrakten står i
headerkommentaren til `js/sources/source-registry.js`.

## Fallgruver

- **Ingen `fetch()` av lokale filer.** Appen skal virke over `file://`, så lokale data
  må leveres som et `<script>`-global. Legger du til en ny lokal datafil nettleseren
  trenger, gi den en `.js`-tvilling ved siden av `.json`-en (som `fhi-catalog.js`/
  `.json`) — ellers feiler den stille og kilden degraderer.
- **Ingen nettverkskall i en adapters `getTables()`.** `BrowserState.init()` venter på
  hele katalogaggregeringen, så alt en adapter henter der blokkerer første paint. NB og
  FHI bygger katalogen fra innsjekkede byggetidsfiler i `data/sources/`. Bak det inn,
  ikke hent det.
- **SEO-byggeren re-deriverer appen.** `scripts/generate-seo-pages.mjs` +
  `scripts/lib/seo-sources.mjs` bygger katalog, hierarki og sideinnhold på nytt fra
  `config.js`/`subjects.js` og speiler `topic-view.js`/`front-page.js`. Endrer du
  `AppConfig.sources`/`sourceNodes`/branding, emnegrupper, `ui.topicCardDepth`, en
  adapters katalogoppføring eller forsidens innhold — se over generatoren også.
- **`nb-catalog.js` og `source-topology.js` må lastes før `config.js`**, og
  `source-registry.js` sist blant `js/sources/*` (den erstatter `window.api`).

## Konvensjoner

- Ingen ES-moduler. Alt henger på `window` og lastes via `<script>`-tagger.
- Kall alltid `api`-fasaden — aldri `SSBApi` eller en adapter direkte.
- Alle UI-strenger gjennom `t()`/`tpl()`. Aldri hardkod en streng eller et kildenavn
  (SSB, SCB, …) utenfor `AppConfig`/`subjects.js`.
- `logger.*` (config.js), aldri `console.*`.
- `escapeHtml()` før API-data rendres.
- Commit-meldinger på norsk.

## Arbeidsflyt

- Ny ren logikk (søkescoring, SDMX-konvertering, hierarki, URL-koding): skriv testen
  først, se den feile av riktig grunn, så implementer.
- Endrer du eksisterende logikk: kjør modulens tester i `tests/unit/` først — de er
  kontrakten.
- **Svekk, hopp aldri over eller slett en eksisterende assertion for å få grønt.** Fiks
  implementasjonen, eller stopp og flagg konflikten.
- Slår dekningsporten til, skriv testen. `npm run coverage:baseline` er kun for bevisste
  fall, og bruk av den skal rapporteres.
- `npm run verify` skal passere før commit — vis outputen. En Stop-hook kjører den
  uansett, og `npm run check` kjører etter hver filendring. Ikke fjern hookene uten å
  spørre.
- E2E asserter struktur, ikke tallverdier — aldri bruk en grønn røyktest som bevis for
  at en konvertering regner riktig.
- Subagenter: harnesset avgjør selv når det lønner seg å spawne. Blir du bedt om det,
  pek agenten på `repo-map`-skillen i stedet for å la den lete seg fram.
