# Statistikkportalen 2.0 — veikart

Status per juli 2026: prototypen integrerer **Norges Bank** og **FHI** i det
eksisterende emnehierarkiet via kildeadaptere (`js/sources/`). SSB-flyten er
uendret. Adapterkontrakten er dokumentert i `js/sources/source-registry.js`.

## Aktivert i prototypen

- **Norges Bank** (under Økonomi → Bank og finansmarked): EXR (valutakurser),
  IR (styringsrenten), SHORT_RATES (NOWA), GOVT_GENERIC_RATES
  (statsobligasjonsrenter). Konfigureres i `AppConfig.sources.nb.dataflows`.
- **FHI** (under Helse og samfunn → Helse): kildene `nokkel`
  (Folkehelsestatistikk), `mfr` (Medisinsk fødselsregister), `daar`
  (Dødsårsaksregisteret). Konfigureres i `AppConfig.sources.fhi.sourceIds`.
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

### Norges Bank — 18 gjenstående dataflows
Aktiveres ved å utvide `AppConfig.sources.nb.dataflows` (+ ev. nye nivå-2-noder
i `AppConfig.sourceNodes`): ANN_KPRA, ANN_FX_SPU, SEC, GOVT_ZEROCOUPON,
GOVT_IRS (historisk, t.o.m. 2014), GOVT_KEYFIGURES, GOVT_PRIMARY_MARKET,
GOVT_SECONDARY_MARKET, CBC_CALENDAR, CBC_INSTRUMENTS, CBC_TRANSACTIONS,
LIQUIDITY_STATISTICS, LIQUIDITY_FORECAST, MONEY_MARKET, FAUCTION,
SETTLEMENT_STATISTICS, FINANCIAL_INDICATORS, REGNET.

### FHI — 10 gjenstående kilder
Aktiveres med én linje i `AppConfig.sources.fhi.sourceIds` (+ node i
`sourceNodes`): msis, sysvak, npr, kpr, lmr, gs, hkr, abr, ngs, skast.
NB: tids-/geodimensjonskoder varierer per kilde (DAAR/FYLKE,
FODSELSTIDSPUNKT_*); rolledeteksjonen i `fhi-adapter.js` er heuristisk og bør
sjekkes ved aktivering av nye kilder.

### Vedlikehold
- FHI-katalogen (`data/sources/fhi-catalog.json` — titler, tidsperioder,
  beskrivelser) er et øyeblikksbilde; kjør `node scripts/update-fhi-catalog.mjs`
  ved nye FHI-tabeller eller endrede sammendrag.
- ~64 lange FHI-titler (mest nokkel) kuttes ved ~90 tegn; kan finpusses manuelt
  i katalogfilen om ønskelig.

### Øvrig
- Kryssfiltrering av gyldige kombinasjoner finnes kun for Norges Bank
  (via `extension.validKeys` fra serieskeysonly); FHI har ingen tilsvarende
  serieliste i API-et.
- SEO-sidene (`scripts/*.mjs`) omfatter kun SSB; fremmede kilder er ekskludert.
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
