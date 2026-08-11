# Statistikkportalen 2.0 — veikart

Status per august 2026: prototypen integrerer **Norges Bank**, **FHI** og
**DBH (HK-dir)** i det eksisterende emnehierarkiet via kildeadaptere
(`js/sources/`). SSB-flyten er uendret. Adapterkontrakten er dokumentert i
`js/sources/source-registry.js`.

## Aktivert i prototypen

- **Norges Bank** (under Økonomi → Bank og finansmarked): 18 dataflows —
  31 tabellrader, siden 13 av dem er kuraterte snitt (se de to punktene under)
  — fordelt på fem emnenoder — renter (IR, SHORT_RATES, GOVT_GENERIC_RATES,
  GOVT_ZEROCOUPON), valutakurser (EXR), statsgjeld/statspapirer (SEC,
  GOVT_ZEROCOUPON, GOVT_KEYFIGURES, GOVT_PRIMARY_MARKET,
  GOVT_SECONDARY_MARKET, GOVT_IRS — historisk, merket avsluttet),
  likviditet/pengemarked (LIQUIDITY_STATISTICS, LIQUIDITY_FORECAST,
  MONEY_MARKET, FAUCTION, CBC_TRANSACTIONS, SETTLEMENT_STATISTICS) og
  indikatorer (FINANCIAL_INDICATORS, REGNET). Konfigureres i
  `AppConfig.sources.nb.dataflows`; tunge flows bruker `probeKey` (smal
  SDMX-nøkkel) for katalogperiode-/tidsprobene. Dimensjoner med koder som
  ikke kan stå i nøkkelstien (punktum/skråstrek: GOVT_PRIMARY_MARKET
  COUPON/INSTR, CBC_TRANSACTIONS INSTR) filtreres klientside.
- **Kuraterte NB-tematabeller (`slice`)**: en dataflow der de fleste
  dimensjonskombinasjonene ikke finnes gir en variabelvelger full av utgråede
  verdier. `slice: {DIM: 'kode'|[koder]}` på en config-rad snitter flowen ned
  til ett tema; enkeltkode-snitt fjerner dimensjonen helt fra velgeren og
  resultattabellen, men pinner koden i API-nøkkelen. Flere rader kan dele samme
  `flow`. Regionalt nettverk (REGNET) er første kilde ut: den fulle tabellen
  («alle indikatorer») står ved siden av seks kuraterte tabeller —
  produksjonsvekst, investeringsplaner, sysselsettingsvekst og -planer,
  regionalindikator, kapasitetsutnytting/lønnsomhet/knapphet på arbeidskraft,
  og årslønnsvekst. Alle seks er verifisert som fulle rektangler, så
  kryssfilteret gråer ikke ut noe inne i dem.
- **Kuraterte statspapirtabeller (`slice`)**: samme mekanisme brukt på de to
  sparsomme GOVT-samletabellene, alle med felles tittelprefiks («Statslån,
  førstehåndsmarkedet» / «… annenhåndsmarkedet») så familien sorterer samlet.
  Førstehåndsmarkedet er delt på `ISSUE_TYPE`
  (utstedelsesauksjoner, syndikeringer, RFQ-salg, tilbakekjøpsauksjoner,
  statens egenbeholdning) — måleenhetene følger emisjonsformen, så bare
  tilbakekjøpsauksjonene har vektet snittkurs/-rente. Annenhåndsmarkedet er
  delt på `UNIT_MEASURE` (omsetning / gjenkjøpsavtaler). Begge de fulle
  samletabellene står igjen ved siden av snittene. Merk at disse IKKE er fulle
  rektangler: `INSTRUMENT_TYPE` er funksjonelt bestemt av ISIN, men beholdt som
  filter (utgråingen er meningsbærende), og annenhåndsmarkedets sparsomhet er
  ekte — ikke alle lån handles med alle motpartstyper i alle regioner.
  Tabellene har `dimOrder` slik at papirtypen står foran lista over enkeltlån,
  og bevisst INGEN `timeUnit`: alle NB-tabellene i noden må ligge i samme
  frekvensbøtte, ellers deler `MenuHierarchy.groupTables` emnenoden i
  «Månedstall» + «Andre tabeller».
  **Neste kandidat:** MONEY_MARKET, som har samme sparsomhetsproblem.
- **FHI** (under Helse og samfunn → Helse): alle 13 kilder i det åpne API-et
  (`nokkel`, `mfr`, `daar`, `msis`, `sysvak`, `npr`, `kpr`, `lmr`, `gs`,
  `hkr`, `abr`, `ngs`, `skast`). Konfigureres i
  `AppConfig.sources.fhi.sourceIds`.
