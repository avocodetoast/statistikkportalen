/**
 * Delt, avhengighetsfri katalognormalisering for nettleseradapterne og SEO-
 * byggingen. Alle data og hjelpefunksjoner injiseres, slik at fila kan kjøres
 * uendret i node:vm uten nettleseravhengigheter.
 */
(function (window) {
  'use strict';

  // Unionen av emnekodene som NB- og FHI-katalogene bruker.
  const SUBJECT_SORTCODE = {
    bf: '0000006', nk: '0000066', os: '0000076', ei: '0000030',
    ut: '0000115', he: '0000034', be: '0000016', in: '0000042'
  };

  /** Bygg segmentene for [subjekt, ...noder] med vilkårlig dybde. */
  function buildPathSegments(placement, opts) {
    const options = opts || {};
    const subjectNames = options.subjectNames || {};
    const sourceNodes = options.sourceNodes || {};
    const pickLabel = options.pickLabel;
    const lang = options.lang;
    const subjectId = placement[0];
    const nodeIds = placement.slice(1);
    return [{
      id: subjectId,
      label: pickLabel(subjectNames[subjectId], lang) || subjectId,
      sortCode: SUBJECT_SORTCODE[subjectId] || '0009999'
    }].concat(nodeIds.map(function (nodeId) {
      const node = sourceNodes[nodeId] || {};
      return {
        id: nodeId,
        label: pickLabel(node.label, lang) || nodeId,
        sortCode: node.sortCode || '999'
      };
    }));
  }

  /** Bygg de nettverksfrie Norges Bank-radene fra config. */
  function buildNbRows(opts) {
    const options = opts || {};
    const flows = options.dataflows || [];
    const variableNames = options.variableNames || {};
    return flows.map(function (flow, index) {
      const placements = Array.isArray(flow.paths) && flow.paths.length
        ? flow.paths : [flow.path];
      return {
        id: flow.tableId,
        label: options.pickLabel(flow.label, options.lang) || flow.tableId,
        sortCode: String(900 + index),
        updated: '',
        firstPeriod: '',
        lastPeriod: '',
        discontinued: flow.discontinued === true,
        timeUnit: flow.timeUnit || 'Business',
        variableNames: (flow.keywords || variableNames[flow.flow] || []).slice(),
        subjectCode: placements[0][0],
        paths: placements.map(function (placement) {
          return buildPathSegments(placement, options);
        }),
        source: 'Norges Bank'
      };
    });
  }

  /**
   * Bygg FHI-rader fra den radlista adapteren har valgt. Katalogradene gir
   * berikelse når de finnes; dermed forblir live-/cache-fallback adapteransvar.
   */
  function buildFhiRows(opts) {
    const options = opts || {};
    const source = options.source;
    const catalogRows = options.catalogRows || [];
    const catalogById = new Map(catalogRows.map(function (row) {
      return [String(row.tableId), row];
    }));
    const placements = options.placements;
    const subjectCode = placements[0][0];
    const basePaths = placements.map(function (placement) {
      return buildPathSegments(placement, options);
    });
    const categories = options.categories || null;

    function pathsForCategory(categoryId) {
      if (!categoryId || !categories || !categories[categoryId]) return basePaths;
      const definition = categories[categoryId];
      const segment = {
        id: 'fhi-' + source + '-' + categoryId,
        label: definition.label || categoryId,
        sortCode: definition.sortCode || '999'
      };
      return basePaths.map(function (path) { return path.concat([segment]); });
    }

    return (options.rows || []).map(function (row) {
      const catalogRow = catalogById.get(String(row.tableId));
      const fallbackTitle = options.stripTitleMetadataTail
        ? options.stripTitleMetadataTail(row.title) : row.title;
      return {
        id: 'fhi-' + source + '-' + row.tableId,
        label: (catalogRow && catalogRow.title) || fallbackTitle || String(row.tableId),
        updated: row.modifiedAt || row.publishedAt ||
          (catalogRow && catalogRow.updated) || '',
        firstPeriod: (catalogRow && catalogRow.firstPeriod) || '',
        lastPeriod: (catalogRow && catalogRow.lastPeriod) || '',
        discontinued: false,
        sortCode: String(row.tableId).padStart(6, '0'),
        timeUnit: (catalogRow && catalogRow.timeUnit) || null,
        variableNames: (catalogRow && catalogRow.variableNames) || [],
        description: (catalogRow && catalogRow.description) || '',
        subjectCode: subjectCode,
        paths: pathsForCategory(catalogRow && catalogRow.category),
        source: 'FHI/' + options.sourceTitle
      };
    });
  }

  /** Bygg de nettverksfrie DBH-radene fra den kuraterte katalogen. */
  function buildDbhRows(opts) {
    const options = opts || {};
    return (options.tables || []).map(function (table, index) {
      const placements = table.paths || [];
      return {
        id: table.id, label: table.title, sortCode: String(920 + index),
        updated: '', firstPeriod: '', lastPeriod: '', discontinued: false,
        timeUnit: table.timeUnit || 'year',
        variableNames: table.dimensions.map(function (d) { return d.label || d.code; }).concat(table.measures),
        subjectCode: placements[0] && placements[0][0],
        paths: placements.map(function (placement) { return buildPathSegments(placement, options); }),
        source: options.sourceName || ''
      };
    });
  }

  window.CatalogShared = {
    SUBJECT_SORTCODE: SUBJECT_SORTCODE,
    buildPathSegments: buildPathSegments,
    buildNbRows: buildNbRows,
    buildFhiRows: buildFhiRows,
    buildDbhRows: buildDbhRows
  };
})(window);
