---
name: api-dbh
description: Verifisert oppførsel i HK-dirs DBH-API (Database for statistikk om høyere utdanning) — egen flat JSON-dialekt (ikke JSON-Stat), påkrevd filter i alle spørringer, 500k-radgrense på fem navngitte tabeller, GDPR-skjerming av småtall, metadata via POST Tabeller/Tabell, åpen CORS. Load ved endringer i js/sources/dbh-adapter.js, js/sources/dbh-to-jsonstat.js, scripts/update-dbh-catalog.mjs, data/sources/dbh-*.json, eller ved feilsøking av DBH-spørringer/responser.
---

# DBH (HK-dir) — API-funn

Oppdaget oppførsel som avviker fra eller utfyller dokumentasjonen. Nye funn
legges til her, datert. Offisiell dokumentasjon:
- API-klient: https://dbh.hkdir.no/dbhapiklient/
- PDF (v. 03.12.2025): https://dbh.hkdir.no/static/files/dokumenter/api/api_dokumentasjon.pdf
- Tabelldokumentasjon: https://dbh.hkdir.no/datainnhold/tabell-dokumentasjon/{tabell_id}

## Endepunkter (verifisert 2026-08-11)

Base: `https://dbh-data.dataporten-api.no/Tabeller/` (kanalregister-tabellene
850–859 ligger på egen host `https://kanalregister.hkdir.no/api/krtabeller/`).
Eksemplene i PDF-en bruker `https://dbh.hkdir.no/api/` som alternativ sti —
IKKE verifisert som likeverdig; hold deg til dataporten-hosten.

| Kall | Endepunkt | Verifisert |
|---|---|---|
| Tabelliste | `GET Tabeller/All` → `[{Tabell_id, Navn, TABLE_TYPE}]` (110 stk) | ja |
| Tabellmetadata | `POST Tabeller/Tabell` body `{"tabell_id": N}` | ja |
| Data (JSON) | `POST Tabeller/hentJSONTabellData` | ja |
| Data (CSV) | `POST Tabeller/hentCSVTabellData` | nei |
| Store uttrekk | `POST Tabeller/streamJsonData` / `streamCsvData` | nei |
| Hel tabell | `GET Tabeller/bulk-csv?rptNr=N` (kun Bulk-merkede tabeller) | nei |

`GET` på base-URL-en er en helsesjekk som returnerer ren tekst
(«DBH API svarer og er klar til å sende data.») — IKKE JSON, ikke tabelliste.
Tabellisten krever `/All`-suffikset (utledet fra API-klientens bundle:
`REACT_APP_DBH_AlleTabeller = "All"`).

**CORS er helt åpen** (`Access-Control-Allow-Origin: *`, preflight OK for
`content-type`) — klientside-henting fungerer uten proxy. Målt 2026-08-11.

## Responsformat: egen flat dialekt, IKKE JSON-Stat

`hentJSONTabellData` returnerer et JSON-array der **element 0 er et
statusobjekt** og resten er flate rader:

```json
[{"status":{"tabell_id":900,"api_versjon":1,"leveransenr":8493092,
  "leveringstid":"2026-08-11 13:46:42","antall":48,"returkode":0,
  "melding":"Data levert."}},
 {"Årstall":"2023","Institusjonskode":"8208","Institusjonsnavn":"VID …",
  "Ny produksjon totalt":3751.399774, …}, …]
```

- `statuslinje:"N"` fjerner statuselementet; `"J"` tar det med. Bruk `"J"` i
  adapteren — `status.antall` er eneste radtelling uten å telle selv.
- `kodetekst:"J"` gir navnekolonner i tillegg til kodekolonner (f.eks.
  `Institusjonskode` + `Institusjonsnavn`). Øker svartid noe iht. dok.
- Måltall kommer som JSON-tall, dimensjoner som strenger. Dok. sier «alle
  fagdata returneres som alfanumeriske felt» — stemmer IKKE for måltall i
  tabell 900 (verifisert: tall uten anførselstegn).
- **Konsekvens:** egen konverteringsmodul (flate rader → JSON-Stat2-kube) à la
  `js/sources/sdmx-to-jsonstat.js`, med egne enhetstester.

## Spørrespråket (PDF + verifisert)

