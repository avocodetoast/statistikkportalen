/**
 * Variable Selection — API Query Preview, API Builder & Fetch Handler
 *
 * Builds and displays the live data URL preview, handles the collapsible
 * API builder section (format selectors, copy/open buttons), and triggers
 * the actual data fetch when the user clicks "Hent data".
 */

// ============================================================
// API query preview
// ============================================================

/**
 * Read the value of the checked radio in a pill group.
 * @param {string} name - The radio group's name attribute
 * @returns {string} Checked value, or '' if none
 */
function getApiRadioValue(name) {
  return document.querySelector('input[name="' + name + '"]:checked')?.value ?? '';
}

/**
 * Update the real-time API query preview box.
 *
 * SSB (capabilities.supportsGetUrlBuilder): full builder — GET/POST data URL
 * with output format, format params, separator, and stub/heading layout.
 * Norges Bank / FHI (capabilities.supportsApiQuery): simplified builder —
 * delegates to updateForeignQueryPreview(), which asks the owning adapter for
 * the exact query via api.buildApiQuery().
 */
function updateQueryPreview() {
  const previewUrl = document.getElementById('query-preview-url');
  const metaUrl = document.getElementById('query-preview-meta-url');
  if (!previewUrl || !AppState.selectedTable) return;

  const tableId = AppState.selectedTable.id;
  const caps = api.capabilitiesFor(tableId) || {};
  if (!caps.supportsGetUrlBuilder) {
    if (caps.supportsApiQuery) updateForeignQueryPreview(previewUrl, metaUrl, tableId);
    return;
  }

  const selection = getVariableSelection();
  const mode = getApiRadioValue('api-method') || 'get';
  const urlDecoded = document.getElementById('api-decode-url-cb')?.checked || false;

  // Collect format-specific params (valid for both GET and POST URLs)
  const format = getApiRadioValue('api-output-format');
  const formatsSupportingParams = ['csv', 'html', 'xlsx'];
  const fmtParams = [];
  let stubDims = undefined;

  if (formatsSupportingParams.includes(format)) {
    const displayFormat = getApiRadioValue('api-display-format');
    if (displayFormat) fmtParams.push(displayFormat);

    if (document.getElementById('api-include-title-cb')?.checked) {
      fmtParams.push('IncludeTitle');
    }

    if (format === 'csv') {
      const separator = getApiRadioValue('api-csv-separator');
      if (separator) fmtParams.push(separator);
    }

    if (document.getElementById('api-layout-pivot-cb')?.checked) {
      const allDims = Object.keys(selection);
      if (allDims.length > 0) stubDims = allDims;
    }
  }

  // Build POST URL params (format params only — valueCodes go in the body)
  const postParams = new URLSearchParams({ lang: getCurrentApiLang() });
  if (format) postParams.append('outputFormat', format);
  if (fmtParams.length > 0) postParams.append('outputFormatParams', fmtParams.join(','));
  if (stubDims) postParams.append('stub', stubDims.join(','));

  // Build GET URL params (POST params + valueCodes + active codelists).
  // Selections are arrays of explicit codes (specific mode) or the strings
  // '*' (star mode) / 'top(N)' (Siste N mode) — all listed verbatim.
  const params = new URLSearchParams(postParams);
  Object.keys(selection).forEach(dimension => {
    const values = selection[dimension];
    const valueStr = Array.isArray(values) ? values.join(',') : values;
    params.append('valueCodes[' + dimension + ']', valueStr);
  });
  const activeCodelistIds = AppState.activeCodelistIds || {};
  Object.keys(activeCodelistIds).forEach(dimension => {
    const codelistId = activeCodelistIds[dimension];
    if (codelistId) {
      params.append('codelist[' + dimension + ']', codelistId);
      // Aggregation codelists need outputValues=aggregated to return summed values
      if (isAggregationCodelistId(codelistId)) {
        params.append('outputValues[' + dimension + ']', 'aggregated');
      }
    }
  });

  const fullGetUrl = AppConfig.apiBaseUrl + '/tables/' + tableId + '/data?' + params.toString();
  const fullPostUrl = AppConfig.apiBaseUrl + '/tables/' + tableId + '/data?' + postParams.toString();
  const urlWarning = document.getElementById('api-url-warning');
  const postBodySection = document.getElementById('api-post-body-section');
  const openBtn = document.getElementById('api-open-btn');

  if (mode === 'get') {
    // GET mode: show full URL (with valueCodes)
    // Keep the raw encoded URL for copy/open — the decoded display variant may not be a valid URL
    previewUrl.dataset.rawUrl = fullGetUrl;
    previewUrl.textContent = urlDecoded ? decodeURIComponent(fullGetUrl) : fullGetUrl;

    // URL length warning
    if (urlWarning) {
      const tooLong = fullGetUrl.length > AppConfig.limits.maxGetUrlLength;
      urlWarning.style.display = tooLong ? '' : 'none';
      if (tooLong) {
        urlWarning.textContent = tpl('api.urlTooLong', fullGetUrl.length, AppConfig.limits.maxGetUrlLength);
      }
    }

    // Hide POST body
    if (postBodySection) postBodySection.style.display = 'none';

    // Enable open-in-browser
    if (openBtn) {
      openBtn.disabled = false;
      openBtn.title = t('api.openNewTab');
    }
  } else {
    // POST mode: show endpoint URL with format params (no valueCodes) + JSON body
    previewUrl.dataset.rawUrl = fullPostUrl;
    previewUrl.textContent = urlDecoded ? decodeURIComponent(fullPostUrl) : fullPostUrl;

    // Build and show POST body (include stub/heading placement if pivot layout)
    const bodyObj = api.buildPostBody(selection, {
      codelistIds: AppState.activeCodelistIds,
      stub: stubDims
    });
    const postBodyEl = document.getElementById('api-post-body-preview');
    if (postBodyEl) postBodyEl.textContent = JSON.stringify(bodyObj, null, 2);
    if (postBodySection) postBodySection.style.display = '';

    // Hide URL warning in POST mode
    if (urlWarning) urlWarning.style.display = 'none';

    // Disable open-in-browser in POST mode
    if (openBtn) {
      openBtn.disabled = true;
      openBtn.title = t('api.getOnlyFeature');
    }
  }

  // Update metadata URL
  if (metaUrl) {
    metaUrl.textContent = AppConfig.apiBaseUrl + '/tables/' + tableId + '/metadata?lang=' + getCurrentApiLang();
  }
}

