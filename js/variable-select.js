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
  // Capability gates (see js/sources/*-adapter.js capabilities and
  // js/sources/source-registry.js): SSB gets the full API-builder panel
  // (supportsGetUrlBuilder — GET/POST with format options); Norges Bank and
  // FHI get the simplified panel (supportsApiQuery — data URL/POST body +
  // metadata URL via api.buildApiQuery). The "load default selection" button
  // is gated separately (supportsDefaultSelection: SSB + FHI, not NB).
  const caps = api.capabilitiesFor(table.id) || {};

  // Pre-rendrede tabellsider (/table/{id}/) har en generert tittel som skal stå
  // urørt i Googlebots snapshot — ikke overskriv med plassholder-/lastetittel.
  if (!seoTableMatchesRoute(table.id)) {
    updatePageTitle([extractTableTitle(table.label), t('variable.heading')]);
  }

  await BrowserState.init();

  // If we arrived via direct link/refresh, the label was a placeholder — update it now
  const realTable = BrowserState.allTables.find(t => t.id === table.id);
  if (realTable) {
    AppState.selectedTable.label = realTable.label;
    if (!seoTableMatchesRoute(table.id)) {
      updatePageTitle([extractTableTitle(table.label), t('variable.heading')]);
    }
  }

  // "Load default selection" (SSB, FHI) — Norges Bank has no defaultselection
  // endpoint (capabilities.supportsDefaultSelection: false), so the button is
  // omitted entirely rather than shown-then-erroring.
  const defaultSelectionBtnHtml = caps.supportsDefaultSelection ? `
        <button id="load-default-selection" class="btn-secondary btn-sm"
                title="${t('variable.defaultSelectionTitle')}">
          ${t('variable.defaultSelection')}
        </button>` : '';

  // Simplified API builder panel (Norges Bank / FHI — capabilities.supportsApiQuery):
  // live data URL (GET) or endpoint + POST body (FHI), plus metadata URL, with
  // copy/open actions. Same element ids as the full panel so updateQueryPreview()
  // and setupApiBuilderEvents() operate on both — the SSB-specific option rows
  // (method/display/separator) are simply absent. Source-specific options
  // (format, NB advanced params, FHI max rows) come from the owning adapter
  // via api.apiBuilderOptionsFor() and only affect the previewed URL/body —
  // never the app's own data fetching.
  const builderOpts = caps.supportsApiQuery ? api.apiBuilderOptionsFor(table.id) : null;

  const foreignFormatRowHtml = builderOpts ? `
          <div class="api-builder-options" id="api-builder-options">
            <div class="api-option-row">
              <span class="api-builder-label">${t('api.format')}</span>
              <!-- NOT id="api-format-group": that group is trimmed against SSB's
                   /config dataFormats in setupApiBuilderEvents() -->
              <div class="api-pill-group" id="api-foreign-format-group" role="radiogroup" aria-label="${t('api.format')}">
                ${builderOpts.formats.map(f => `
                <label class="api-pill"><input type="radio" name="api-output-format" value="${escapeHtml(f.value)}"${f.value === builderOpts.defaultFormat ? ' checked' : ''}><span>${escapeHtml(f.labelKey ? t(f.labelKey) : f.label)}</span></label>`).join('')}
              </div>
            </div>
            ${builderOpts.nbAdvanced ? `
            <div class="api-option-row">
              <span class="api-builder-label">${t('api.detail')}</span>
              <div class="api-pill-group" role="radiogroup" aria-label="${t('api.detail')}">
                <label class="api-pill"><input type="radio" name="api-nb-detail" value="" checked><span>${t('api.detailFull')}</span></label>
                <label class="api-pill"><input type="radio" name="api-nb-detail" value="dataonly"><span>${t('api.detailDataonly')}</span></label>
                <label class="api-pill"><input type="radio" name="api-nb-detail" value="serieskeysonly"><span>${t('api.detailSerieskeys')}</span></label>
                <label class="api-pill"><input type="radio" name="api-nb-detail" value="nodata"><span>${t('api.detailNodata')}</span></label>
              </div>
            </div>
            <div class="api-option-row">
              <label class="api-builder-checkbox-label"><input type="checkbox" id="api-include-history-cb"> ${t('api.includeHistory')}</label>
              <label class="api-builder-checkbox-label" id="api-bom-option" style="display: none;"><input type="checkbox" id="api-bom-cb"> ${t('api.bom')}</label>
            </div>` : ''}
            ${builderOpts.maxRowCount ? `
            <div class="api-option-row">
              <span class="api-builder-label">${t('api.maxRowCount')}</span>
              <input type="number" id="api-max-rows-input" class="api-max-rows-input"
                     value="${builderOpts.maxRowCount.default}" min="1" step="1000"
                     title="${t('api.maxRowCountHint')}">
              <span class="api-builder-hint">${t('api.maxRowCountHint')}</span>
            </div>` : ''}
          </div>` : '';

  const simpleApiBuilderHtml = `
      <div class="query-preview-container">
        <button class="query-preview-toggle" id="query-preview-toggle">
          <span class="query-toggle-icon">&#9654;</span> ${t('api.builder')}
        </button>
        <div class="query-preview-content" id="query-preview-content" style="display: none;">
${foreignFormatRowHtml}

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
      </div>`;

  // Full API builder panel (GET/POST URL preview with format options) — SSB-only
  // (capabilities.supportsGetUrlBuilder). NB/FHI fall back to the simplified
  // panel above (capabilities.supportsApiQuery).
  const apiBuilderHtml = caps.supportsGetUrlBuilder ? `
      <div class="query-preview-container">
        <button class="query-preview-toggle" id="query-preview-toggle">
          <span class="query-toggle-icon">&#9654;</span> ${t('api.builder')}
        </button>
        <div class="query-preview-content" id="query-preview-content" style="display: none;">

          <div class="api-builder-options" id="api-builder-options">
            <div class="api-option-row">
              <span class="api-builder-label">${t('api.method')}</span>
              <div class="api-pill-group" role="radiogroup" aria-label="${t('api.method')}">
                <label class="api-pill"><input type="radio" name="api-method" value="get" checked><span>GET</span></label>
                <label class="api-pill"><input type="radio" name="api-method" value="post"><span>POST</span></label>
              </div>
            </div>

            <div class="api-option-row">
              <span class="api-builder-label">${t('api.format')}</span>
              <div class="api-pill-group" id="api-format-group" role="radiogroup" aria-label="${t('api.format')}">
                <label class="api-pill"><input type="radio" name="api-output-format" value="" checked><span>JSON-stat2</span></label>
                <label class="api-pill"><input type="radio" name="api-output-format" value="csv"><span>CSV</span></label>
                <label class="api-pill"><input type="radio" name="api-output-format" value="xlsx"><span>Excel</span></label>
                <label class="api-pill"><input type="radio" name="api-output-format" value="px"><span>PX</span></label>
                <label class="api-pill"><input type="radio" name="api-output-format" value="html"><span>HTML</span></label>
                <label class="api-pill"><input type="radio" name="api-output-format" value="json-px"><span>JSON-PX</span></label>
              </div>
            </div>

            <div class="api-option-row" id="api-display-option" style="display: none;">
              <span class="api-builder-label">${t('api.display')}</span>
              <div class="api-pill-group" role="radiogroup" aria-label="${t('api.display')}">
                <label class="api-pill"><input type="radio" name="api-display-format" value="UseTexts" checked><span>${t('api.displayText')}</span></label>
                <label class="api-pill"><input type="radio" name="api-display-format" value="UseCodes"><span>${t('api.displayCodes')}</span></label>
                <label class="api-pill"><input type="radio" name="api-display-format" value="UseCodesAndTexts"><span>${t('api.displayBoth')}</span></label>
              </div>
            </div>

            <div class="api-option-row" id="api-separator-option" style="display: none;">
              <span class="api-builder-label">${t('api.separator')}</span>
              <div class="api-pill-group" role="radiogroup" aria-label="${t('api.separator')}">
                <label class="api-pill"><input type="radio" name="api-csv-separator" value="SeparatorSemicolon" checked><span>${t('api.separatorSemicolon')}</span></label>
                <label class="api-pill"><input type="radio" name="api-csv-separator" value="SeparatorTab"><span>${t('api.separatorTab')}</span></label>
                <label class="api-pill"><input type="radio" name="api-csv-separator" value="SeparatorSpace"><span>${t('api.separatorSpace')}</span></label>
              </div>
            </div>

            <div class="api-option-row" id="api-extras-option" style="display: none;">
              <label class="api-builder-checkbox-label"><input type="checkbox" id="api-include-title-cb"> ${t('api.includeTitle')}</label>
              <label class="api-builder-checkbox-label"><input type="checkbox" id="api-layout-pivot-cb"> ${t('api.layoutPivot')}</label>
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
      </div>` : (caps.supportsApiQuery ? simpleApiBuilderHtml : '');

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
        ${defaultSelectionBtnHtml}
      </div>

      <div id="table-info-container"></div>

      <div id="variables-container" class="variables-container">
        <p class="loading-message">${t('loading.metadata')}</p>
      </div>

      ${apiBuilderHtml}

      <div class="action-bar">
        <button id="fetch-data-btn" class="btn-primary" disabled>
          ${t('variable.fetchData')}
        </button>
        <div class="selection-summary">
          <span id="selection-status">${t('variable.selectValuesAll')}</span>
          <div id="cell-count-display" class="cell-count-display"></div>
          <div id="series-match-display" class="cell-count-display"></div>
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

  // Set up default selection button
  document.getElementById('load-default-selection')?.addEventListener('click', handleLoadDefaultSelection);
}

