/**
 * Table Display - Fetch and display table data
 */

// Store current data and metadata
let currentData = null;
let currentFullMetadata = null;

/**
 * Render the table display view
 * @param {HTMLElement} container - Container element
 */
async function renderTableDisplay(container) {
  logger.log('[TableDisplay] Rendering table display');

  if (!AppState.selectedTable || !AppState.variableSelection) {
    showError(t('error.noTableOrSel'));
    URLRouter.navigateTo('home', {});
    URLRouter.handleRoute();
    return;
  }

  const table = AppState.selectedTable;
  updatePageTitle([extractTableTitle(table.label)]);

  await BrowserState.init();

  // If we arrived via direct link/refresh, the label was a placeholder — update it now
  const realTable = BrowserState.allTables.find(t => t.id === table.id);
  if (realTable) {
    AppState.selectedTable.label = realTable.label;
    updatePageTitle([extractTableTitle(table.label)]);
  }

  container.innerHTML = `
    ${BrowserState.renderSearchInput()}
    ${MenuBar.render(BrowserState.menuHierarchy)}
    <div class="view-container">
      <div class="view-header">
        <div class="view-header-buttons">
          <button id="back-to-browser" class="btn-secondary">
            ${t('nav.back.tables')}
          </button>
          <button id="back-to-variables" class="btn-secondary">
            ${t('nav.back.variables')}
          </button>
        </div>
        ${buildNavigationBreadcrumb(table.id, extractTableTitle(table.label))}
        <h2>${escapeHtml(extractTableTitle(table.label))}</h2>
        <p class="table-id-display">${t('table.prefix')} ${escapeHtml(table.id)}</p>
      </div>

      <div id="data-container" class="data-container">
        <p class="loading-message">${t('loading.data')}</p>
      </div>
    </div>
  `;

  // Wire up the shared top navigation (search + subject menu)
  MenuBar.attachListeners(container);
  BrowserState.attachSearchInputListener();

  // Set up back buttons
  document.getElementById('back-to-browser')?.addEventListener('click', () => {
    currentData = null;
    currentFullMetadata = null;
    const ref = AppState.navigationRef || 'home';
    AppState.resetTableState();
    const [route, qs] = ref.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    URLRouter.navigateTo(route, params);
    URLRouter.handleRoute();
  });

  document.getElementById('back-to-variables')?.addEventListener('click', () => {
    AppState.setView('variables');
  });

  // Fetch and display data
  await loadTableData();
}

/**
 * Load table data from API.
 *
 * The selection object (AppState.variableSelection) may not contain entries
 * for all dimensions. Dimensions with extension.elimination=true that the user
 * left unselected are intentionally omitted, causing the API to aggregate
 * across all values for those dimensions (they won't appear in the result).
 */