/**
 * Update the simplified API query preview for foreign sources (Norges Bank /
 * FHI). The owning adapter describes the exact request its getTableData would
 * send — GET URL for Norges Bank's SDMX API, POST endpoint + JSON body for
 * FHI's open API — via the facade's synchronous buildApiQuery().
 * No-op until the table metadata has loaded (buildApiQuery requires it).
 *
 * @param {HTMLElement} previewUrl - The #query-preview-url element
 * @param {HTMLElement|null} metaUrl - The #query-preview-meta-url element
 * @param {string} tableId - Namespaced table id (nb-… or fhi-…)
 */
function updateForeignQueryPreview(previewUrl, metaUrl, tableId) {
  if (!tableMetadata || !Array.isArray(tableMetadata.id)) return; // metadata not loaded yet

  // Source-specific builder options (format pills, NB advanced params, FHI max
  // rows) — controls only exist when the adapter's getApiBuilderOptions()
  // declared them, so absent elements simply leave the option undefined.
  const format = getApiRadioValue('api-output-format') || undefined;
  const detail = getApiRadioValue('api-nb-detail') || undefined;
  const includeHistory = document.getElementById('api-include-history-cb')?.checked || undefined;
  const maxRowsInput = document.getElementById('api-max-rows-input');
  // Empty field → null (property omitted = unlimited); absent input → undefined (adapter default)
  const maxRowCount = maxRowsInput
    ? (maxRowsInput.value.trim() === '' ? null : parseInt(maxRowsInput.value, 10))
    : undefined;

  // The UTF-8 BOM param only applies to CSV output — hide the checkbox for
  // other formats and keep its state out of the URL while hidden.
  const csvFormats = api.apiBuilderOptionsFor(tableId)?.csvFormats || [];
  const bomApplies = csvFormats.includes(format);
  const bomOption = document.getElementById('api-bom-option');
  if (bomOption) bomOption.style.display = bomApplies ? '' : 'none';
  const bom = (bomApplies && document.getElementById('api-bom-cb')?.checked) || undefined;

  let query;
  try {
    query = api.buildApiQuery(tableId, getVariableSelection(), {
      meta: tableMetadata,
      lang: getCurrentApiLang(),
      format: format,
      detail: detail,
      includeHistory: includeHistory,
      bom: bom,
      maxRowCount: maxRowCount
    });
  } catch (err) {
    logger.warn('[ApiBuilder] buildApiQuery failed for ' + tableId + ':', err);
    return;
  }

  const urlDecoded = document.getElementById('api-decode-url-cb')?.checked || false;
  // Keep the raw encoded URL for copy/open — the decoded display variant may not be a valid URL
  previewUrl.dataset.rawUrl = query.url;
  previewUrl.textContent = urlDecoded ? decodeURIComponent(query.url) : query.url;

  const postBodySection = document.getElementById('api-post-body-section');
  const openBtn = document.getElementById('api-open-btn');

  if (query.method === 'POST' && query.body) {
    const postBodyEl = document.getElementById('api-post-body-preview');
    if (postBodyEl) postBodyEl.textContent = JSON.stringify(query.body, null, 2);
    if (postBodySection) postBodySection.style.display = '';
    // A POST data URL can't be opened directly in a browser tab
    if (openBtn) {
      openBtn.disabled = true;
      openBtn.title = t('api.getOnlyFeature');
    }
  } else {
    if (postBodySection) postBodySection.style.display = 'none';
    if (openBtn) {
      openBtn.disabled = false;
      openBtn.title = t('api.openNewTab');
    }
  }

  if (metaUrl) metaUrl.textContent = query.metadataUrl || '';
}