- **FHI register → kategori-hierarki + kuraterte titler**: alle 370
  FHI-tabeller har håndkuraterte visningstitler, og kilder med mange
  tabeller er inndelt i kategorier på laveste emnetre-nivå (f.eks.
  Medisinsk fødselsregister → «Fødsler og fødte», Norsk pasientregister →
  «Diagnoser (ICD-10-kapittel)») — kuratert i
  `data/sources/fhi-curation.json`, som `scripts/update-fhi-catalog.mjs`
  fletter inn i `data/sources/fhi-catalog.json` ved hver regenerering
  (kurateringen overskrives aldri; se scripts/lib/fhi-curation.mjs).
- **DBH** (under Arbeid, lønn og utdanning → Utdanning): 14 kuraterte tabeller
  fra HK-dirs DBH-API, fordelt på seks emnenoder (Studenter og søkere,
  Studietilbud, Fagskoler, Tilsatte, Vitenskapelig publisering,
  Institusjonsdata). Kuratert katalog i `js/sources/dbh-catalog.js` med
  reduserte dimensjonssett per tabell (API-et aggregerer server-side);
  årsdekning + dimensjonsverdier probes ved byggetid av
  `scripts/update-dbh-metadata.mjs` → `data/sources/dbh-metadata.json`.
  Datauttrekk filtrerer kun på Årstall server-side (ytelse — se
  `api-dbh`-skillen), resten klientside. Utvalget bygger på en systematisk
  gjennomgang av alle 23 Data-tabeller i API-et (aug. 2026).
- **Per-kilde status + resiliens**: portalen fungerer (degradert, tydelig
  merket) selv når SSB er nede. Statusbadge i headeren («4/4 API-er lastet
  inn», grønn/gul/rød) med panel per kilde: status, cache-info, tabellantall,
  retry/refresh, «Oppdater alle», tøm cache per kilde (`js/source-status.js`).
  Stale-if-error: utløpt katalog-cache serveres når en kilde er nede
  (retensjon `AppConfig.cache.staleRetentionMs`, 7 dager).
- **Multi-path-plasseringer** for fremmede kilder: én NB-/FHI-tabell kan
  ligge under flere emnestier (som SSBs multi-mappe-tabeller) via
  `AppConfig.sources.nb.dataflows[].paths` / `AppConfig.sources.fhi.paths`.
  Eksempel aktivert: nb-EXR (valutakurser) under både Bank og finansmarked
  og Utenriksøkonomi.

## Gjenstår til senere

### Norges Bank — 4 bevisst utsatte dataflows
ANN_KPRA, ANN_FX_SPU, CBC_CALENDAR og CBC_INSTRUMENTS er register-/
kunngjøringstabeller: én rad per hendelse der innholdet ligger i
attributtkolonner (`VALID_FROM`, `DELTA_VALUE`, `AUCTION_DATE`, `TICKER`,
`MATURITY`, …), ikke i observasjonsverdier. SDMX→JSON-Stat2-konverteringen
(`sdmx-to-jsonstat.js`) bærer kun observasjonsverdier, så tabellene ville
vist tomme/meningsløse celler i GUI-et. Krever attributt-støtte i
konverteren (egen kolonne per attributt) før de kan aktiveres.

### DBH — 9 bevisst utsatte tabeller
- **906 Eksamensdata detaljert** og **374 Publisering – kanaler**: mangler
  tidsakse helt (totaler aggregert over alle år) — uegnet som statistikktabell.
- **705/706/707 Gjennomføring og frafall (sektor-/studium-/programnivå)**:
  bit-identisk metadata og likt radantall som hverandre; uklart skille.
  704 (institusjonsnivå) er aktivert — vurder én av de andre hvis behovet
  oppstår.
- **543/544 Videreutdanning lærere** og **537 Lærlinger**: avsluttede serier
  (siste år 2019). Kan aktiveres som historiske tabeller ved behov.
- **948 Fagskolestudenter utenfor telletidspunkt**: bare 13 rader/år.
- `Kjønn` (0/1) og `Opptakstype` (L/N) mangler kodetekst i DBH selv — vises
  som koder. Kuratert etikettkart i katalogen er mulig hvis betydningen
  bekreftes med HK-dir.

### Vedlikehold
- DBH-metadataene (`data/sources/dbh-metadata.json` — årsdekning +
  dimensjonsverdier per kuratert tabell) er et øyeblikksbilde; kjør
  `node scripts/update-dbh-metadata.mjs` ved nye årganger (inngår i
  `bin/refresh.sh dbh`).
