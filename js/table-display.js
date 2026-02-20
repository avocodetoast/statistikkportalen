/**
 * Table Display - Fetch and display table data
 */

// Store current data and metadata
let currentData = null;
let currentFullMetadata = null;

// Cache the last saved query so repeated clicks reuse the same ID
let _lastSavedQuery = null; // { fingerprint: string, id: string }

/**
 * Render the table display view
 * @param {HTMLElement} container - Container element
 */
async function renderTableDisplay(container) {
  logger.log('[TableDisplay] Rendering table display');

  if (!AppState.selectedTable || !AppState.variableSelection) {
    showError('Mangler tabell eller variabelvalg');
    URLRouter.navigateTo('home', {});
    URLRouter.handleRoute();
    return;
  }

  const table = AppState.selectedTable;
  updatePageTitle([extractTableTitle(table.label)]);

  await BrowserState.init();

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <div class="view-header-buttons">
          <button id="back-to-browser" class="btn-secondary">
            &larr; Tilbake til tabelloversikt
          </button>
          <button id="back-to-variables" class="btn-secondary">
            &larr; Endre variabelvalg
          </button>
        </div>
        ${buildNavigationBreadcrumb(table.id, extractTableTitle(table.label))}
        <h2>${escapeHtml(extractTableTitle(table.label))}</h2>
        <p class="table-id-display">Tabell ${escapeHtml(table.id)}</p>
      </div>

      <div id="data-container" class="data-container">
        <p class="loading-message">Henter data...</p>
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
    () => api.getTableData(tableId, selection, 'no', AppState.activeCodelistIds),
    'Kunne ikke hente data fra API'
  );

  if (!data || !data.value) {
    logger.error('[TableDisplay] Invalid data format:', data);
    return;
  }

  if (data.value.length === 0) {
    const container = document.getElementById('data-container');
    if (container) {
      container.innerHTML = '<p class="no-results">Ingen data funnet for valgt kombinasjon. Prøv å endre variabelvalget.</p>';
    }
    return;
  }

  currentData = data;

  // Fetch full metadata (from cache) for display
  try {
    currentFullMetadata = await api.getTableMetadata(tableId, true, 'no');
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
  // has meaningful content, otherwise calculate a sensible default from the data.
  const existingLayout = AppState.tableLayout;
  const hasPresetLayout = existingLayout &&
    (existingLayout.rows.length > 0 || existingLayout.columns.length > 0);
  if (!hasPresetLayout) {
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

  // Default: put time dimension as columns if present, otherwise last dimension
  const timeDimIndex = dimensions.findIndex(d =>
    d === 'Tid' || d.toLowerCase().includes('tid')
  );

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
          ↻ Roter tabell
        </button>
        <button id="export-quick-btn" class="btn-primary">
          ⬇ Last ned i Excel-format
        </button>
        <button id="export-btn" class="btn-secondary">
          Flere alternativer
        </button>
        <button id="save-query-btn" class="btn-secondary">
          &#128279; Få lenke
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
    return '<p class="error-message">Kunne ikke bygge tabell</p>';
  }

  const data = currentData;
  const layout = AppState.tableLayout;

  // Get dimension info
  const rowDims = layout.rows;
  const colDims = layout.columns;

  // Build row and column headers
  const rowHeaders = buildDimensionCombinations(rowDims, data);
  const colHeaders = buildDimensionCombinations(colDims, data);

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

      // Empty cells for row headers
      if (dimIndex === 0) {
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
      const value = getDataValue(rowHeader, colHeader);
      const formatted = formatNumber(value);
      html += '<td class="data-cell">' + formatted + '</td>';
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
  display.textContent = formatNumber(totalCells, 0) + ' celler';
}

/**
 * Convert markdown-style links [text](url) to HTML anchor tags
 * @param {string} text - Text with potential markdown links
 * @returns {string} - HTML with anchor tags
 */
function convertMarkdownLinks(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
}

/**
 * Build the collapsible metadata section HTML
 * @returns {string} - HTML string
 */
function buildMetadataSection() {
  if (!currentFullMetadata) return '';

  const meta = currentFullMetadata;

  // Format updated date
  let updatedStr = '';
  if (meta.updated) {
    try {
      const date = new Date(meta.updated);
      updatedStr = date.toLocaleDateString('no-NO', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      updatedStr = meta.updated;
    }
  }

  // Build notes HTML
  let notesHtml = '';
  if (meta.note && Array.isArray(meta.note) && meta.note.length > 0) {
    notesHtml = '<dt>Merknader</dt><dd>';
    meta.note.forEach(note => {
      notesHtml += '<p>' + convertMarkdownLinks(note) + '</p>';
    });
    notesHtml += '</dd>';
  }

  // Build contact HTML
  let contactHtml = '';
  if (meta.extension && meta.extension.contact && meta.extension.contact.length > 0) {
    contactHtml = '<dt>Kontakt</dt><dd>';
    meta.extension.contact.forEach(contact => {
      const parts = [];
      if (contact.name) parts.push(escapeHtml(contact.name));
      if (contact.phone) parts.push('tlf: ' + escapeHtml(contact.phone));
      if (contact.mail) {
        parts.push('<a href="mailto:' + escapeHtml(contact.mail) + '">' +
                   escapeHtml(contact.mail) + '</a>');
      }
      contactHtml += '<p>' + parts.join(', ') + '</p>';
    });
    contactHtml += '</dd>';
  }

  // Official statistics flag
  let officialHtml = '';
  if (meta.extension && meta.extension.px && meta.extension.px['official-statistics']) {
    officialHtml = '<dt>Status</dt><dd>Offisiell statistikk</dd>';
  }

  return `
    <div class="table-metadata">
      <h4 class="metadata-toggle-btn" role="button" tabindex="0" aria-expanded="false">
        <span class="metadata-toggle-icon">&#9654;</span> Tabellinfo
      </h4>
      <div class="metadata-content" style="display: none;">
        <dl>
          ${meta.source ? '<dt>Kilde</dt><dd>' + escapeHtml(meta.source) + '</dd>' : ''}
          ${updatedStr ? '<dt>Sist oppdatert</dt><dd>' + updatedStr + '</dd>' : ''}
          ${officialHtml}
          ${notesHtml}
          ${contactHtml}
        </dl>
      </div>
    </div>
  `;
}

/**
 * Show dialog for saving the current query and presenting shareable links.
 * POSTs to SSB's /savedqueries endpoint and displays both an SSB link
 * and a Statistikkportalen deep-link using the returned query ID.
 */
async function showSaveQueryDialog() {
  if (!currentData || !AppState.selectedTable || !AppState.variableSelection) {
    showError('Ingen aktiv spørring å lagre');
    return;
  }

  // Fingerprint the current selection so we can skip the POST if nothing changed
  const layout = AppState.tableLayout;
  const fingerprint = JSON.stringify({
    tableId: AppState.selectedTable.id,
    selection: AppState.variableSelection,
    codelistIds: AppState.activeCodelistIds || {},
    rows: layout ? layout.rows : [],
    columns: layout ? layout.columns : []
  });

  // Remove any existing dialog
  document.getElementById('save-query-dialog')?.remove();

  const needsLoading = !(_lastSavedQuery && _lastSavedQuery.fingerprint === fingerprint);

  const dialogHtml = `
    <div class="dialog-overlay" id="save-query-dialog">
      <div class="dialog-container" style="max-width: 540px;">
        <div class="dialog-header">
          <h3>Få lenke til spørringen</h3>
          <button class="dialog-close" id="save-query-close">&times;</button>
        </div>
        <div class="dialog-content" id="save-query-content">
          ${needsLoading ? '<p class="loading-message">Lagrer spørring hos SSB...</p>' : ''}
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', dialogHtml);

  const dialog = document.getElementById('save-query-dialog');
  const closeDialog = () => dialog.remove();

  document.getElementById('save-query-close')?.addEventListener('click', closeDialog);

  // Only close overlay click if the mousedown also started on the overlay —
  // prevents accidental close when dragging to select text in the inputs.
  let mouseDownOnOverlay = false;
  dialog.addEventListener('mousedown', (e) => {
    mouseDownOnOverlay = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && mouseDownOnOverlay) closeDialog();
  });

  const showLinks = (id) => {
    const ssbUrl = 'https://www.ssb.no/statbank/sq/' + id;
    const portalUrl = window.location.origin + window.location.pathname + '#sq/' + id;

    document.getElementById('save-query-content').innerHTML = `
      <p>Spørringen er lagret. Bruk lenkene nedenfor for å dele eller gjenåpne den.</p>

      <div class="form-group">
        <label class="form-label">Åpne i Statistikkportalen:</label>
        <div class="save-query-link-row">
          <input type="text" class="save-query-link-input" readonly
                 id="portal-link-input" value="${escapeHtml(portalUrl)}">
          <button class="btn-secondary" id="copy-portal-link">Kopier</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Åpne i SSBs statistikkbank:</label>
        <div class="save-query-link-row">
          <input type="text" class="save-query-link-input" readonly
                 id="ssb-link-input" value="${escapeHtml(ssbUrl)}">
          <button class="btn-secondary" id="copy-ssb-link">Kopier</button>
        </div>
        <a href="${escapeHtml(ssbUrl)}" target="_blank" rel="noopener"
           style="display:inline-block; margin-top: 6px; font-size: 0.9em;">
          Åpne i SSBs statistikkbank ↗
        </a>
      </div>
    `;

    const makeCopyHandler = (inputId, btnId) => {
      document.getElementById(btnId)?.addEventListener('click', () => {
        const val = document.getElementById(inputId)?.value || '';
        navigator.clipboard.writeText(val).catch(() => {
          const input = document.getElementById(inputId);
          if (input) { input.select(); document.execCommand('copy'); }
        });
        const btn = document.getElementById(btnId);
        if (btn) {
          btn.textContent = 'Kopiert!';
          setTimeout(() => { btn.textContent = 'Kopier'; }, 2000);
        }
      });
    };

    makeCopyHandler('portal-link-input', 'copy-portal-link');
    makeCopyHandler('ssb-link-input', 'copy-ssb-link');
  };

  // Reuse cached ID if the selection is unchanged
  if (!needsLoading) {
    showLinks(_lastSavedQuery.id);
    return;
  }

  try {
    const result = await api.saveSavedQuery(
      AppState.selectedTable.id,
      AppState.variableSelection,
      {
        stub: layout ? layout.rows : [],
        heading: layout ? layout.columns : [],
        codelistIds: AppState.activeCodelistIds || {},
        lang: 'no'
      }
    );

    const id = result.id || result.savedQuery?.id;
    if (!id) throw new Error('Ingen ID i svar fra API');

    _lastSavedQuery = { fingerprint, id };
    showLinks(id);

  } catch (e) {
    logger.error('[TableDisplay] Failed to save query:', e);
    document.getElementById('save-query-content').innerHTML =
      '<p class="error-message">Kunne ikke lagre spørringen: ' + escapeHtml(e.message) + '</p>';
  }
}

