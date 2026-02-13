/**
 * Variable Selection - Select dimension values for data query
 *
 * This module renders the variable selection view where users choose which
 * dimension values to include in their data query to the SSB PxWebApi v2.
 *
 * === Selection modes ===
 * Each dimension's value list has a data-mode attribute controlling how values are sent:
 *   - "specific" : User has manually selected individual values (sent as comma-separated codes)
 *   - "star"     : All values requested via the Alle(*) button (sent as "*")
 *   - "top"      : Last N values for time dimensions (sent as "top(N)")
 *
 * === Elimination (valgfrie variabler) ===
 * Dimensions with extension.elimination=true in the metadata are optional.
 * If no values are selected for such a dimension, it is omitted from the API query
 * entirely, causing the API to aggregate across all values for that dimension.
 * Non-elimination dimensions are mandatory and must have at least one value selected.
 *
 * === Codelists (alternative grupperinger) ===
 * Some dimensions have extension.codelists[] with alternative value groupings.
 * Each codelist defines a subset of the dimension's value codes (e.g., aggregated
 * vs detailed categories). A dropdown lets users switch between codelists or
 * view all values freely. Codelists may override the elimination property —
 * e.g., an aggregated codelist may be optional while a detailed one is mandatory.
 *
 * === Hierarchy in labels ===
 * SSB uses the "¬" character to indicate hierarchy depth in value labels.
 * "¬ Bygg og anlegg" = depth 1, "¬¬ Boliger" = depth 2, etc.
 * These are converted to visual indentation via padding-left.
 */

// Store metadata for current table
let tableMetadata = null;

// Track last clicked item index per dimension for shift-click range selection
const lastClickedIndex = {};

/**
 * Track active codelist per dimension.
 * Key: dimension code (e.g., "Investeringsart")
 * Value: null (no codelist, show all values) or {
 *   codelistId: string,
 *   elimination: boolean,
 *   isAggregated: boolean,
 *   values: Array<{code, label, valueMap}>,
 *   originalCodes: Set<string>
 * }
 *
 * When a codelist is active, the value list is always re-rendered from codelist
 * data (via renderCodelistValues), ensuring values appear in the codelist's order.
 * The codelist's own elimination property may override the dimension's default.
 */
const activeCodelists = {};

/**
 * Pre-loaded value ordering per dimension from the first codelist.
 * Key: dimension code, Value: array of codes in the codelist's order.
 * Used by renderValueList() to order "Velg fritt" values consistently
 * with codelist-defined ordering (codelist codes first, remaining after).
 */
const dimensionValueOrder = {};

// URL update debounce timer
let urlUpdateTimer = null;

/**
 * Debounced URL update to avoid excessive history entries
 * Updates URL with current variable selections and codelist IDs
 */
function debouncedURLUpdate() {
  clearTimeout(urlUpdateTimer);

  urlUpdateTimer = setTimeout(() => {
    if (!AppState.selectedTable) return;

    const params = {};

    // Get current variable selection
    const selection = getVariableSelection();
    if (selection && Object.keys(selection).length > 0) {
      params.v = URLRouter.encode(selection);
    }

    // Get current codelist IDs
    if (Object.keys(AppState.activeCodelistIds).length > 0) {
      params.c = URLRouter.encode(AppState.activeCodelistIds);
    }

    // Update URL (use replaceState, not pushState, to avoid creating history entries for every selection change)
    URLRouter.navigateTo(
      `variables/${AppState.selectedTable.id}`,
      params,
      false  // replaceState
    );
  }, 500); // 500ms debounce
}

// ============================================================
// View rendering
// ============================================================

/**
 * Render the variable selection view
 * @param {HTMLElement} container - Container element
 */