async function loadTableData() {
  const tableId = AppState.selectedTable.id;
  const selection = AppState.variableSelection;

  logger.log('[TableDisplay] Fetching data for table:', tableId);
  logger.log('[TableDisplay] Variable selection:', selection);

  // Use pre-fetched data if available (e.g. from saved query parallel fetch).
  // Consume and clear immediately so subsequent navigations always re-fetch.
  let data;
  if (AppState.tableData) {
    logger.log('[TableDisplay] Using pre-fetched data for table:', tableId);
    data = AppState.tableData;
    AppState.tableData = null;
  } else {
    data = await safeApiCall(
      () => api.getTableData(tableId, selection, getCurrentApiLang(), AppState.activeCodelistIds),
      t('error.fetchData')
    );
  }

  if (!data || !data.value) {
    logger.error('[TableDisplay] Invalid data format:', data);
    const container = document.getElementById('data-container');
    if (container) {
      container.innerHTML = '<p class="error-message">' + t('error.fetchData') + '</p>';
    }
    return;
  }

  if (data.value.length === 0) {
    const container = document.getElementById('data-container');
    if (container) {
      container.innerHTML = '<p class="no-results">' + t('error.noData') + '</p>';
    }
    return;
  }

  currentData = data;

  // Fetch full metadata (from cache) for display
  try {
    currentFullMetadata = await api.getTableMetadata(tableId, true, getCurrentApiLang());
    // Update title if it was set as a placeholder during direct URL navigation
    if (currentFullMetadata?.label && AppState.selectedTable) {
      AppState.selectedTable.label = currentFullMetadata.label;
      const h2 = document.querySelector('.view-header h2');
      if (h2) h2.textContent = extractTableTitle(currentFullMetadata.label);
      const bc = document.querySelector('.breadcrumb-current');
      if (bc) bc.textContent = AppState.selectedTable.id + ' ' + extractTableTitle(currentFullMetadata.label);
    }
    BrowserState.syncTablePeriodsFromMetadata(tableId, currentFullMetadata);
  } catch (e) {
    logger.warn('[TableDisplay] Could not load full metadata:', e);
    currentFullMetadata = null;
  }

  logger.log('[TableDisplay] Data loaded:', data);
  logger.log('[TableDisplay] Dimensions:', data.id);
  logger.log('[TableDisplay] Sizes:', data.size);
  logger.log('[TableDisplay] Values:', data.value.length);

  // Determine layout: use pre-set layout (e.g. from saved query or URL param) if it
  // has meaningful content AND covers exactly the same dimensions as the current data.
  // If the dimension set has changed (e.g. user added/removed an optional variable),
  // recalculate from scratch so no dimension is silently missing or stale.
  const existingLayout = AppState.tableLayout;
  const allDataDims = [...data.id].sort();
  const layoutDims = existingLayout
    ? [...(existingLayout.rows || []), ...(existingLayout.columns || [])].sort()
    : [];
  const hasValidPresetLayout = existingLayout &&
    (existingLayout.rows.length > 0 || existingLayout.columns.length > 0) &&
    JSON.stringify(allDataDims) === JSON.stringify(layoutDims);

  if (!hasValidPresetLayout) {
    AppState.tableLayout = determineDefaultLayout(data);
  }

  // Display the data
  displayData();
}

/**
 * Determine default layout for table
 * @param {object} data - JSON-Stat2 data
 * @returns {object} - Layout object with rows and columns arrays
 */
function determineDefaultLayout(data) {
  const dimensions = data.id;

  // Use the JSON-stat2 role.time field to identify the time dimension — API-agnostic,
  // works regardless of what the dimension code is named in any language or instance.
  const timeDimCode = data.role?.time?.[0];
  const timeDimIndex = timeDimCode != null ? dimensions.indexOf(timeDimCode) : -1;

  if (timeDimIndex !== -1) {
    // Time dimension as rows (one row per period)
    const nonTimeDims = dimensions.filter((_, i) => i !== timeDimIndex);
    if (nonTimeDims.length > 0) {
      return {
        rows: [dimensions[timeDimIndex]],
        columns: nonTimeDims
      };
    } else {
      return {
        rows: [dimensions[timeDimIndex]],
        columns: []
      };
    }
  } else if (dimensions.length > 1) {
    // Last dimension as column
    return {
      rows: dimensions.slice(0, -1),
      columns: [dimensions[dimensions.length - 1]]
    };
  } else {
    // Single dimension: show as column
    return {
      rows: [],
      columns: dimensions
    };
  }
}

/**
 * Display the data as a table
 */
