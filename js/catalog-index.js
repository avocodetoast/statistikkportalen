/**
 * Catalog Index — dekoder + runtime-laster for den kompakte katalog-
 * serialiseringen.
 *
 *   decode(doc)        — ren, synkron rehydrering av ett katalogdokument.
 *   load({lang})       — henter manifest + alle shards for språket og
 *                        returnerer { available, rows, bySource, meta,
 *                        missingSources }. Kaster ALDRI: alt som går galt
 *                        degraderer (se «Degradering» under).
 *   available()        — om siste fullførte load() ga en brukbar indeks.
 *   meta()/builtAt()   — meta per kilde / manifestets generatedAt fra siste
 *                        fullførte load().
 *   invalidate()       — nullstiller memoisert tilstand.
 *   checkForUpdate({lang}) — «Se etter ny indeks»: tvinger et ekte
 *                        nettverkskall mot det ~600 B manifestet, sammenligner
 *                        shard-filnavn (innholdshash) mot det som er lastet,
 *                        og returnerer hvilke kilder som endret seg
 *                        (`changed`). Se metoden for full begrunnelse.
 *
 * Lastingen er gated på AppConfig.catalogIndex.enabled hos KALLEREN
 * (js/browser-state.js) — load() selv sjekker ikke flagget, så byggere og
 * tester kan kalle den direkte.
 *
 * DEGRADERING (kontrakten browse-visningene hviler på)
 * ----------------------------------------------------
 * Manifest 404 / ikke-JSON / format !== 1 / 0 dekodede rader → logger.warn og
 * { available: false }; BrowserState faller da tilbake til dagens direkte
 * kildehenting. ETT ødelagt shard tar kun ned SIN kilde: kilden havner i
 * missingSources, og BrowserState henter nettopp den via
 * api.getAllTables({ onlySources }).
 *
 * FORMATET (produseres av scripts/lib/catalog-format.mjs sin encodeCatalog,
 * som er MOTSTYKKET til denne fila — hold de to i sync):
 *
 *   {
 *     format: 1, source, lang, generatedAt, count,
 *     fields: [...],           // rekkefølgen radene i `tables` er kodet i
 *     nodes:  [[id,label,sortCode], ...],  // path-node-tabell
 *     paths:  [[nodeIdx, ...], ...],       // path-tabell (indekser inn i nodes)
 *     vars:   ["kjønn", ...],              // variabelnavn-tabell
 *     tables: [[...felt i fields-rekkefølge...], ...]
 *   }
 *
 * Path-noder interneres på TRIPPELEN (id, label, sortCode) ved encoding —
 * ALDRI på id alene, fordi samme node-id kan bære ulik sortCode på ulike
 * plasseringer i emnetreet (f.eks. "aku"/"Arbeidskraftundersøkelsen" har tre
 * ulike sortCode-er i den ekte SSB-katalogen). decode() gjenoppretter derfor
 * ett delt objekt per `nodes`-oppføring — to tabeller under samme node får
 * et `===`-likt nodeobjekt, som er hele minnegevinsten ved formatet.
 *
 * Rehydreringskontrakten (radformen decode returnerer) er den samme som
 * katalogoppføringene js/sources/source-registry.js:121-134 dokumenterer —
 * se den headerkommentaren for full kontrakt. Kort oppsummert:
 *   - updated/sortCode/subjectCode/timeUnit/firstPeriod/lastPeriod er ALLTID
 *     string (aldri null/undefined) — flere callsites kaller .localeCompare()
 *     rett på feltet.
 *   - discontinued er boolean.
 *   - variableNames og paths er alltid arrays.
 *   - Radobjektene selv er ferske per decode() (appen muterer dem).
 */