// ============================================================
// API builder
// ============================================================

/**
 * Set up event listeners for the enhanced API builder section.
 * Handles: format selector with conditional options, copy URL, copy curl, open in browser.
 */
function setupApiBuilderEvents() {
  // Trim unsupported formats from the pill group. /config returns the live list
  // of dataFormats; api._applyConfig populates AppConfig.limits.dataFormats.
  // Empty value="" is JSON-stat2 (the default) and is always kept.
  const formatGroup = document.getElementById('api-format-group');
  if (formatGroup && Array.isArray(AppConfig.limits.dataFormats)) {
    const allowed = new Set(AppConfig.limits.dataFormats.map(f => f.toLowerCase()));
    allowed.add('');
    allowed.add('json-stat2');
    formatGroup.querySelectorAll('input[name="api-output-format"]').forEach(input => {
      if (!allowed.has(input.value.toLowerCase())) input.closest('.api-pill')?.remove();
    });
  }

  // All option pills/checkboxes: one delegated listener updates visibility + preview
  document.getElementById('api-builder-options')?.addEventListener('change', () => {
    updateApiBuilderOptionsVisibility();
    updateQueryPreview();
  });

  // Decode URL checkbox
  document.getElementById('api-decode-url-cb')?.addEventListener('change', () => {
    updateQueryPreview();
  });

  // FHI max-rows field: update the previewed body live while typing
  // ('change' on the delegated container only fires on blur/Enter)
  document.getElementById('api-max-rows-input')?.addEventListener('input', () => {
    updateQueryPreview();
  });

  // Copy data URL (always the raw encoded URL, even when the decoded variant is displayed)
  document.getElementById('api-copy-url-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.dataset.rawUrl;
    if (url && url.startsWith('http')) {
      copyToClipboard(url);
      showCopyToast();
    }
  });

  // Open data URL in new tab (GET only)
  document.getElementById('api-open-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.dataset.rawUrl;
    if (url && url.startsWith('http')) {
      window.open(url, '_blank');
    }
  });

  // Copy POST body
  document.getElementById('api-copy-post-body-btn')?.addEventListener('click', () => {
    const body = document.getElementById('api-post-body-preview')?.textContent;
    if (body) {
      copyToClipboard(body);
      showCopyToast();
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
 * - csv, html, xlsx: show display format row + title/layout checkboxes
 * - csv only: also show separator row
 * - Other formats: hide all sub-options
 */
function updateApiBuilderOptionsVisibility() {
  const format = getApiRadioValue('api-output-format');
  const hasFormatParams = ['csv', 'html', 'xlsx'].includes(format);

  // Display format (UseCodes/UseTexts/UseCodesAndTexts)
  const displayOption = document.getElementById('api-display-option');
  if (displayOption) displayOption.style.display = hasFormatParams ? '' : 'none';

  // CSV separator (csv only)
  const separatorOption = document.getElementById('api-separator-option');
  if (separatorOption) separatorOption.style.display = format === 'csv' ? '' : 'none';

  // Title + pivot layout checkboxes (csv, html, xlsx)
  const extrasOption = document.getElementById('api-extras-option');
  if (extrasOption) extrasOption.style.display = hasFormatParams ? '' : 'none';
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
    showError(t('variable.selectValuesAll'));
    return;
  }

  AppState.variableSelection = selection;
  logger.log('[VariableSelect] Variable selection:', selection);

  AppState.setView('table');
}
