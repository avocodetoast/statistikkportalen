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
