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
 *
 * === File structure ===
 * This file is the main entry point. Supporting modules (loaded before this):
 *   variable-select-state.js    — module-level state variables + debouncedURLUpdate()
 *   variable-select-status.js   — visual updates, selection status, cell count, getVariableSelection()
 *   variable-select-codelists.js — codelist fetch/apply/restore + setupCodelistDropdowns()
 *   variable-select-render.js   — dimension card rendering, value lists, restoreSelections()
 *   variable-select-events.js   — click/keyboard/filter/mode button event wiring
 *   variable-select-api.js      — API query preview, API builder UI, handleFetchData()
 */

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
    showError(t('error.noTable'));
    URLRouter.navigateTo('home', {});
    URLRouter.handleRoute();
    return;
  }

  const table = AppState.selectedTable;
  updatePageTitle([extractTableTitle(table.label), t('variable.heading')]);

  await BrowserState.init();

  // If we arrived via direct link/refresh, the label was a placeholder — update it now
  const realTable = BrowserState.allTables.find(t => t.id === table.id);
  if (realTable) {
    AppState.selectedTable.label = realTable.label;
    updatePageTitle([extractTableTitle(table.label), t('variable.heading')]);
  }

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <button id="back-to-browser" class="btn-secondary">
          ${t('nav.back.tables')}
        </button>
        ${buildNavigationBreadcrumb(table.id, extractTableTitle(table.label))}
        <h2>${escapeHtml(extractTableTitle(table.label))}</h2>
        <p class="table-id-display">${t('variable.tablePrefix')} ${escapeHtml(table.id)}</p>
        <p class="view-description">
          ${t('variable.instructions')}
        </p>
      </div>

      <div id="variables-container" class="variables-container">
        <p class="loading-message">${t('loading.metadata')}</p>
      </div>

      <div class="query-preview-container">
        <button class="query-preview-toggle" id="query-preview-toggle">
          <span class="query-toggle-icon">&#9654;</span> ${t('api.builder')}
        </button>
        <div class="query-preview-content" id="query-preview-content" style="display: none;">

          <div class="api-builder-options-grid">
            <div class="api-builder-option">
              <label class="api-builder-label">${t('api.method')}</label>
              <select id="api-method-toggle" class="api-format-select">
                <option value="get">GET</option>
                <option value="post">POST</option>
              </select>
            </div>

            <div class="api-builder-option">
              <label class="api-builder-label">${t('api.format')}</label>
              <select id="api-output-format" class="api-format-select">
                <option value="" selected>JSON-stat2 (standard)</option>
                <option value="csv">CSV</option>
                <option value="xlsx">Excel (xlsx)</option>
                <option value="px">PX (PC-Axis)</option>
                <option value="html">HTML</option>
                <option value="json-px">JSON-PX</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-display-option" style="display: none;">
              <label class="api-builder-label">${t('api.display')}</label>
              <select id="api-display-format" class="api-format-select">
                <option value="UseTexts" selected>${t('api.displayText')}</option>
                <option value="UseCodes">${t('api.displayCodes')}</option>
                <option value="UseCodesAndTexts">${t('api.displayBoth')}</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-title-option" style="display: none;">
              <label class="api-builder-label">${t('api.tableTitle')}</label>
              <select id="api-include-title" class="api-format-select">
                <option value="" selected>${t('variable.withoutTitle')}</option>
                <option value="IncludeTitle">${t('variable.withTitle')}</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-separator-option" style="display: none;">
              <label class="api-builder-label">${t('api.separator')}</label>
              <select id="api-csv-separator" class="api-format-select">
                <option value="SeparatorSemicolon" selected>${t('api.separatorSemicolon')}</option>
                <option value="SeparatorTab">${t('api.separatorTab')}</option>
                <option value="SeparatorSpace">${t('api.separatorSpace')}</option>
              </select>
            </div>

            <div class="api-builder-option" id="api-layout-option" style="display: none;">
              <label class="api-builder-label">${t('api.layout')}</label>
              <select id="api-table-layout" class="api-format-select">
                <option value="" selected>${t('api.layoutStandard')}</option>
                <option value="pivot">${t('api.layoutPivot')}</option>
              </select>
            </div>
          </div>

          <div class="api-builder-section">
            <div class="api-builder-section-header">
              <span class="api-builder-section-title">${t('api.dataUrl')}</span>
              <div class="api-builder-actions">
                <label class="api-builder-checkbox-label" title="${t('api.decodedUrlTooltip')}"><input type="checkbox" id="api-decode-url-cb" checked> ${t('api.showPlaintext')}</label>
                <button class="btn-secondary btn-sm" id="api-copy-url-btn" title="${t('api.copyUrl')}">${t('api.copyUrl')}</button>
                <button class="btn-secondary btn-sm" id="api-open-btn" title="${t('api.openNewTab')}">${t('api.openBrowser')}</button>
              </div>
            </div>
            <code class="query-preview-url" id="query-preview-url">
              ${t('variable.selectValues')}
            </code>
            <div id="api-url-warning" class="api-url-warning" style="display: none;"></div>
          </div>

          <div class="api-builder-section" id="api-post-body-section" style="display: none;">
            <div class="api-builder-section-header">
              <span class="api-builder-section-title">${t('api.postBody')}</span>
              <div class="api-builder-actions">
                <button class="btn-secondary btn-sm" id="api-copy-post-body-btn" title="${t('api.copyBody')}">${t('api.copyBody')}</button>
              </div>
            </div>
            <code class="query-preview-url" id="api-post-body-preview" style="white-space: pre;"></code>
          </div>

          <div class="api-builder-section">
            <div class="api-builder-section-header">
              <span class="api-builder-section-title">${t('api.metadataUrl')}</span>
              <div class="api-builder-actions">
                <button class="btn-secondary btn-sm" id="api-copy-meta-btn" title="${t('api.copyMetadataUrl')}">${t('api.copyMetadataUrl')}</button>
                <button class="btn-secondary btn-sm" id="api-open-meta-btn" title="${t('api.openMetadata')}">${t('api.openBrowser')}</button>
              </div>
            </div>
            <code class="query-preview-url" id="query-preview-meta-url"></code>
          </div>

          <div class="api-copy-toast" id="api-copy-toast" style="display: none;">${t('api.copied')}</div>
        </div>
      </div>

      <div class="action-bar">
        <button id="fetch-data-btn" class="btn-primary" disabled>
          ${t('variable.fetchData')}
        </button>
        <div class="selection-summary">
          <span id="selection-status">${t('variable.selectValuesAll')}</span>
          <div id="cell-count-display" class="cell-count-display"></div>
        </div>
      </div>
    </div>
  `;

  // Set up back button - navigate to stored ref, fallback to home
  document.getElementById('back-to-browser')?.addEventListener('click', () => {
    const ref = AppState.navigationRef || 'home';
    AppState.resetTableState();
    const [route, qs] = ref.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    URLRouter.navigateTo(route, params);
    URLRouter.handleRoute();
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
    () => api.getTableMetadata(tableId, true, getCurrentApiLang()),
    t('error.loadMetadata') + tableId
  );

  if (!data || !data.dimension) {
    logger.error('[VariableSelect] Invalid metadata format:', data);
    return;
  }

  tableMetadata = data;
  logger.log('[VariableSelect] Loaded metadata:', data);

  // Update title if it was set as a placeholder during direct URL navigation
  if (data.label && AppState.selectedTable) {
    AppState.selectedTable.label = data.label;
    const h2 = document.querySelector('.view-header h2');
    if (h2) h2.textContent = extractTableTitle(data.label);
    const bc = document.querySelector('.breadcrumb-current');
    if (bc) bc.textContent = AppState.selectedTable.id + ' ' + extractTableTitle(data.label);
  }

  // Reset codelist state for new table
  Object.keys(activeCodelists).forEach(k => delete activeCodelists[k]);
  Object.keys(dimensionValueOrder).forEach(k => delete dimensionValueOrder[k]);

  // Display variables
  await displayVariables();
}
