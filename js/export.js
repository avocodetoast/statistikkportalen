/**
 * Export - Export table data using SSB API's native export functionality
 *
 * This module provides an export options dialog that lets users configure
 * the export format, display options, and layout before downloading data
 * directly from the SSB API.
 */

/**
 * Show export options dialog
 */
function showExportDialog() {
  logger.log('[Export] Opening export dialog');

  if (!currentData || !AppState.tableLayout) {
    showError(t('error.noDataExport'));
    return;
  }

  // Check if dialog already exists
  let dialog = document.getElementById('export-dialog');
  if (dialog) {
    dialog.remove();
  }

  // Get current layout
  const layout = AppState.tableLayout;

  // Create dialog HTML
  const dialogHtml = `
    <div class="dialog-overlay" id="export-dialog">
      <div class="dialog-container">
        <div class="dialog-header">
          <h3>${t('export.title')}</h3>
          <button class="dialog-close" id="export-dialog-close">&times;</button>
        </div>

        <div class="dialog-content">
          <!-- File Format -->
          <div class="form-group">
            <label class="form-label">${t('export.format')}</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="export-format" value="xlsx" checked>
                <span>${t('export.formatExcel')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="export-format" value="csv">
                <span>${t('export.formatCsv')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="export-format" value="px">
                <span>${t('export.formatPx')}</span>
              </label>
            </div>
          </div>

          <!-- Display Format -->
          <div class="form-group">
            <label class="form-label">${t('export.displayAs')}</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="display-format" value="" checked>
                <span>${t('export.displayStandard')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="display-format" value="UseTexts">
                <span>${t('export.displayText')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="display-format" value="UseCodes">
                <span>${t('export.displayCodes')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="display-format" value="UseCodesAndTexts">
                <span>${t('export.displayBoth')}</span>
              </label>
            </div>
          </div>

          <!-- CSV Separator (only for CSV) -->
          <div class="form-group" id="csv-separator-group">
            <label class="form-label">${t('export.csvSeparator')}</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="csv-separator" value="SeparatorSemicolon" checked>
                <span>${t('export.sepSemicolon')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="csv-separator" value="SeparatorTab">
                <span>${t('export.sepTab')}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="csv-separator" value="SeparatorSpace">
                <span>${t('export.sepSpace')}</span>
              </label>
            </div>
          </div>

          <!-- Table Layout -->
          <div class="form-group">
            <label class="form-label">${t('export.layout')}</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="table-layout" value="as-shown" checked>
                <span>${tpl('export.layoutAsShown', escapeHtml(layout.columns.join(', ') || 'ingen'))}</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="table-layout" value="pivot-friendly">
                <span>${t('export.layoutPivot')}</span>
              </label>
            </div>
          </div>

          <!-- Include Title -->
          <div class="form-group">
            <label class="checkbox-option">
              <input type="checkbox" id="include-title" checked>
              <span>${t('export.includeTitle')}</span>
            </label>
          </div>

          <!-- Export Info -->
          <div class="export-info">
            <p>${tpl('export.downloadInfo', AppConfig.source?.name || 'API')}</p>
            <p>${tpl('export.dataPoints', escapeHtml(currentData.value.length.toLocaleString('nb-NO')))}</p>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary" id="export-cancel-btn">${t('export.cancel')}</button>
          <button class="btn-primary" id="export-download-btn">${t('export.download')}</button>
        </div>
      </div>
    </div>
  `;

  // Add dialog to page
  document.body.insertAdjacentHTML('beforeend', dialogHtml);

  // Set up event listeners
  setupExportDialogEvents();
}

/**
 * Set up event listeners for export dialog
 */