function displayData() {
  const container = document.getElementById('data-container');
  if (!container || !currentData) return;

  // Capability gates: SSB-only features (server-side xlsx/px/html export,
  // saved/shared queries) are hidden for sources that don't support them
  // (Norges Bank, FHI — see js/sources/*-adapter.js capabilities). The
  // client-side CSV export below has no server dependency, so it is always
  // shown, for every source.
  const caps = api.capabilitiesFor(AppState.selectedTable.id) || {};
  // No server export (NB/FHI): CSV is the primary download action.
  const csvBtnClass = caps.supportsServerExport ? 'btn-secondary' : 'btn-primary';

  // Build metadata section
  let html = buildMetadataSection();

  // Build control bar
  html += `
    <div class="table-controls">
      <div class="control-group">
        <button id="rotate-table-btn" class="btn-secondary">
          ${t('table.rotate')}
        </button>
        ${caps.supportsServerExport ? `
        <button id="export-quick-btn" class="btn-primary">
          ${t('table.download')}
        </button>` : ''}
        <button id="export-csv-btn" class="${csvBtnClass}" title="${t('table.downloadCsvTooltip')}">
          ${t('table.downloadCsv')}
        </button>
        ${caps.supportsServerExport ? `
        <button id="export-btn" class="btn-secondary">
          ${t('table.moreOptions')}
        </button>` : ''}
        ${caps.supportsSavedQueries ? `
        <button id="save-query-btn" class="btn-secondary">
          ${t('table.getLink')}
        </button>` : ''}
      </div>
      <div class="table-info">
        <span id="cell-count-display"></span>
      </div>
    </div>
  `;

  // Build the table
  html += buildHtmlTable();

  container.innerHTML = html;

  // Set up event listeners
  document.getElementById('rotate-table-btn')?.addEventListener('click', () => {
    openRotationDialog();
  });

  document.getElementById('save-query-btn')?.addEventListener('click', () => {
    showSaveQueryDialog();
  });

  document.getElementById('export-quick-btn')?.addEventListener('click', () => {
    quickExportXlsx();
  });

  document.getElementById('export-btn')?.addEventListener('click', () => {
    showExportDialog();
  });

  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    exportCsvClientSide();
  });

  // Set up metadata toggle
  setupMetadataToggle(container);

  // Update cell count
  updateCellCount();
}

/**
 * Client-side CSV export of the currently displayed (pivoted) table.
 *
 * Available for ALL sources (SSB, Norges Bank, FHI) — unlike the xlsx/px/html
 * export dialog, it needs no server support: it serializes `currentData` +
 * `AppState.tableLayout`, i.e. exactly the rows/columns/values the on-screen
 * HTML table shows (see buildHtmlTable()). For SSB tables it complements the
 * server-side export (xlsx.); for NB/FHI tables it is the only download
 * option.
 *
 * Format choices (deliberate, not user-configurable):
 *   - UTF-8 with a BOM, semicolon (;) field separator — matches SSB's own
 *     "SeparatorSemicolon" CSV default (js/export.js) so the file opens
 *     directly in Norwegian-locale Excel without a manual import wizard.
 *   - Numbers use a decimal comma, no thousands separator (formatNumberForCsv),
 *     consistent with the on-screen formatNumber() but without the space
 *     thousands-grouping, which spreadsheet software would otherwise choke on.
 *   - Suppressed cells keep their JSON-stat2 status symbol (., .., :) as text.
 *   - CSV cannot merge cells, so multi-level column headers are flattened:
 *     one header row per column dimension, with the value repeated for every
 *     column in that group (rather than the HTML table's colspan). The
 *     corner above the row-header columns — left blank on screen — instead
 *     carries the row dimensions' own labels on the last such row, so every
 *     CSV column has an unambiguous header.
 */
function exportCsvClientSide() {
  if (!currentData || !AppState.tableLayout) {
    showError(t('error.noDataExport'));
    return;
  }

  const csv = buildCsvContent();
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });

  // Same custom-filename convention as SSBApi.downloadTableData (api.js):
  // tableId_yyyymmdd-hhmmss.csv
  const timestamp = getTimestamp().replace('_', '-');
  const filename = AppState.selectedTable.id + '_' + timestamp + '.csv';

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  logger.log('[TableDisplay] CSV export complete:', filename);
}

/**
 * Build the CSV text (without BOM) for the currently displayed table.
 * See exportCsvClientSide() for the format rationale.
 * @returns {string} CSV content, CRLF line endings
 */
