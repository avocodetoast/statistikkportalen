# Statistikkportalen
Statistikkportalen er et uoffisielt grensesnitt som forbedrer tilgangen til SSBs data. Applikasjonen gir rask navigering gjennom lokal caching, et kompakt grensesnitt for å minimere scrolling, og enklere oppdagelse av tabeller gjennom menynavigering.

Fra og med **Statistikkportalen 2.0** er appen en multi-kilde-hub: i tillegg til SSB integrerer den også **Norges Bank** (renter, valutakurser) og **FHI** (Folkehelseinstituttet) via en kildeadapter i `js/sources/`, slik at tabeller fra alle tre kildene dukker opp side om side i samme emnehierarki og søk. Se [ROADMAP.md](ROADMAP.md) for hva som er aktivert og hva som gjenstår.

Applikasjonen kan i tillegg tilpasses andre systemer som bruker PxWebApi v2, eksempelvis SCBs statistikkbank. Det krever kun at tre filer byttes ut: `config.js` (API-URL, kilde, språk), `subjects.js` (emnehierarki) og `synonyms.js` (søkesynonymer) — se `config-sv.js`/`subjects-sv.js` for et fungerende eksempel på SCB-varianten.

## Funksjonalitet
1. **Oppdag tabeller raskt og enkelt**
   - Søk gjennom alle tilgjengelige tabeller — SSB, Norges Bank og FHI i samme søk og emnehierarki
   - Filtrer etter emne og frekvens
   - Oversiktlige kort med metadata (periode, oppdateringsdato, antall variabler)

2. **Variabelvelger**
   - Interaktivt grensesnitt for å velge verdier for hver dimensjon
   - Semantiske merker (Tid, Geografi, Statistikkvariabel) basert på JSON-stat2 `role`
   - Tidsdimensjon viser forventet periodeformat (f.eks. `2024M06`)
   - Støtte for kodelister, inkludert riktig håndtering av aggregeringer (`agg_*`) — sender automatisk `outputValues=aggregated` for korrekte summerte tall
   - Støtte for spesielle operatorer
     - `*` — Alle verdier
     - `top(n)` — De n siste verdiene (f.eks. `top(12)` for siste 12 måneder)
     - `from(periode)` — Alle verdier fra og med en gitt periode (f.eks. `from(2020M01)`)
   - Visuelle indikatorer for valideringsstatus

3. **API-bygger**
   - Generer GET- og POST-URL direkte fra variabelvalget
   - Støtte for alle responsformater (JSON-stat2, CSV, Excel, PX, HTML) — formatlisten leses dynamisk fra `/config` slik at den alltid speiler hva API-et faktisk støtter
   - Tidsdimensjonen optimeres automatisk: eksplisitte perioder erstattes med `from(startdato)` eller `top(n)` for en dynamisk URL som alltid henter ferske data
   - URL vises i klartekst som standard
   - Kopier URL eller POST-body med ett klikk

4. **Datavisning**
   - Intelligent standard layout
   - Sticky headers for enkel navigering i store tabeller
   - Norske tallformater (mellomrom som tusenskilletegn, komma som desimalskilletegn)
   - Korrekt visning av statuskoder (`.`, `..`, `:`) per SSBs konvensjon
   - Tabellinfo med direktelenke til "Om statistikken" på ssb.no

5. **Tabellrotasjon**
   - Drag-and-drop-grensesnitt for å endre tabellayout
   - Flytt dimensjoner mellom rader og kolonner
   - Hurtigvalg: Standard, Transponér, Alle som rader/kolonner

6. **Dataeksport**
   - Eksporter til Excel, CSV og PX-format
   - Valg for eksportformat, eksempelvis pivotvennlig CSV

7. **Caching**
   - Intelligent caching av API-kall i localStorage
   - Automatisk opprydding av utdaterte data

8. **Lagrede spørringer** (kun SSB-tabeller)
   - Lagre spørringer som kan gjenfinnes med lenke
   - Åpne en SSB-spørring ved å lime lenken inn i søkefeltet

9. **Smart søk (beta)**
   - Finn flere tabeller enn ved den vanlige søkemodusen
   - Synonymutvidelse (f.eks. «bnp» finner også «bruttonasjonalprodukt») og enkel fuzzy-fallback ved null treff

10. **Flerspråklig grensesnitt**
    - Norsk bokmål og engelsk (SCB-varianten: svensk og engelsk)
    - Språkvalg lagres i nettleseren og huskes til neste besøk

## Kom i gang
1. Åpne `index.html` i en moderne nettleser
2. Vent til tabellisten lastes (caches automatisk)
3. Søk eller bla til ønsket tabell
4. Velg verdier for variablene
5. Klikk «Hent data»
6. Utforsk, roter og eksporter data