class CatalogIndex {
  /**
   * Dekoder et katalogdokument til den flate radformen appen forventer.
   *
   * @param {object} doc - Katalogdokument fra encodeCatalog().
   * @returns {object[]} rader, i doc.tables-rekkefølge.
   */
  static decode(doc) {
    if (!doc || doc.format !== 1) {
      throw new Error(
        `CatalogIndex.decode: ukjent katalogformat (doc.format=${doc && doc.format}, forventet 1)`
      );
    }

    const fields = doc.fields || [];
    const nodeRows = doc.nodes || [];
    const pathRows = doc.paths || [];
    const varRows = doc.vars || [];

    const fieldIndex = {};
    fields.forEach((name, i) => { fieldIndex[name] = i; });

    // Ett delt nodeobjekt per rad i doc.nodes — dette ER minnegevinsten:
    // alle paths som refererer samme nodeIdx peker på nøyaktig samme objekt.
    const nodeObjects = nodeRows.map(([id, label, sortCode]) => ({ id, label, sortCode }));

    function nodeAt(nodeIdx) {
      if (nodeIdx < 0 || nodeIdx >= nodeObjects.length) {
        throw new Error(
          `CatalogIndex.decode: node-indeks ${nodeIdx} utenfor rekkevidde (0..${nodeObjects.length - 1})`
        );
      }
      return nodeObjects[nodeIdx];
    }

    function pathAt(pathIdx) {
      if (pathIdx < 0 || pathIdx >= pathRows.length) {
        throw new Error(
          `CatalogIndex.decode: path-indeks ${pathIdx} utenfor rekkevidde (0..${pathRows.length - 1})`
        );
      }
      return pathRows[pathIdx].map(nodeAt);
    }

    function varAt(varIdx) {
      if (varIdx < 0 || varIdx >= varRows.length) {
        throw new Error(
          `CatalogIndex.decode: variabel-indeks ${varIdx} utenfor rekkevidde (0..${varRows.length - 1})`
        );
      }
      return varRows[varIdx];
    }

    /** Les et feltnavn ut av en kodet rad; tomstreng-fallback for manglende strengfelt. */
    function readString(row, name) {
      const i = fieldIndex[name];
      const v = i === undefined ? undefined : row[i];
      return v === undefined || v === null ? '' : v;
    }

    return (doc.tables || []).map(row => {
      const variableNameIdxs = row[fieldIndex.variableNames] || [];
      const pathIdxs = row[fieldIndex.paths] || [];
      const discontinuedRaw = row[fieldIndex.discontinued];

      return {
        id: readString(row, 'id'),
        label: readString(row, 'label'),
        updated: readString(row, 'updated'),
        firstPeriod: readString(row, 'firstPeriod'),
        lastPeriod: readString(row, 'lastPeriod'),
        subjectCode: readString(row, 'subjectCode'),
        sortCode: readString(row, 'sortCode'),
        timeUnit: readString(row, 'timeUnit'),
        discontinued: !!discontinuedRaw,
        variableNames: variableNameIdxs.map(varAt),
        paths: pathIdxs.map(pathAt),
        description: readString(row, 'description')
      };
    });
  }

  // =========================================================================
  // Runtime-lasting
  // =========================================================================

  /** AppConfig.catalogIndex med defaults, så load() virker i en stripped build. */
  static _settings() {
    const cfg = (window.AppConfig && window.AppConfig.catalogIndex) || {};
    return {
      manifestPath: cfg.manifestPath || 'data/index/catalog-manifest.json',
      staleAfterMs: cfg.staleAfterMs || 48 * 60 * 60 * 1000,
      timeoutMs: cfg.timeoutMs || 15000
    };
  }

  /** Shard-URL relativt til manifestets katalog (ikke til dokumentroten). */
  static _shardUrl(manifestPath, file) {
    const slash = String(manifestPath).lastIndexOf('/');
    const dir = slash === -1 ? '' : String(manifestPath).slice(0, slash + 1);
    return dir + file;
  }

  /**
   * Den DELTE CacheManageren (samme instans SSB-adapteren og resten av
   * kildelaget bruker) — ikke en egen, ellers ville indeksen ligget utenfor
   * «Tøm cache» i statuspanelet. Null før api.js har kjørt.
   */
  static _cache() {
    return (window.api && window.api.cache) || null;
  }

  /**
   * Cachenøkler.
   *
   * Shard-nøkkelen er FILNAVNET, som er innholdshashet
   * ('ssb-no-24c87da3.json') — et treff kan derfor aldri være feil innhold,
   * og en ny bygging gir en ny nøkkel i stedet for å måtte invalidere den
   * gamle. Bevisst konsekvens: CacheManager._isForeignSourceKey ser 'nb-' og
   * 'fhi-' i nb-/fhi-filnavnene og lar dem følge ren TTL, mens SSB-shardet
   * i tillegg revalideres på SSBs oppdateringsplan. Det er akkurat riktig
   * retning — SSB-katalogen er den som endrer seg oftest — og et bomtreff
   * koster bare én ny henting av identiske bytes.
   *
   * Manifestet er derimot IKKE hashet og er SSB-eid etter samme regel, så
   * det revalideres to ganger i døgnet. Er nettet nede, serverer
   * _cachedJson() den utløpte kopien via getEntry() i stedet — en offline
   * klient booter fortsatt fra indeksen.
   */
  static _manifestKey(lang) {
    return 'catalogIndex_manifest_' + lang;
  }