async function renderVariableSelection(container) {
  logger.log('[VariableSelect] Rendering variable selection');

  if (!AppState.selectedTable) {
    showError('Ingen tabell valgt');
    URLRouter.navigateTo('home', {});
    URLRouter.handleRoute();
    return;
  }

  const table = AppState.selectedTable;

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <button id="back-to-browser" class="btn-secondary">
          &larr; Tilbake til tabelloversikt
        </button>
        <h2>${escapeHtml(extractTableTitle(table.label))}</h2>
        <p class="table-id-display">Tabell ${escapeHtml(table.id)}</p>
        <p class="view-description">
          Velg verdier for hver variabel. Klikk for &aring; velge, Shift+klikk for &aring; velge et omr&aring;de,
          Ctrl/Cmd+klikk for &aring; legge til enkelverdier, Ctrl+A for &aring; velge alle synlige.
        </p>
      </div>

      <div id="variables-container" class="variables-container">
        <p class="loading-message">Laster metadata...</p>
      </div>

      <div class="query-preview-container">
        <button class="query-preview-toggle" id="query-preview-toggle">
          <span class="query-toggle-icon">&#9654;</span> API-bygger
        </button>
        <div class="query-preview-content" id="query-preview-content" style="display: none;">

          <div class="api-builder-options-grid">
            <div class="api-builder-option">
              <label class="api-builder-label">Responsformat:</label>
              <select id="api-output-format" class="api-format-select">
                <option value="" selected>JSON-stat2 (standard)</option>
                <option value="csv">CSV</option>
                <option value="xlsx">Excel (xlsx)</option>
                <option value="px">PX (PC-Axis)</option>
                <option value="parquet">Parquet</option>
                <option value="html">HTML</option>
                <option value="json-px">JSON-PX</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-display-option" style="display: none;">
              <label class="api-builder-label">Visning:</label>
              <select id="api-display-format" class="api-format-select">
                <option value="UseTexts" selected>Tekst</option>
                <option value="UseCodes">Koder</option>
                <option value="UseCodesAndTexts">Koder og tekst</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-title-option" style="display: none;">
              <label class="api-builder-label">Tabelltittel:</label>
              <select id="api-include-title" class="api-format-select">
                <option value="" selected>Uten tittel</option>
                <option value="IncludeTitle">Med tittel</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-separator-option" style="display: none;">
              <label class="api-builder-label">Skilletegn:</label>
              <select id="api-csv-separator" class="api-format-select">
                <option value="SeparatorSemicolon" selected>Semikolon</option>
                <option value="SeparatorTab">Tabulator</option>
                <option value="SeparatorSpace">Mellomrom</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-layout-option" style="display: none;">
              <label class="api-builder-label">Tabellayout:</label>
              <select id="api-table-layout" class="api-format-select">
                <option value="" selected>Standard</option>
                <option value="pivot">Pivotvennlig (alle i forspalte)</option>
              </select>
            </div>
          </div>

          <div class="api-builder-section">
            <div class="api-builder-section-header">
              <span class="api-builder-section-title">Data-URL</span>
              <div class="api-builder-actions">
                <button class="btn-secondary btn-sm" id="api-copy-url-btn" title="Kopier URL">Kopier URL</button>
                <button class="btn-secondary btn-sm" id="api-copy-curl-btn" title="Kopier som curl-kommando">Kopier curl</button>
                <button class="btn-secondary btn-sm" id="api-open-btn" title="&Aring;pne i ny fane">&Aring;pne i nettleser</button>
              </div>
            </div>
            <code class="query-preview-url" id="query-preview-url">
              Velg verdier for &aring; se sp&oslash;rringen
            </code>
          </div>

          <div class="api-builder-section">
            <div class="api-builder-section-header">
              <span class="api-builder-section-title">Metadata-URL</span>
              <div class="api-builder-actions">
                <button class="btn-secondary btn-sm" id="api-copy-meta-btn" title="Kopier metadata-URL">Kopier URL</button>
                <button class="btn-secondary btn-sm" id="api-open-meta-btn" title="&Aring;pne metadata i ny fane">&Aring;pne i nettleser</button>
              </div>
            </div>
            <code class="query-preview-url" id="query-preview-meta-url"></code>
          </div>

          <div class="api-copy-toast" id="api-copy-toast" style="display: none;">Kopiert!</div>
        </div>
      </div>

      <div class="action-bar">
        <button id="fetch-data-btn" class="btn-primary" disabled>
          Hent data
        </button>
        <div class="selection-summary">
          <span id="selection-status">Velg verdier for alle variabler</span>
          <div id="cell-count-display" class="cell-count-display"></div>
        </div>
      </div>
    </div>
  `;

  // Set up back button - go back in history, fallback to home
  document.getElementById('back-to-browser')?.addEventListener('click', () => {
    AppState.resetTableState();
    if (window.history.length > 1) {
      window.history.back();
    } else {
      URLRouter.navigateTo('home', {});
      URLRouter.handleRoute();
    }
  });

  // Set up query preview toggle (collapsible)
  const previewToggle = document.getElementById('query-preview-toggle');
  const previewContent = document.getElementById('query-preview-content');
  if (previewToggle && previewContent) {
    previewToggle.addEventListener('click', () => {
      const icon = previewToggle.querySelector('.query-toggle-icon');
      if (previewContent.style.display === 'none') {
        previewContent.style.display = 'block';
        if (icon) icon.innerHTML = '&#9660;';
      } else {
        previewContent.style.display = 'none';
        if (icon) icon.innerHTML = '&#9654;';
      }
    });
  }

  // Set up API builder events (copy, open, format selector)
  setupApiBuilderEvents();

  // Fetch and display metadata
  await loadTableMetadata(table.id);

  // Set up fetch button
  document.getElementById('fetch-data-btn')?.addEventListener('click', handleFetchData);
}

/**
 * Load table metadata from API
 * @param {string} tableId - Table ID
 */
async function loadTableMetadata(tableId) {
  const data = await safeApiCall(
    () => api.getTableMetadata(tableId, true, 'no'),
    'Kunne ikke laste metadata for tabell ' + tableId
  );

  if (!data || !data.dimension) {
    logger.error('[VariableSelect] Invalid metadata format:', data);
    return;
  }

  tableMetadata = data;
  logger.log('[VariableSelect] Loaded metadata:', data);

  // Reset codelist state for new table
  Object.keys(activeCodelists).forEach(k => delete activeCodelists[k]);
  Object.keys(dimensionValueOrder).forEach(k => delete dimensionValueOrder[k]);

  // Display variables
  await displayVariables();
}

// ============================================================
// Variable card rendering
// ============================================================

/**
 * Get the display order for dimensions.
 *
 * SSB's traditional interface orders dimensions as heading first, then stub.
 * The metadata provides these arrays in extension.px.heading and extension.px.stub.
 * For table 13760: heading=["ContentsCode","Tid"], stub=["Kjonn","Alder","Justering"]
 *   → display order: ContentsCode, Tid, Kjonn, Alder, Justering
 *
 * Falls back to tableMetadata.id if heading/stub are not available.
 *
 * @returns {string[]} - Ordered array of dimension codes
 */
function getDimensionDisplayOrder() {
  const heading = tableMetadata.extension?.px?.heading || [];
  const stub = tableMetadata.extension?.px?.stub || [];
  const ordered = [...heading, ...stub];

  // Fallback: add any dimensions from metadata.id not covered by heading+stub
  const remaining = tableMetadata.id.filter(d => !ordered.includes(d));
  return [...ordered, ...remaining];
}

/**
 * Display variables/dimensions for selection.
 * Reads metadata to determine elimination status, codelists, and time dimensions.
 * Dimensions are ordered per SSB convention: heading dimensions first, then stub.
 */
async function displayVariables() {
  if (!tableMetadata) return;

  const container = document.getElementById('variables-container');
  if (!container) return;

  // Use SSB's heading+stub order instead of the raw metadata.id order
  const dimensions = getDimensionDisplayOrder();

  // Pre-load first codelist per dimension for value ordering in "Velg fritt" view
  await preloadCodelistOrdering(dimensions);

  let html = '';

  dimensions.forEach(dimCode => {
    const dimension = tableMetadata.dimension[dimCode];
    if (!dimension) return;

    const values = dimension.category.label;
    const valueCount = Object.keys(values).length;
    const isTimeDim = dimCode === 'Tid' || dimCode.toLowerCase().includes('tid');

    // Elimination: can this dimension be omitted from the query?
    const elimination = dimension.extension?.elimination === true;

    // Codelists: alternative value groupings for this dimension
    const codelists = dimension.extension?.codelists || [];
    const hasCodelists = codelists.length > 0;
    const sortedCodelists = hasCodelists ? sortCodelistOptions(codelists) : [];

    html += `
      <div class="variable-card" data-dimension="${escapeHtml(dimCode)}" data-elimination="${elimination}">
        <div class="variable-header">
          <h3 class="variable-name">${escapeHtml(dimension.label || dimCode)}</h3>
          <span class="variable-badge ${elimination ? 'badge-optional' : 'badge-required'}">
            ${elimination ? 'Valgfri variabel' : 'M&aring; velges *'}
          </span>
          <span class="variable-info">${valueCount} verdier</span>
        </div>

        <div class="variable-controls">
          ${hasCodelists ? `
            <div class="codelist-selector">
              <label class="codelist-label">Kategorisering:</label>
              <select class="codelist-dropdown" data-dimension="${escapeHtml(dimCode)}">
                ${sortedCodelists.map(cl =>
                  '<option value="' + escapeHtml(cl.id) + '">' + escapeHtml(cl.label) + '</option>'
                ).join('')}
                <option value="" selected>Velg fritt blant alle verdier</option>
              </select>
            </div>
          ` : ''}

          <div class="control-row">
            <button class="btn-secondary btn-sm select-star-btn" title="Alle verdier (*)">Alle (*)</button>
            <button class="btn-secondary btn-sm select-all-btn">Velg alle</button>
            <button class="btn-secondary btn-sm select-none-btn">Opphev alle</button>
            ${isTimeDim ? `
              <span class="top-n-group">
                <button class="btn-secondary btn-sm select-top-btn">Siste</button>
                <input type="number" class="top-n-input" value="12" min="1" max="${valueCount}">
                <span class="top-n-label">verdier</span>
              </span>
            ` : ''}
          </div>

          <div class="value-filter-container">
            <input type="text" class="value-filter-input" placeholder="Filtrer verdier...">
          </div>

          <div class="value-counter">
            Valgt <span class="selected-count">0</span> av totalt <span class="total-count">${valueCount}</span>
          </div>

          <div class="value-list-container" data-mode="specific" tabindex="0">
            ${renderValueList(dimCode, dimension, isTimeDim)}
          </div>
        </div>

        <div class="variable-selection-summary"></div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Set up event listeners
  setupVariableEvents();

  // Restore previous selections if returning from table view
  await restoreSelections();

  // Auto-select mandatory dimensions with only one value
  autoSelectSingleValueDimensions();

  // Update initial selection state
  updateSelectionStatus();
}