/**
 * Fetch the table's default selection and apply it to the variable cards.
 * Reuses the same restore mechanism as URL-state restore.
 */
async function handleLoadDefaultSelection() {
  const btn = document.getElementById('load-default-selection');
  if (!btn || !AppState.selectedTable) return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('variable.defaultSelectionLoading');

  let showingTempMessage = false;
  try {
    const result = await api.getDefaultSelection(AppState.selectedTable.id, getCurrentApiLang());
    const entries = result?.selection || result || [];

    if (!Array.isArray(entries) || entries.length === 0) {
      logger.warn('[VariableSelect] Default selection returned empty or unexpected format:', result);
      showingTempMessage = true;
      btn.textContent = t('variable.defaultSelectionEmpty');
      setTimeout(() => { btn.textContent = originalText; }, 3000);
      return;
    }

    // Convert array format → AppState format and apply via the existing restore path
    const newSelection = {};
    const newCodelists = {};
    entries.forEach(item => {
      if (item.variableCode) {
        newSelection[item.variableCode] = item.valueCodes || [];
        if (item.codelist) newCodelists[item.variableCode] = item.codelist;
      }
    });

    AppState.variableSelection = newSelection;
    AppState.activeCodelistIds = newCodelists;

    await restoreSelections();
    updateSelectionStatus();
  } catch (err) {
    logger.error('[VariableSelect] Failed to load default selection:', err);
    showError(t('error.defaultSelection'), err);
  } finally {
    btn.disabled = false;
    if (!showingTempMessage) btn.textContent = originalText;
  }
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

  // Tabellinfo (notater, kilde, kontakt, Klass-lenker) — samme kollapsbare
  // seksjon som på tabellvisningen. Viktig også for crawlere: de pre-rendrede
  // /table/{id}/-sidene erstattes av denne visningen når appen booter, og
  // uten denne seksjonen ville beskrivelsen forsvinne fra Googlebots snapshot.
  const infoContainer = document.getElementById('table-info-container');
  if (infoContainer && typeof buildMetadataSection === 'function') {
    infoContainer.innerHTML = buildMetadataSection(data);
    setupMetadataToggle(infoContainer);
  }

  // Reset codelist state for new table
  Object.keys(activeCodelists).forEach(k => delete activeCodelists[k]);
  Object.keys(dimensionValueOrder).forEach(k => delete dimensionValueOrder[k]);

  // Display variables
  await displayVariables();
}
