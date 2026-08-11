---
name: api-fhi
description: Verifisert oppførsel i FHIs åpne statistikk-API (JSON-Stat2) som avviker fra eller utfyller spec — virkningsløs maxRowCount, gyldige responsformater, sterkt varierende tidsdimensjonsnavn mellom kilder, ingen cellegrense (bare økende svartid), 404 = ekte feil med strukturert feilkropp. Load ved endringer i js/sources/fhi-adapter.js, scripts/update-fhi-catalog.mjs, data/sources/fhi-*.json, eller ved feilsøking av FHI-spørringer/responser.
---

# FHI (JSON-Stat2) — API-funn

Oppdaget oppførsel som avviker fra eller utfyller spesifikasjonen. Nye funn
legges til her, datert. SSB/NB har egne skills (`api-ssb`, `api-norges-bank`).

## Responsformater og maxRowCount (verifisert 2026-07, maxRowCount målt på nytt 2026-08-02)

Verifisert mot det levende API-et (`POST /api/open/v1/{source}/Table/{id}/data`):

- Gyldige `response.format`-verdier: `json-stat2`, `csv2`, `csv3` (to
  CSV-varianter, `text/csv`) og `parquet` (`application/vnd.apache.parquet`).
  Alle andre verdier avvises med 422 før spørringen kjøres.
- **`response.maxRowCount` er virkningsløs.** Målt 2026-08-02: `maxRowCount`
  1, 10, 50000 og utelatt felt gav BYTE-IDENTISKE svar — både for `json-stat2`
  og `csv2`, og også for en tabell på 1,2 mill. celler. Feltet trunkerer ikke
  og gir ingen feil. (Retter en tidligere påstand om at en spørring over
  grensen gir feil; det stemmer ikke.)
- Dimensjonsfiltre: `item`, `top`, `bottom` og `all` (med `*`-jokertegn).

**Konsekvens:** API-byggeren eksponerer format og maxRowCount via
`buildApiQuery`-options; appen selv henter alltid `json-stat2` med
`maxRowCount: 50000` — en verdi som altså ikke har noen effekt. Feltet
beholdes fordi det står i FHIs egen API-kontrakt og vises som en knott i
API-byggeren.

## Ingen cellegrense — bare en asymptote (målt 2026-08-02)

FHI har ingen cellegrense og ingen feilkode ved store uttak. Bare tid:

| Celler | Svartid / størrelse |
|---|---|
| 0,6 mill. | 2,5 s / 4 MB |
| 2,0 mill. | 39 s / 11 MB |
| 6,0 mill. | 116 s / 30 MB |
| 14 mill. | klient-timeout 150 s |
| 49 mill. | timeout 180 s |

~52 000 celler/s i det lineære området. Veggen er ikke en grense, men en
asymptote: svaret tar bare lengre og lengre tid, uten feilkode. Den bindende
skranken for appen var derfor i praksis `sources.fetchTimeoutMs` (15 s), ikke
celletallet. Kun SSB har et ekte celletak (se `api-ssb`).

Omfang: 37 av 370 FHI-tabeller har et kryssprodukt over 800 000; den største
er 49 129 080 celler (`nokkel-343`). Med det gamle globale taket var alle
disse usynlig sperret av en regel som ikke fantes. Verifisert i nettleser:
`fhi-msis-733` (1 224 960 celler) hentes nå på 22,6 s — den var både sperret
av celletaket OG over det gamle 15 s-taket.

**Konsekvens:** `AppConfig.limits.bySource.fhi` har `maxCells: null` (kun myke
`warnCells`/`slowWarnCells`-advarsler), og `sources.dataFetchTimeoutMs` = 90 s
for selve datauttrekket, mens `sources.fetchTimeoutMs` = 15 s fortsatt verner
katalog-/metadatastien.

## Dimensjonsnavn for tid varierer sterkt mellom kilder (verifisert 2026-07)

Tidsdimensjonen heter bl.a. `AAR` (nokkel), `DAAR` (daar),
`FODSELSTIDSPUNKT_*` (mfr), `AARGANG` (abr), `Argang`/«Årgang» (hkr —
matcher IKKE et fritt «år»-token pga. etterfølgende bokstav), `year`/«Årstall»
(sysvak årstabeller), `season`/«Sesong» + `week`/«Uke» (msis/ngs
sesong-/ukestabeller) og `my`/«Måned» (ngs månedstabeller).

**Konsekvens:** Rolledeteksjonen bruker både et fritt «år»-token
(TIME_PATTERN) og en eksakt navneliste (TIME_EXACT) — begge duplisert mellom
`fhi-adapter.js` og `update-fhi-catalog.mjs`. Byggescriptet logger tabeller
uten gjenkjent tidsdimensjon; per 2026-07 har alle 370 tabeller en gjenkjent
tidsdimensjon.

## 404 = ekte feil (strukturert feilkropp)

I motsetning til Norges Bank (der 404 betyr tomt resultat) er 404 hos FHI en
reell feil (ressursen finnes ikke); ugyldige spørringer gir 400/422.
Feilkroppen er RFC 7807-*lignende* (`detail`/`errors{}`/`title` avhengig av
feiltype — se feilhåndteringen i `fhi-adapter.js`). Adapteren skal IKKE tolke
FHI-404 som tomt — se CLAUDE.md-fallgruven og commit `dbfa542`.
