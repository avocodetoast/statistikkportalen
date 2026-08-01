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
1. Server katalogen over HTTP — f.eks. `npx serve` eller `python3 -m http.server` — og åpne
   `index.html` derfra. Åpnet rett fra disk (`file://`) blokkerer nettleseren `fetch()` av
   lokale filer, så katalogindeksen er utilgjengelig; appen fungerer fortsatt, men faller
   tilbake til å hente hele katalogen direkte fra API-ene. Det er en dokumentert, bevisst
   degradert modus — ikke en feil.
2. Vent til tabellisten lastes (fra `data/index/`, deretter caches den automatisk)
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

Generatoren er siste steg i byggekjeden — se [Drift og deploy](#drift-og-deploy) for
rekkefølgen og cron-oppsettet. Bruk `--dry-run` for å se hva som ville blitt skrevet.
Scriptet sletter kun filer det selv har generert (sporet i `{webroot}/.seo-manifest.json`),
og avbryter uten å røre webroot ved en manglende eller ubrukelig katalogindeks. De genererte
filene skal ikke sjekkes inn i git.

Tabellsidene berikes med innhold fra lokale metadatafiler i `data/table-metadata/{id}.json`
(eksakte responser fra `/tables/{id}/metadata`, lastes ned av et eget oppdaterings-script —
se `data/table-metadata/README.md` for kontrakten; katalogen overstyres med `--metadata-dir`).
Tabeller uten gyldig fil får samme innhold som før fra `/tables`-listen alene. Siden
metadatafilene kan være gamle, hentes tidsperiode og oppdatert-dato alltid fra den ferske
`/tables`-listen. Berikelsen gjelder kun SSB-tabeller; NB-/FHI-sidene bygges fra
katalogoppføringene alene.

## Drift og deploy

Appen gjør **ingen eksterne API-kall ved sidelasting**: hele katalogen kommer fra en
forhåndsbygget indeks i `{webroot}/data/index/`. Det gjør byggekjeden og serverkonfigurasjonen
til en del av produktet, ikke bare av utrullingen.

### Byggekjeden — rekkefølgen er lastbærende

Hvert steg bygges fra artefaktet forrige steg skrev (krever Node 18+):

```
node scripts/update-fhi-catalog.mjs --incremental
node scripts/update-nb-periods.mjs
node scripts/build-catalog-index.mjs --webroot /sti/til/webroot
node scripts/generate-seo-pages.mjs  --webroot /sti/til/webroot --site https://statistikkportalen.no
```

SEO-generatoren konsumerer katalogindeksen steg 3 skrev. Begge byggetidsartefaktene — indeksen
appen laster og de statiske SEO-sidene — bygges dermed fra ett og samme øyeblikksbilde av
kildene og kan aldri bli uenige om hvilke tabeller som finnes. `build-catalog-index.mjs` må ha
kjørt minst én gang mot webroot før generatoren kan kjøre i det hele tatt.

Kjeden kjøres av GitHub Actions, ikke av en cron på serveren, og de fire stegene har hver sin
eier:

| Steg | Hvor | Når |
|---|---|---|
| 1-2 `update-fhi-catalog` / `update-nb-periods` | runneren, resultatet committes | `refresh-sources.yml`, ukentlig |
| 3 `build-catalog-index` | runneren, resultatet rsynces opp | `deploy.yml`, hver utrulling |
| 4 `generate-seo-pages` | serveren, over SSH | `deploy.yml`, hver utrulling |
| `update-table-metadata` | serveren, egen cron | månedlig |

`data/table-metadata/` er den ene tingen som fortsatt eier en cron på serveren. En kald kjøring
er ~10 000 tabeller rate-limitet til 20 kall/min, altså ~8,5 time — det hører ikke hjemme i en
Actions-jobb med 6 timers tak:

```
0 3 1 * * cd ~/statistikkportalen && node scripts/update-table-metadata.mjs >> table-metadata.log 2>&1
```

### Utrulling (GitHub Actions)

To workflows, begge triggbare manuelt fra Actions-fanen:

- **`deploy.yml`** — velg miljø (`staging` eller `production`). Ruller ut kode, bygger
  katalogindeksen og genererer SEO-sidene. Skru av `rebuild_index` for en ren kodeutrulling
  uten å vente på en full SSB-henting.
- **`refresh-sources.yml`** — ukentlig (natt til søndag, 04:15 UTC) og manuelt. Oppdaterer
  `data/sources/fhi-catalog.json` og `nb-periods.json`, committer dem hvis de endret seg, og
  kaller `deploy.yml` mot produksjon etterpå — også når ingenting ble committet, siden
  SSB-katalogen endrer seg uavhengig av de to filene.

**Rekkefølgen inne i `deploy.yml` er valgt slik at alt som kan feile skjer før serveren røres.**
Runneren speiler først ned serverens `data/index/` (~200 KB) — den er både krympe-guardens
sammenlikningsgrunnlag og byggerens egen oppryddingsliste — bygger indeksen lokalt, og synker
først da opp. Slår en guard til, står serveren fullstendig urørt.

SEO-generatoren kjøres derimot på serveren. Den beriker tabellsidene fra
`data/table-metadata/`, som er gitignorert og kun finnes der.

Hemmeligheter og variabler som må finnes i repoet:

| Navn | Sted | Innhold |
|---|---|---|
| `SSH_HOST` | repo-hemmelighet | `bruker@vert` |
| `SSH_PRIVATE_KEY` | repo-hemmelighet | egen deploy-nøkkel, ikke en personlig nøkkel |
| `SSH_KNOWN_HOSTS` | repo-hemmelighet | output fra `ssh-keyscan <vert>` — vertsnøkkelen pinnes |
| `CF_API_TOKEN` | repo-hemmelighet | Cloudflare-token med purge-rettighet |
| `CF_ZONE_ID` | variabel per environment | sone-ID for `staging` hhv. `production` |

Miljøene `staging` og `production` må opprettes under Settings → Environments (det er der
`CF_ZONE_ID` bor, og der du eventuelt legger på en godkjenningsregel for produksjon).

Serveren må ha Node 18+ tilgjengelig i en **ikke-interaktiv** SSH-shell — `ssh vert 'node -v'`
må svare. nvm settes typisk kun opp i interaktive shell; svarer den ikke, må absolutt sti til
`node` brukes i `deploy.yml`. Port 22 må være åpen for GitHub-hostede runnere.

### Feilhåndtering

`build-catalog-index.mjs` avslutter med exit ≠ 0 og har da skrevet **null filer** når:

- SSB-hentingen feiler, eller gir færre enn `--min-tables` rader
- krympe-guarden slår til: et shard er mer enn `--max-shrink` % (standard 10) mindre enn det
  som allerede ligger i webroot — fanger en avkortet, men HTTP 200, katalog

Siden indeksen bygges på runneren, slår begge guardene til **før** noen fil er rørt på serveren:
jobben stopper, ingenting synkes opp, og SEO-steget kjøres ikke — det siste er poenget, ellers
bygges sidene mot en indeks som ikke ble oppdatert. En fremmed kilde (NB/FHI) som feiler er
derimot feilisolert — forrige shard bæres videre og kjøringen lykkes.

Byggeren skriver aldri en halv indeks over en god: alle shards bygges ferdig i minnet, filene
skrives med tmp+rename, og **manifestet skrives sist**. En leser som løper kappløp med byggeren
ser derfor enten det gamle manifestet (gamle shards ligger der ennå) eller det nye — aldri et
manifest som peker på en fil som ikke finnes.

Den garantien må kopieringen til serveren opprettholde, og det gjør den ikke av seg selv: rsync
overfører alfabetisk, og `catalog-manifest.json` kommer før `fhi-`, `nb-` og `ssb-`-shardene.
`deploy.yml` synker derfor indeksen i **tre pass** — shards først (`--exclude
catalog-manifest.json`), så manifestet alene, så et opprydningspass med `--delete`. Ett enkelt
rsync ville brutt nøyaktig den garantien byggeren jobber for.

### Filkopiering

- **`.json` og `.json.br` må begge med.** Bare `.json` betyr at du serverer 1,76 MB i stedet
  for 183 KB.
- **`data/index/` må ekskluderes fra kode-rsyncen.** Kopien som ligger i git er en *testfixture*
  (SSB-shardet har 83 rader, og `tests/unit/catalog-index-load.test.js` asserter mot den) — ikke
  en produksjonsindeks. Uten den excluden overskriver hver utrulling den ekte indeksen med
  fixture-data.
- **`data/table-metadata/` må også ekskluderes.** Den er gitignorert og bor kun på serveren.
- **Ingen `--delete` mot webroot.** Der ligger de genererte SEO-sidene; generatoren rydder selv
  etter sitt eget `.seo-manifest.json`.
- **`--delete` brukes kun på siste pass av `data/index/`-synken, og der er den nødvendig.** Runnerens
  indeksmappe er serverens mappe speilet ned, pluss den nye generasjonen, minus det byggeren
  selv pruget — altså nøyaktig de generasjonene `--keep-generations` (standard 2) skal beholde,
  så en klient som allerede har lest det gamle manifestet fortsatt får sitt shard. Uten
  `--delete` ville gamle shards hopet seg opp på serveren for alltid.

### Servering (Caddy)

Filnavnene på shardene er innholdshashet, så de kan caches for alltid. Manifestet er den ene
fila som endrer innhold under fast navn, og er ~600 B.

```caddyfile
statistikkportalen.no {
    root * /sti/til/webroot

    @indexShards path_regexp "^/data/index/.+-[0-9a-f]{8}\.json$"
    header @indexShards Cache-Control "public, max-age=31536000, immutable"

    @indexManifest path /data/index/catalog-manifest.json
    header @indexManifest Cache-Control "public, max-age=300, must-revalidate"

    encode zstd gzip

    file_server {
        precompressed br gzip
    }
}
```

De to komprimeringslinjene gjør **hver sin jobb, og dekker hver sine filer** — du trenger begge:

- `precompressed br gzip` får Caddy til å servere `.br`-tvillingen byggeren allerede har laget
  (brotli kvalitet 11, komprimert én gang på byggetid — null CPU per forespørsel). Den gjelder
  kun `data/index/`, for det er de eneste filene som har en `.br`-tvilling. `precompressed`
  komprimerer aldri noe selv: finnes ikke tvillingen, går fila ut rå.
- `encode zstd gzip` komprimerer on-the-fly, og er derfor det eneste som dekker `js/`,
  `css/` og `index.html`. **Utelater du den, serveres 764 KB JavaScript ukomprimert** (39
  `<script>`-tagger, ~845 KB totalt med CSS og HTML). Med `encode` faller det til ~220 KB med
  gzip, ~185 KB for nettlesere som støtter zstd. Caddy hopper selv over filer som allerede er
  dekket av `precompressed`.

**Skriv aldri `br` i `encode`-linja.** Standard Caddy — inkludert det offisielle
`caddy:latest`-imaget — har ingen brotli-*encoder*; den krever en plugin bygget inn med xcaddy.
Direktivet parser ikke, og Caddy nekter å starte i det hele tatt:

```
Error: adapting config using caddyfile: parsing caddyfile tokens for 'encode':
finding encoder module '': module not registered: http.encoders.br
```

Ligger flere vhoster i samme Caddyfile, tar den feilen ned alle sammen samtidig. `precompressed
br gzip` er derimot en **annen modul** (`http.precompressed.br`) som *er* med i standardbygget —
å servere ferdigkomprimerte `.br`-filer virker fint. Det er kun komprimering i sanntid som
mangler.

Caddy setter `Content-Encoding` og `Vary` selv i begge tilfeller. På nginx heter de to tingene
`brotli_static on` og `gzip on` — `brotli_static` krever tredjepartsmodulen `ngx_brotli`, som
ikke er med i standardpakkene, mens `gzip on` er innebygd. Mønsteret er altså det samme i begge
serverne: statisk brotli er gratis, brotli i sanntid koster en modul.

**Minifisering av JS-en er bevisst ikke gjort.** Målt med terser (`--compress --mangle`, ikke
`--toplevel` — modulene henger på `window`, så toppnivånavn må stå urørt) gir det 169 KB → 70 KB
brotli. Det er ~100 KB på toppen av de ~660 KB `encode` alene henter, og prisen er et byggesteg
prosjektet i dag klarer seg uten. Vurderes det på nytt, hører det hjemme i cron-kjeden sammen med
katalogindeksen — ikke som noe utviklere må kjøre lokalt — og bundling gir mer enn minifisering
alene, siden 39 forespørsler koster mer enn de siste 100 KB.

### Røyktest etter deploy

`deploy.yml` kjører disse tre automatisk som siste steg og feiler jobben hvis én av dem ikke
holder — de står her for manuell feilsøking:

```
curl -sI -H 'Accept-Encoding: br' https://statistikkportalen.no/data/index/catalog-manifest.json
curl -s  -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}\n' \
     https://statistikkportalen.no/data/index/<ssb-shard-fra-manifestet>.json
curl -s  -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}\n' \
     https://statistikkportalen.no/index.html
```

Første skal vise `cache-control: public, max-age=300, must-revalidate`. Er headeren helt
fraværende, mangler `header @indexManifest`-blokka i serverkonfigurasjonen.

Andre skal gi ~187 000 bytes mot ~1 800 000 rå. Nummer tre tester `encode`-direktivet, som er
en annen feil med et annet symptom: `index.html` er den eneste fila som garantert finnes og som
kun `encode` dekker (aldri `precompressed`, den har ingen `.br`-tvilling). Er tallet like stort
som fila på disk, komprimeres ingenting — da mangler `encode` i serverblokka, og hele appkoden
går ut rå.

**Står nettstedet bak Cloudflare, måler ikke test to det du tror.** Cloudflare komprimerer selv
på vei ut, så et shard ser komprimert ut selv om origin sendte det rått og `precompressed`
mangler. Symptomet er at tallet er merkbart *større* enn de ~187 000 byggeren rapporterte
(Cloudflares brotli er raskere og svakere enn byggerens kvalitet 11). Vil du måle origin, må du
gå utenom edgen:

```
curl -s --resolve statistikkportalen.no:443:<origin-ip> \
     -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}\n' \
     https://statistikkportalen.no/data/index/<ssb-shard>.json
```

### Overvåking

En jobb som slutter å kjøre er den farligste stille feilen her: portalen ser helt frisk ut med
tre uker gamle tall. Statusbadgen i appen blir gul når indeksen er eldre enn
`AppConfig.catalogIndex.staleAfterMs` (48 timer), og statuspanelet skriver hvor gammel den er,
men det forutsetter at noen ser på den.

GitHub varsler på e-post når en schedulert workflow feiler, men **ikke** når den slutter å
kjøre — Actions deaktiverer schedulerte workflows automatisk i repoer uten aktivitet på 60
dager. Sjekk derfor `generatedAt` i `catalog-manifest.json` med jevne mellomrom, ikke bare
kjørelogger:

```
curl -s https://statistikkportalen.no/data/index/catalog-manifest.json | grep generatedAt
```

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
