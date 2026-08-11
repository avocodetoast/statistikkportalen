---
name: api-norges-bank
description: Verifisert oppførsel i Norges Banks SDMX-API som avviker fra eller utfyller spec — frekvensspesifikke TIME_PERIOD-koder, nøkkelsyntaks-fallgruver (FREQ-posisjon, skråstrek/punktum i koder), responsformater og valgfrie parametere, ISIN-avhengige dimensjoner, probe-kostnader, fravær av cellegrense. Load ved endringer i js/sources/norges-bank-adapter.js, js/sources/sdmx-to-jsonstat.js, js/sources/nb-catalog.js, scripts/update-nb-periods.mjs, ved aktivering av nye NB-dataflows, eller ved feilsøking av NB-spørringer/responser.
---

# Norges Bank (SDMX) — API-funn

Oppdaget oppførsel som avviker fra eller utfyller spesifikasjonen. Nye funn
legges til her, datert. SSB/FHI har egne skills (`api-ssb`, `api-fhi`).

## TIME_PERIOD-koder er frekvensspesifikke

TIME_PERIOD-kodene følger frekvensen til serien: `B` (virkedag) → `2025-07-15`,
`M` → `2025-07`, `A` → `2025`. Et `startPeriod`/`endPeriod`-intervall uttrykt
som daglige datoer gir derfor aldri treff mot års-/månedsserier — tidsutvalget
må uttrykkes i samme granularitet som valgt frekvens.

API-et godtar riktignok flere frekvenser i ett kall (`+`-syntaks i
nøkkelsegmentet, f.eks. `/data/EXR/A+M.USD.NOK.SP`), men periodene aligner
aldri på tvers av frekvenser, så resultatet blir en nesten tom
FREQ×TIME_PERIOD-kryssmatrise — og `startPeriod`/`endPeriod` kan bare
uttrykkes i én granularitet.

**Konsekvens:** `norges-bank-adapter.js` prober tidsvinduet én gang pr. faktisk
frekvens (frekvensene hentes fra `detail=serieskeysonly`-proben) og emitterer
`extension.timePeriodsByFreq` i metadataene; `variable-select-status.js`
(`applyTimeFreqFilter`) bruker den til å begrense tidslisten til perioder som
finnes for valgt frekvens. Adapteren merker FREQ med
`dimension.FREQ.extension.singleSelect = true`, som UI-en håndhever som
radio-adferd (kun én frekvens kan velges).

## Responsformater og valgfrie parametere (verifisert 2026-07)

Verifisert mot det levende API-et (`/api/data/{FLOW}/{key}`):

- `format=`-verdier som fungerer (HTTP 200): `sdmx-json`, `csv`, `csv-ts`
  (én tidsserie per rad), `excel-both` (API-ets egen standard), `excel-ts`.
  `sdmx-csv` fungerer også, men er udokumentert. XML-varianter
  (`genericdata`, `structurespecificdata`, `jsondata`, `xml`) avvises med 406.
- `detail=` godtar `full` (standard), `dataonly`, `serieskeysonly`, `nodata`;
  ugyldig verdi gir 400.
- `includeHistory=true`, `bom=true` (UTF-8 BOM, Excel-vennlig CSV) og
  `updatedAfter=`/`dimensionAtObservation=` aksepteres. `locale=no|en`.

**Konsekvens:** API-byggeren (variable-select) eksponerer format, detail,
includeHistory og bom via `buildApiQuery`-options; appen selv henter alltid
`sdmx-json`.

## Nøkkelsyntaks-fallgruver (verifisert 2026-07)

Funnet under aktiveringen av de 14 nye dataflowene:

- **FREQ er ikke alltid første dimensjon.** GOVT_IRS har FREQ sist (posisjon
  9 av 9), GOVT_KEYFIGURES/GOVT_PRIMARY_MARKET har den midt i, og FAUCTION
  har ingen FREQ-dimensjon i det hele tatt. Nøkler må bygges mot
  DSD-/serieskeysonly-posisjonene, ikke antas å starte med frekvensen.
- **En helt tom nøkkel («..») gir 400** — «alle serier» må uttrykkes som
  `all` (eller ved å utelate nøkkelsegmentet i URL-en helt).
- **Koder med skråstrek kan ikke stå i nøkkelstien**: Tomcat avviser kodet
  skråstrek (`%2F`) med 400 «The encoded slash character is not allowed»
  (GOVT_PRIMARY_MARKET/CBC_TRANSACTIONS `INSTR`-koder som «NTB 03/2004»).
  Koder med punktum (GOVT_PRIMARY_MARKET `COUPON`, «0.00000000») kolliderer
  med segmentskilletegnet og kan heller ikke uttrykkes. Slike dimensjoner må
  hentes ufiltrert og filtreres klientside.
- **Koder med mellomrom fungerer** percent-enkodet (`%20`): GOVT_IRS
  `COUNTERPARTY` («Danske Bank») gir 200.