To tabelltyper: **matematiske** (Math=1 i tabell 001-innhold; krever ikke-tom
`groupBy`) og **listetabeller** (krever `variabler`, som kan være `["*"]`).
`groupBy`/`variabler` kan ALDRI være `[]` eller mangle. `sortBy` ⊆ `groupBy`.
Formelfelt (f.eks. «Antall totalt») kan ikke stå i filter.

Kun `tabell_id` og `api_versjon` er obligatoriske i headerdelen, MEN:
**`filter` må ha minst ett element** — tom filterliste gir 400 «Valideringsfeil»
med strukturert kropp (verifisert 2026-08-11). Minste gyldige filter er
`{"variabel": "<dim>", "selection": {"filter": "all", "values": ["*"]}}`.

Filtertyper: `all` (`values:["*"]`), `item`, `top` (én verdi, N høyeste),
`between` (to verdier), `like` (`%`-jokertegn), `lessthan`, `greaterthan`.
`exclude: [...]` kan legges i alle unntatt `item`.

## Feilsemantikk (verifisert 2026-08-11)

Strukturert feilkropp à la RFC 7807 (`title`/`detail`/`status`/`instance`):

- Ugyldig spørring (tomt filter, ukjent variabel) → **400 «Valideringsfeil»**,
  `detail` inkluderer hele innsendt JSON.
- Ukjent `tabell_id` → **500 «Intern serverfeil»** (ikke 404!) mot
  `Tabeller/Tabell`. 404 med `detail: "No static resource …"` betyr feil URL-
  sti, ikke manglende data.
- Tomt resultat er IKKE undersøkt ferdig — sjekk `status.antall`/returkode før
  antakelser.

## Grenser og ytelse

- **500 000 rader i retur** er hard grense for tabellene **208, 347, 900, 905,
  906** (PDF-en, ikke selvtestet). Andre tabeller: ingen dokumentert grense;
  klient-siden anbefales stream-endepunktene for store uttrekk.
- Ingen dokumentert rate limit. Alle forespørsler logges av HK-dir.
- JWT (Feide) finnes kun for å se skjermede småtall — irrelevant for åpen bruk.

## GDPR-skjerming av småtall

Tabeller merket for skjerming i 001-innhold anonymiserer verdier < 3 for
brukere uten institusjonstilgang. **Konsekvens:** portalen kan vise skjermede
celler — dette må kommuniseres (fotnote/kildenote), og tallene skal ikke
tolkes som eksakte nuller.

## Katalog og metadata

- `TABLE_TYPE` ∈ `Data` (23), `Kodetabell` (34), `Liste` (33), `View` (4),
  `Utgått` (16) per 2026-08-11. Kun kuraterte `Data`-tabeller er
  portal-kandidater; `Utgått` skal aldri inn.
- `POST Tabeller/Tabell` gir per variabel: `variabel_navn`, `COLUMN_NAME`,
  `api_filter_variabler` (foreslått filtertype: `all`/`top`/…), `sortBy`- og
  `groupBy`-flagg (boolske), `datakilde` (peker mot kodetabell), `api_formel`
  (≠ null ⇒ beregnet måltall, kan ikke filtreres). `status.groupBy`/`sortBy`
  i svaret er API-ets *forslag* til spørring (JSON-strenger som må parses).
- Tabell 1 «API innhold» og 2 «API metadata» (View) beskriver tabellene selv
  (Math-, Bulk- og skjermingsflagg m.m.) — strukturen kartlegges i
  tabellrapporten (se under).
- Sist-oppdatert per tabell: ikke funnet noe billig endepunkt ennå; tabell 916
  «API-driftsmeldinger» har endringslogg.

## Språk og lisens

Kun norsk (ingen lang-parameter) → engelsk UI trenger fast note à la FHIs
`EN_LANGUAGE_NOTE`. Lisens: NLOD (Norsk lisens for offentlige data);
«DBH/DBH-HYU skal oppgis som kilde» → `AppConfig.sources.dbh.branding` med
`licenseName: 'NLOD'`.

## Trege filtre — hovedytelsesfunnet (målt 2026-08-11, tabell 900)

Énverdis filtre på Årstall er raske (`item`/`top`/`between`/`lessthan`/
`greaterthan`: 2–4 s). Alt annet er dramatisk tregt på store tabeller:
flerverdis `item` (97 s for TO årstall!), `like` (88 s), `exclude`
(timeout > 45 s), énverdis `item` på Institusjonskode (13 s). På små
tabeller/View-tabeller er `item` raskt (~1–2 s).