  static _shardKey(file) {
    return 'catalogIndex_' + file;
  }

  /**
   * Hent JSON gjennom SourceCommon.fetchWithTimeout — ikke rå fetch — så
   * indekshentingen deltar i den samme køen/in-flight-dedupen som resten av
   * kildelaget og ikke kan henge appoppstarten.
   */
  static async _fetchJson(url, timeoutMs) {
    const res = await window.SourceCommon.fetchWithTimeout(url, null, {
      queue: 'catalog-index',
      timeoutMs: timeoutMs,
      timeoutErrorPrefix: '[CatalogIndex] Tidsavbrudd'
    });
    if (!res || !res.ok) {
      throw new Error('[CatalogIndex] HTTP ' + (res && res.status) + ' for ' + url);
    }
    return await res.json();
  }

  /** Cache først, så nett, med stale-if-error-fallback til en utløpt kopi. */
  static async _cachedJson(cacheKey, url, timeoutMs) {
    const cache = CatalogIndex._cache();
    const ttl = (window.AppConfig && window.AppConfig.cache &&
                 window.AppConfig.cache.tableListTTL) || 24 * 60 * 60 * 1000;

    if (cache) {
      const hit = await cache.get(cacheKey);
      if (hit) return hit;
    }

    try {
      const doc = await CatalogIndex._fetchJson(url, timeoutMs);
      if (cache) await cache.set(cacheKey, doc, ttl);
      return doc;
    } catch (e) {
      if (cache) {
        const entry = await cache.getEntry(cacheKey);
        if (entry && entry.value) {
          logger.warn('[CatalogIndex] ' + url + ' feilet — serverer utløpt kopi:', e);
          return entry.value;
        }
      }
      throw e;
    }
  }

  /** Kilde-id-ene som er aktivert i AppConfig.sources (adapter-oppføringene). */
  static _enabledSources() {
    const cfg = (window.AppConfig && window.AppConfig.sources) || {};
    // sources bærer også skalarer (fetchTimeoutMs, maxConcurrentRequests);
    // `adapter` er det som skiller en kildeoppføring fra dem.
    return Object.keys(cfg).filter(key => {
      const entry = cfg[key];
      return !!entry && typeof entry === 'object' && !!entry.adapter && entry.enabled !== false;
    });
  }

  /** Hent + dekod ETT shard. Kaster ved alt som gjør shardet ubrukelig. */
  static async _loadShard(entry, settings) {
    const url = CatalogIndex._shardUrl(settings.manifestPath, entry.file);
    const doc = await CatalogIndex._cachedJson(
      CatalogIndex._shardKey(entry.file), url, settings.timeoutMs);

    // decode() kaster på ukjent format og på indekser utenfor rekkevidde —
    // et halvskrevet shard skal degradere kilden, ikke levere halve rader.
    const rows = CatalogIndex.decode(doc);
    if (!rows.length) {
      throw new Error('[CatalogIndex] Shard «' + entry.file + '» dekodet til 0 rader');
    }

    const generatedAt = doc.generatedAt || entry.generatedAt || '';
    const builtAt = Date.parse(generatedAt);
    return {
      sourceId: entry.source,
      rows: rows,
      meta: {
        count: rows.length,
        generatedAt: generatedAt,
        // Ukjent byggetidspunkt behandles som stale — da sier statusbadgen
        // fra i stedet for å love ferskhet den ikke kan vite noe om.
        stale: Number.isFinite(builtAt) ? (Date.now() - builtAt) > settings.staleAfterMs : true,
        bytes: entry.bytes || 0,
        // Innholdshashet filnavn — brukes av checkForUpdate() til å avgjøre
        // OM kilden faktisk endret seg (se der for begrunnelse).
        file: entry.file
      }
    };
  }

  /** Tomt (ikke-tilgjengelig) resultat — samme form som et vellykket. */
  static _emptyResult() {
    return { available: false, rows: [], bySource: {}, meta: {}, missingSources: [], generatedAt: '' };
  }

  /** Noter tilgjengeligheten + meta på den memoiserte tilstanden og returner svaret. */
  static _settle(result) {
    if (CatalogIndex._state) {
      CatalogIndex._state.available = !!result.available;
      CatalogIndex._state.meta = result.meta || {};
      CatalogIndex._state.generatedAt = result.generatedAt || '';
    }
    return result;
  }

