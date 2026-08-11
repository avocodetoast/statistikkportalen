---
name: new-source
description: Oppskrift for å implementere en helt ny API-kilde (adapter) i Statistikkportalen — først et undersøkelses-skjema for det nye API-et (rate limits, feilsemantikk, celletak, språk, frekvenser, …), så en komplett implementasjons-sjekkliste over alle repo-berøringspunkter (adapter, config, byggeskript, SEO, cache, CSS, tester). Load når en ny datakilde/nytt API skal legges til, eller når du vurderer om et API egner seg som kilde. For å UTVIDE en eksisterende kilde (flere NB-dataflows/FHI-kilder): bruk repo-map-skillens Common Tasks i stedet.
---

# Ny API-kilde — Statistikkportalen

Å legge til en ny kilde er to jobber: **forstå API-et** (del A) og **koble det inn i
repoet** (del B). Gjør A ferdig før du skriver kode — svarene styrer nesten alle
designvalg i B, og de skal dokumenteres i en ny `api-<kilde>`-skill
(`.claude/skills/api-<kilde>/SKILL.md`) FØR implementeringen starter, slik at
implementasjonsagenten har dem fra første linje kode.

Kontrakten en adapter må oppfylle står i headerkommentaren til
`js/sources/source-registry.js` — les den først, den dupliseres ikke her.
Arkitekturbeskrivelsen (ruting, feilisolasjon, cache-deling) står i
`ARCHITECTURE.md` § «Multi-source architecture».

## Del A — Undersøk API-et før koding

Fyll ut dette skjemaet ved å lese dokumentasjon OG teste endepunktene med ekte kall
(spec og virkelighet avviker — se skillene `api-ssb`, `api-norges-bank` og `api-fhi`
for hva de eksisterende kildene faktisk gjør, og som mal for formatet). Funnene
skrives inn i den nye `api-<kilde>`-skillen: kun avvik fra spec, målte
grenser/ytelse (datert) og design-konsekvenser med kodepekere — ikke generell
API-dokumentasjon. Skriv en trigger-orientert `description` som navngir filene og
oppgavetypene som skal laste skillen. Skillen er et LEVENDE dokument: mange funn
dukker først opp under implementeringen (del B) — før dem inn løpende.

| Spørsmål | Hvorfor det avgjør design |
|---|---|
| **Dataformat?** JSON-Stat2, SDMX, eller egen dialekt? | JSON-Stat2 → adapteren kan levere nesten rått (jf. FHI). SDMX/egen → egen konverteringsmodul à la `js/sources/sdmx-to-jsonstat.js`, med egne enhetstester. |
| **Rate limits / samtidighet?** | Sett kø-navn og cap i `SourceCommon.fetchWithTimeout({queue: '<kilde>'})`; global cap i `AppConfig.sources.maxConcurrentRequests`. |
| **Timeouts** — er data-uttrekk vesentlig tregere enn katalog/metadata? | Egen data-timeout à la FHI (90 s) vs. felles `fetchTimeoutMs` (15 s). Treg-men-ikke-hengende ≠ hengende. |
| **Feilkoder og semantikk?** Hva betyr 404? Finnes strukturert feilkropp? | NB: 404 = tomt resultat. FHI: 404 = ekte feil, RFC7807-kropp. SSB: 403 = celletak. Adapteren må oversette riktig — fasaden skiller «tomt» fra «feilet». |
| **Maks nedlastingsstørrelse / celletak** — ekte hard grense (HTTP-feil) eller bare treghet? | Ekte grense → `maxCells` i `AppConfig.limits.bySource.<kilde>` (hard blokk i UI). Bare treghet → kun `warnCells`/`slowWarnCells` (myke advarsler). Kun SSB har ekte grense i dag. |
| **Språk?** Har API-et lang-parameter, eller kun norsk? Eller finnes kilden ikke på norsk i det hele tatt? | Lang-param → map i adapterens `apiLang()`. Kun norsk → fast engelsk-note à la FHIs `EN_LANGUAGE_NOTE`. Kun engelsk → speilvendt note, og kuratér norske visningstitler i katalogen (à la `fhi-curation.json`). |
| **Sist oppdatert / tidsperioder per tabell** — kan de hentes billig for hele katalogen? | Billig → hent ved byggetid i katalogindeksen. Dyrt → pregenerert fil + eget probe-script à la `data/sources/nb-periods.json` / `scripts/update-nb-periods.mjs`, eller korriger ved tabellåpning (`extension.periods`). Liten config-katalog + dyre perioder er en vanlig mellomting — løses som NB: JS-katalog + eget periods-probe-script. |
| **Oppdateringstidspunkter / frekvenser?** | `timeUnit` per tabell styrer «Nylig oppdatert»-logikken; nær-daglige kilder inn i `ui.recentUpdates.highFrequencyTimeUnits`. Nye periodestavelser → regel i `period-format.js`. |
| **Valgfrie API-argumenter?** (format, detail-nivå, historikk, …) | Blir tilbudet i API-byggeren: `getApiBuilderOptions()` + `buildApiQuery()`. Kildespesifikke felter krever i dag også UI-endring (se lekkasje-listen i del B). |
| **Hvilke endepunkter egner seg som statistiske tabeller?** | Kuratér — ikke alt skal inn. NB eksponerer 31 utvalgte dataflows av mange flere; noen er bevisst utsatt (se `ROADMAP.md`). Kriterier: stabil dimensjonsstruktur, meningsfull tidsakse, forsvarlig størrelse. |
| **Katalognavn/titler** — er rå titler brukbare? | Metadata-haler (periode/oppdatert i tittelen) → `SourceCommon.stripTitleMetadataTail`. Dårlige titler/kategorier → kureringsfil à la `data/sources/fhi-curation.json`. |
| **Emnehierarki-plassering?** | Hvilke subjektkoder i `js/subjects.js` skal tabellene under? Trengs nye syntetiske noder i `sourceNodes` (`js/sources/source-topology.js`)? Subjektene MÅ finnes i `js/subjects.js`. Et helt NYTT toppemne påvirker også forsiden/emnekortene (`ui.topicCardDepth`, emnegrupper) og dermed SEO-generatoren — se CLAUDE.md-fallgruven om `generate-seo-pages.mjs`. |
| **Krever katalogen nettverkskall?** | `getTables()` skal være nettverksfri eller nær-fri (blokkerer første paint i fallback-stien). Stor/dynamisk katalog → pregenerer til `data/sources/<kilde>-catalog.json` med eget update-script à la `scripts/update-fhi-catalog.mjs`; liten/stabil → ren config à la `js/sources/nb-catalog.js`. |
| **Dimensjonsroller** — merker API-et tid/geo/metric pålitelig? | Upålitelig `role` → heuristikk à la FHIs `TIME_PATTERN`/`GEO_PATTERN`. Avgjør også `singleSelect`/`validKeys`-støtte. |

