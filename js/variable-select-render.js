/**
 * Variable Selection — Variable Card Rendering
 *
 * Renders dimension cards with value lists, handles display ordering
 * (heading/stub convention), auto-selects single-value mandatory dimensions,
 * and restores previous selections when navigating back from the table view.
 */

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
