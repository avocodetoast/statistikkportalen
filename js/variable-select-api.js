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
  const mode = document.getElementById('api-method-toggle')?.value || 'get';
  const urlDecoded = document.getElementById('api-decode-url-cb')?.checked || false;

  // Collect format-specific params (valid for both GET and POST URLs)
  const format = document.getElementById('api-output-format')?.value || '';
  const formatsSupportingParams = ['csv', 'html', 'xlsx'];
  const fmtParams = [];
  let stubDims = undefined;

  if (formatsSupportingParams.includes(format)) {
    const displayFormat = document.getElementById('api-display-format')?.value;
    if (displayFormat) fmtParams.push(displayFormat);

    const includeTitle = document.getElementById('api-include-title')?.value;
    if (includeTitle) fmtParams.push(includeTitle);

    if (format === 'csv') {
      const separator = document.getElementById('api-csv-separator')?.value;
      if (separator) fmtParams.push(separator);
    }

    const layout = document.getElementById('api-table-layout')?.value;
    if (layout === 'pivot') {
      const allDims = Object.keys(selection);
      if (allDims.length > 0) stubDims = allDims;
    }
  }

  // Build GET URL params (valueCodes + format params)
  const params = new URLSearchParams({ lang: 'no' });
  Object.keys(selection).forEach(dimension => {
    const values = selection[dimension];
    const valueStr = Array.isArray(values) ? values.join(',') : values;
    params.append('valueCodes[' + dimension + ']', valueStr);
  });
  if (format) params.append('outputFormat', format);
  if (fmtParams.length > 0) params.append('outputFormatParams', fmtParams.join(','));
  if (stubDims) params.append('stub', stubDims.join(','));

  // Build POST URL params (format params only — valueCodes go in the body)
  const postParams = new URLSearchParams({ lang: 'no' });
  if (format) postParams.append('outputFormat', format);
  if (fmtParams.length > 0) postParams.append('outputFormatParams', fmtParams.join(','));
  if (stubDims) postParams.append('stub', stubDims.join(','));

  const fullGetUrl = AppConfig.apiBaseUrl + '/tables/' + tableId + '/data?' + params.toString();
  const fullPostUrl = AppConfig.apiBaseUrl + '/tables/' + tableId + '/data?' + postParams.toString();
  const urlWarning = document.getElementById('api-url-warning');
  const postBodySection = document.getElementById('api-post-body-section');
  const openBtn = document.getElementById('api-open-btn');

  if (mode === 'get') {
    // GET mode: show full URL (with valueCodes)
    previewUrl.textContent = urlDecoded ? decodeURIComponent(fullGetUrl) : fullGetUrl;

    // URL length warning
    if (urlWarning) {
      const tooLong = fullGetUrl.length > AppConfig.limits.maxGetUrlLength;
      urlWarning.style.display = tooLong ? '' : 'none';
      if (tooLong) {
        urlWarning.textContent = 'URL-en er ' + fullGetUrl.length + ' tegn \u2014 overskrider grensen p\u00e5 '
          + AppConfig.limits.maxGetUrlLength + ' tegn. Bruk POST-modus for store utvalg.';
      }
    }

    // Hide POST body
    if (postBodySection) postBodySection.style.display = 'none';

    // Enable open-in-browser
    if (openBtn) {
      openBtn.disabled = false;
      openBtn.title = '\u00c5pne i ny fane';
    }
  } else {
    // POST mode: show endpoint URL with format params (no valueCodes) + JSON body
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
      openBtn.title = 'Kun tilgjengelig i GET-modus';
    }
  }

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

  // Method toggle (GET/POST)
  document.getElementById('api-method-toggle')?.addEventListener('change', () => {
    updateQueryPreview();
  });

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

  // Decode URL checkbox
  document.getElementById('api-decode-url-cb')?.addEventListener('change', () => {
    updateQueryPreview();
  });

  // Copy data URL
  document.getElementById('api-copy-url-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.textContent;
    if (url && url.startsWith('http')) {
      copyToClipboard(url);
      showCopyToast();
    }
  });

  // Copy as curl command (mode-aware)
  document.getElementById('api-copy-curl-btn')?.addEventListener('click', () => {
    const mode = document.getElementById('api-method-toggle')?.value || 'get';
    if (mode === 'get') {
      const url = document.getElementById('query-preview-url')?.textContent;
      if (url && url.startsWith('http')) {
        copyToClipboard("curl '" + url + "'");
        showCopyToast();
      }
    } else {
      const endpoint = document.getElementById('query-preview-url')?.textContent;
      const body = document.getElementById('api-post-body-preview')?.textContent;
      if (endpoint && body) {
        const cmd = "curl -X POST '" + endpoint + "' \\\n"
          + "  -H 'Content-Type: application/json' \\\n"
          + "  -d '" + body.replace(/'/g, "'\\''") + "'";
        copyToClipboard(cmd);
        showCopyToast();
      }
    }
  });

  // Open data URL in new tab (GET only)
  document.getElementById('api-open-btn')?.addEventListener('click', () => {
    const url = document.getElementById('query-preview-url')?.textContent;
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
