# Statistikkportalen 2.0 — veikart

Status per juli 2026: prototypen integrerer **Norges Bank** og **FHI** i det
eksisterende emnehierarkiet via kildeadaptere (`js/sources/`). SSB-flyten er
uendret. Adapterkontrakten er dokumentert i `js/sources/source-registry.js`.

## Aktivert i prototypen

- **Norges Bank** (under Økonomi → Bank og finansmarked): 18 dataflows fordelt
  på fem emnenoder — renter (IR, SHORT_RATES, GOVT_GENERIC_RATES,
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
  kryssfilteret gråer ikke ut noe inne i dem. **Neste kandidater:**
  MONEY_MARKET og GOVT_SECONDARY_MARKET, som har samme sparsomhetsproblem.
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
- **Per-kilde status + resiliens**: portalen fungerer (degradert, tydelig
  merket) selv når SSB er nede. Statusbadge i headeren («3/3 API-er lastet
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

### Vedlikehold
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
