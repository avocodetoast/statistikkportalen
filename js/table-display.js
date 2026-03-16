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

  const data = await safeApiCall(
    () => api.getTableData(tableId, selection, getCurrentApiLang(), AppState.activeCodelistIds),
    t('error.fetchData')
  );

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

  // Build metadata section
  let html = buildMetadataSection();

  // Build control bar
  html += `
    <div class="table-controls">
      <div class="control-group">
        <button id="rotate-table-btn" class="btn-secondary">
          ${t('table.rotate')}
        </button>
        <button id="export-quick-btn" class="btn-primary">
          ${t('table.download')}
        </button>
        <button id="export-btn" class="btn-secondary">
          ${t('table.moreOptions')}
        </button>
        <button id="save-query-btn" class="btn-secondary">
          ${t('table.getLink')}
        </button>
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

  // Set up metadata toggle
  const metaToggle = container.querySelector('.metadata-toggle-btn');
  if (metaToggle) {
    metaToggle.addEventListener('click', () => {
      const content = container.querySelector('.metadata-content');
      const icon = metaToggle.querySelector('.metadata-toggle-icon');
      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.innerHTML = '&#9660;';
        metaToggle.setAttribute('aria-expanded', 'true');
      } else {
        content.style.display = 'none';
        icon.innerHTML = '&#9654;';
        metaToggle.setAttribute('aria-expanded', 'false');
      }
    });
    metaToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        metaToggle.click();
      }
    });
  }

  // Update cell count
  updateCellCount();
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

  // Build data rows
  html += '<tbody>';

  rowHeaders.forEach(rowHeader => {
    html += '<tr>';

    // Row header cells
    rowDims.forEach((dimCode, dimIndex) => {
      const code = rowHeader.codes[dimIndex];
      const label = data.dimension[dimCode].category.label[code];
      html += '<th class="row-header">' + escapeHtml(label) + '</th>';
    });

    // Data cells
    colHeaders.forEach(colHeader => {
      const status = getDataStatus(rowHeader, colHeader);
      if (status) {
        html += '<td class="data-cell suppressed-value" title="' + escapeHtml(suppressedLabel(status)) + '">' + escapeHtml(status) + '</td>';
      } else {
        const value = getDataValue(rowHeader, colHeader);
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
 * Get data value for specific row/column combination
 * @param {object} rowHeader - Row header combination
 * @param {object} colHeader - Column header combination
 * @returns {number|null} - Data value
 */
function getDataValue(rowHeader, colHeader) {
  if (!currentData) return null;

  const layout = AppState.tableLayout;
  const data = currentData;

  // Build full dimension indices array
  const fullIndices = [];

  data.id.forEach(dimCode => {
    const rowIndex = layout.rows.indexOf(dimCode);
    const colIndex = layout.columns.indexOf(dimCode);

    if (rowIndex !== -1) {
      fullIndices.push(rowHeader.indices[rowIndex]);
    } else if (colIndex !== -1) {
      fullIndices.push(colHeader.indices[colIndex]);
    } else {
      // Shouldn't happen
      fullIndices.push(0);
    }
  });

  // Calculate flat index
  const flatIndex = calculateFlatIndex(fullIndices, data.size);

  return data.value[flatIndex];
}

/**
 * Get suppressed-value status code for a cell (JSON-stat2 `status` field)
 * @param {object} rowHeader - Row header combination
 * @param {object} colHeader - Column header combination
 * @returns {string|null} - Status symbol (e.g. ".", ":", "..") or null
 */
function getDataStatus(rowHeader, colHeader) {
  if (!currentData || !currentData.status) return null;

  const layout = AppState.tableLayout;
  const data = currentData;

  const fullIndices = [];
  data.id.forEach(dimCode => {
    const rowIndex = layout.rows.indexOf(dimCode);
    const colIndex = layout.columns.indexOf(dimCode);
    if (rowIndex !== -1) {
      fullIndices.push(rowHeader.indices[rowIndex]);
    } else if (colIndex !== -1) {
      fullIndices.push(colHeader.indices[colIndex]);
    } else {
      fullIndices.push(0);
    }
  });

  const flatIndex = calculateFlatIndex(fullIndices, data.size);
  return data.status[String(flatIndex)] ?? null;
}

/**
 * Return a Norwegian label for a JSON-stat2 suppressed-value status code
 * @param {string} code - Status code
 * @returns {string}
 */
function suppressedLabel(code) {
  switch (code) {
    case '.':  return t('table.notAvailable');
    case ':':  return t('table.confidential');
    case '..': return t('table.notApplicable');
    default:   return code;
  }
}

/**
 * Calculate flat array index from dimension indices
 * @param {Array} indices - Index for each dimension
 * @param {Array} sizes - Size of each dimension
 * @returns {number} - Flat index
 */
function calculateFlatIndex(indices, sizes) {
  let flatIndex = 0;
  let multiplier = 1;

  // Process dimensions in reverse order (last dimension changes fastest)
  for (let i = sizes.length - 1; i >= 0; i--) {
    flatIndex += indices[i] * multiplier;
    multiplier *= sizes[i];
  }

  return flatIndex;
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

