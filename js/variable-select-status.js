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
  card.querySelectorAll('.select-all-btn, .select-top-btn').forEach(btn => {
    btn.classList.remove('btn-active');
  });

  if (mode === 'star') {
    card.querySelector('.select-all-btn')?.classList.add('btn-active');
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
    selectedCount.textContent = t('status.all');
  } else if (mode === 'top') {
    const topN = card.querySelector('.top-n-input')?.value || '10';
    selectedCount.textContent = tpl('status.topMode', topN);
  } else {
    const count = container.querySelectorAll('.value-list-item.selected').length;
    selectedCount.textContent = count;
  }
}

// ============================================================
// Cross-filtering (generic, source-agnostic)
// ============================================================
//
// When the metadata carries extension.validKeys — a compact enumeration of the
// dimension-value combinations that actually have data (currently produced by the
// Norges Bank adapter from a serieskeysonly probe) — the selection UI cross-filters:
// values that cannot produce any data given the other dimensions' selections are
// muted + made non-selectable (and auto-deselected if they were selected). A live
// counter shows how many series match the current selection.
//
// validKeys format: { dims: ['FREQ','BASE_CUR','QUOTE_CUR','TENOR'],
//                     keys: ['B.USD.NOK.SP', 'A.EUR.NOK.SP', ...] }  (codes, '.'-joined,
// segment order matches dims). Absent for SSB/FHI → every function here is a no-op.

/** Return the validKeys spec if present and non-empty, else null. */
function getValidKeys() {
  const vk = tableMetadata && tableMetadata.extension && tableMetadata.extension.validKeys;
  if (!vk || !Array.isArray(vk.dims) || !Array.isArray(vk.keys) || vk.keys.length === 0) return null;
  return vk;
}

/** Lazily parse keys into per-dimension code segment arrays (cached on the spec). */
function getParsedValidKeys(vk) {
  if (!vk._parsed) vk._parsed = vk.keys.map(k => k.split('.'));
  return vk._parsed;
}

/**
 * Read the current per-dimension constraint from the DOM for cross-filtering.
 * Returns { dimId: Set<code> | null } where null = no constraint (star/top mode
 * or empty specific selection — a value that constrains nothing).
 */
function readCrossFilterConstraints(vk) {
  const constraints = {};
  vk.dims.forEach(dimId => {
    const card = document.querySelector('.variable-card[data-dimension="' + dimId + '"]');
    const container = card && card.querySelector('.value-list-container');
    if (!container || container.dataset.mode !== 'specific') { constraints[dimId] = null; return; }
    const sel = Array.from(container.querySelectorAll('.value-list-item.selected'))
      .map(it => it.dataset.code);
    constraints[dimId] = sel.length ? new Set(sel) : null;
  });
  return constraints;
}

/**
 * Standard cross-filter: for each dimension D, a value v is enabled iff some valid
 * key has v in D AND matches every OTHER dimension's non-empty selection.
 */
function computeCrossFilterEnabled(vk, constraints) {
  const dims = vk.dims;
  const parsed = getParsedValidKeys(vk);
  const enabled = {};
  dims.forEach(d => { enabled[d] = new Set(); });

  parsed.forEach(seg => {
    for (let di = 0; di < dims.length; di++) {
      let ok = true;
      for (let oi = 0; oi < dims.length; oi++) {
        if (oi === di) continue;
        const c = constraints[dims[oi]];
        if (c && !c.has(seg[oi])) { ok = false; break; }
      }
      if (ok) enabled[dims[di]].add(seg[di]);
    }
  });
  return enabled;
}

/**
 * Er én eller flere av validKeys-dimensjonene i spesifikt utvalg med NULL
 * valgte verdier, og dimensjonen er obligatorisk (ikke elimination)? Da har
 * brukeren ikke fullført utvalget ennå — readCrossFilterConstraints()
 * behandler et slikt tomt utvalg som «ingen begrensning» (nødvendig for at
 * kryssfiltreringen av verdilister i ANDRE dimensjoner skal fungere som før),
 * men det gjør countCrossFilterMatches() sitt treffantall optimistisk/
 * villedende — samtidig som validateSelection() sperrer Hent-knappen for
 * nøyaktig denne dimensjonen. Brukes til å vise en nøytral tellertekst i
 * stedet for et (feilaktig komplett) antall.
 */