  /**
   * Hent + dekod hele indeksen for ett språk. Ren i den forstand at den IKKE
   * rører den memoiserte _state — load() gjør det via _settle() rett under,
   * og checkForUpdate() (se der) bruker den samme funksjonen for å kunne
   * avgjøre FØR den committer noe, slik at en forbigående nettverksfeil
   * under en manuell sjekk ikke slår beina under en allerede brukbar indeks.
   */
  static async _fetchAndDecode(lang) {
    const settings = CatalogIndex._settings();

    // Over file:// blokkerer nettleseren fetch() av lokale filer. Å prøve
    // likevel gir en CORS-feil i konsollen for ingenting — vi vet svaret på
    // forhånd. Åpnes appen rett fra disk er indeksen derfor ikke tilgjengelig,
    // og BrowserState henter kildene direkte (tregere, men fungerer). Dette er
    // en bevisst, dokumentert degradert modus: kravet om at appen skal virke
    // over file:// ble droppet da indeksen kom til. Se README.
    if (window.location && window.location.protocol === 'file:') {
      logger.warn('[CatalogIndex] Åpnet over file:// — indeksen kan ikke hentes ' +
                  'lokalt; kildene hentes direkte fra API-ene i stedet.');
      return CatalogIndex._emptyResult();
    }

    let manifest = null;
    try {
      manifest = await CatalogIndex._cachedJson(
        CatalogIndex._manifestKey(lang), settings.manifestPath, settings.timeoutMs);
    } catch (e) {
      logger.warn('[CatalogIndex] Klarte ikke å hente manifestet — kildene hentes direkte:', e);
      return CatalogIndex._emptyResult();
    }

    if (!manifest || manifest.format !== 1 || !Array.isArray(manifest.shards)) {
      logger.warn('[CatalogIndex] Ukjent manifestformat (format=' +
                  (manifest && manifest.format) + ') — kildene hentes direkte');
      return CatalogIndex._emptyResult();
    }

    // Alle shards for språket parallelt; allSettled isolerer hvert shard slik
    // at ett ødelagt ikke tar de andre med seg.
    const wanted = manifest.shards.filter(s => s && s.lang === lang);
    const settled = await Promise.allSettled(
      wanted.map(s => CatalogIndex._loadShard(s, settings)));

    const rows = [];
    const bySource = {};
    const meta = {};

    settled.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        bySource[res.value.sourceId] = res.value.rows;
        meta[res.value.sourceId] = res.value.meta;
        rows.push(...res.value.rows);
      } else {
        logger.warn('[CatalogIndex] Shard for «' + (wanted[i] && wanted[i].source) +
                    '» er ubrukelig (kilden hentes direkte i stedet):', res.reason);
      }
    });

    if (!rows.length) {
      logger.warn('[CatalogIndex] Indeksen ga 0 rader — kildene hentes direkte');
      return CatalogIndex._emptyResult();
    }

    const missingSources = CatalogIndex._enabledSources().filter(id => !bySource[id]);

    logger.log('[CatalogIndex] Lastet ' + rows.length + ' rader fra indeksen (' +
               Object.keys(bySource).join(', ') + ')' +
               (missingSources.length ? '; mangler: ' + missingSources.join(', ') : ''));

    return {
      available: true,
      rows: rows,
      bySource: bySource,
      meta: meta,
      missingSources: missingSources,
      // Manifestets EGET tidsstempel (når hele indeksbygget fullførte) — til
      // forskjell fra per-kilde meta[x].generatedAt (når DEN shardens data
      // ble hentet). source-status.js viser denne som «indeksens alder».
      generatedAt: manifest.generatedAt || ''
    };
  }

  static async _doLoad(lang) {
    return CatalogIndex._settle(await CatalogIndex._fetchAndDecode(lang));
  }

  /**
   * Last katalogindeksen for ett språk. Memoisert per språk — parallelle
   * kallere deler ett arbeid, og et gjentatt kall koster ingenting.
   *
   * @param {object} [options]
   * @param {string} [options.lang] - API-språkkoden ('no' | 'en' | ...).
   * @returns {Promise<{available:boolean, rows:object[], bySource:object,
   *                    meta:object, missingSources:string[]}>}
   */
  static load(options) {
    const lang = (options && options.lang) || 'no';
    const state = CatalogIndex._state;
    if (state && state.lang === lang) return state.promise;

    const promise = CatalogIndex._doLoad(lang);
    CatalogIndex._state = { lang: lang, promise: promise, available: false };
    return promise;
  }

  /** Ga siste FULLFØRTE load() en brukbar indeks? */
  static available() {
    return !!(CatalogIndex._state && CatalogIndex._state.available);
  }

  /** Meta (count/generatedAt/stale/bytes/file per kilde) fra siste FULLFØRTE load(). */
  static meta() {
    return (CatalogIndex._state && CatalogIndex._state.meta) || {};
  }

  /** Manifestets generatedAt fra siste FULLFØRTE load() — ISO-streng, eller ''. */
  static builtAt() {
    return (CatalogIndex._state && CatalogIndex._state.generatedAt) || '';
  }

  /** Glem memoisert tilstand; neste load() henter på nytt (cache gjelder fortsatt). */
  static invalidate() {
    CatalogIndex._state = null;
  }

  /**
   * Sjekk om serveren har bygget en nyere indeks siden sist, uten å laste
   * tabellene på nytt med mindre noe faktisk endret seg — dette er billig
   * (manifestet er ~600 B), til forskjell fra «Oppdater»-knappen per kilde
   * som treffer API-et direkte.
   *
   * DESIGNVALG (holdt mot eksisterende kode i stedet for å finne opp noe
   * nytt): en «sjekk nå»-handling skal være DETERMINISTISK — den skal alltid
   * gjøre et ekte nettverkskall, ikke tilfeldig treffe SSB-revalideringsplanen
   * (cache.js, kun to faste klokkeslett i døgnet) som en vanlig load() ellers
   * ville vært underlagt via manifestets statiske cache-nøkkel. Derfor
   * slettes manifest-cacheoppføringen eksplisitt her FØR hentingen. Shardene
   * trenger ALDRI samme behandling: cache-nøkkelen DERES ER filnavnet
   * (innholdshashet, se _shardKey/_loadShard) — en endret shard er dermed
   * automatisk et cache-bomtreff og hentes friskt av _loadShard uansett,
   * mens en uendret shard fortsatt treffer cachen (billig).
   *
   * «Endret» avgjøres ved å sammenligne shard-FILNAVNET (= innholdshash) per
   * kilde mot det som ble lastet sist, ikke generatedAt — filnavnet er
   * allerede den kanoniske identiteten formatet bruker (se catalog-format.mjs
   * / kommentaren i _cachedJson), så gjenbruk av den er reneste sti; en
   * generatedAt-sammenligning ville vært et duplikat signal.
   *
   * Feiler nettverket/manifestet degraderer dette akkurat som load() — kaster
   * ALDRI — men i MOTSETNING til load() lar det gjeldende, allerede brukbare
   * tilstand stå urørt i stedet for å committe en tom/util­gjengelig indeks:
   * en forbigående feil på en frivillig «se etter oppdatering»-handling skal
   * ikke få appen til å late som om den aldri hadde en indeks.
   *
   * @param {object} [options]
   * @param {string} [options.lang]
   * @returns {Promise<{available, rows, bySource, meta, missingSources,
   *                    generatedAt, changed:string[]}>} changed er kilde-id-ene
   *   hvis shard faktisk byttet filnavn siden forrige load()/checkForUpdate().
   */
  static async checkForUpdate(options) {
    const lang = (options && options.lang) || 'no';
    const prevState = CatalogIndex._state;
    const prevMeta = (prevState && prevState.lang === lang && prevState.meta) || {};

    if (window.location && window.location.protocol === 'file:') {
      return Object.assign(CatalogIndex._emptyResult(), { changed: [] });
    }

    const cache = CatalogIndex._cache();
    if (cache) await cache.delete(CatalogIndex._manifestKey(lang));

    const result = await CatalogIndex._fetchAndDecode(lang);

    const changed = Object.keys(result.meta || {}).filter(sourceId => {
      const prevFile = prevMeta[sourceId] && prevMeta[sourceId].file;
      const newFile = result.meta[sourceId] && result.meta[sourceId].file;
      return !!newFile && newFile !== prevFile;
    });

    if (result.available) {
      // Commit — samme sti som en vanlig load() ville satt (også når
      // changed.length === 0: staleness-flaggene friskes uansett opp mot
      // Date.now()).
      CatalogIndex._state = { lang: lang, promise: Promise.resolve(result), available: false };
      CatalogIndex._settle(result);
    } else {
      logger.warn('[CatalogIndex] Sjekk etter ny indeks feilet — beholder gjeldende tilstand.');
    }

    return Object.assign({}, result, { changed: changed });
  }
}

// Memoisert lastetilstand: { lang, promise, available } eller null.
// Satt utenfor klassekroppen med vilje — statiske klassefelt ville vært den
// eneste ES2022-syntaksen i js/, og filen kjøres også gjennom node:vm av
// scripts/lib/catalog-format.mjs.
CatalogIndex._state = null;

// Global instance
window.CatalogIndex = CatalogIndex;
