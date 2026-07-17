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
/**
 * Pick the most recent (highest-sorted) value code from a time dimension to use
 * as a format example in the placeholder, e.g. "2024M06" or "2024K2".
 * Returns null if no values are found.
 */
function _sampleTimeFormat(dimension) {
  const codes = dimension?.category?.index ? Object.keys(dimension.category.index) : [];
  if (codes.length === 0) return null;
  return codes.sort().slice(-1)[0];
}

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

  // Role lookup from metadata: role.time/geo/metric → which dimensions play these roles.
  // Used to label variable cards with semantic badges ("Tid", "Geografi", "Mål").
  const roleByDim = {};
  const roles = tableMetadata.role || {};
  (roles.time || []).forEach(d => { roleByDim[d] = 'time'; });
  (roles.geo || []).forEach(d => { roleByDim[d] = 'geo'; });
  (roles.metric || []).forEach(d => { roleByDim[d] = 'metric'; });

  dimensions.forEach(dimCode => {
    const dimension = tableMetadata.dimension[dimCode];
    if (!dimension) return;

    const values = dimension.category.label;
    const valueCount = Object.keys(values).length;
    const role = roleByDim[dimCode] || null;
    const isTimeDim = role === 'time' || dimCode === 'Tid' || dimCode.toLowerCase().includes('tid');
    const roleBadgeHtml = role
      ? '<span class="variable-role-badge role-' + role + '">' + t('variable.role.' + role) + '</span>'
      : '';

    // Elimination: can this dimension be omitted from the query?
    const elimination = dimension.extension?.elimination === true;

    // Single-select: values are mutually exclusive (e.g. Norges Bank FREQ —
    // mixing frequencies gives a near-empty cross matrix). Radio-style
    // selection is enforced in variable-select-events.js via the card attribute.
    const singleSelect = dimension.extension?.singleSelect === true;

    // Interval time picker (Norges Bank): the SDMX API is interval-based
    // (startPeriod/endPeriod/lastNObservations), so the adapter marks the time
    // dimension with extension.intervalPicker and the card renders a
    // Siste N / Fra–til / Hele historikken picker instead of a value list.
    if (dimension.extension?.intervalPicker === true) {
      html += renderTimePickerCard(dimCode, dimension, roleBadgeHtml);
      return;
    }

    // Small single-select dimensions (Norges Bank FREQ) render as a radio
    // pill row — mutual exclusivity is then inherent in the control instead of
    // being enforced as list-interaction rules. Large singleSelect dimensions
    // fall back to the value list with radio behaviour.
    if (singleSelect && valueCount <= 12) {
      html += renderPillGroupCard(dimCode, dimension, roleBadgeHtml, elimination, valueCount);
      return;
    }

    // Codelists: alternative value groupings for this dimension
    const codelists = dimension.extension?.codelists || [];
    const hasCodelists = codelists.length > 0;
    const sortedCodelists = hasCodelists ? sortCodelistOptions(codelists) : [];

    html += `
      <div class="variable-card" data-dimension="${escapeHtml(dimCode)}" data-elimination="${elimination}" data-singleselect="${singleSelect}">
        <div class="variable-header">
          <h3 class="variable-name">${escapeHtml(dimension.label || dimCode)}</h3>
          ${roleBadgeHtml}
          <span class="variable-badge ${elimination ? 'badge-optional' : 'badge-required'}">
            ${elimination ? t('variable.optional') : t('variable.required')}
          </span>
          <span class="variable-info">${valueCount} ${t('unit.value.many')}</span>
        </div>

        <div class="variable-controls">
          ${hasCodelists ? `
            <div class="codelist-selector">
              <label class="codelist-label">${t('variable.categorization')}</label>
              <select class="codelist-dropdown" data-dimension="${escapeHtml(dimCode)}">
                ${sortedCodelists.map(cl =>
                  '<option value="' + escapeHtml(cl.id) + '">' + escapeHtml(cl.label) + '</option>'
                ).join('')}
                <option value="" selected>${t('variable.freeChoice')}</option>
              </select>
            </div>
          ` : ''}

          <div class="control-row">
            ${singleSelect ? '' : `<button class="btn-secondary btn-sm select-all-btn">${t('variable.btn.selectAll')}</button>`}
            <button class="btn-secondary btn-sm select-none-btn">${t('variable.btn.deselectAll')}</button>
            ${isTimeDim ? `
              <span class="top-n-group">
                <button class="btn-secondary btn-sm select-top-btn">${t('variable.btn.last')}</button>
                <input type="number" class="top-n-input" value="10" min="1" max="${valueCount}">
                <span class="top-n-label">${t('unit.value.many')}</span>
              </span>
            ` : ''}
          </div>

          <div class="value-filter-container value-filter-wrapper">
            <input type="text" class="value-filter-input" placeholder="${
              isTimeDim ? escapeHtml(tpl('variable.timeFormatHint', _sampleTimeFormat(dimension) || '')) || t('variable.filterPlaceholder')
                        : t('variable.filterPlaceholder')
            }">
          </div>

          <div class="value-counter">
            ${t('variable.selected')} <span class="selected-count">0</span> ${t('variable.ofTotal')} <span class="total-count">${valueCount}</span>
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
 * Render the interval-based time picker card (dimensions flagged with
 * extension.intervalPicker — Norges Bank's TIME_PERIOD). Three pill modes
 * matching the SDMX API's real semantics:
 *   «Siste N»          → top(N)          → lastNObservations=N
 *   «Fra–til»          → range(from,to)  → startPeriod/endPeriod
 *   «Hele historikken» → '*'             → no period params
 * Defaults to Siste 10 so the time dimension never blocks «Hent data».
 * The from/til inputs are rendered lazily by syncTimePicker()
 * (variable-select-status.js) since their granularity follows the selected
 * frequency (B → date, M → month, Q → year+quarter, A → year).
 */
function renderTimePickerCard(dimCode, dimension, roleBadgeHtml) {
  const name = escapeHtml(dimension.label || dimCode);
  return `
    <div class="variable-card" data-dimension="${escapeHtml(dimCode)}" data-elimination="false"
         data-singleselect="false" data-time-picker="interval" data-picker-mode="top">
      <div class="variable-header">
        <h3 class="variable-name">${name}</h3>
        ${roleBadgeHtml}
        <span class="variable-badge badge-required">${t('variable.required')}</span>
      </div>

      <div class="variable-controls">
        <div class="api-pill-group tp-modes" role="radiogroup" aria-label="${name}">
          <label class="api-pill"><input type="radio" name="tp-mode-${escapeHtml(dimCode)}" value="top" checked><span>${t('variable.btn.last')} N</span></label>
          <label class="api-pill"><input type="radio" name="tp-mode-${escapeHtml(dimCode)}" value="range"><span>${t('variable.timePicker.range')}</span></label>
          <label class="api-pill"><input type="radio" name="tp-mode-${escapeHtml(dimCode)}" value="star"><span>${t('variable.timePicker.all')}</span></label>
        </div>

        <div class="tp-pane tp-pane-top">
          <label class="tp-label">${t('variable.btn.last')}</label>
          <input type="number" class="top-n-input" value="10" min="1">
          <span class="top-n-label">${t('unit.value.many')}</span>
        </div>

        <div class="tp-pane tp-pane-range" hidden>
          <div class="tp-range-inputs"></div>
        </div>

        <div class="tp-pane tp-pane-star" hidden>
          <p class="tp-hint">${t('variable.timePicker.allHint')}</p>
        </div>
      </div>

      <div class="variable-selection-summary"></div>
    </div>
  `;
}

/**
 * Render a small single-select dimension (e.g. Norges Bank FREQ) as a radio
 * pill row. Emits the same selection shape as a one-item list selection
 * (array of one code) via the pill branch in getVariableSelection().
 */
function renderPillGroupCard(dimCode, dimension, roleBadgeHtml, elimination, valueCount) {
  const name = escapeHtml(dimension.label || dimCode);
  const labels = dimension.category.label;
  const index = dimension.category.index || {};
  const codes = Object.keys(labels).sort((a, b) => (index[a] ?? 0) - (index[b] ?? 0));

  const pills = codes.map(code =>
    `<label class="api-pill"><input type="radio" name="dim-${escapeHtml(dimCode)}" value="${escapeHtml(code)}"><span>${escapeHtml(labels[code] || code)}</span></label>`
  ).join('');

  return `
    <div class="variable-card" data-dimension="${escapeHtml(dimCode)}" data-elimination="${elimination}"
         data-singleselect="true" data-pill-group="true">
      <div class="variable-header">
        <h3 class="variable-name">${name}</h3>
        ${roleBadgeHtml}
        <span class="variable-badge ${elimination ? 'badge-optional' : 'badge-required'}">
          ${elimination ? t('variable.optional') : t('variable.required')}
        </span>
        <span class="variable-info">${valueCount} ${t('unit.value.many')}</span>
      </div>

      <div class="variable-controls">
        <div class="api-pill-group dim-pill-group" role="radiogroup" aria-label="${name}">
          ${pills}
        </div>
      </div>

      <div class="variable-selection-summary"></div>
    </div>
  `;
}

/**
 * Render the from/til inputs for a granularity. Native input types map 1:1 to
 * the SDMX period formats: date → 'YYYY-MM-DD', month → 'YYYY-MM',
 * year (number) → 'YYYY'; quarter needs a year input + Q1–Q4 select.
 * bounds {min,max} become min/max attributes where known.
 */
function renderPeriodInputsHtml(gran, bounds, fromVal, toVal) {
  const b = bounds || {};

  const sideHtml = (side, val) => {
    if (gran === 'quarter') {
      const y = val ? val.slice(0, 4) : '';
      const q = val && /Q[1-4]$/.test(val) ? val.slice(-2) : '';
      const yMin = b.min ? b.min.slice(0, 4) : '';
      const yMax = b.max ? b.max.slice(0, 4) : '';
      const options = ['', 'Q1', 'Q2', 'Q3', 'Q4'].map(o =>
        `<option value="${o}"${o === q ? ' selected' : ''}>${o || '–'}</option>`
      ).join('');
      return `<input type="number" class="tp-${side}-year"` +
        (yMin ? ` min="${escapeHtml(yMin)}" placeholder="${escapeHtml(yMin)}"` : '') +
        (yMax ? ` max="${escapeHtml(yMax)}"` : '') +
        ` value="${escapeHtml(y)}">` +
        `<select class="tp-${side}-q" aria-label="${t('variable.timePicker.quarterLabel')}">${options}</select>`;
    }
    const type = gran === 'day' ? 'date' : (gran === 'month' ? 'month' : 'number');
    const min = b.min ? (gran === 'year' ? b.min.slice(0, 4) : b.min) : '';
    const max = b.max ? (gran === 'year' ? b.max.slice(0, 4) : b.max) : '';
    return `<input type="${type}" class="tp-${side}"` +
      (min ? ` min="${escapeHtml(min)}"` : '') +
      (max ? ` max="${escapeHtml(max)}"` : '') +
      (gran === 'year' && min ? ` placeholder="${escapeHtml(min)}"` : '') +
      ` value="${escapeHtml(val || '')}">`;
  };

  return `<label class="tp-label">${t('variable.timePicker.from')}</label>${sideHtml('from', fromVal)}` +
         `<label class="tp-label">${t('variable.timePicker.to')}</label>${sideHtml('to', toVal)}`;
}

/** Show the pane matching card.dataset.pickerMode, hide the others. */
function toggleTimePickerPanes(card) {
  const mode = card.dataset.pickerMode || 'top';
  card.querySelector('.tp-pane-top')?.toggleAttribute('hidden', mode !== 'top');
  card.querySelector('.tp-pane-range')?.toggleAttribute('hidden', mode !== 'range');
  card.querySelector('.tp-pane-star')?.toggleAttribute('hidden', mode !== 'star');
}

/**
 * Restore a saved selection onto an interval time picker card.
 * Handles '*', 'top(N)', 'range(from,to)' and — for legacy deep links created
 * by the old value-list UI — explicit code arrays, which collapse to a
 * contiguous range(min,max) (the adapter fetched min..max as an interval for
 * arrays anyway; only the client-side subset filter is lost).
 */
function restoreTimePickerSelection(card, dimSelection) {
  if (!dimSelection) return; // keep the Siste 10 default

  const P = window.SdmxToJsonStat;
  let mode = null, topN = null, from = '', to = '';

  if (dimSelection === '*') {
    mode = 'star';
  } else if (typeof dimSelection === 'string' && dimSelection.startsWith('top(')) {
    mode = 'top';
    topN = dimSelection.match(/\d+/)?.[0] || '10';
  } else if (typeof dimSelection === 'string' && P?.parsePeriodRange(dimSelection)) {
    const r = P.parsePeriodRange(dimSelection);
    mode = 'range';
    from = r.from;
    to = r.to;
  } else if (Array.isArray(dimSelection) && dimSelection.length > 0) {
    const sorted = dimSelection.map(String).slice().sort();
    mode = 'range';
    from = sorted[0];
    to = sorted[sorted.length - 1];
  }
  if (!mode) return;

  card.dataset.pickerMode = mode;
  card.querySelectorAll('.tp-modes input[type="radio"]').forEach(r => {
    r.checked = (r.value === mode);
  });
  toggleTimePickerPanes(card);

  if (mode === 'top' && topN) {
    const input = card.querySelector('.top-n-input');
    if (input) input.value = topN;
  }
  if (mode === 'range' && (from || to)) {
    // Render the inputs now at the granularity the saved codes dictate, so the
    // values can be set; syncTimePicker() leaves matching granularity alone.
    const gran = P?.periodCodeGranularity(from || to) || 'day';
    const wrap = card.querySelector('.tp-range-inputs');
    if (wrap) {
      wrap.innerHTML = renderPeriodInputsHtml(gran, timePickerBounds(card, gran, null), from, to);
      card.dataset.pickerGran = gran;
    }
  }
}

/**
 * Auto-select any non-time dimension that has exactly one value and no existing
 * selection, so users aren't forced to click through degenerate choices.
 *
 * Applies to both mandatory (e.g. "Personer") and optional single-value dimensions,
 * and to foreign sources with degenerate dimensions (Norges Bank QUOTE_CUR=NOK,
 * TENOR=SP; single-value FHI dims).
 *
 * Must not fight restoreSelections()/URL state: a dimension already present in
 * AppState.variableSelection, already in a non-specific mode, or already holding a
 * selected value is left untouched.
 */
function autoSelectSingleValueDimensions() {
  logger.log('[VariableSelect] Checking for single-value dimensions to auto-select');

  const savedSelection = AppState.variableSelection || {};

  // Time dimensions are excluded — a lone period is left to the user (Siste N etc.).
  const timeDims = new Set((tableMetadata.role && tableMetadata.role.time) || []);

  let didAutoSelect = false;

  document.querySelectorAll('.variable-card').forEach(card => {
    const dimCode = card.dataset.dimension;

    // Radio pill dimensions (e.g. Norges Bank FREQ): auto-check the pill when
    // there is exactly one option — common for the NB core flows, where only
    // one frequency actually has data, and required for the time picker to
    // know its input granularity without a user click.
    if (card.dataset.pillGroup === 'true') {
      if (savedSelection[dimCode] !== undefined) return;
      const radios = card.querySelectorAll('.dim-pill-group input[type="radio"]');
      if (radios.length === 1 && !card.querySelector('.dim-pill-group input:checked')) {
        radios[0].checked = true;
        didAutoSelect = true;
      }
      return;
    }

    const container = card.querySelector('.value-list-container');
    if (!container) return;

    // Respect URL/restore state and any existing selection.
    if (savedSelection[dimCode] !== undefined) return;
    if (container.dataset.mode !== 'specific') return;
    if (container.querySelector('.value-list-item.selected')) return;

    // Skip time dimensions.
    if (timeDims.has(dimCode) || dimCode === 'Tid' || dimCode.toLowerCase().includes('tid')) return;

    const allItems = container.querySelectorAll('.value-list-item');
    if (allItems.length === 1) {
      const dimension = tableMetadata.dimension[dimCode];
      const dimLabel = dimension ? dimension.label : dimCode;
      logger.log('[VariableSelect] Auto-selecting single value for dimension "' + dimLabel + '"');

      container.dataset.mode = 'specific';
      allItems[0].classList.add('selected');
      updateModeVisuals(card);
      updateValueCounter(card);
      didAutoSelect = true;
    }
  });

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
            () => api.getCodeList(savedCodelistId, true, getCurrentApiLang()),
            t('codelist.error')
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

    // Interval time picker card: token-based restore (no value list to mark).
    if (card.dataset.timePicker === 'interval') {
      restoreTimePickerSelection(card, savedSelection[dimCode]);
      return;
    }

    // Radio pill card: check the pill matching the saved (single) code.
    if (card.dataset.pillGroup === 'true') {
      const sel = savedSelection[dimCode];
      const code = Array.isArray(sel) && sel.length > 0 ? String(sel[0]) : null;
      if (code !== null) {
        card.querySelectorAll('.dim-pill-group input[type="radio"]').forEach(r => {
          r.checked = (r.value === code);
        });
      }
      return;
    }

    const container = card.querySelector('.value-list-container');
    if (!container) return;

    let dimSelection = savedSelection[dimCode];

    if (!dimSelection) {
      // No saved selection for this dimension (was eliminated or not selected)
      return;
    }

    // Single-select dimensions (e.g. Norges Bank FREQ): only one specific code
    // is meaningful — trim multi-code URL/back-navigation state to the first
    // code, and ignore star/top modes entirely (they imply multiple values).
    if (card.dataset.singleselect === 'true') {
      if (!Array.isArray(dimSelection)) {
        updateValueCounter(card);
        return;
      }
      dimSelection = dimSelection.slice(0, 1);
    }

    if (dimSelection === '*') {
      // Star mode: set mode and update visuals
      container.dataset.mode = 'star';
      updateModeVisuals(card);
    } else if (typeof dimSelection === 'string' && dimSelection.startsWith('top(')) {
      // Top mode: set mode and restore the N value
      container.dataset.mode = 'top';
      const n = dimSelection.match(/\d+/)?.[0] || '10';
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
    html += `<div class="truncate-notice">${tpl('variable.truncated', maxDisplay, codes.length)}</div>`;
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
