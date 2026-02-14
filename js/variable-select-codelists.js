/**
 * Variable Selection — Codelist Support
 *
 * Handles alternative value groupings (codelists) for dimensions:
 * fetching, applying, and removing codelists; rendering codelist values;
 * and wiring up the codelist dropdown event listeners.
 */

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