## Del B — Implementasjons-sjekkliste

Rekkefølgen er også en fornuftig arbeidsrekkefølge. TDD for all ren logikk
(konvertering, path-bygging, periodeavledning) — jf. CLAUDE.md.

1. **Adapter**: `js/sources/<kilde>-adapter.js`. Kontrakt + katalog-radform i
   `source-registry.js`-headeren. Full metodeflate kreves (ikke-støttede metoder skal
   finnes og kaste/degradere), `capabilities`-objekt, `ownsTableId()` på id-prefiks
   `<kilde>-`. Gjenbruk `SourceCommon` (`fetchWithTimeout` med eget kø-navn,
   `pickLabel`, `htmlToPlainLines`, `cacheGet`/`cacheSet`/`sharedCache`) og
   `CatalogShared` (`buildPathSegments` + ren radbygging — se punkt 5). Cache:
   delt `CacheManager` via `SourceCommon`, unikt nøkkel-prefiks
   `<kilde>_`/`<kilde>-`, egen `_meta_vN_`-versjonsstempling (bump ved
   metadata-formendring). Tabellinfo: fyll `meta.extension.{sections,flags,aboutUrl,
   publishedBy,periods}` — `table-metadata.js` rendrer det som finnes, uendret.
2. **Katalogdata/topologi**: kuratert katalog i `js/sources/<kilde>-catalog.js`
   (à la NB) eller pregenerert `data/sources/<kilde>-catalog.json` + update-script
   (à la FHI). Emnetre-noder og plasseringer i `js/sources/source-topology.js`.
3. **Config**: `js/config.js` — `sources.<kilde>` (`adapter`, `enabled`,
   `idPrefix: '<kilde>-'` — den ENE kilden til id→kilde-regelen; `utils.js`,
   `cache.js` og `seo-sources.mjs` deriverer fra den — `baseUrl`, `displayName`,
   `branding` med `name`/`nameFull`/`shortName`/`url`/`licenseUrl`/`licenseName`),
   `limits.bySource.<kilde>`, ev. tillegg i `sourceNodes` og `ui.recentUpdates`.
4. **Lastrekkefølge og index.html**: nye `<script>`-tagger — katalog/topologi FØR
   `config.js`, adapteren blant `js/sources/*` FØR `source-registry.js` (som lastes
   sist og erstatter `window.api`). Husk også den statiske noscript/crawler-
   attribusjonen i footeren (`#footer-sources` i `index.html`) — den er hardkodet
   HTML, ikke config-drevet som «Kilder og vilkår»-dialogen.
