/** Adapter for HK-dirs DBH-API. Registrerer seg før source-registry.js. */
(function () {
  'use strict';
  const logger = window.logger;
  const cfg = window.AppConfig && window.AppConfig.sources && window.AppConfig.sources.dbh;
  if (!cfg || cfg.enabled === false) return;
  if (!window.DbhToJsonStat || !window.DbhCatalog) {
    logger.error('[DBHAdapter] Konverterer eller katalog mangler — sjekk lastrekkefølgen.');
    return;
  }
  const BASE = (cfg.baseUrl || '').replace(/\/+$/, '');
  const FETCH_TIMEOUT_MS = window.AppConfig.sources.fetchTimeoutMs || 15000;
  const DATA_TIMEOUT_MS = window.AppConfig.sources.dataFetchTimeoutMs || 90000;
  const TTL = window.AppConfig.cache.metadataTTL;
  const cacheGet = window.SourceCommon.cacheGet;
  const cacheSet = function (key, value) { return window.SourceCommon.cacheSet(key, value, TTL); };
  let metadataPromise = null;

  function tableForId(id) {
    return window.DbhCatalog.tables.find(function (table) { return table.id === id; }) || null;
  }
  function translated(key, fallback) {
    const value = typeof window.t === 'function' ? window.t(key) : key;
    return value && value !== key ? value : fallback;
  }
  function getMetadataFile() {
    if (metadataPromise) return metadataPromise;
    if (window.location && window.location.protocol === 'file:') {
      logger.warn('[DBHAdapter] file:// kan ikke hente data/sources/dbh-metadata.json.');
      metadataPromise = Promise.resolve(null);
      return metadataPromise;
    }
    metadataPromise = window.SourceCommon.fetchWithTimeout('data/sources/dbh-metadata.json',
      { headers: { Accept: 'application/json' } },
      { timeoutMs: FETCH_TIMEOUT_MS, timeoutErrorPrefix: '[DBHAdapter] Tidsavbrudd', queue: 'dbh' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .catch(function (error) { logger.warn('[DBHAdapter] Klarte ikke å lese byggetidsmetadata.', error); return null; });
    return metadataPromise;
  }
  async function fetchDbh(path, body, timeoutMs) {
    const res = await window.SourceCommon.fetchWithTimeout(BASE + '/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }, { timeoutMs: timeoutMs || FETCH_TIMEOUT_MS, timeoutErrorPrefix: '[DBHAdapter] Tidsavbrudd', queue: 'dbh' });
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok) {
      const detail = json && (json.detail || json.title) || '';
      if (res.status === 400 && /Over 500001 poster/i.test(detail)) {
        throw new Error(translated('dbh.error.tooLarge', 'Uttrekket er for stort. Begrens utvalget og prøv igjen.'));
      }
      if (res.status === 400 && /Valideringsfeil/i.test((json && json.title || '') + ' ' + detail)) {
        throw new Error(translated('dbh.error.validation', 'DBH avviste spørringen som ugyldig.') + ' ' + detail);
      }
      if (res.status === 500) throw new Error(translated('dbh.error.unknownTable', 'DBH-tabellen finnes ikke.'));
      throw new Error('[DBHAdapter] HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    return json;
  }
  function buildCatalogue(lang) {
    return window.CatalogShared.buildDbhRows({
      tables: window.DbhCatalog.tables,
      subjectNames: window.SubjectConfig && window.SubjectConfig.subjectNames || {},
      sourceNodes: window.AppConfig.sourceNodes || {}, lang: lang,
      pickLabel: window.SourceCommon.pickLabel,
      sourceName: cfg.branding.name
    });
  }
  async function getTables(options) {
    const opts = options || {};
    if (opts.query || opts.pastDays) return { tables: [] };
    return { tables: buildCatalogue(opts.lang || 'no'), sourceMeta: { fromCache: true, stale: false, fetchedAt: Date.now() } };
  }
  function buildMetadata(table, built) {
    const tableMeta = built && built.tables && built.tables[table.id] || {};
    const dimension = {};
    const ids = table.dimensions.map(function (dim) { return dim.code; });
    const sizes = [];
    table.dimensions.forEach(function (dim) {
      const entries = (tableMeta.dimensions && tableMeta.dimensions[dim.code]) || [];
      const index = {}; const label = {};
      entries.forEach(function (entry, i) {
        const code = String(entry.code); index[code] = i; label[code] = entry.label == null ? code : String(entry.label);
      });
      sizes.push(entries.length);
      dimension[dim.code] = { label: dim.label || dim.code, category: { index: index, label: label } };
    });
    if (table.measures.length > 1) {
      const index = {}; const label = {};
      table.measures.forEach(function (m, i) { index[m] = i; label[m] = m; });
      ids.push('dbh-måltall'); sizes.push(table.measures.length);
      dimension['dbh-måltall'] = { label: translated('dbh.metric', 'Måltall'), category: { index: index, label: label } };
    }
    const notes = [];
    if (table.noteKey) notes.push(translated(table.noteKey, 'Gjennomsnitt er ikke additive og skal ikke summeres.'));
    const extension = {
      sections: [{ title: translated('dbh.section.title', 'Om DBH-dataene'), lines: [translated('dbh.section.body', 'Data leveres fra HK-dirs DBH-API.')] }],
      aboutUrl: table.aboutUrl, publishedBy: cfg.branding.nameFull,
      periods: tableMeta.periods || { firstPeriod: '', lastPeriod: '' }
    };
    if (table.gdpr) notes.push(translated('dbh.gdprNote', 'Små tall under 3 kan være skjermet av personvernhensyn.'));
    return { class: 'dataset', id: ids, size: sizes, dimension: dimension,
      role: { time: ['Årstall'], metric: table.measures.length > 1 ? ['dbh-måltall'] : [] },
      label: table.title, source: cfg.branding.name, updated: built && built.generatedAt || null,
      note: notes, extension: extension };
  }
  async function getTableMetadata(id, useCache, lang) {
    const table = tableForId(id);
    if (!table) throw new Error('[DBHAdapter] Ukjent tabell-id: ' + id);
    const cacheKey = 'table_' + id + '_meta_v1_' + (lang || 'no');
    let meta = useCache === false ? null : await cacheGet(cacheKey);
    if (!meta) { meta = buildMetadata(table, await getMetadataFile()); await cacheSet(cacheKey, meta); }
    const out = Object.assign({}, meta);
    const notes = (meta.note || []).slice();
    if (String(lang || '').toLowerCase() === 'en') notes.push(translated('dbh.enLanguageNote', 'Data and labels are only available in Norwegian.'));
    out.note = notes;
    return out;
  }
  function normalizeSelection(value) {
    if (value === '*' || value == null) return null;
    return Array.isArray(value) ? value.map(String) : [String(value)];
  }
  function buildBody(table, valueCodes) {
    const selections = valueCodes || {};
    const years = normalizeSelection(selections['Årstall']);
    let yearSelection = { filter: 'all', values: ['*'] };
    if (years && years.length === 1) yearSelection = { filter: 'item', values: years };
    else if (years && years.length > 1) {
      const sorted = years.slice().sort(); yearSelection = { filter: 'between', values: [sorted[0], sorted[sorted.length - 1]] };
    }
    return { tabell_id: table.rawId, api_versjon: 1,
      filter: [{ variabel: 'Årstall', selection: yearSelection }],
      groupBy: table.dimensions.map(function (d) { return d.code; }),
      sortBy: ['Årstall'], statuslinje: 'J', kodetekst: 'J', desimal_separator: '.' };
  }
  function buildApiQuery(id, valueCodes) {
    const table = tableForId(id);
    if (!table) throw new Error('[DBHAdapter] Ukjent tabell-id: ' + id);
    return { method: 'POST', url: BASE + '/hentJSONTabellData', body: buildBody(table, valueCodes), metadataUrl: BASE + '/Tabell' };
  }
  async function getTableData(id, valueCodes, lang) {
    const table = tableForId(id);
    if (!table) throw new Error('[DBHAdapter] Ukjent tabell-id: ' + id);
    const response = await fetchDbh('hentJSONTabellData', buildBody(table, valueCodes), DATA_TIMEOUT_MS);
    const status = response && response[0] && response[0].status;
    if (status && Number(status.returkode) !== 0) throw new Error(status.melding || translated('dbh.error.response', 'DBH returnerte en feil.'));
    // Etiketter fra byggetidsmetadataene: dataresponsen har bare navnekolonner
    // for et fåtall dimensjoner, mens dbh-metadata.json har kode+navn-par for
    // alle (probet med kodetekst:"J").
    const built = await getMetadataFile();
    const builtDims = built && built.tables && built.tables[table.id] && built.tables[table.id].dimensions || {};
    const dimsWithLabels = table.dimensions.map(function (dim) {
      const labelMap = {};
      (builtDims[dim.code] || []).forEach(function (entry) { labelMap[String(entry.code)] = entry.label; });
      return Object.assign({}, dim, { labelMap: labelMap });
    });
    const selected = valueCodes || {};
    const rows = response.slice(1).filter(function (row) {
      return table.dimensions.every(function (dim) {
        if (dim.code === 'Årstall') return true;
        const wanted = normalizeSelection(selected[dim.code]);
        return !wanted || wanted.indexOf(String(row[dim.code])) !== -1;
      });
    });
    return window.DbhToJsonStat.convert([response[0]].concat(rows), {
      dimensions: dimsWithLabels, measures: table.measures,
      label: table.title, source: cfg.branding.name
    });
  }
  const unsupported = function (message) { return async function () { throw new Error(message); }; };
  const adapter = {
    sourceId: 'dbh',
    capabilities: { supportsSavedQueries: false, supportsServerExport: false, supportsCodelists: false,
      supportsGetUrlBuilder: false, supportsApiQuery: true, supportsDefaultSelection: false, supportsAggregation: false },
    ownsTableId: function (id) { return typeof id === 'string' && id.startsWith('dbh-'); },
    getConfig: async function () { return null; }, getTables: getTables, getAllTables: getTables,
    getTableMetadata: getTableMetadata, getTableData: getTableData, buildApiQuery: buildApiQuery,
    getApiBuilderOptions: function () { return { formats: [{ value: 'json', label: 'JSON' }], defaultFormat: 'json', csvFormats: [], maxRowCount: null }; },
    getCodeList: unsupported('[DBHAdapter] Kodelister støttes ikke'),
    downloadTableData: unsupported('[DBHAdapter] Servereksport støttes ikke'),
    saveSavedQuery: unsupported('[DBHAdapter] Lagrede spørringer støttes ikke'),
    getSavedQuery: unsupported('[DBHAdapter] Lagrede spørringer støttes ikke'),
    getSavedQueryData: unsupported('[DBHAdapter] Lagrede spørringer støttes ikke'),
    getDefaultSelection: async function () { return { selection: [] }; }, buildPostBody: function () { throw new Error('[DBHAdapter] Bruk buildApiQuery'); },
    cleanupCache: function () { return 0; }, clearCache: function () {}, getCacheStats: function () { return null; }
  };
  (window.SourceAdapters = window.SourceAdapters || []).push(adapter);
})();
