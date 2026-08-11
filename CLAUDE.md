# CLAUDE.md

Klientside-webapp i ren vanilla JS — ingen rammeverk, ingen byggesteg, ingen
runtime-avhengigheter. Bla i og eksporter statistikk fra PxWebApi v2 (SSB), Norges Bank
(SDMX) og FHI (JSON-Stat2) gjennom et kildeadapter-lag. Åpnes direkte som `index.html`.

## Slå opp her

| Trenger du å vite… | Les |
|---|---|
| hvilken fil eier hva, hvilke filer en endring treffer, re-skinning | `repo-map`-skillen |
| hvordan implementere en helt ny API-kilde (adapter) | `new-source`-skillen |
| hvordan kjøre og verifisere appen, E2E, fixtures, skjermbilder, feilsøking | `verify`-skillen |
| tilstandsflyt, kildefasaden, caching, URL-koding, SEO-pipelinen | [ARCHITECTURE.md](ARCHITECTURE.md) |
| testharnessen, dekningsporten, hva som testes hvor | [tests/README.md](tests/README.md) |
| API-atferd som avviker fra spec | [API-FINDINGS.md](API-FINDINGS.md) |
| hva som er aktivert vs. planlagt av NB-/FHI-kilder | [ROADMAP.md](ROADMAP.md) |

Lastrekkefølgen er `<script>`-rekkefølgen i `index.html`. Adapterkontrakten står i
headerkommentaren til `js/sources/source-registry.js`.

## Fallgruver

- **Lokale datafiler hentes med `fetch()`.** `file://` er en dokumentert DEGRADERT
  modus, ikke et krav om paritet: katalogindeksen (`js/catalog-index.js`) kan ikke
  hentes lokalt, og appen faller da tilbake til direkte kildehenting fra API-ene.
  Fungerer, men tregt og uten byggetids-metadata (se `js/sources/fhi-adapter.js` sin
  egen `file:`-guard i `getCatalog()`).
- **Ingen nettverkskall i en adapters `getTables()`.** Normalflyten kaller den ikke i
  det hele tatt — katalogindeksen (`data/index/`, bygget av
  `scripts/build-catalog-index.mjs` fra bl.a. `data/sources/*.json`) dekker sidelasting.
  `getTables()` er kun fallback-stien når indeksen mangler/er ubrukelig, og
  `BrowserState.init()` venter da på hele resultatet — alt en adapter henter der
  blokkerer første paint. NB bygger katalogen rent fra config; FHI leser
  `data/sources/fhi-catalog.json` med et memoisert `fetch()`. Bak det inn ved byggetid,
  ikke hent det live ved hver sidelasting.
- **SEO-byggeren re-deriverer hierarkiet og sideinnholdet — ikke lenger katalogen.**
  `scripts/generate-seo-pages.mjs` leser katalogen ferdigbygd fra `{webroot}/data/index/`
  (`scripts/lib/seo-enumerate.mjs`, bygget av `scripts/build-catalog-index.mjs` — som må ha
  kjørt først, se README.md for cron-rekkefølgen). Den bygger fortsatt emnetreet
  (`buildHierarchy`, speiler `menu-hierarchy.js`) og sideinnholdet (speiler
  `topic-view.js`/`front-page.js`) på nytt. Endrer du en adapters katalogoppføring,
  `AppConfig.sourceNodes` eller stiplasseringer — bygg katalogindeksen på nytt FØR du
  kjører generatoren, ellers ser den gamle data. Endrer du `ui.topicCardDepth`, emnegrupper
  eller forsidens innhold — se over generatoren også. Kildebranding
  (`AppConfig.sources.<kilde>.branding`, `scripts/lib/seo-sources.mjs`) leses derimot
  direkte fra `config.js` og trenger ingen indeks-ombygging.
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
