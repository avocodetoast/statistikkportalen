# Statistikkportalen
Statistikkportalen er et uoffisielt grensesnitt som forbedrer tilgangen til SSBs data. Applikasjonen gir rask navigering gjennom lokal caching, et kompakt grensesnitt for å minimere scrolling, og enklere oppdagelse av tabeller gjennom menynavigering.

Applikasjonen kan tilpasses andre systemer som bruker PxWebApi v2, eksempelvis SCBs statistikkbank. Det krever kun at tre filer byttes ut: `config.js` (API-URL, kilde, språk), `subjects.js` (emnehierarki) og `synonyms.js` (søkesynonymer).

## Funksjonalitet
1. **Oppdag tabeller raskt og enkelt**
   - Søk gjennom alle SSBs tilgjengelige tabeller
   - Filtrer etter emne og frekvens
   - Oversiktlige kort med metadata (periode, oppdateringsdato, antall variabler)

2. **Variabelvelger**
   - Interaktivt grensesnitt for å velge verdier for hver dimensjon
   - Støtte for spesielle operatorer
     - `*` — Alle verdier
     - `top(n)` — De n siste verdiene (f.eks. `top(12)` for siste 12 måneder)
     - `from(periode)` — Alle verdier fra og med en gitt periode (f.eks. `from(2020M01)`)
   - Visuelle indikatorer for valideringsstatus

3. **API-bygger**
   - Generer GET- og POST-URL direkte fra variabelvalget
   - Støtte for alle responsformater (JSON-stat2, CSV, Excel, PX, HTML)
   - Tidsdimensjonen optimeres automatisk: eksplisitte perioder erstattes med `from(startdato)` eller `top(n)` for en dynamisk URL som alltid henter ferske data
   - URL vises i klartekst som standard
   - Kopier URL eller POST-body med ett klikk

4. **Datavisning**
   - Intelligent standard layout
   - Sticky headers for enkel navigering i store tabeller
   - Norske tallformater (mellomrom som tusenskilletegn, komma som desimalskilletegn)

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

8. **Lagrede spørringer**
   - Lagre spørringer som kan gjenfinnes med lenke
   - Åpne en SSB-spørring ved å lime lenken inn i søkefeltet

9. **Smart søk (beta)**
   - Finn flere tabeller enn ved den vanlige søkemodusen

## Kom i gang
1. Åpne `index.html` i en moderne nettleser
2. Vent til tabellisten lastes (caches automatisk)
3. Søk eller bla til ønsket tabell
4. Velg verdier for variablene
5. Klikk «Hent data»
6. Utforsk, roter og eksporter data

## Systemkrav
- Moderne nettleser (Chrome, Firefox, Safari, Edge, Vivaldi)
- JavaScript aktivert
- Internettforbindelse (for API-kall)
- localStorage aktivert (for caching)

## Lisens
Denne koden er lisensiert under [MIT-lisens](LICENCE.md).
Data fra Statistisk sentralbyrå er lisensiert under [CC BY 4.0](https://www.ssb.no/diverse/lisens).
Data fra Statistiska centralbyrån er lisensiert under [CC0](https://www.scb.se/en/services/open-data-api/).