function buildCsvContent() {
  const SEPARATOR = ';';
  const data = currentData;
  const layout = AppState.tableLayout;
  const rowDims = layout.rows;
  const colDims = layout.columns;

  const rowHeaders = buildDimensionCombinations(rowDims, data);
  const colHeaders = buildDimensionCombinations(colDims, data);
  const rowDimLabels = rowDims.map(d => data.dimension[d]?.label || d);

  const lines = [];

  if (colDims.length > 0) {
    // One header row per column dimension. The corner cells (above the
    // row-header columns) are blank except on the last row, which carries
    // the row dimensions' labels.
    colDims.forEach((dimCode, dimIndex) => {
      const dimension = data.dimension[dimCode];
      const corner = (dimIndex === colDims.length - 1) ? rowDimLabels : rowDims.map(() => '');
      const headerCells = colHeaders.map(colHeader => {
        const code = colHeader.codes[dimIndex];
        return dimension.category.label[code] ?? code;
      });
      lines.push([...corner, ...headerCells].map(csvField).join(SEPARATOR));
    });
  } else if (rowDims.length > 0) {
    // No column dimension: a single header row (row-dim labels + one generic value column)
    lines.push([...rowDimLabels, t('table.csvValueColumn')].map(csvField).join(SEPARATOR));
  }

  const { rowOffsets, colOffsets } = computeFlatIndexOffsets(data, layout, rowHeaders, colHeaders);

  rowHeaders.forEach((rowHeader, rowIndex) => {
    const rowCells = rowDims.map((dimCode, i) => {
      const code = rowHeader.codes[i];
      return data.dimension[dimCode].category.label[code] ?? code;
    });

    const rowOffset = rowOffsets[rowIndex];
    const dataCells = colHeaders.map((_colHeader, colIndex) => {
      const flatIndex = rowOffset + colOffsets[colIndex];
      const status = statusAtFlatIndex(flatIndex);
      if (status) return status;
      return formatNumberForCsv(valueAtFlatIndex(flatIndex));
    });

    lines.push([...rowCells, ...dataCells].map(csvField).join(SEPARATOR));
  });

  return lines.join('\r\n');
}

/**
 * Format a numeric value for CSV: Norwegian decimal comma, no thousands
 * separator (unlike the on-screen formatNumber(), which adds space
 * grouping that would confuse spreadsheet numeric parsing).
 * @param {number|string|null} value
 * @returns {string}
 */
function formatNumberForCsv(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  return String(value).replace('.', ',');
}

/**
 * Escape a single CSV field: quote (and double internal quotes) whenever
 * the value contains the separator, a quote, or a line break.
 * @param {*} value
 * @returns {string}
 */
