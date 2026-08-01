/**
 * Inkrementell oppdatering av data/sources/fhi-catalog.json — brukes av
 * scripts/update-fhi-catalog.mjs (--incremental).
 *
 * FHIs åpne API har INGEN bulk-vei til en tabells periode eller metadata: både
 * /Table/{id}/dimension og /Table/{id}/metadata må kalles PER TABELL. Full
 * regenerering er derfor ~740 kall for de 13 kildene, selv om innholdet
 * sjelden endrer seg (typisk noen få tabeller per uke).
 *
 * Tabell-lista (GET /{source}/table) er derimot ett kall per kilde og
 * inneholder modifiedAt/publishedAt. Den brukes her til å avgjøre HVILKE
 * tabeller som må hentes på nytt (selectStaleTableIds), og som fasit på hvilke
 * tabeller som fortsatt finnes (mergeCatalogSource) — så fjernede tabeller
 * faktisk forsvinner fra katalogen.
 *
 * Fila eier også normaliseringspasset over katalogradene (normalizeCatalogPeriods)
 * — samme sted i pipelinen, og av samme grunn: passet MÅ dekke rader som en
 * inkrementell kjøring beholdt uendret.
 *
 * Ren ESM uten sideeffekter — testes i tests/unit/fhi-catalog-merge.test.js.
 */

import { normalizePeriod, classifyTimeUnit } from './period-format.mjs';

/** Tabell-id-er sammenlignes som streng: API-et og katalogfila blander tall/streng. */
const key = (id) => String(id);

/** modifiedAt, ellers publishedAt, ellers '' (ukjent). */
function rowTimestamp(row) {
  return (row && (row.modifiedAt || row.publishedAt)) || '';
}

/**
 * Hvilke tabeller må hentes på nytt?
 *
 * En tabell er «stale» hvis den
 *   - ikke finnes i den eksisterende katalogen (ny tabell), eller
 *   - har modifiedAt/publishedAt nyere enn cutoff, eller
 *   - mangler dato-felt helt (da kan vi ikke avgjøre — vi henter for sikkerhets skyld).
 *
 * @param {Array<object>} existingTables  katalogens rader for kilden
 * @param {Array<object>} liveRows        GET /{source}/table
 * @param {string} cutoff                 ISO-tidspunkt (katalogens generatedAt)
 * @returns {Array<number|string>} tableId-er i live-radenes rekkefølge
 */
export function selectStaleTableIds(existingTables, liveRows, cutoff) {
  const known = new Set((existingTables || []).map(t => key(t.tableId)));
  const cutoffMs = Date.parse(cutoff);

  return (liveRows || [])
    .filter(row => {
      if (!known.has(key(row.tableId))) return true; // ny tabell
      const ts = rowTimestamp(row);
      if (!ts) return true;                          // ukjent alder
      const ms = Date.parse(ts);
      if (Number.isNaN(ms) || Number.isNaN(cutoffMs)) return true;
      return ms > cutoffMs;
    })
    .map(row => row.tableId);
}

/**
 * Flett nyhentede tabellrader inn i den eksisterende katalogen for én kilde.
 *
 * Live-lista er fasit på medlemskap: rader som ikke lenger finnes der fjernes.
 * Uendrede rader beholdes ORDRETT (inkludert kuratering fra en tidligere
 * kjøring — kurateringsfila flettes uansett på nytt av kalleren etterpå).
 *
 * @param {Array<object>} existingTables  katalogens rader for kilden
 * @param {Array<object>} liveRows        GET /{source}/table (fasit på medlemskap)
 * @param {Array<object>} probedTables    nybygde rader (full form, fra buildSource)
 * @returns {{tables:Array<object>, added:Array, updated:Array, removed:Array}}
 *   `tables` sortert på tableId; input muteres aldri.
 */
export function mergeCatalogSource(existingTables, liveRows, probedTables) {
  const existingById = new Map((existingTables || []).map(t => [key(t.tableId), t]));
  const probedById = new Map((probedTables || []).map(t => [key(t.tableId), t]));

  const tables = [];
  const added = [];
  const updated = [];

  (liveRows || []).forEach(row => {
    const k = key(row.tableId);
    const probedRow = probedById.get(k);
    if (probedRow) {
      tables.push(probedRow);
      (existingById.has(k) ? updated : added).push(probedRow.tableId);
      return;
    }
    const existingRow = existingById.get(k);
    // Verken probet eller kjent fra før: skal ikke kunne skje (kalleren prober
    // alltid ukjente id-er), men vi finner ikke på en rad vi ikke har data for.
    if (existingRow) tables.push(existingRow);
  });

  const liveIds = new Set((liveRows || []).map(r => key(r.tableId)));
  const removed = (existingTables || [])
    .filter(t => !liveIds.has(key(t.tableId)))
    .map(t => t.tableId);

  tables.sort((a, b) => Number(a.tableId) - Number(b.tableId));
  return { tables, added, updated, removed };
}

/**
 * Normaliser firstPeriod/lastPeriod til SSB-form (2024U17, 2025M10, 2023T1) og
 * utled frekvens av resultatet. FHI leverer fem ulike former for uke/måned/
 * tertial; se js/period-format.js for reglene.
 *
 * Kjøres over HELE kildens tabelliste, ikke bare de nyhentede radene: en
 * --incremental-kjøring beholder uendrede rader ordrett, og de ville ellers
 * blitt liggende på råformat til neste fulle regenerering (~740 kall). Passet
 * er idempotent, så gjentatte kjøringer er trygge.
 *
 * `variableNames` er hintet som skiller formene som kolliderer: «2025-26» er en
 * SESONG, mens «2021-01» er ÅR-UKE. Adapteren har den eksakte
 * dimensjonsetiketten og bruker den i stedet (js/sources/fhi-adapter.js,
 * derivePeriods).
 *
 * timeUnit settes KUN når feltet står tomt: 'Annual' fra deriveTimeInfo
 * (scripts/update-fhi-catalog.mjs) er utledet av samtlige kategorier og er en
 * bedre kilde enn endepunktene alene.
 *
 * @param {Array<object>} tables katalograder
 * @returns {Array<object>} nye rader; input muteres aldri
 */
export function normalizeCatalogPeriods(tables) {
  return (tables || []).map(table => {
    const hint = (table.variableNames || []).join(' ');
    const first = normalizePeriod(table.firstPeriod, hint) || table.firstPeriod;
    const last = normalizePeriod(table.lastPeriod, hint) || table.lastPeriod;
    const derivedUnit = table.timeUnit ? null : classifyTimeUnit(first, last);

    if (first === table.firstPeriod && last === table.lastPeriod && !derivedUnit) {
      return table;
    }
    const out = { ...table, firstPeriod: first, lastPeriod: last };
    // Aldri introduser feltet på en rad som ikke har det fra før.
    if (derivedUnit) out.timeUnit = derivedUnit;
    return out;
  });
}
