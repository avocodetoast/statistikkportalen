---
name: api-ssb
description: Verifisert oppførsel i SSBs PxWebApi v2 som avviker fra eller utfyller spec — `link.describedby` i to former, ugyldige `updated`-datoer i /tables, det reelle celletaket (800 000, live fra GET /config, 403 ved brudd). Load ved endringer i js/api.js, js/table-metadata.js, SSB-delen av byggeskriptene (generate-seo-pages.mjs), eller ved feilsøking av SSB-spørringer/metadata.
---

# SSB (PxWebApi v2) — API-funn

Oppdaget oppførsel som avviker fra eller utfyller spesifikasjonen. Nye funn
legges til her, datert. NB/FHI har egne skills (`api-norges-bank`, `api-fhi`).

## `link.describedby` har to former (metadata-endepunktet)

`GET /tables/{id}/metadata` leverer Klass-/VarDok-referanser i `link.describedby`
(datasett- og dimensjonsnivå) i **to ulike former**:

1. `{ "href": "urn:ssb:classification:klass:104", "label": "..." }` — formen
   appens `js/table-metadata.js` antar.
2. `{ "extension": { "Region": "urn:ssb:classification:klass:104 urn:ssb:classification:klass:131 ..." } }`
   — en **mellomromsseparert URN-liste** per dimensjonskode. Observert juli 2026
   på bl.a. tabell 07459 (Region/Kjonn/Alder) og 12869; ingen `href`/`label` i det hele tatt.

**Konsekvens:** `scripts/generate-seo-pages.mjs` (`buildEnrichedSections`)
håndterer begge former. `buildMetadataSection()` i `js/table-metadata.js`
håndterer kun form 1, så «Klassifikasjoner og definisjoner»-seksjonen i appen
vises ikke for tabeller som bruker form 2.

URN-oppløsning:
- `urn:ssb:classification:klass:{id}` → `https://www.ssb.no/klass/klassifikasjoner/{id}`
- `urn:ssb:conceptvariable:vardok:{id}` → `https://www.ssb.no/a/metadata/conceptvariable/vardok/{id}/{nb|en}`

## Ugyldige datoer i `/tables`-listen

Enkelte tabeller har åpenbart ugyldige `updated`-verdier (f.eks. tabell 04197
med `"0003-10-13"`). Google avviser slike i sitemap/JSON-LD.

**Konsekvens:** `isoDate()` i `scripts/generate-seo-pages.mjs` dropper datoer
utenfor 1900–(inneværende år + 1).

## Celletak: 800 000 er reelt — og SSB er ENESTE kilde med ett (målt 2026-08-02)

- Grensen hentes live fra `GET /config` → `maxDataCells` (bekreftet `800000`).
- Brudd gir **HTTP 403**. Dette er den eneste ekte celletak-regelen blant de
  tre kildene — NB og FHI har ingen (se deres skills).

**Konsekvens:** `AppConfig.limits.bySource.ssb.maxCells` er hard sperre i UI-et
(kun for SSB); `ensureApiLimits` i `js/variable-select.js` henter `/config` og
er en bevisst SSB-only-gate.