5. **Byggeskript — BEGGE utvidelsespunktene**:
   - `scripts/lib/catalog-sources.mjs`: ny provider i `ADAPTER_PROVIDERS`-mappen
     (`adapternavn → buildRows-funksjon`; `KNOWN_ADAPTERS` avledes automatisk).
   - `scripts/lib/seo-sources.mjs`: nettverksfri katalogbygger
     (`build<Kilde>Catalogue()`). Legg den rene radbyggingen i
     `js/sources/catalog-shared.js` (`CatalogShared`, lastes av byggeskriptene
     via `scripts/lib/catalog-shared.mjs`) slik NB/FHI gjør — da deler adapter
     og SEO samme kode, og ekvivalenstesten i `tests/unit/catalog-shared.test.js`
     vokter mot drift. `sourceKeyForId()` er config-drevet (idPrefix) og trenger
     ingen endring.
   - Har kilden en JS-katalogfil (à la `nb-catalog.js`): registrer den også i
     `loadAppConfig()`-sandkassens fil-liste i `scripts/lib/catalog-sources.mjs`
     (speiler `<script>`-rekkefølgen).
   - `bin/refresh.sh`: nytt kilde-argument i `case`-valideringen + cron-linje
     (serverens katalog-refresh kjenner i dag kun `ssb|nb|fhi`). Eget
     data-oppdaterings-steg bare hvis kilden har en byggetidsfil å friske opp
     (à la NB-perioder/FHI-katalog) — SSB-grenen er tom av samme grunn; uten
     byggetidsfil trengs likevel argumentet, så indeks+SEO kan rebygges.
   - Rekkefølge etterpå: `build-catalog-index.mjs` FØR `generate-seo-pages.mjs`
     (generatoren leser den ferdigbygde indeksen).
6. **Kjente kildespesifikke punkter utenfor adapterlaget**. Id→kilde-regelen
   (`utils.js`, `cache.js`, `seo-sources.mjs`) er config-drevet via `idPrefix`
   (punkt 3) og trenger ingen kodeendring. Gjenstår manuelt:
   - `css/menu-navigator.css` — egen `.source-badge--<kilde>`-regel (ingen generisk fallback).
   - SSB-only-gates som skal forbli SSB-only, men verifiser: `js/table-metadata.js`
     (`_getStatisticShortName`), `js/variable-select.js` (`ensureApiLimits`, `/config`).
   - Kildespesifikke API-bygger-felter i `variable-select.js`/`variable-select-api.js`
     er i dag hardkodet for NB (`nbAdvanced`) — en ny kilde med egne felter trenger
     tilsvarende UI-arbeid.
7. **Strenger**: alle nye UI-strenger via `t()`/`tpl()` i `js/translations.js`;
   aldri kildenavn hardkodet utenfor `AppConfig`/`js/subjects.js`. Nye
   periodestavelser → regel i `js/period-format.js`. «Kilder og vilkår»-dialogen
   (`js/app-terms.js`) og statusbadgen («N/N API-er», `js/source-status.js`) er
   config-drevne — de plukker opp en ny kilde fra `AppConfig.sources` uten
   kodeendring; kun den statiske footeren i `index.html` (punkt 4) er hardkodet.
8. **Tester** (mønster fra NB/FHI i `tests/unit/`): `<kilde>-adapter-paths`,
   katalog-/periodeavledningstester, formatkonverteringstester hvis egen konvertering
   (à la `sdmx-*`). Oppdater `source-registry`-, `source-registry-status`-,
   `source-branding`-, `seo-sources`- og `hierarchy-real-catalog`-testene. I tillegg:
   - `tests/helpers/app-env.js`: adapter- og katalogfilene inn i `SCRIPTS`-presetene
     (`core`/`sources`), ellers lastes de aldri av enhetstestene.
   - Dekningsporten: en ny fil under `js/` som ingen test laster stopper
     `npm run coverage` (`scripts/check-coverage.mjs`) — skriv testen som laster
     den; `coverage:baseline` er kun for bevisste unntak og skal rapporteres.
   - E2E: nytt API-vertsnavn inn i `API_HOSTS` i `tests/e2e/helpers/stub-routes.mjs`
     (ellers abortes kall dit), ny rad i `SOURCE_TABLES` i `tests/e2e/helpers/flows.mjs`,
     og oppdater de hardkodede antakelsene om tre kilder i `tests/e2e/smoke.e2e.mjs`
     («3/3»-badge, `nb-`/`fhi-`-prefikslister) og `tests/unit/catalog-index-load.test.js`
     (eksakte shard-/statusnøkler).
   E2E asserter struktur, aldri tallverdier. `npm run verify` grønn før commit.
9. **Dokumentasjon**: nye API-funn fra implementeringen → `api-<kilde>`-skillen
   (opprettet i del A); aktivert/utsatt-status →
   `ROADMAP.md`; ny File Guide-rad + ev. Common Tasks-rad i `repo-map`-skillen.

## Selvtest

Når alt over er gjort skal den nye kilden: vises i statusbadgen («N/N API-er»), få
egen badge i tabellister, dukke opp i emnetreet og søk, åpne variabelvelgeren med
riktige dimensjoner, hente og vise data, eksportere, og få SEO-sider generert.
Kjør `verify`-skillens E2E med skjermbilder for å bekrefte i ekte nettleser.