- **Åpne prober er dyre for store flows**: MONEY_MARKET (34 025 serier) gir
  3,5 MB for `?firstNObservations=1&lastNObservations=1` og 15,6 MB for en
  åpen `lastNObservations=60`-probe. Adapteren bruker derfor smale
  `probeKey`-utsnitt fra config for slike flows.
- Alle 22 dataflows i `/dataflow/NB` er versjon 1.0 unntatt IR (1.1) og
  SHORT_RATES (1.2).

## Kjennetegns-dimensjoner er funksjonelt avhengige av ISIN (verifisert 2026-07)

Verifisert mot serieskeysonly for verdipapir-flowene:

- **GOVT_PRIMARY_MARKET**: ISIN → (MATURITY, COUPON, INSTR) er en streng
  funksjonell avhengighet — 125 ISIN-er ↔ 125 forfallsdatoer ↔ 125
  INSTR-navn. MATURITY/COUPON/INSTR er altså *kjennetegn ved verdipapiret*
  (slik Norges Banks eget datatorg viser dem som kolonner), ikke
  selvstendige filtre.
- **CBC_TRANSACTIONS**: ISIN → (MATURITY, INSTR, ISSUE_TYPE,
  INSTRUMENT_TYPE, FREQ). INSTR er mange-til-én (flere sertifikater deler
  navn).
- **GOVT_SECONDARY_MARKET**: ISIN → INSTRUMENT_TYPE, men har ingen
  MATURITY/COUPON/INSTR-dimensjoner.
- Appen kollapser slike dimensjoner inn i ankerdimensjonen via
  `collapseDims` i config-raden (se `applyCollapseDims` i
  norges-bank-adapter.js).
- **Punktum-koder gjør '.'-joinede serienøkler tvetydige**: serieskeysonly-
  nøkler som joines med `.` (GOVT_PRIMARY_MARKET COUPON «0.00000000») kan
  ikke splittes trygt igjen — kryssfilteret i UI-en feiltolket segmentene
  for denne flowen før adapteren gikk over til å bære kodearrayer
  (`keyTuples`) i tillegg.
- **DSD-ens navn er ofte kun engelsk** (`names: {en}`), mens dataflow-
  ressursen har både `no` og `en`. Metadata-tittelen bygges derfor fra den
  kuraterte configetiketten (`flow.label`), med DSD-navnet kun som fallback
  — ellers bytter tabelltittelen til engelsk når metadata lastes.
- **Nøkkeltallenes tilgjengelighet styres av filtrene** (ikke omvendt):
  i GOVT_PRIMARY_MARKET finnes auksjonsmålene (BC, V_B, Y, P) kun for
  ISSUE_TYPE=AU og de veide snittmålene (Y_WA, BY_L, BPH, P_WA) kun for BB,
  mens kjernemålene (C_V, DU, O_V, SD, V_A, V_O, YM) finnes for alle
  emisjonstyper; i GOVT_SECONDARY_MARKET finnes repovolum (V_R) kun for
  enkelte motparter. UI-ets kryssfilter er derfor gjort énveis for
  `role.metric`-dimensjoner (nøkkeltallsvalg begrenser aldri filtrene) og
  visningen seksjonert i filtre/nøkkeltall — se
  `sectionedDimensionLayout`/`computeCrossFilterEnabled`.

## Ingen cellegrense (målt 2026-08-02)

Full EXR = 1 544 388 celler levert på 1,5 s (7,4 MB). MONEY_MARKET: 61 MB /
3,1 mill. observasjoner på 11,2 s, HTTP 200. Kun SSB har et ekte celletak
(se `api-ssb`).

NB traff likevel sjelden det gamle globale 800 000-taket, og det er verdt å
vite hvorfor: celletelleren anslår perioder for den VALGTE frekvensen, ikke
alle frekvenser samtidig. Full EXR blir derfor 2 747 celler i UI-et, ikke
1 544 388 — sistnevnte er kryssproduktet i selve API-svaret (alle tre
frekvenser × 12 556 perioder). Sperringen var altså feil av prinsipp for NB,
ikke en daglig plage.

**Konsekvens:** `AppConfig.limits.bySource.nb` har `maxCells: null` (kun myke
advarsler). Advarselen måles mot ANSLÅTTE observasjoner (serier × perioder),
ikke det tette kryssproduktet: SDMX er sparsomt, og GOVT_PRIMARY_MARKET har
et kryssprodukt på 5,2 billioner celler mot 11 264 faktiske observasjoner.

## 404 = tomt resultat

NB-API-et svarer 404 når en spørring ikke matcher noen serier — det er et
tomt resultat, ikke en feil. Adapteren oversetter dette; fasaden skiller
«tomt» fra «feilet». (FHI har motsatt semantikk — se `api-fhi`.)
