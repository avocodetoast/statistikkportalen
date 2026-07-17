# API-funn (PxWebApi v2)

Oppdaget oppførsel i SSBs API som avviker fra eller utfyller spesifikasjonen.
Nye funn legges til her.

## `link.describedby` har to former (metadata-endepunktet)

`GET /tables/{id}/metadata` leverer Klass-/VarDok-referanser i `link.describedby`
(datasett- og dimensjonsnivå) i **to ulike former**:

1. `{ "href": "urn:ssb:classification:klass:104", "label": "..." }` — formen
   appens `js/table-metadata.js` antar.
2. `{ "extension": { "Region": "urn:ssb:classification:klass:104 urn:ssb:classification:klass:131 ..." } }`
   — en **mellomromsseparert URN-liste** per dimensjonskode. Observert juli 2026
   på bl.a. tabell 07459 (Region/Kjonn/Alder) og 12869; ingen `href`/`label` i det hele tatt.

`scripts/generate-seo-pages.mjs` (`buildEnrichedSections`) håndterer begge former.
NB: `buildMetadataSection()` i `js/table-metadata.js` håndterer kun form 1, så
«Klassifikasjoner og definisjoner»-seksjonen i appen vises ikke for tabeller som
bruker form 2.

URN-oppløsning:
- `urn:ssb:classification:klass:{id}` → `https://www.ssb.no/klass/klassifikasjoner/{id}`
- `urn:ssb:conceptvariable:vardok:{id}` → `https://www.ssb.no/a/metadata/conceptvariable/vardok/{id}/{nb|en}`

## Ugyldige datoer i `/tables`-listen

Enkelte tabeller har åpenbart ugyldige `updated`-verdier (f.eks. tabell 04197
med `"0003-10-13"`). Google avviser slike i sitemap/JSON-LD — `isoDate()` i
`scripts/generate-seo-pages.mjs` dropper datoer utenfor 1900–(inneværende år + 1).

## Norges Bank (SDMX): TIME_PERIOD-koder er frekvensspesifikke

TIME_PERIOD-kodene i Norges Banks SDMX-API følger frekvensen til serien:
`B` (virkedag) → `2025-07-15`, `M` → `2025-07`, `A` → `2025`. Et
`startPeriod`/`endPeriod`-intervall uttrykt som daglige datoer gir derfor
aldri treff mot års-/månedsserier — tidsutvalget må uttrykkes i samme
granularitet som valgt frekvens. `norges-bank-adapter.js` prober derfor
tidsvinduet én gang pr. faktisk frekvens (frekvensene hentes fra
`detail=serieskeysonly`-proben) og emitterer `extension.timePeriodsByFreq`
i metadataene; `variable-select-status.js` (`applyTimeFreqFilter`) bruker
den til å begrense tidslisten til perioder som finnes for valgt frekvens.

API-et godtar riktignok flere frekvenser i ett kall (`+`-syntaks i
nøkkelsegmentet, f.eks. `/data/EXR/A+M.USD.NOK.SP`), men periodene aligner
aldri på tvers av frekvenser, så resultatet blir en nesten tom
FREQ×TIME_PERIOD-kryssmatrise — og `startPeriod`/`endPeriod` kan bare
uttrykkes i én granularitet. Adapteren merker derfor FREQ med
`dimension.FREQ.extension.singleSelect = true`, som UI-en håndhever som
radio-adferd (kun én frekvens kan velges).

## Norges Bank (SDMX): responsformater og valgfrie parametere (verifisert 2026-07)

Verifisert mot det levende API-et (`/api/data/{FLOW}/{key}`):

- `format=`-verdier som fungerer (HTTP 200): `sdmx-json`, `csv`, `csv-ts`
  (én tidsserie per rad), `excel-both` (API-ets egen standard), `excel-ts`.
  `sdmx-csv` fungerer også, men er udokumentert. XML-varianter
  (`genericdata`, `structurespecificdata`, `jsondata`, `xml`) avvises med 406.
- `detail=` godtar `full` (standard), `dataonly`, `serieskeysonly`, `nodata`;
  ugyldig verdi gir 400.
- `includeHistory=true`, `bom=true` (UTF-8 BOM, Excel-vennlig CSV) og
  `updatedAfter=`/`dimensionAtObservation=` aksepteres. `locale=no|en`.

API-byggeren (variable-select) eksponerer format, detail, includeHistory og
bom via `buildApiQuery`-options; appen selv henter alltid `sdmx-json`.

## FHI: responsformater og maxRowCount (verifisert 2026-07)

Verifisert mot det levende API-et (`POST /api/open/v1/{source}/Table/{id}/data`):

- Gyldige `response.format`-verdier: `json-stat2`, `csv2`, `csv3` (to
  CSV-varianter, `text/csv`) og `parquet` (`application/vnd.apache.parquet`).
  Alle andre verdier avvises med 422 før spørringen kjøres.
- `response.maxRowCount` er valgfri: utelatt felt betyr ubegrenset; en
  spørring som overskrider grensen gir feil (ikke trunkert svar).
- Dimensjonsfiltre: `item`, `top`, `bottom` og `all` (med `*`-jokertegn).

API-byggeren eksponerer format og maxRowCount via `buildApiQuery`-options;
appen selv henter alltid `json-stat2` med `maxRowCount: 50000`.