## SEO-sider (pre-rendering)
Appen er hash-rutet (`#topic/...`), som er usynlig for søkemotorer. `scripts/generate-seo-pages.mjs`
genererer derfor statiske, crawlbare emnesider med pene URL-er
(f.eks. `/okonomi/nasjonalregnskap-og-konjunkturer/nasjonalregnskap/`) og én side per
tabell, også avsluttede (`/table/{id}/`, Dataset-enes kanoniske landingssider for Google
Dataset Search)
direkte i webroot, pluss `sitemap.xml`, `robots.txt` og `seo-map.json` (rute → kanonisk URL,
brukes av `js/seo-head.js` til å holde canonical/og:-tagger i synk ved navigering i appen).
Sidene er fulle app-skall: brukere som lander der overføres umiddelbart til den tilsvarende
`#topic/...`- eller `#variables/{id}`-URL-en uten omlasting (via `window.__SEO_TOPIC_PATH__`-/
`window.__SEO_TABLE_ID__`-bootstrapen i `index.html`).

Generatoren dekker alle aktiverte kilder i `AppConfig.sources` — også Norges Bank- og
FHI-tabeller (`nb-*`/`fhi-*`) får egne `/table/{id}/`-sider og inngår i emnesider, sitemap og
`seo-map.json`. Katalogen bygges IKKE av generatoren selv: den leser den ferdigbygde
katalogindeksen i `{webroot}/data/index/` (`catalog-manifest.json` + per-kilde shards,
skrevet av `scripts/build-catalog-index.mjs`; lesingen ligger i `scripts/lib/seo-enumerate.mjs`).
Indeksen må derfor ha kjørt minst én gang mot samme webroot før generatoren kan kjøre.
Kildeattribusjon (JSON-LD `creator`/`license`, «Kilde:»-linjer) hentes per tabell fra
`AppConfig.sources.<kilde>.branding` (`scripts/lib/seo-sources.mjs`). Mangler indeksen, har
den ukjent format, eller dekoder SSB-shardet til færre enn `--min-tables` rader, avbrytes
kjøringen uten å røre webroot; en fremmed kildes shard som mangler eller ikke lar seg dekode
logges og hoppes over.

**Cron-rekkefølgen er lastbærende** — hvert steg bygges fra artefaktet forrige steg skrev, så
kjør i denne rekkefølgen (krever Node 18+):
```
node scripts/update-fhi-catalog.mjs --incremental
node scripts/update-nb-periods.mjs
node scripts/build-catalog-index.mjs --webroot /sti/til/webroot
node scripts/generate-seo-pages.mjs --webroot /sti/til/webroot --site https://statistikkportalen.no
```
SEO-generatoren konsumerer katalogindeksen forrige steg skrev — begge byggetidsartefaktene
(indeksen appen laster, og de statiske SEO-sidene) bygges dermed fra ett og samme
øyeblikksbilde av kildene og kan aldri bli uenige om hvilke tabeller som finnes.
`build-catalog-index.mjs` må ha kjørt minst én gang mot webroot før generatoren kan kjøre.
Som cron-jobb (ukentlig, natt til søndag):
```
15 4 * * 0 cd /sti/til/repo && \
  node scripts/update-fhi-catalog.mjs --incremental >> catalog.log 2>&1 && \
  node scripts/update-nb-periods.mjs >> catalog.log 2>&1 && \
  node scripts/build-catalog-index.mjs --webroot /sti/til/webroot >> catalog.log 2>&1 && \
  node scripts/generate-seo-pages.mjs --webroot /sti/til/webroot --site https://statistikkportalen.no >> seo-gen.log 2>&1
```
Bruk `--dry-run` på generatoren for å se hva som ville blitt skrevet. Scriptet sletter kun
filer det selv har generert (sporet i `{webroot}/.seo-manifest.json`), og avbryter uten å
røre webroot ved en manglende eller ubrukelig katalogindeks. De genererte filene skal ikke
sjekkes inn i git.

Tabellsidene berikes med innhold fra lokale metadatafiler i `data/table-metadata/{id}.json`
(eksakte responser fra `/tables/{id}/metadata`, lastes ned av et eget oppdaterings-script —
se `data/table-metadata/README.md` for kontrakten; katalogen overstyres med `--metadata-dir`).
Tabeller uten gyldig fil får samme innhold som før fra `/tables`-listen alene. Siden
metadatafilene kan være gamle, hentes tidsperiode og oppdatert-dato alltid fra den ferske
`/tables`-listen. Berikelsen gjelder kun SSB-tabeller; NB-/FHI-sidene bygges fra
katalogoppføringene alene.

## Systemkrav
- Moderne nettleser (Chrome, Firefox, Safari, Edge, Vivaldi)
- JavaScript aktivert
- Internettforbindelse (for API-kall)
- localStorage aktivert (for caching)

## Lisens
Denne koden er lisensiert under [MIT-lisens](LICENCE.md).
Data fra Statistisk sentralbyrå er lisensiert under [CC BY 4.0](https://www.ssb.no/diverse/lisens).
Data fra Statistiska centralbyrån er lisensiert under [CC0](https://www.scb.se/en/services/open-data-api/).
Data fra Norges Bank og Folkehelseinstituttet (FHI) hentes fra deres respektive åpne API-er og er underlagt disse etatenes egne vilkår for viderebruk.