/**
 * Auto-select mandatory dimensions that have only one value.
 * This saves the user from having to manually click single-option mandatory dimensions
 * like "Personer" in the Statistikkvariabel dimension.
 */
function autoSelectSingleValueDimensions() {
  logger.log('[VariableSelect] Checking for single-value mandatory dimensions to auto-select');

  let didAutoSelect = false;

  document.querySelectorAll('.variable-card').forEach(card => {
    const dimCode = card.dataset.dimension;
    const isElimination = card.dataset.elimination === 'true';
    const container = card.querySelector('.value-list-container');

    if (!container || isElimination) return; // Skip optional dimensions

    // Get all value items (visible or not)
    const allItems = container.querySelectorAll('.value-list-item');

    // Only auto-select if exactly one value exists
    if (allItems.length === 1) {
      const singleItem = allItems[0];
      const dimension = tableMetadata.dimension[dimCode];
      const dimLabel = dimension ? dimension.label : dimCode;

      logger.log('[VariableSelect] Auto-selecting single value for mandatory dimension "' + dimLabel + '"');

      // Select the item (set mode to specific)
      container.dataset.mode = 'specific';
      singleItem.classList.add('selected');

      // Update visuals
      updateModeVisuals(card);
      updateValueCounter(card);
      didAutoSelect = true;
    }
  });

  // Update selection status if we auto-selected anything
  if (didAutoSelect) {
    updateSelectionStatus();
  }
}

/**
 * Restore previously saved variable selections to the DOM.
 *
 * When the user navigates back from the table view ("Endre variabelvalg"),
 * AppState.variableSelection still contains the previous selections.
 * This function re-applies those selections to the freshly rendered DOM
 * so the user doesn't lose their work.
 *
 * Handles all three selection modes: specific (array of codes), star ("*"), and top("top(N)").
 * Also restores the selected codelist for each dimension if one was active.
 */
async function restoreSelections() {
  const savedSelection = AppState.variableSelection;
  const savedCodelists = AppState.activeCodelistIds;

  if (!savedSelection || Object.keys(savedSelection).length === 0) return;

  logger.log('[VariableSelect] Restoring previous selections:', savedSelection);
  logger.log('[VariableSelect] Restoring previous codelists:', savedCodelists);

  // First pass: restore codelists (needs to be done before restoring selections)
  for (const card of document.querySelectorAll('.variable-card')) {
    const dimCode = card.dataset.dimension;
    const savedCodelistId = savedCodelists?.[dimCode];

    if (savedCodelistId) {
      const dropdown = card.querySelector('.codelist-dropdown');
      if (dropdown) {
        logger.log('[VariableSelect] Restoring codelist for ' + dimCode + ': ' + savedCodelistId);

        // Set dropdown value
        dropdown.value = savedCodelistId;

        // Trigger the codelist load (same logic as in setupCodelistDropdowns)
        try {
          dropdown.disabled = true;
          const codelistData = await safeApiCall(
            () => api.getCodeList(savedCodelistId, true, 'no'),
            'Kunne ikke laste kodeliste'
          );
          dropdown.disabled = false;

          if (codelistData) {
            const codelistInfo = extractCodelistCodes(codelistData);

            // Get dimension's original elimination status
            const dimension = tableMetadata.dimension[dimCode];
            const originalElimination = dimension.extension?.elimination === true;
            const effectiveElimination = originalElimination || (codelistData.elimination === true);

            // Store codelist info
            activeCodelists[dimCode] = {
              codelistId: savedCodelistId,
              elimination: effectiveElimination,
              isAggregated: codelistInfo.isAggregated,
              values: codelistInfo.values,
              originalCodes: codelistInfo.originalCodes
            };

            // Apply the codelist to the value list
            applyCodelistToValueList(dimCode, card);
            updateEliminationBadge(card, effectiveElimination);
          }
        } catch (err) {
          dropdown.disabled = false;
          logger.error('[VariableSelect] Failed to restore codelist:', err);

          // Clear the failed codelist from AppState to prevent repeated errors
          delete AppState.activeCodelistIds[dimCode];

          // Update URL to remove broken codelist reference
          debouncedURLUpdate();
        }
      }
    }
  }

  // Second pass: restore value selections
  document.querySelectorAll('.variable-card').forEach(card => {
    const dimCode = card.dataset.dimension;
    const container = card.querySelector('.value-list-container');
    if (!container) return;

    const dimSelection = savedSelection[dimCode];

    if (!dimSelection) {
      // No saved selection for this dimension (was eliminated or not selected)
      return;
    }

    if (dimSelection === '*') {
      // Star mode: set mode and update visuals
      container.dataset.mode = 'star';
      updateModeVisuals(card);
    } else if (typeof dimSelection === 'string' && dimSelection.startsWith('top(')) {
      // Top mode: set mode and restore the N value
      container.dataset.mode = 'top';
      const n = dimSelection.match(/\d+/)?.[0] || '12';
      const topInput = card.querySelector('.top-n-input');
      if (topInput) topInput.value = n;
      updateModeVisuals(card);
    } else if (Array.isArray(dimSelection) && dimSelection.length > 0) {
      // Specific mode: mark matching items as selected
      const selectedCodes = new Set(dimSelection);
      container.querySelectorAll('.value-list-item').forEach(item => {
        if (selectedCodes.has(item.dataset.code)) {
          item.classList.add('selected');
        }
      });
    }

    updateValueCounter(card);
  });
}

/**
 * Render list items for dimension values.
 * Parses hierarchy markers (¬) in labels for visual indentation.
 * Time dimensions are displayed in reverse order (newest first) since
 * users typically care most about recent data.
 *
 * @param {string} dimCode - Dimension code
 * @param {object} dimension - Dimension metadata
 * @param {boolean} isTimeDim - Whether this is a time dimension
 * @returns {string} - HTML for list items
 */
function renderValueList(dimCode, dimension, isTimeDim) {
  const values = dimension.category.label;
  let codes = Object.keys(values);

  // Time dimensions: show newest values first (reverse chronological)
  if (isTimeDim) {
    codes = codes.slice().reverse();
  } else if (dimensionValueOrder[dimCode]) {
    // Use pre-loaded codelist ordering: codelist codes first, then remaining
    const preferredOrder = dimensionValueOrder[dimCode];
    const remaining = new Set(codes);
    const orderedCodes = [];

    preferredOrder.forEach(code => {
      if (remaining.has(code)) {
        orderedCodes.push(code);
        remaining.delete(code);
      }
    });

    // Append remaining codes in original category.index order
    codes.forEach(code => {
      if (remaining.has(code)) {
        orderedCodes.push(code);
      }
    });

    codes = orderedCodes;
  }

  const maxDisplay = 500;
  const displayCodes = codes.slice(0, maxDisplay);
  const hasMore = codes.length > maxDisplay;

  let html = '';
  displayCodes.forEach((code, index) => {
    const label = values[code];
    const { cleanLabel, depth } = parseHierarchyLabel(label);
    // Indent hierarchical items: base padding + depth * 1.2rem
    const indent = depth > 0 ? ' style="padding-left: ' + (depth * 1.2 + 0.5) + 'rem"' : '';

    html += `<div class="value-list-item" data-code="${escapeHtml(code)}" data-index="${index}"${indent}>
      <span class="value-list-label">${escapeHtml(cleanLabel)}</span>
      <span class="value-list-code">${escapeHtml(code)}</span>
    </div>`;
  });

  if (hasMore) {
    html += `<div class="truncate-notice">Viser ${maxDisplay} av ${codes.length} verdier.
             Bruk "Alle (*)" for &aring; inkludere alle.</div>`;
  }

  return html;
}

