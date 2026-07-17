/**
 * SSB source adapter — Statistikkportalen 2.0
 *
 * Tynn wrapper rundt den eksisterende SSBApi-klassen (js/api.js). Eksponerer
 * SSB som en kildeadapter bak den delte `api`-fasaden
 * (js/sources/source-registry.js) med `sourceId: 'ssb'`.
 *
 * SSB er FALLBACK-kilden: `ownsTableId(id)` returnerer alltid true, slik at alle
 * tabell-id-er uten kjent fremmed-prefiks (nb- / fhi-) rutes hit. Fremmede
 * adaptere registreres FØR denne i window.SourceAdapters, men fasaden sjekker
 * dem først (mest spesifikke eier vinner) — se source-registry.js.
 *
 * Capabilities er alle `true`: SSB støtter hele funksjonsflaten (lagrede
 * spørringer, server-eksport, kodelister/aggregering, GET-URL-bygger,
 * defaultselection og aggregering på tvers av sider).
 *
 * Alle API-metoder er rene pass-through til SSBApi-instansen. Registryet får
 * en referanse til råinstansen via `instance` for delt cache-delegering
 * (cleanupCache/clearCache/getCacheStats treffer den samme CacheManager-en).
 *
 * Registrering: filen laster FØR source-registry.js og dytter adapteren på
 * den delte `window.SourceAdapters`-lista, som registryet konsumerer.
 */
(function () {
  'use strict';

  if (typeof window.SSBApi !== 'function') {
    // api.js må lastes før denne filen. Uten SSBApi kan vi ikke bygge adapteren.
    (window.logger || console).error &&
      (window.logger || console).error('[SSBAdapter] SSBApi ikke tilgjengelig — sjekk load-order i index.html');
    return;
  }

  // Gjenbruk instansen api.js allerede opprettet (window.api er en ren SSBApi
  // på dette tidspunktet — registryet erstatter den senere). Da deler vi én
  // CacheManager og én throttle-tilstand i stedet for å lage en ny instans.
  const ssb = (window.api instanceof window.SSBApi) ? window.api : new window.SSBApi();

  const adapter = {
    sourceId: 'ssb',

    // Rå SSBApi-instans — brukes av registryet for delt cache-delegering.
    instance: ssb,

    // SSB støtter hele funksjonsflaten. supportsApiQuery er false fordi SSB
    // bruker det dedikerte fullpanelet i variable-select (supportsGetUrlBuilder,
    // med format-/visningsvalg) i stedet for den forenklede buildApiQuery-veien.
    capabilities: {
      supportsSavedQueries: true,
      supportsServerExport: true,
      supportsCodelists: true,
      supportsGetUrlBuilder: true,
      supportsApiQuery: false,
      supportsDefaultSelection: true,
      supportsAggregation: true
    },

    // SSB er fallback: eier alle id-er (registryet prøver fremmede adaptere
    // først, så denne fanger opp resten).
    ownsTableId: function () { return true; },

    // ---- API-flate (pass-through, signaturer identiske med SSBApi) ----
    getConfig:           (...a) => ssb.getConfig(...a),
    getTables:           (...a) => ssb.getTables(...a),
    getAllTables:        (...a) => ssb.getAllTables(...a),
    getTableMetadata:    (...a) => ssb.getTableMetadata(...a),
    getTableData:        (...a) => ssb.getTableData(...a),
    getCodeList:         (...a) => ssb.getCodeList(...a),
    downloadTableData:   (...a) => ssb.downloadTableData(...a),
    saveSavedQuery:      (...a) => ssb.saveSavedQuery(...a),
    getSavedQuery:       (...a) => ssb.getSavedQuery(...a),
    getSavedQueryData:   (...a) => ssb.getSavedQueryData(...a),
    getDefaultSelection: (...a) => ssb.getDefaultSelection(...a),
    // Synkron ren hjelper brukt av API-bygger-panelet (variable-select-api.js).
    // SSB-only funksjon (capabilities.supportsGetUrlBuilder), men eksponeres på
    // fasaden for å bevare dagens oppførsel.
    buildPostBody:       (...a) => ssb.buildPostBody(...a),
    // Forenklet API-bygger-spørring (NB/FHI) — SSB bruker fullpanelet i
    // variable-select-api.js (GET/POST-URL med format-/visningsvalg) i stedet.
    buildApiQuery:       () => { throw new Error('[SSBAdapter] buildApiQuery støttes ikke — SSB bruker det dedikerte API-bygger-panelet'); },
    cleanupCache:        (...a) => ssb.cleanupCache(...a),
    clearCache:          (...a) => ssb.clearCache(...a),
    getCacheStats:       (...a) => ssb.getCacheStats(...a)
  };

  (window.SourceAdapters = window.SourceAdapters || []).push(adapter);
})();
