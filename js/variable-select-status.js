/**
 * Variable Selection — Visual State, Selection Status & Validation
 *
 * Handles visual feedback for selection modes (star/top/specific),
 * per-card value counters, overall selection status bar, cell count
 * estimation, the getVariableSelection() query builder, and validation.
 */

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