function hasPendingMandatorySelection(vk) {
  return vk.dims.some(dimId => {
    const card = document.querySelector('.variable-card[data-dimension="' + dimId + '"]');
    const container = card && card.querySelector('.value-list-container');
    if (!container || container.dataset.mode !== 'specific') return false;
    if (card.dataset.elimination === 'true') return false; // valgfri — tomt utvalg er en gyldig sluttilstand
    return container.querySelectorAll('.value-list-item.selected').length === 0;
  });
}

/** Count valid keys matching every dimension's current constraint. */
function countCrossFilterMatches(vk, constraints) {
  const dims = vk.dims;
  const parsed = getParsedValidKeys(vk);
  let n = 0;
  parsed.forEach(seg => {
    for (let i = 0; i < dims.length; i++) {
      const c = constraints[dims[i]];
      if (c && !c.has(seg[i])) return;
    }
    n++;
  });
  return n;
}

/**
 * Apply cross-filtering to the DOM: mute + disable values incompatible with the
 * current selection in other dimensions, auto-deselecting any that were selected.
 * Returns { matchCount } for the status counter, or null when no validKeys (no-op).
 */
function applyCrossFilter() {
  const vk = getValidKeys();
  if (!vk) return null;

  const constraints = readCrossFilterConstraints(vk);
  const enabled = computeCrossFilterEnabled(vk, constraints);

  vk.dims.forEach(dimId => {
    const card = document.querySelector('.variable-card[data-dimension="' + dimId + '"]');
    const container = card && card.querySelector('.value-list-container');
    if (!container) return;
    const en = enabled[dimId];
    container.querySelectorAll('.value-list-item').forEach(item => {
      if (en.has(item.dataset.code)) {
        item.classList.remove('value-disabled');
        item.removeAttribute('aria-disabled');
      } else {
        item.classList.add('value-disabled');
        item.setAttribute('aria-disabled', 'true');
        item.classList.remove('selected'); // auto-deselect incompatible value
      }
    });
    if (card) updateValueCounter(card);
  });

  // Re-read after auto-deselection so the counter reflects the effective selection.
  return {
    matchCount: countCrossFilterMatches(vk, readCrossFilterConstraints(vk)),
    // Se hasPendingMandatorySelection(): sant når treffantallet over er
    // optimistisk fordi minst én obligatorisk dimensjon ennå ikke har noe
    // spesifikt utvalg — telleren skal da vise en nøytral melding, ikke tallet.
    pending: hasPendingMandatorySelection(vk)
  };
}

// ============================================================
// Selection status and validation
// ============================================================

/**
 * Set the left-border status class on a variable card and toggle badge visibility.
 * @param {HTMLElement} card - The .variable-card element
 * @param {'valid'|'invalid'|'optional'} status
 */
function setCardStatus(card, status) {
  card.classList.remove('card-status-invalid', 'card-status-valid', 'card-status-optional');
  card.classList.add('card-status-' + status);
  const badge = card.querySelector('.variable-badge');
  if (badge) badge.classList.toggle('badge-hidden', status === 'valid');
}

/**
 * Update selection status and enable/disable fetch button.
 * Also updates per-card summaries and the API query preview.
 */
