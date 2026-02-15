# Statistikkportalen
Statistikkportalen er et uoffisielt grensesnitt som forbedrer tilgangen til SSBs data. Applikasjonen gir rask navigering gjennom lokal caching, et kompakt grensesnitt for å minimere scrolling, og enklere oppdagelse av tabeller gjennom menynavigering.

Applikasjonen kan også med mindre justeringer tilpasses andre systemer som bruker PxWebApi, eksempelvis SCBs statistikkbank.

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
   - Visuelle indikatorer for valideringsstatus

3. **Datavisning**
   - Intelligent standard layout
   - Sticky headers for enkel navigering i store tabeller
   - Norske tallformater (mellomrom som tusenskilletegn, komma som desimalskilletegn)

4. **Tabellrotasjon**
   - Drag-and-drop-grensesnitt for å endre tabellayout
   - Flytt dimensjoner mellom rader og kolonner
   - Hurtigvalg: Standard, Transponér, Alle som rader/kolonner

5. **Dataeksport**
   - Eksporter til Excel, CSV og PX-format
   - Valg for eksportformat, eksempelvis pivotvennlig CSV

6. **Caching**
   - Intelligent caching av API-kall i localStorage
   - Automatisk opprydding av utdaterte data

## Kom i gang
1. Åpne `index.html` i en moderne nettleser
2. Vent til tabellisten lastes (caches automatisk)
3. Søk eller bla til ønsket tabell
4. Velg verdier for variablene
5. Klikk «Hent data»
6. Utforsk, roter og eksporter data

## Systemkrav
- Moderne nettleser (Chrome, Firefox, Safari, Edge)
- JavaScript aktivert
- Internettforbindelse (for API-kall)
- localStorage aktivert (for caching)

## Lisens
Denne koden er lisensiert under [MIT-lisens](LICENCE.md).
Data fra Statistisk sentralbyrå er lisensiert under [CC BY 4.0](https://www.ssb.no/diverse/lisens).

