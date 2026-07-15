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

### Øvrig
- SEO-sidene (`scripts/*.mjs`) omfatter kun SSB; fremmede kilder er ekskludert.
- Permalenke-emulering for NB/FHI (saved query-ekvivalent via URL-state).
- Søkesynonymer for nye domener (renter, valuta, dødsårsaker, fødsler) i
  `synonyms.js`.
- Per-kilde oppdateringsplaner (`sourceUpdateTimes` gjelder i dag kun SSB;
  NB/FHI bruker ren 24 t cache-TTL).
- Klientside xlsx-eksport for NB/FHI (CSV finnes; xlsx krever et lite bibliotek).
- Engelske FHI-etiketter (kilden publiserer kun norsk; UI viser norsk med note).
- Favicon mangler (kosmetisk 404 i konsollen, fantes også før 2.0).