function updateSelectionStatus() {
  // Cross-filter first (may auto-deselect incompatible values) so the selection
  // read below already reflects the muted state. No-op without extension.validKeys.
  const crossFilter = applyCrossFilter();

  const selection = getVariableSelection();
  const statusElement = document.getElementById('selection-status');
  const fetchButton = document.getElementById('fetch-data-btn');

  if (!selection || !statusElement || !fetchButton) return;

  const isValid = validateSelection(selection);

  if (isValid) {
    statusElement.textContent = t('status.ready');
    statusElement.className = 'selection-status-valid';
    fetchButton.disabled = false;
  } else {
    statusElement.textContent = t('status.selectRequired');
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
        summary.textContent = t('status.noValuesOpt');
        summary.className = 'variable-selection-summary summary-optional';
        setCardStatus(card, 'optional');
      } else {
        summary.textContent = t('status.noValues');
        summary.className = 'variable-selection-summary summary-invalid';
        setCardStatus(card, 'invalid');
      }
      updateValueCounter(card);
      return;
    }

    if (Array.isArray(dimSelection)) {
      const count = dimSelection.length;
      summary.textContent = count + ' ' + (count === 1 ? t('unit.value.one') : t('unit.value.many')) + ' valgt';
      summary.className = 'variable-selection-summary summary-valid';
    } else if (dimSelection === '*') {
      summary.textContent = t('status.allSelected');
      summary.className = 'variable-selection-summary summary-valid';
    } else if (typeof dimSelection === 'string' && dimSelection.startsWith('top(')) {
      summary.textContent = dimSelection;
      summary.className = 'variable-selection-summary summary-valid';
    }

    setCardStatus(card, 'valid');
    updateValueCounter(card);
  });

  // Update the live API query preview and cell count
  updateQueryPreview();
  const cellCount = updateSelectionCellCount();

  // Disable fetch button if cell count exceeds API limit (800,000)
  if (isValid && cellCount > AppConfig.limits.maxCells) {
    statusElement.textContent = t('status.tooManyCells');
    statusElement.className = 'selection-status-invalid';
    fetchButton.disabled = true;
  }

  // Cross-filter series counter + N=0 guard (only when validKeys present).
  const seriesMatchEl = document.getElementById('series-match-display');
  if (crossFilter) {
    if (seriesMatchEl) {
      if (crossFilter.pending) {
        // Minst én obligatorisk dimensjon mangler ennå spesifikt utvalg —
        // matchCount er optimistisk (se hasPendingMandatorySelection), så vis
        // en nøytral melding i stedet for et (feilaktig komplett) antall.
        // Samsvarer med validateSelection() som sperrer Hent-knappen her.
        seriesMatchEl.textContent = t('status.seriesMatchPending');
        seriesMatchEl.style.color = '';
      } else if (crossFilter.matchCount > 0) {
        seriesMatchEl.textContent = tpl('status.seriesMatch', crossFilter.matchCount.toLocaleString('nb-NO'));
        seriesMatchEl.style.color = '';
      } else {
        seriesMatchEl.textContent = t('status.noSeriesMatch');
        seriesMatchEl.style.color = 'var(--color-error)';
      }
    }
    // Should not normally happen (disabling prevents empty combos), but guard anyway.
    // Kun relevant når utvalget faktisk er komplett (!pending) — ellers er
    // matchCount===0 en forventet mellomtilstand som validateSelection() (og
    // "Velg verdier"-meldingen over) allerede dekker.
    if (!crossFilter.pending && crossFilter.matchCount === 0) {
      statusElement.textContent = t('status.noSeriesMatch');
      statusElement.className = 'selection-status-invalid';
      fetchButton.disabled = true;
    }
  } else if (seriesMatchEl) {
    seriesMatchEl.textContent = '';
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
      const topN = parseInt(card.querySelector('.top-n-input')?.value || '10', 10);
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
  cellCountEl.textContent = tpl('status.cellsSelected', formatted, t('unit.cell.many'), maxFormatted);

  // Warn if approaching API cell limit
  const apiMaxCells = AppConfig.limits.maxCells;
  const apiWarningThreshold = AppConfig.limits.cellWarningThreshold;
  if (selectedCells > apiMaxCells) {
    cellCountEl.style.color = 'var(--color-error)';
    cellCountEl.textContent += ' ' + t('status.exceedsLimit');
  } else if (selectedCells > apiWarningThreshold) {
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
      if (codelistInfo && codelistInfo.isAggregated) {
        // Aggregated (agg_) codelist: send all codelist codes as-is.
        // The API resolves them using the codelist ID in the POST body.
        selection[dimCode] = codelistInfo.values.map(v => v.code);
      } else if (codelistInfo) {
        // Filter (vs_) codelist: send all original codes explicitly.
        // (* would select the full dimension, not just the codelist subset.)
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

      // If a filter (vs_) codelist is active, expand via valueMap to get original
      // dimension codes. For filter codelists valueMap[0] === code, so this is
      // effectively a no-op, but keeps the logic consistent.
      // Aggregated (agg_) codelists: keep the aggregate codes as-is — the API
      // resolves them using the codelist ID in the POST body.
      const codelistInfo = activeCodelists[dimCode];
      if (codelistInfo && !codelistInfo.isAggregated) {
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