/**
 * Parse hierarchy indicators in SSB value labels.
 *
 * SSB uses the "¬" character (not sign, U+00AC) as a prefix to indicate
 * hierarchy depth in dimension value labels:
 *   "Fast realkapital"         → depth 0
 *   "¬ Bygg og anlegg"        → depth 1
 *   "¬¬ Boliger"              → depth 2
 *   "¬¬¬ IT utstyr"           → depth 3
 *
 * @param {string} label - Raw label text from API
 * @returns {{ cleanLabel: string, depth: number }}
 */
function parseHierarchyLabel(label) {
  if (!label) return { cleanLabel: label, depth: 0 };

  // Count leading ¬ characters (possibly with spaces between them)
  const match = label.match(/^([\u00AC\s]+)/);
  if (!match) return { cleanLabel: label, depth: 0 };

  const prefix = match[1];
  const depth = (prefix.match(/\u00AC/g) || []).length;
  const cleanLabel = label.substring(match[0].length).trim();

  return { cleanLabel: cleanLabel || label, depth };
}

// ============================================================
// Event setup
// ============================================================

/**
 * Set up all event listeners for variable selection
 */
function setupVariableEvents() {
  setupListSelectionEvents();
  setupValueFilters();
  setupModeButtons();
  setupKeyboardShortcuts();
  setupCodelistDropdowns();
}

/**
 * Set up click events on value list items (shift-click, ctrl-click, plain click)
 */