- FHI-katalogen (`data/sources/fhi-catalog.json` — titler, tidsperioder,
  beskrivelser) er et øyeblikksbilde; kjør `node scripts/update-fhi-catalog.mjs`
  ved nye FHI-tabeller eller endrede sammendrag. Manuell kuratering
  (visningstitler + kategorier) ligger i `data/sources/fhi-curation.json` og
  flettes inn automatisk ved hver kjøring — nye tabeller uten kuratering
  havner rett under registernoden og listes som advarsel av scriptet.
- Rolledeteksjonen (tid/geo) i `fhi-adapter.js`/`update-fhi-catalog.mjs` er
  heuristisk (`TIME_PATTERN`/`TIME_EXACT`, bevisst duplisert — hold i sync);
  byggescriptet logger tabeller uten gjenkjent tidsdimensjon, sjekk loggen
  ved nye kilder/tabeller.

### ~~Funn fra adapterlag-review (aug. 2026)~~ — **Gjort**

Fra en ekstern kodereview (Codex), etterprøvd mot koden. Alt under er fikset
(aug. 2026), med regresjonstester som feilet før fiks:

- ~~`js/cache.js` nivåbytte rydder ikke gammel representasjon~~ — `set()`
  rydder nå motsatt lager i alle skrivestier (`tests/unit/cache-storage-transition.test.js`).
- ~~`adapterForTableId()` ruter deaktivert kildes id-er til SSB~~ — returnerer
  nå `null` (→ lesbar feil) når en deaktivert fremmed kilde eier id-en.
- ~~Status-race mellom kataloglasting og `reloadSource()`~~ — verifisert reell;
  fikset med attempt-token per kilde (eldre operasjons resultat droppes stille).
- ~~Id→kilde-regelen hardkodet tre steder~~ — nå deklarert én gang som
  `AppConfig.sources.<kilde>.idPrefix`; `utils.js`, `cache.js` og
  `seo-sources.mjs` deriverer fra config.
- ~~`KNOWN_ADAPTERS`-sett + `if`-kjede i `catalog-sources.mjs`~~ — nå én
  `ADAPTER_PROVIDERS`-map (registrering og dispatch samlet).
- ~~Katalognormalisering/emnesti-bygging duplisert adapter vs. SEO~~ — delt
  kjerne i `js/sources/catalog-shared.js` (lastes av byggeskriptene via
  `scripts/lib/catalog-shared.mjs`, samme mønster som `period-format.js`);
  ekvivalenstest i `tests/unit/catalog-shared.test.js` er driftvernet.
- ~~Cache-oppslag/feiltolerante wrappere duplisert i NB-/FHI-adapterne~~ —
  delt `SourceCommon.sharedCache()/cacheGet()/cacheSet()`.

### Øvrig
- Kryssfiltrering av gyldige kombinasjoner finnes kun for Norges Bank
  (via `extension.validKeys` fra serieskeysonly); FHI har ingen tilsvarende
  serieliste i API-et.
- ~~SEO-sidene (`scripts/*.mjs`) omfatter kun SSB; fremmede kilder er
  ekskludert.~~ **Gjort:** `generate-seo-pages.mjs` enumererer nå alle
  aktiverte kilder via providere i `scripts/lib/seo-sources.mjs` (NB fra
  config + periodeprobe, FHI fra `fhi-catalog.json`), med per-kilde
  attribusjon fra `AppConfig.sources.<kilde>.branding`. Gjenstår:
  `update-table-metadata.mjs`-berikelse er fortsatt SSB-only (NB-/FHI-sidene
  bygges fra katalogoppføringene alene).
- Permalenke-emulering for NB/FHI (saved query-ekvivalent via URL-state).
- Søkesynonymer for nye domener (renter, valuta, dødsårsaker, fødsler) i
  `synonyms.js`.
- Per-kilde oppdateringsplaner (`sourceUpdateTimes` gjelder i dag kun SSB;
  NB/FHI bruker ren 24 t cache-TTL).
- Automatisk bakgrunns-retry av feilede kilder (bevisst utelatt i første
  omgang; statusflaten `api.onSourceStatusChange` + `api.reloadSource` gjør
  den triviell å legge til).
- Klientside xlsx-eksport for NB/FHI (CSV finnes; xlsx krever et lite bibliotek).
- Engelske FHI-etiketter (kilden publiserer kun norsk; UI viser norsk med note).
- Favicon mangler (kosmetisk 404 i konsollen, fantes også før 2.0).