function setupExportDialogEvents() {
  const dialog = document.getElementById('export-dialog');
  if (!dialog) return;

  // Close buttons
  const closeBtn = document.getElementById('export-dialog-close');
  const cancelBtn = document.getElementById('export-cancel-btn');

  const closeDialog = () => { dialog.remove(); removeEscape(); };
  const removeEscape = addEscapeHandler(closeDialog);

  if (closeBtn) closeBtn.addEventListener('click', closeDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', closeDialog);

  // Click outside to close
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      closeDialog();
    }
  });

  // Format change: show/hide CSV separator options
  const formatRadios = dialog.querySelectorAll('input[name="export-format"]');
  const csvSeparatorGroup = document.getElementById('csv-separator-group');

  formatRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (csvSeparatorGroup) {
        csvSeparatorGroup.style.display = radio.value === 'csv' ? 'block' : 'none';
      }
    });
  });

  // Download button
  const downloadBtn = document.getElementById('export-download-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault(); // Prevent any default action
      logger.log('[Export] Download button clicked');

      try {
        // Read options BEFORE closing dialog
        await executeExport();
        closeDialog();
      } catch (error) {
        logger.error('[Export] Download button handler error:', error);
        closeDialog();
        showError(t('error.downloadFailed'), error);
      }
    });
  }
}

/**
 * Execute the export with selected options
 */
async function executeExport() {
  logger.log('[Export] Executing export');

  const dialog = document.getElementById('export-dialog');
  if (!dialog) return;

  // Get selected options
  const format = dialog.querySelector('input[name="export-format"]:checked')?.value || 'xlsx';
  const displayFormat = dialog.querySelector('input[name="display-format"]:checked')?.value ?? '';
  const csvSeparator = dialog.querySelector('input[name="csv-separator"]:checked')?.value || 'SeparatorSemicolon';
  const layout = dialog.querySelector('input[name="table-layout"]:checked')?.value || 'as-shown';
  const includeTitle = document.getElementById('include-title')?.checked || false;

  // Build format parameters
  const formatParams = [];
  if (displayFormat) {
    formatParams.push(displayFormat);
  }

  if (includeTitle) {
    formatParams.push('IncludeTitle');
  }

  // Add CSV separator if CSV format
  if (format === 'csv') {
    formatParams.push(csvSeparator);
  }

  // Determine stub and heading based on layout choice
  let stub, heading;
  const currentLayout = AppState.tableLayout;

  if (layout === 'pivot-friendly') {
    // All dimensions in stub for pivot-friendly export
    stub = currentData.id;
    heading = [];
  } else {
    // Use current layout (as shown on screen)
    stub = currentLayout.rows;
    heading = currentLayout.columns;
  }

  // Get the variable selection used to fetch this data
  const valueCodes = AppState.variableSelection;

  // Trigger download via API (with loading indicator)
  try {
    showLoading(true, t('loading.file'));
    await api.downloadTableData(AppState.selectedTable.id, valueCodes, {
      format: format,
      stub: stub,
      heading: heading,
      formatParams: formatParams,
      lang: getCurrentApiLang(),
      codelistIds: AppState.activeCodelistIds
    });
    showLoading(false);
    logger.log('[Export] Export completed successfully');
  } catch (error) {
    showLoading(false);
    logger.error('[Export] Export failed:', error);
    showError(t('error.downloadFailed2'), error);
  }
}

/**
 * Quick export: download as xlsx using default settings (as shown on screen)
 */
async function quickExportXlsx() {
  if (!currentData || !AppState.tableLayout) {
    showError(t('error.noDataExport'));
    return;
  }

  const layout = AppState.tableLayout;
  const valueCodes = AppState.variableSelection;

  try {
    showLoading(true, t('loading.file'));
    await api.downloadTableData(AppState.selectedTable.id, valueCodes, {
      format: 'xlsx',
      stub: layout.rows,
      heading: layout.columns,
      formatParams: ['IncludeTitle'],
      lang: getCurrentApiLang(),
      codelistIds: AppState.activeCodelistIds
    });
    showLoading(false);
  } catch (error) {
    showLoading(false);
    logger.error('[Export] Quick export failed:', error);
    showError(t('error.downloadFailed2'), error);
  }
}

/**
 * Legacy export functions for backwards compatibility
 * These now open the export dialog instead
 */
function exportToCsv() {
  showExportDialog();
}

function exportToExcel() {
  showExportDialog();
}