function setupListSelectionEvents() {
  document.querySelectorAll('.value-list-container').forEach(container => {
    const card = container.closest('.variable-card');
    const dimCode = card.dataset.dimension;

    container.addEventListener('click', (e) => {
      const item = e.target.closest('.value-list-item');
      if (!item) return;

      // If in star/top mode, switch back to specific on click
      if (container.dataset.mode !== 'specific') {
        container.dataset.mode = 'specific';
        updateModeVisuals(card);
      }

      const clickedIndex = parseInt(item.dataset.index, 10);
      const allItems = Array.from(container.querySelectorAll('.value-list-item'));

      if (e.shiftKey && lastClickedIndex[dimCode] !== undefined) {
        // Shift-click: select range between last click and current click
        const start = Math.min(lastClickedIndex[dimCode], clickedIndex);
        const end = Math.max(lastClickedIndex[dimCode], clickedIndex);

        if (!e.ctrlKey && !e.metaKey) {
          // Without Ctrl: replace selection with range
          allItems.forEach(it => it.classList.remove('selected'));
        }

        allItems.forEach(it => {
          const idx = parseInt(it.dataset.index, 10);
          if (idx >= start && idx <= end) {
            it.classList.add('selected');
          }
        });
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd-click: toggle individual item
        item.classList.toggle('selected');
      } else {
        // Plain click: select only this item
        allItems.forEach(it => it.classList.remove('selected'));
        item.classList.add('selected');
      }

      lastClickedIndex[dimCode] = clickedIndex;
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });
}

/**
 * Set up search/filter inputs for value lists.
 * Since codelists now re-render the DOM (not just hide/show), the text filter
 * only needs to handle text-based filtering of whatever items are in the DOM.
 */
function setupValueFilters() {
  document.querySelectorAll('.value-filter-input').forEach(input => {
    const card = input.closest('.variable-card');
    const container = card.querySelector('.value-list-container');

    input.addEventListener('input', debounce(() => {
      const query = input.value.trim().toLowerCase();
      const items = container.querySelectorAll('.value-list-item');

      items.forEach(item => {
        const label = item.querySelector('.value-list-label').textContent.toLowerCase();
        const codeText = item.querySelector('.value-list-code').textContent.toLowerCase();

        if (!query || label.includes(query) || codeText.includes(query)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    }, 150));
  });
}

/**
 * Set up Ctrl+A keyboard shortcut to select all visible values in a focused value list.
 * The value-list-container has tabindex="0" so it can receive focus.
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      // Check if focus is inside a value list container
      const container = document.activeElement?.closest('.value-list-container');
      if (!container) return; // Not inside a value list — let browser handle normally

      e.preventDefault();

      const card = container.closest('.variable-card');

      // Switch to specific mode (individual selections)
      container.dataset.mode = 'specific';

      // Select all VISIBLE items (respects both codelist and text filter)
      container.querySelectorAll('.value-list-item').forEach(item => {
        if (item.style.display !== 'none') {
          item.classList.add('selected');
        }
      });

      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    }
  });
}

/**
 * Set up mode buttons (select all, select none, star, top)
 */
function setupModeButtons() {
  // "Alle (*)" button — requests all values via the API wildcard
  document.querySelectorAll('.select-star-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'star';
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // "Siste N" button — requests last N values (time dimensions)
  document.querySelectorAll('.select-top-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'top';
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // Top-n input: auto-activate top mode when user types a number
  document.querySelectorAll('.top-n-input').forEach(input => {
    input.addEventListener('input', () => {
      const card = input.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'top';
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // "Velg alle" button — selects all visible items individually
  document.querySelectorAll('.select-all-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'specific';
      // Select only visible items (respects codelist filter)
      container.querySelectorAll('.value-list-item').forEach(item => {
        if (item.style.display !== 'none') {
          item.classList.add('selected');
        }
      });
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // "Opphev alle" button — deselects everything
  document.querySelectorAll('.select-none-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'specific';
      container.querySelectorAll('.value-list-item').forEach(item => {
        item.classList.remove('selected');
      });
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });
}

// ============================================================
// Codelist support
// ============================================================

/**
 * Sort codelist options for dropdown display.
 * SSB convention: vs_ (valueset) codelists first, then others, then agg_ (aggregation) codelists.
 *
 * @param {Array} codelists - Array of codelist objects from dimension metadata
 * @returns {Array} - Sorted array
 */
function sortCodelistOptions(codelists) {
  const vs = codelists.filter(cl => cl.id.toLowerCase().startsWith('vs_'));
  const agg = codelists.filter(cl => cl.id.toLowerCase().startsWith('agg_'));
  const other = codelists.filter(cl =>
    !cl.id.toLowerCase().startsWith('vs_') && !cl.id.toLowerCase().startsWith('agg_')
  );
  return [...vs, ...other, ...agg];
}

/**
 * Pre-load codelist ordering for dimensions that have codelists.
 * Fetches the first codelist (sorted: vs_ first) per dimension to determine
 * the preferred value ordering for the "Velg fritt" view.
 *
 * @param {string[]} dimensions - Array of dimension codes
 */
async function preloadCodelistOrdering(dimensions) {
  const promises = dimensions.map(async dimCode => {
    const dimension = tableMetadata.dimension[dimCode];
    if (!dimension) return;

    const codelists = dimension.extension?.codelists || [];
    if (codelists.length === 0) return;

    const sorted = sortCodelistOptions(codelists);
    const firstId = sorted[0].id;

    const data = await safeApiCall(
      () => api.getCodeList(firstId, true, 'no'),
      null // silent failure — falls back to category.index order
    );

    if (data && data.values && Array.isArray(data.values)) {
      dimensionValueOrder[dimCode] = data.values.flatMap(v =>
        (v.valueMap && Array.isArray(v.valueMap) && v.valueMap.length > 0)
          ? v.valueMap : [v.code]
      );
    }
  });

  await Promise.all(promises);
}

/**
 * Set up codelist dropdown change events.
 *
 * When the user selects a codelist from the dropdown:
 * 1. Fetch the codelist's value definitions from the API
 * 2. Store the allowed codes in activeCodelists[dimCode]
 * 3. Show only matching values in the value list (hide others)
 * 4. Update the elimination badge (codelists can override the dimension's default)
 * 5. Reset any existing selection
 *
 * "Velg fritt blant alle verdier" (value="") restores the full value list.
 */
function setupCodelistDropdowns() {
  document.querySelectorAll('.codelist-dropdown').forEach(dropdown => {
    dropdown.addEventListener('change', async () => {
      const dimCode = dropdown.dataset.dimension;
      const codelistId = dropdown.value; // "" = show all values
      const card = dropdown.closest('.variable-card');
      const container = card.querySelector('.value-list-container');

      if (!codelistId) {
        // "Velg fritt" — remove codelist, restore original values and elimination
        activeCodelists[dimCode] = null;

        // Clear from AppState
        delete AppState.activeCodelistIds[dimCode];

        restoreOriginalValueList(dimCode, card);

        // Restore the dimension's original elimination status
        const dimension = tableMetadata.dimension[dimCode];
        const originalElimination = dimension.extension?.elimination === true;
        updateEliminationBadge(card, originalElimination);
      } else {
        // Fetch codelist data from API
        try {
          dropdown.disabled = true;
          const codelistData = await safeApiCall(
            () => api.getCodeList(codelistId, true, 'no'),
            'Kunne ikke laste kodeliste'
          );
          dropdown.disabled = false;

          if (codelistData) {
            // Extract codelist information
            const codelistInfo = extractCodelistCodes(codelistData);

            // Get dimension's original elimination status
            const dimension = tableMetadata.dimension[dimCode];
            const originalElimination = dimension.extension?.elimination === true;

            // IMPORTANT: If the dimension is originally optional, it remains optional
            // regardless of what the codelist says. We never make an optional dimension mandatory.
            // However, a codelist can make a mandatory dimension optional.
            const effectiveElimination = originalElimination || (codelistData.elimination === true);

            // Store codelist info with effective elimination property
            activeCodelists[dimCode] = {
              codelistId: codelistId,
              elimination: effectiveElimination,
              isAggregated: codelistInfo.isAggregated,
              values: codelistInfo.values,
              originalCodes: codelistInfo.originalCodes
            };

            // Save to AppState for persistence when navigating back
            AppState.activeCodelistIds[dimCode] = codelistId;

            // Apply the codelist to the value list
            applyCodelistToValueList(dimCode, card);

            // Update badge with effective elimination status
            updateEliminationBadge(card, effectiveElimination);
          }
        } catch (err) {
          dropdown.disabled = false;
          logger.error('[VariableSelect] Failed to load codelist:', err);
        }
      }

      // Reset selection when switching codelist
      container.dataset.mode = 'specific';
      container.querySelectorAll('.value-list-item').forEach(item => {
        item.classList.remove('selected');
      });

      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });
}

/**
 * Extract codelist information from API response.
 *
 * Codelists can work in two ways:
 * 1. Aggregated: defines new codes that map to multiple original dimension codes via valueMap
 * 2. Filter: subset of original dimension codes (valueMap contains just the code itself)
 *
 * Codelist format: { values: [{ code: "AGG_01", label: "Group 1", valueMap: ["01", "02", "03"] }, ...] }
 *
 * @param {object} codelistData - Raw codelist response from the API
 * @returns {object} - { isAggregated: boolean, values: Array, originalCodes: Set }
 */
function extractCodelistCodes(codelistData) {
  const values = [];
  const originalCodes = new Set();
  let isAggregated = false;

  logger.log('[VariableSelect] Processing codelist:', codelistData.id || 'unknown');
  logger.log('[VariableSelect] Raw codelist data:', codelistData);

  if (!codelistData.values || !Array.isArray(codelistData.values)) {
    logger.warn('[VariableSelect] Codelist has no values array');
    return { isAggregated: false, values: [], originalCodes: new Set() };
  }

  codelistData.values.forEach((item, index) => {
    // Validate item structure
    if (!item.code) {
      logger.warn('[VariableSelect] Codelist item ' + index + ' has no code:', item);
      return;
    }

    // Handle valueMap - it might be missing, an array, or need special handling
    let valueMap = [];
    if (item.valueMap && Array.isArray(item.valueMap) && item.valueMap.length > 0) {
      valueMap = item.valueMap;
    } else {
      // If no valueMap, assume the code itself is the value
      valueMap = [item.code];
    }

    values.push({
      code: item.code,
      label: item.label || item.code,
      valueMap: valueMap
    });

    // Collect all original dimension codes that this codelist covers
    valueMap.forEach(c => {
      if (c) originalCodes.add(String(c));
    });

    // Determine if aggregated: valueMap contains different codes than the codelist code
    if (valueMap.length !== 1 || valueMap[0] !== item.code) {
      isAggregated = true;
    }
  });

  logger.log('[VariableSelect] Extracted codelist:', {
    id: codelistData.id,
    isAggregated,
    codelistValues: values.length,
    originalCodes: originalCodes.size,
    sampleValues: values.slice(0, 3)
  });

  // Validate that we got some codes
  if (originalCodes.size === 0) {
    logger.error('[VariableSelect] No valid codes extracted from codelist!');
  }

  return { isAggregated, values, originalCodes };
}

/**
 * Apply codelist to value list — always re-renders from codelist data.
 * Both aggregated and filter codelists are rendered via renderCodelistValues()
 * to ensure values appear in the codelist's defined order.
 *
 * @param {string} dimCode - Dimension code
 * @param {HTMLElement} card - Variable card element
 */
function applyCodelistToValueList(dimCode, card) {
  const container = card.querySelector('.value-list-container');
  if (!container) return;

  const codelistInfo = activeCodelists[dimCode];
  if (!codelistInfo) return;

  logger.log('[VariableSelect] Applying codelist to dimension ' + dimCode + ':', {
    isAggregated: codelistInfo.isAggregated,
    valueCount: codelistInfo.values.length,
    originalCodesCount: codelistInfo.originalCodes.size
  });

  // Clear text filter when switching codelist
  const filterInput = card.querySelector('.value-filter-input');
  if (filterInput) filterInput.value = '';

  // Always render from codelist values to ensure correct ordering
  renderCodelistValues(dimCode, card, codelistInfo.values);

  // Update the "totalt" count to show codelist item count
  const totalCount = card.querySelector('.total-count');
  if (totalCount) {
    totalCount.textContent = codelistInfo.values.length;
  }
}

/**
 * Render codelist values as the value list.
 * Used for both aggregated and filter codelists to ensure codelist-defined ordering.
 * Replaces the existing value list with the codelist's values.
 * Stores the valueMap in data attributes for later expansion to original codes.
 *
 * @param {string} dimCode - Dimension code
 * @param {HTMLElement} card - Variable card element
 * @param {Array} codelistValues - Array of {code, label, valueMap}
 */
function renderCodelistValues(dimCode, card, codelistValues) {
  const container = card.querySelector('.value-list-container');
  if (!container) return;

  let html = '';
  codelistValues.forEach((item, index) => {
    const { cleanLabel, depth } = parseHierarchyLabel(item.label);
    const indent = depth > 0 ? ' style="padding-left: ' + (depth * 1.2 + 0.5) + 'rem"' : '';

    // Store valueMap as JSON in data attribute for later expansion
    const valueMapJson = JSON.stringify(item.valueMap || [item.code]);

    html += `<div class="value-list-item" data-code="${escapeHtml(item.code)}" data-index="${index}" data-valuemap='${escapeHtml(valueMapJson)}'${indent}>
      <span class="value-list-label">${escapeHtml(cleanLabel)}</span>
      <span class="value-list-code">${escapeHtml(item.code)}</span>
    </div>`;
  });

  container.innerHTML = html;
}

/**
 * Restore original dimension values (undo codelist rendering).
 * Always re-renders from metadata since both aggregated and filter codelists
 * now replace the DOM via renderCodelistValues().
 *
 * @param {string} dimCode - Dimension code
 * @param {HTMLElement} card - Variable card element
 */
function restoreOriginalValueList(dimCode, card) {
  const container = card.querySelector('.value-list-container');
  if (!container) return;

  // Re-render from original metadata (includes codelist-based ordering if available)
  const dimension = tableMetadata.dimension[dimCode];
  if (dimension) {
    const isTimeDim = dimCode === 'Tid' || dimCode.toLowerCase().includes('tid');
    container.innerHTML = renderValueList(dimCode, dimension, isTimeDim);
    logger.log('[VariableSelect] Restored original values for dimension ' + dimCode);
  }

  // Clear text filter
  const filterInput = card.querySelector('.value-filter-input');
  if (filterInput) filterInput.value = '';

  // Restore original total count
  const totalCount = card.querySelector('.total-count');
  if (totalCount && dimension) {
    totalCount.textContent = Object.keys(dimension.category.label).length;
  }
}

/**
 * Update the elimination badge on a variable card.
 * Called when switching codelists, since each codelist may have
 * a different elimination property.
 *
 * @param {HTMLElement} card - Variable card element
 * @param {boolean} elimination - Whether the dimension is currently optional
 */
function updateEliminationBadge(card, elimination) {
  card.dataset.elimination = String(elimination);

  const badge = card.querySelector('.variable-badge');
  if (badge) {
    badge.className = 'variable-badge ' + (elimination ? 'badge-optional' : 'badge-required');
    badge.innerHTML = elimination ? 'Valgfri variabel' : 'M&aring; velges *';
  }
}

// ============================================================
// Visual state updates
// ============================================================

/**
 * Update visual state based on current mode (star/top dims list)
 * @param {HTMLElement} card - Variable card element
 */
function updateModeVisuals(card) {
  const container = card.querySelector('.value-list-container');
  const mode = container.dataset.mode;

  // Highlight active mode button
  card.querySelectorAll('.select-star-btn, .select-top-btn').forEach(btn => {
    btn.classList.remove('btn-active');
  });

  if (mode === 'star') {
    card.querySelector('.select-star-btn')?.classList.add('btn-active');
    container.classList.add('mode-inactive');
  } else if (mode === 'top') {
    card.querySelector('.select-top-btn')?.classList.add('btn-active');
    container.classList.add('mode-inactive');
  } else {
    container.classList.remove('mode-inactive');
  }
}

/**
 * Update the value counter display for a card
 * @param {HTMLElement} card - Variable card element
 */
function updateValueCounter(card) {
  const container = card.querySelector('.value-list-container');
  const selectedCount = card.querySelector('.selected-count');
  if (!container || !selectedCount) return;

  const mode = container.dataset.mode;

  if (mode === 'star') {
    selectedCount.textContent = 'alle';
  } else if (mode === 'top') {
    const topN = card.querySelector('.top-n-input')?.value || '12';
    selectedCount.textContent = 'siste ' + topN;
  } else {
    const count = container.querySelectorAll('.value-list-item.selected').length;
    selectedCount.textContent = count;
  }
}

// ============================================================
// Selection status and validation
// ============================================================

/**
 * Update selection status and enable/disable fetch button.
 * Also updates per-card summaries and the API query preview.
 */
function updateSelectionStatus() {
  const selection = getVariableSelection();
  const statusElement = document.getElementById('selection-status');
  const fetchButton = document.getElementById('fetch-data-btn');

  if (!selection || !statusElement || !fetchButton) return;

  const isValid = validateSelection(selection);

  if (isValid) {
    statusElement.textContent = 'Klar til \u00e5 hente data';
    statusElement.className = 'selection-status-valid';
    fetchButton.disabled = false;
  } else {
    statusElement.textContent = 'Velg minst \u00e9n verdi for alle obligatoriske variabler';
    statusElement.className = 'selection-status-invalid';
    fetchButton.disabled = true;
  }

  // Update individual variable summaries
  document.querySelectorAll('.variable-card').forEach(card => {
    const dimCode = card.dataset.dimension;
    const summary = card.querySelector('.variable-selection-summary');
    if (!summary) return;

    const isElimination = card.dataset.elimination === 'true';
    const dimSelection = selection[dimCode];

    // No selection for this dimension
    if (!dimSelection || (Array.isArray(dimSelection) && dimSelection.length === 0)) {
      if (isElimination) {
        summary.textContent = 'Ingen verdier valgt (variabelen utelates fra sp\u00f8rringen)';
        summary.className = 'variable-selection-summary summary-optional';
      } else {
        summary.textContent = 'Ingen verdier valgt';
        summary.className = 'variable-selection-summary summary-invalid';
      }
      updateValueCounter(card);
      return;
    }

    if (Array.isArray(dimSelection)) {
      const count = dimSelection.length;
      summary.textContent = count + ' verdi' + (count === 1 ? '' : 'er') + ' valgt';
      summary.className = 'variable-selection-summary summary-valid';
    } else if (dimSelection === '*') {
      summary.textContent = 'Alle verdier valgt';
      summary.className = 'variable-selection-summary summary-valid';
    } else if (typeof dimSelection === 'string' && dimSelection.startsWith('top(')) {
      summary.textContent = dimSelection;
      summary.className = 'variable-selection-summary summary-valid';
    }

    updateValueCounter(card);
  });

  // Update the live API query preview and cell count
  updateQueryPreview();
  const cellCount = updateSelectionCellCount();

  // Disable fetch button if cell count exceeds API limit (800,000)
  if (isValid && cellCount > AppConfig.limits.maxCells) {
    statusElement.textContent = 'For mange celler valgt \u2014 reduser utvalget';
    statusElement.className = 'selection-status-invalid';
    fetchButton.disabled = true;
  }

  // Update URL with current selections (debounced to avoid excessive history entries)
  debouncedURLUpdate();
}

/**
 * Get the true total number of values for a dimension, regardless of UI truncation.
 *
 * The value list in the DOM is capped at maxDisplayValues (500) items,
 * so counting DOM elements gives wrong results for large dimensions.
 * This function returns the authoritative count from metadata/codelist.
 *
 * @param {string} dimCode - Dimension code
 * @returns {number} - True total value count
 */
function getTrueDimensionValueCount(dimCode) {
  const codelistInfo = activeCodelists[dimCode];

  if (codelistInfo) {
    // Codelist active: count is the number of original dimension codes covered
    return codelistInfo.originalCodes.size;
  }

  // No codelist: use the full metadata dimension
  if (tableMetadata && tableMetadata.dimension[dimCode]) {
    return Object.keys(tableMetadata.dimension[dimCode].category.label).length;
  }
  return 0;
}

/**
 * Calculate and display the total number of cells that will be fetched.
 *
 * Cell count = product of selected value counts across all included dimensions.
 * Uses metadata counts (not DOM element counts) for accurate totals,
 * since the value list is truncated at 500 items in the UI.
 * The API has an 800,000 cell limit per request.
 *
 * @returns {number} - Total selected cell count (0 if invalid)
 */
function updateSelectionCellCount() {
  const cellCountEl = document.getElementById('cell-count-display');
  if (!cellCountEl || !tableMetadata) return 0;

  let selectedCells = 1;
  let maxCells = 1;
  let hasIncludedDimension = false;
  let hasMissingMandatory = false;

  document.querySelectorAll('.variable-card').forEach(card => {
    const dimCode = card.dataset.dimension;
    const container = card.querySelector('.value-list-container');
    if (!container) return;

    const mode = container.dataset.mode;
    const isElimination = card.dataset.elimination === 'true';

    const selectedItems = container.querySelectorAll('.value-list-item.selected');

    // Skip if no selection and dimension is optional (will be eliminated)
    if (selectedItems.length === 0 && mode === 'specific' && isElimination) {
      return; // Don't count this dimension
    }

    hasIncludedDimension = true;

    // Calculate dimension contribution based on mode
    // Use metadata-based count (not DOM count) since the value list is truncated at 500 items
    const trueCount = getTrueDimensionValueCount(dimCode);
    let dimSelectedCount = 0;
    let dimMaxCount = trueCount;

    const codelistInfo = activeCodelists[dimCode];

    if (mode === 'star') {
      // All values selected
      dimSelectedCount = trueCount;
    } else if (mode === 'top') {
      // Last N values
      const topN = parseInt(card.querySelector('.top-n-input')?.value || '12', 10);
      dimSelectedCount = Math.min(topN, trueCount);
    } else {
      // Specific mode - count selected items
      if (codelistInfo) {
        // Codelist active: count expanded codes via valueMap
        // For filter codelists this equals selectedItems.length (each maps to 1 code)
        // For aggregated codelists this gives the true expanded code count
        let expandedCount = 0;
        selectedItems.forEach(item => {
          const valueMapJson = item.dataset.valuemap;
          if (valueMapJson) {
            try {
              const valueMap = JSON.parse(valueMapJson);
              expandedCount += (Array.isArray(valueMap) ? valueMap.length : 1);
            } catch (e) {
              expandedCount += 1;
            }
          } else {
            expandedCount += 1;
          }
        });
        dimSelectedCount = expandedCount;
      } else {
        // No codelist - just count selected items
        dimSelectedCount = selectedItems.length;
      }
    }

    // Check if mandatory dimension has no selection
    if (dimSelectedCount === 0 && !isElimination) {
      hasMissingMandatory = true;
    }

    // Multiply by count (even if 0 - we'll handle invalid state after the loop)
    if (dimSelectedCount > 0) {
      selectedCells *= dimSelectedCount;
    }

    maxCells *= dimMaxCount;
  });

  // If any mandatory dimension is missing, total cells is 0
  if (hasMissingMandatory) {
    selectedCells = 0;
  }

  // If no dimensions are included, show 0
  if (!hasIncludedDimension) {
    selectedCells = 0;
    maxCells = 0;
  }

  const formatted = selectedCells.toLocaleString('nb-NO');
  const maxFormatted = maxCells.toLocaleString('nb-NO');
  cellCountEl.textContent = formatted + ' celler valgt (av maks ' + maxFormatted + ' mulige)';

  // Warn if approaching API limit (800,000 cells)
  if (selectedCells > 800000) {
    cellCountEl.style.color = 'var(--color-error)';
    cellCountEl.textContent += ' \u2014 overskrider API-grensen p\u00e5 800\u00a0000!';
  } else if (selectedCells > 600000) {
    cellCountEl.style.color = '#e65100';
  } else {
    cellCountEl.style.color = '';
  }

  return selectedCells;
}

/**
 * Get current variable selection as API query object.
 *
 * Returns an object mapping dimension codes to their selected values.
 * Format matches what api.getTableData() expects:
 *   - Array of codes: ["0", "1"]
 *   - All values wildcard: "*"
 *   - Last N values: "top(12)"
 *
 * Elimination dimensions with no selection are OMITTED entirely,
 * causing the API to aggregate across all values for that dimension.
 *
 * "Velg alle" always sends explicit individual codes.
 * "*" is only used when the user explicitly clicks "Alle (*)" (star mode).
 *
 * @returns {object} - Variable selection object, e.g., { Kjonn: ["0"], Tid: "top(12)" }
 */
function getVariableSelection() {
  const selection = {};

  document.querySelectorAll('.variable-card').forEach(card => {
    const dimCode = card.dataset.dimension;
    const container = card.querySelector('.value-list-container');
    if (!container) return;

    const mode = container.dataset.mode;
    const isElimination = card.dataset.elimination === 'true';

    if (mode === 'star') {
      const codelistInfo = activeCodelists[dimCode];
      if (codelistInfo) {
        // Codelist active: send explicit codes from the codelist, not *
        // (* means all values in the full dimension, not just the codelist subset)
        selection[dimCode] = Array.from(codelistInfo.originalCodes);
      } else {
        selection[dimCode] = '*';
      }
    } else if (mode === 'top') {
      const topN = card.querySelector('.top-n-input')?.value || '10';
      selection[dimCode] = 'top(' + topN + ')';
    } else {
      // Specific mode: collect individually selected items
      const selectedItems = container.querySelectorAll('.value-list-item.selected');
      let values = Array.from(selectedItems).map(item => item.dataset.code);

      // If any codelist is active, expand via valueMap to get original dimension codes.
      // For filter codelists: valueMap[0] === code, so expansion is a no-op.
      // For aggregated codelists: expands to the original dimension codes.
      const codelistInfo = activeCodelists[dimCode];
      if (codelistInfo) {
        const expandedCodes = new Set();
        selectedItems.forEach(item => {
          const valueMapJson = item.dataset.valuemap;
          if (valueMapJson) {
            try {
              const valueMap = JSON.parse(valueMapJson);
              if (Array.isArray(valueMap)) {
                valueMap.forEach(code => expandedCodes.add(code));
              }
            } catch (e) {
              logger.error('[VariableSelect] Failed to parse valueMap:', e);
            }
          }
        });
        values = Array.from(expandedCodes);
      }

      // Time dimensions: restore chronological order (oldest first).
      // The UI shows newest first for convenience, but the API and table
      // display expect chronological order.
      const isTimeDim = dimCode === 'Tid' || dimCode.toLowerCase().includes('tid');
      if (isTimeDim && tableMetadata?.dimension[dimCode]?.category?.index) {
        const indexMap = tableMetadata.dimension[dimCode].category.index;
        values.sort((a, b) => (indexMap[a] ?? 0) - (indexMap[b] ?? 0));
      }

      // Elimination dimensions with no selection → omit from query (API aggregates)
      if (isElimination && values.length === 0) {
        return; // Skip — do not add to selection object
      }

      selection[dimCode] = values;
    }
  });

  return selection;
}

/**
 * Validate that selection is complete for all mandatory (non-elimination) dimensions.
 *
 * Elimination dimensions (extension.elimination=true) are optional and do not
 * need values selected. However, if a codelist is active that overrides elimination
 * to false, that dimension becomes mandatory.
 *
 * @param {object} selection - Variable selection object from getVariableSelection()
 * @returns {boolean} - True if all mandatory dimensions have selections
 */
function validateSelection(selection) {
  if (!tableMetadata) return false;

  for (const dimCode of tableMetadata.id) {
    // Get current elimination status from the card (may be overridden by codelist)
    const card = document.querySelector('.variable-card[data-dimension="' + dimCode + '"]');
    const isElimination = card ? card.dataset.elimination === 'true' : false;

    // Elimination dimensions are optional — skip validation
    if (isElimination) continue;

    // Non-elimination: must have values
    const dimSelection = selection[dimCode];
    if (!dimSelection) return false;
    if (Array.isArray(dimSelection) && dimSelection.length === 0) return false;
  }

  return true;
}

// ============================================================
// API query preview
// ============================================================

/**
 * Update the real-time API query preview box.
 * Shows the full data URL and metadata URL for the SSB API.
 * Includes output format, format params, separator, and stub/heading layout.
 */
function updateQueryPreview() {
  const previewUrl = document.getElementById('query-preview-url');
  const metaUrl = document.getElementById('query-preview-meta-url');
  if (!previewUrl || !AppState.selectedTable) return;

  const selection = getVariableSelection();
  const tableId = AppState.selectedTable.id;

  // Build URL params in the same way as api.getTableData()
  const params = new URLSearchParams({ lang: 'no' });

  Object.keys(selection).forEach(dimension => {
    const values = selection[dimension];
    const valueStr = Array.isArray(values) ? values.join(',') : values;
    params.append('valueCodes[' + dimension + ']', valueStr);
  });

  // Output format
  const format = document.getElementById('api-output-format')?.value || '';
  if (format) {
    params.append('outputFormat', format);
  }

  // Output format params (for csv, html, xlsx)
  const formatsSupportingParams = ['csv', 'html', 'xlsx'];
  if (formatsSupportingParams.includes(format)) {
    const formatParams = [];

    // Display format (UseCodes / UseTexts / UseCodesAndTexts)
    const displayFormat = document.getElementById('api-display-format')?.value;
    if (displayFormat) formatParams.push(displayFormat);

    // Include title
    const includeTitle = document.getElementById('api-include-title')?.value;
    if (includeTitle) formatParams.push(includeTitle);

    // CSV separator
    if (format === 'csv') {
      const separator = document.getElementById('api-csv-separator')?.value;
      if (separator) formatParams.push(separator);
    }

    if (formatParams.length > 0) {
      params.append('outputFormatParams', formatParams.join(','));
    }

    // Stub/heading layout
    const layout = document.getElementById('api-table-layout')?.value;
    if (layout === 'pivot') {
      // Pivot-friendly: all dimensions in stub (none in heading)
      const allDims = Object.keys(selection);
      if (allDims.length > 0) {
        params.append('stub', allDims.join(','));
      }
    }
  }

  const fullDataUrl = AppConfig.apiBaseUrl + '/tables/' + tableId + '/data?' + params.toString();
  previewUrl.textContent = fullDataUrl;

  // Update metadata URL
  if (metaUrl) {
    metaUrl.textContent = AppConfig.apiBaseUrl + '/tables/' + tableId + '/metadata?lang=no';
  }
}

// ============================================================
// API builder
// ============================================================

/**
 * Set up event listeners for the enhanced API builder section.
 * Handles: format selector with conditional options, copy URL, copy curl, open in browser.
 */
function setupApiBuilderEvents() {
  const formatSelect = document.getElementById('api-output-format');

  // Output format selector — show/hide format-specific options
  formatSelect?.addEventListener('change', () => {
    updateApiBuilderOptionsVisibility();
    updateQueryPreview();
  });

  // All sub-option selectors should also trigger URL update
  ['api-display-format', 'api-include-title', 'api-csv-separator', 'api-table-layout'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      updateQueryPreview();
    });
  });

  // Copy data URL
  document.getElementById('api-copy-url-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.textContent;
    if (url && url.startsWith('http')) {
      copyToClipboard(url);
      showCopyToast();
    }
  });

  // Copy as curl command
  document.getElementById('api-copy-curl-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.textContent;
    if (url && url.startsWith('http')) {
      const curlCmd = "curl '" + url + "'";
      copyToClipboard(curlCmd);
      showCopyToast();
    }
  });

  // Open data URL in new tab
  document.getElementById('api-open-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.textContent;
    if (url && url.startsWith('http')) {
      window.open(url, '_blank');
    }
  });

  // Copy metadata URL
  document.getElementById('api-copy-meta-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-meta-url')?.textContent;
    if (url && url.startsWith('http')) {
      copyToClipboard(url);
      showCopyToast();
    }
  });

  // Open metadata URL in new tab
  document.getElementById('api-open-meta-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-meta-url')?.textContent;
    if (url && url.startsWith('http')) {
      window.open(url, '_blank');
    }
  });
}

/**
 * Show/hide format-specific option rows based on the selected output format.
 *
 * - csv, html, xlsx: show display format, title option, layout option
 * - csv only: also show separator option
 * - Other formats: hide all sub-options
 */
function updateApiBuilderOptionsVisibility() {
  const format = document.getElementById('api-output-format')?.value || '';
  const hasFormatParams = ['csv', 'html', 'xlsx'].includes(format);

  // Display format (UseCodes/UseTexts/UseCodesAndTexts)
  const displayOption = document.getElementById('api-display-option');
  if (displayOption) displayOption.style.display = hasFormatParams ? '' : 'none';

  // Include title
  const titleOption = document.getElementById('api-title-option');
  if (titleOption) titleOption.style.display = hasFormatParams ? '' : 'none';

  // CSV separator (csv only)
  const separatorOption = document.getElementById('api-separator-option');
  if (separatorOption) separatorOption.style.display = format === 'csv' ? '' : 'none';

  // Table layout / stub+heading (csv, html, xlsx)
  const layoutOption = document.getElementById('api-layout-option');
  if (layoutOption) layoutOption.style.display = hasFormatParams ? '' : 'none';
}

/**
 * Copy text to clipboard using the Clipboard API with fallback.
 * @param {string} text - Text to copy
 */
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopyToClipboard(text);
    });
  } else {
    fallbackCopyToClipboard(text);
  }
}

/**
 * Fallback clipboard copy using a temporary textarea element.
 * @param {string} text - Text to copy
 */
function fallbackCopyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    logger.error('[ApiBuilder] Fallback copy failed:', err);
  }
  document.body.removeChild(textarea);
}

/**
 * Show a brief "Kopiert!" toast notification in the API builder area.
 */
function showCopyToast() {
  const toast = document.getElementById('api-copy-toast');
  if (!toast) return;
  toast.style.display = 'inline-block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 1500);
}

// ============================================================
// Fetch data
// ============================================================

/**
 * Handle fetch data button click.
 * Validates selection, stores it in AppState, and switches to table view.
 */
async function handleFetchData() {
  logger.log('[VariableSelect] Fetching data');

  const selection = getVariableSelection();
  if (!validateSelection(selection)) {
    showError('Velg verdier for alle obligatoriske variabler');
    return;
  }

  AppState.variableSelection = selection;
  logger.log('[VariableSelect] Variable selection:', selection);

  AppState.setView('table');
}
