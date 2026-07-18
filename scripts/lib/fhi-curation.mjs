/**
 * Fletting av den håndkuraterte FHI-fila (data/sources/fhi-curation.json) inn
 * i den API-byggede katalogen — brukes av scripts/update-fhi-catalog.mjs.
 *
 * Byggescriptet henter titler/perioder på nytt fra FHIs API ved hver kjøring
 * og ville ellers overskrevet manuell kuratering. Kurateringen ligger derfor i
 * en EGEN innsjekket fil og flettes inn på toppen her, slik at
 * `node scripts/update-fhi-catalog.mjs` alltid kan kjøres trygt.
 *
 * Kurateringsfilas form (per kilde under `sources`):
 *   {
 *     "categories": { "<katId>": { "label": "Fødsler og fødte", "sortCode": "010" } },
 *     "tables": {
 *       "448": { "title": "Overstyrt visningstittel", "category": "<katId>" }
 *     }
 *   }
 *
 * - `title` overstyrer den API-/heuristikk-utledede tittelen. Det opprinnelige
 *   API-tittelfeltet ligger alltid i `internalName` og røres ikke.
 * - `category` peker på en nøkkel i kildens `categories` og blir et
 *   kategorinivå (register → kategori) i emnetreet — fhi-adapter.js og
 *   scripts/lib/seo-sources.mjs bygger et tredje path-segment av den.
 * - Kilder/tabeller uten kuratering passerer uendret gjennom.
 *
 * Ren ESM uten sideeffekter — testes i tests/unit/fhi-curation.test.js.
 */

/**
 * Flett kuratering for ÉN kilde inn i den byggede kilden.
 *
 * @param {object} builtSource  {title, tables:[{tableId, title, internalName, …}]}
 * @param {object|null|undefined} curatedSource  kildeoppføring fra kurateringsfila
 * @param {(msg: string) => void} [warn]  callback for kurateringsavvik
 *   (foreldreløse tabell-id-er, udefinerte kategorireferanser, ukategoriserte
 *   tabeller i kilder som har kategorier)
 * @returns {object} nytt kildeobjekt — input muteres aldri
 */
export function applyCuration(builtSource, curatedSource, warn = () => {}) {
  const out = {
    ...builtSource,
    tables: (builtSource.tables || []).map(t => ({ ...t })),
  };
  if (!curatedSource || typeof curatedSource !== 'object') return out;

  const categories = curatedSource.categories || {};
  const curatedTables = curatedSource.tables || {};
  const hasCategories = Object.keys(categories).length > 0;

  const byId = new Map(out.tables.map(t => [String(t.tableId), t]));

  for (const [rawId, cur] of Object.entries(curatedTables)) {
    const table = byId.get(String(rawId));
    if (!table) {
      warn(`kuratert tabell-id ${rawId} finnes ikke (lenger) i API-katalogen — oppføringen ignoreres`);
      continue;
    }
    if (!cur || typeof cur !== 'object') continue;

    if (typeof cur.title === 'string' && cur.title.trim()) {
      table.title = cur.title.trim();
    }
    if (cur.category !== undefined) {
      if (Object.prototype.hasOwnProperty.call(categories, cur.category)) {
        table.category = cur.category;
      } else {
        warn(`tabell ${rawId} refererer udefinert kategori «${cur.category}» — kategorien utelates`);
      }
    }
  }

  if (hasCategories) {
    out.categories = Object.fromEntries(
      Object.entries(categories).map(([id, def]) => [id, { ...def }])
    );
    const uncategorized = out.tables.filter(t => !t.category).map(t => t.tableId);
    if (uncategorized.length) {
      warn(`${uncategorized.length} tabeller uten kategori (havner rett under registernoden): ${uncategorized.join(', ')}`);
    }
  }

  return out;
}