**Konsekvens (adapterstrategi):** datauttrekk filtrerer KUN på Årstall
server-side (én verdi → `item`, flere → `between` min–maks), alle andre
dimensjoner hentes med `all` og filtreres klientside. `groupBy` = tabellens
kuraterte dimensjoner. Server-side-aggregering gjør reduserte groupBy trygge
(også for snitt-tall som opptakspoeng).

## Metadata-hull: Tabeller/Tabell er ufullstendig (verifisert 2026-08-11)

- `POST Tabeller/Tabell` lister IKKE måltallene for tabeller uten
  `api_formel` (571, 379, 222, 905 m.fl.) — de finnes bare i dataresponsen
  eller i **tabell 2 «API metadata»** (1 172 rader, komplett variabel-/
  typeliste per tabell).
- `groupBy`-/`sortBy`-flaggene per variabel er upålitelige (571: bare 8 av 16
  flagget, alle fungerer). `status.groupBy/sortBy` er JSON-strenger med API-ets
  *forslag*.
- **Tabell 1 «API innhold»** (View, 110 rader) er katalogkilden: per tabell
  `Emne` (temagruppe), `Gdpr` (0/1), `Bulk tabell` (0/1), `Math` (0/1) og
  komplett `Variabelliste`. View-/Liste-tabeller spørres med
  `"variabler":["*"]` i stedet for `groupBy` (Math=0); filter kreves fortsatt.
- **Sist-oppdatert/tidsdekning finnes ikke** i noen metadatakilde. Årsdekning
  probes billig per tabell: `groupBy:["Årstall"]` + `all` (0,3–11 s).
  Distinkte verdier per dimensjon: `groupBy:["<dim>"]` + `all` på seg selv.

## Datatyper og datakvalitet (verifisert 2026-08-11)

- Måltall er **inkonsistent** typet: ekte JSON-tall i 900/373/226/390,
  strenger («12», «0.00») i 571/379/222/905 m.fl., og `null` forekommer
  (370). Konverteringen må tåle alle tre.
- Siste år kan være ufullstendig/fremtidig (2026 i opptakstabellene med
  0-verdier) — «siste komplette år» må utledes, ikke antas.
- 500k-grensen håndheves med COUNT FØR materialisering: rask 400 «Ugyldig
  forespørsel» med `detail` «… Over 500001 poster …» (~6 s) — ingen
  timeout-risiko ved å prøve. 400-`detail` skiller IKKE mellom ukjent variabel
  og forsøk på å filtrere formelfelt (samme melding).
- Ingen 429/rate-limit observert over ~90 sekvensielle kall. Svartider:
  metadata 0,2 s; små uttrekk 0,3–2,5 s (tabell 222 er unntaket: 5–9 s);
  900 med 103k rader: 18 s.

## kodetekst:"J" kan gi 500 uten institusjonskontekst (verifisert 2026-08-11)

`groupBy:["Avdelingskode"]` alene på tabell 905 gir **500 med
`kodetekst:"J"`**, men 200 med `kodetekst:"N"` eller med
`["Institusjonskode","Avdelingskode"]` — navnejoinen bak kodetekstene krever
institusjonskontekst for avdelingsdimensjoner. **Konsekvens:**
`scripts/update-dbh-metadata.mjs` retryer med `kodetekst:"N"` ved 500 (koder
brukes da som etiketter). Ikke anta at 500 = ukjent tabell; det kan også være
denne joinen (og «reduser størrelsen»-meldingen i 500-kroppen er misvisende).

## Kodelister (Liste-tabeller)

211 Institusjon (293 rader, med gyldig fra/til i ÅÅÅÅS-format og
fusjonshistorikk) og 210 Avdeling (4 325 rader) er gode kodelistekilder.
347 er «Studieprogram» (IKKE institusjoner — vanlig forveksling) og har
500k-grense; 208 Emner likeså. 947/948 (fagskoler) har dimensjoner som NAVN,
ikke koder — kodetekst er irrelevant der.

Full tabellvurdering (alle 23 Data-tabeller, per-tabell-dimensjoner og
egnethet) ble gjort 2026-08-11 — se `data/sources/`-katalogen og ROADMAP.md
for hva som ble kuratert inn/utsatt.