function csvField(value) {
  const str = String(value ?? '');
  if (/[;"\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build HTML table from data
 * @returns {string} - HTML table
 */
function buildHtmlTable() {
  if (!currentData || !AppState.tableLayout) {
    return '<p class="error-message">' + t('error.buildTable') + '</p>';
  }

  const data = currentData;
  const layout = AppState.tableLayout;

  // Get dimension info
  const rowDims = layout.rows;
  const colDims = layout.columns;

  // Build row and column headers
  const rowHeaders = buildDimensionCombinations(rowDims, data);
  const colHeaders = buildDimensionCombinations(colDims, data);

  // Precompute metric dimension lookup for decimal formatting (constant across all cells)
  const metricDim = data.role?.metric?.[0];
  const metricRowIdx = metricDim != null ? layout.rows.indexOf(metricDim) : -1;
  const metricColIdx = metricDim != null ? layout.columns.indexOf(metricDim) : -1;
  const tableDefaultDecimals = data.extension?.px?.decimals ?? null;

  logger.log('[TableDisplay] Row headers:', rowHeaders.length);
  logger.log('[TableDisplay] Column headers:', colHeaders.length);

  // Start building table
  let html = '<div class="table-wrapper"><table class="data-table">';

  // Build column header rows
  if (colDims.length > 0) {
    html += '<thead>';

    // One row for each column dimension
    colDims.forEach((dimCode, dimIndex) => {
      html += '<tr>';

      // Corner cell spanning all row-header columns (omit if there are no row dims)
      if (dimIndex === 0 && rowDims.length > 0) {
        html += '<th colspan="' + rowDims.length + '" rowspan="' + colDims.length + '"' +
                ' class="corner-cell">&nbsp;</th>';
      }

      // Column headers
      const dimension = data.dimension[dimCode];
      const dimLabel = dimension.label || dimCode;

      // Group headers by dimension level
      let prevGroup = null;
      let groupSpan = 0;

      colHeaders.forEach((colHeader, colIndex) => {
        const currentGroup = colHeader.codes[dimIndex];

        if (prevGroup !== null && currentGroup !== prevGroup) {
          // Output previous group
          const label = data.dimension[dimCode].category.label[prevGroup];
          html += '<th colspan="' + groupSpan + '" class="col-header">' +
                  escapeHtml(label) + '</th>';
          groupSpan = 0;
        }

        groupSpan++;
        prevGroup = currentGroup;

        // Last column - output current group
        if (colIndex === colHeaders.length - 1) {
          const label = data.dimension[dimCode].category.label[prevGroup];
          html += '<th colspan="' + groupSpan + '" class="col-header">' +
                  escapeHtml(label) + '</th>';
        }
      });

      html += '</tr>';
    });

    html += '</thead>';
  }

  // Precompute per-row/-column flat-index offsets so each cell's flat index is a
  // single addition (rowOffset + colOffset) instead of two full data.id scans.
  const { rowOffsets, colOffsets } = computeFlatIndexOffsets(data, layout, rowHeaders, colHeaders);

  // Build data rows
  html += '<tbody>';

  rowHeaders.forEach((rowHeader, rowIndex) => {
    html += '<tr>';

    // Row header cells. title=full label so long, ellipsis-clipped labels
    // (see .row-header max-width in table.css) stay readable on hover.
    rowDims.forEach((dimCode, dimIndex) => {
      const code = rowHeader.codes[dimIndex];
      const label = data.dimension[dimCode].category.label[code];
      html += '<th class="row-header" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</th>';
    });

    const rowOffset = rowOffsets[rowIndex];

    // Data cells
    colHeaders.forEach((colHeader, colIndex) => {
      const flatIndex = rowOffset + colOffsets[colIndex];
      const status = statusAtFlatIndex(flatIndex);
      if (status) {
        html += '<td class="data-cell suppressed-value" title="' + escapeHtml(suppressedLabel(status)) + '">' + escapeHtml(status) + '</td>';
      } else {
        const value = valueAtFlatIndex(flatIndex);
        const metricCode = metricRowIdx !== -1 ? rowHeader.codes[metricRowIdx]
                         : metricColIdx !== -1 ? colHeader.codes[metricColIdx]
                         : undefined;
        const decimals = metricCode !== undefined
          ? (data.dimension[metricDim]?.category?.unit?.[metricCode]?.decimals ?? tableDefaultDecimals)
          : tableDefaultDecimals;
        html += '<td class="data-cell">' + formatNumber(value, decimals) + '</td>';
      }
    });

    html += '</tr>';
  });

  html += '</tbody>';
  html += '</table></div>';

  return html;
}

/**
 * Build all combinations of dimension values
 * @param {Array} dimCodes - Dimension codes
 * @param {object} data - JSON-Stat2 data
 * @returns {Array} - Array of combination objects
 */
function buildDimensionCombinations(dimCodes, data) {
  if (dimCodes.length === 0) {
    return [{ codes: [], indices: [] }];
  }

  let combinations = [{ codes: [], indices: [] }];

  dimCodes.forEach(dimCode => {
    const dimension = data.dimension[dimCode];
    if (!dimension) {
      logger.warn('[TableDisplay] Skipping unknown dimension in layout:', dimCode);
      return;
    }
    const codes = Object.keys(dimension.category.index);

    const newCombinations = [];

    combinations.forEach(combo => {
      codes.forEach(code => {
        const index = dimension.category.index[code];
        newCombinations.push({
          codes: [...combo.codes, code],
          indices: [...combo.indices, index]
        });
      });
    });

    combinations = newCombinations;
  });

  return combinations;
}

/**
 * Per-dimension stride (flat-index multiplier) in data.id order: the last
 * dimension changes fastest, so strides[dim] === product of the sizes of the
 * dimensions after it. The JSON-Stat2 value array is row-major over data.id;
 * this is its positional weighting, precomputed once per table.
 *
 * @param {object} data - JSON-Stat2 data (needs `id` and `size`)
 * @returns {Object<string, number>} - dimCode → stride
 */
function computeDimStrides(data) {
  const strides = {};
  let multiplier = 1;
  for (let i = data.size.length - 1; i >= 0; i--) {
    strides[data.id[i]] = multiplier;
    multiplier *= data.size[i];
  }
  return strides;
}

/**
 * The flat-index contribution of each header, constant across the perpendicular
 * axis: offset(header) = Σ header.indices[i] * strides[dims[i]].
 *
 * @param {Array} headers - Combinations from buildDimensionCombinations
 * @param {string[]} dims - The dimension codes those combinations enumerate
 *   (layout.rows or layout.columns), aligned with header.indices
 * @param {Object<string, number>} strides - From computeDimStrides
 * @returns {number[]} - One offset per header
 */
function computeHeaderOffsets(headers, dims, strides) {
  return headers.map(header => {
    let offset = 0;
    for (let i = 0; i < dims.length; i++) {
      offset += header.indices[i] * strides[dims[i]];
    }
    return offset;
  });
}

/**
 * Precompute the row- and column-offset arrays so a cell's flat index is a
 * single addition: flatIndex = rowOffsets[r] + colOffsets[c]. Replaces the
 * per-cell `data.id.forEach` + two `indexOf` + multiplier work in the render/CSV
 * loops, which dominates for large tables (up to ~800k cells).
 *
 * @param {object} data - JSON-Stat2 data
 * @param {object} layout - AppState.tableLayout ({rows, columns})
 * @param {Array} rowHeaders - buildDimensionCombinations(layout.rows, data)
 * @param {Array} colHeaders - buildDimensionCombinations(layout.columns, data)
 * @returns {{strides: object, rowOffsets: number[], colOffsets: number[]}}
 */
function computeFlatIndexOffsets(data, layout, rowHeaders, colHeaders) {
  const strides = computeDimStrides(data);
  return {
    strides,
    rowOffsets: computeHeaderOffsets(rowHeaders, layout.rows, strides),
    colOffsets: computeHeaderOffsets(colHeaders, layout.columns, strides)
  };
}

/** Data value at a precomputed flat index (companion to computeFlatIndexOffsets). */
function valueAtFlatIndex(flatIndex) {
  return currentData ? currentData.value[flatIndex] : null;
}

/** Suppressed-value status at a precomputed flat index, or null. */
function statusAtFlatIndex(flatIndex) {
  if (!currentData || !currentData.status) return null;
  return currentData.status[String(flatIndex)] ?? null;
}

/**
 * Return a Norwegian label for a JSON-stat2 suppressed-value status code
 * @param {string} code - Status code
 * @returns {string}
 */
function suppressedLabel(code) {
  // SSB JSON-stat2 status conventions:
  //   "."  = ikke mulig å oppgi tall (not applicable)
  //   ".." = tallgrunnlag mangler   (not available)
  //   ":"  = konfidensielt          (confidential)
  switch (code) {
    case '.':  return t('table.notApplicable');
    case '..': return t('table.notAvailable');
    case ':':  return t('table.confidential');
    default:   return code;
  }
}

/**
 * Update cell count display
 */
function updateCellCount() {
  const display = document.getElementById('cell-count-display');
  if (!display || !currentData) return;

  const totalCells = currentData.value.length;
  display.textContent = formatNumber(totalCells, 0) + ' ' + t('unit.cell.many');
}

