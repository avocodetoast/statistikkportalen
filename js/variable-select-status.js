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
  if (!container) return; // pill/picker cards have no value list — pills' :checked CSS handles visuals
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
// Radio pill dimensions + interval time picker (helpers)
// ============================================================
//
// Two alternative card representations exist besides the classic value list:
//   - data-pill-group="true"       — small singleSelect dims rendered as radio
//                                    pills (NB FREQ); selection = checked radio.
//   - data-time-picker="interval"  — interval-based time dims (NB TIME_PERIOD,
//                                    extension.intervalPicker); selection is a
//                                    token: 'top(N)' | 'range(from,to)' | '*'.
// The helpers below let cross-filtering/status/counting read all three
// representations without touching the value-list code paths (SSB/FHI).

/** Checked radio codes for a pill card (0 or 1 entries). */
function getPillSelectedCodes(card) {
  return Array.from(
    card.querySelectorAll('.dim-pill-group input[type="radio"]:checked')
  ).map(r => r.value);
}

/**
 * Read one side ('from'/'to') of the interval picker as an SDMX period code
 * at the card's current granularity. Quarter granularity combines the year
 * input with the Q-select (missing quarter defaults to Q1/Q4 so a bare year
 * still forms a sensible bound). Empty/invalid input → '' (open end).
 */
function readPeriodSide(card, side) {
  const gran = card.dataset.pickerGran || 'day';
  if (gran === 'quarter') {
    const y = (card.querySelector('.tp-' + side + '-year')?.value || '').trim();
    if (!/^\d{4}$/.test(y)) return '';
    const q = card.querySelector('.tp-' + side + '-q')?.value || '';
    return y + '-' + (q || (side === 'from' ? 'Q1' : 'Q4'));
  }
  const v = (card.querySelector('.tp-' + side)?.value || '').trim();
  if (!v) return '';
  if (gran === 'year') return /^\d{4}$/.test(v) ? v : '';
  return v; // date/month inputs guarantee the SDMX format
}

/** Current picker selection as an API token ('top(N)' | 'range(f,t)' | '*'). */
function readTimePickerToken(card) {
  const mode = card.dataset.pickerMode || 'range';
  if (mode === 'star') return '*';
  if (mode === 'range') {
    return window.SdmxToJsonStat.formatPeriodRange(
      readPeriodSide(card, 'from'), readPeriodSide(card, 'to'));
  }
  const n = parseInt(card.querySelector('.top-n-input')?.value, 10);
  return 'top(' + (n > 0 ? n : 10) + ')';
}

/**
 * min/max bounds for the picker inputs at a granularity. Both sides prefer the
 * EXACT first/last observation from the catalogue probe (timeBounds.firstCode/
 * lastCode, converted to the current granularity) and fall back to the
 * catalogue year's first/last period. The max additionally prefers the newest
 * probed period code for the selected frequency, which is exact per frequency.
 * Either side may be '' (no bound).
 *
 * These are also the values ensureRangeDefaults() pre-fills fra/til with, so an
 * inexact bound would send a startPeriod before the first observation or an
 * endPeriod in the future.
 */
function timePickerBounds(card, gran, freq) {
  const P = window.SdmxToJsonStat;
  const ext = tableMetadata?.dimension?.[card.dataset.dimension]?.extension || {};
  const tb = ext.timeBounds || {};
  const minB = P.periodBoundsForYear(tb.firstPeriod, gran);
  const maxB = P.periodBoundsForYear(tb.lastPeriod, gran);
  const spec = getTimeFreqSpec();
  const probed = freq && spec && Array.isArray(spec.byFreq[freq]) ? spec.byFreq[freq] : null;
  // Eksakte koder er ofte finere enn visningsgranulariteten (FAUCTIONs
  // tidsstempler mot en dagsvelger) — convertPeriod grovner deterministisk og
  // gir null motsatt vei, der årsgrensene overtar.
  const exactMin = tb.firstCode ? P.convertPeriod(tb.firstCode, gran) : null;
  const exactMax = tb.lastCode ? P.convertPeriod(tb.lastCode, gran) : null;
  return {
    min: exactMin || (minB ? minB.min : ''),
    max: (probed && probed[probed.length - 1]) || exactMax || (maxB ? maxB.max : '')
  };
}

/**
 * Pre-fill an empty Fra–til with the first and last available observation.
 * The picker defaults to range mode, and an empty range means «no period
 * params» — indistinguishable from «Hele historikken», so switching mode would
 * appear to do nothing to the API preview. Never overwrites a side the user (or
 * URL restore) already filled in.
 *
 * @returns {boolean} true if a value was filled in
 */
function ensureRangeDefaults(card) {
  if (!card || card.dataset.timePicker !== 'interval') return false;
  if ((card.dataset.pickerMode || 'range') !== 'range') return false;
  if (readPeriodSide(card, 'from') || readPeriodSide(card, 'to')) return false;

  const gran = card.dataset.pickerGran || 'day';
  const bounds = timePickerBounds(card, gran, null);
  if (!bounds.min && !bounds.max) return false;

  const wrap = card.querySelector('.tp-range-inputs');
  if (!wrap) return false;
  wrap.innerHTML = renderPeriodInputsHtml(gran, bounds, bounds.min, bounds.max);
  return true;
}

/**
 * Keep the picker's from/til inputs in sync with the selected frequency:
 * SDMX period codes are frequency-specific, so a FREQ change swaps the input
 * granularity (date ↔ month ↔ quarter ↔ year). Existing values are converted
 * where deterministic (coarsening) and clamped to the bounds; unconvertible
 * values are cleared. No-op while the granularity is unchanged so typing in
 * the inputs is never clobbered.
 *
 * `spec` (extension.timePeriodsByFreq) may be null: flows without a frequency
 * dimension (Norges Bank's FAUCTION) declare the granularity on the time
 * dimension itself (extension.pickerGran) instead.
 */
function syncTimePicker(spec, timeCard) {
  const P = window.SdmxToJsonStat;

  const freqCard = spec
    ? document.querySelector('.variable-card[data-dimension="' + spec.freqDim + '"]')
    : null;
  const freqSel = freqCard ? getCardSelectedCodes(freqCard) : [];
  const freq = freqSel.length === 1 ? freqSel[0] : null;

  const declaredGran =
    tableMetadata?.dimension?.[timeCard.dataset.dimension]?.extension?.pickerGran;
  const gran = freq
    ? P.periodGranularity(freq)
    : (timeCard.dataset.pickerGran || declaredGran ||
       (spec ? P.periodGranularity(Object.keys(spec.byFreq)[0]) : 'day'));

  const wrap = timeCard.querySelector('.tp-range-inputs');
  if (!wrap) return;
  if (timeCard.dataset.pickerGran === gran && wrap.innerHTML !== '') return;

  // Convert + clamp existing values into the new granularity.
  const oldFrom = readPeriodSide(timeCard, 'from');
  const oldTo = readPeriodSide(timeCard, 'to');
  const bounds = timePickerBounds(timeCard, gran, freq);
  const newFrom = oldFrom ? (P.convertPeriod(oldFrom, gran) || '') : '';
  const newTo = oldTo ? (P.convertPeriod(oldTo, gran) || '') : '';

  wrap.innerHTML = renderPeriodInputsHtml(
    gran, bounds,
    newFrom ? P.clampPeriod(newFrom, bounds.min, bounds.max) : '',
    newTo ? P.clampPeriod(newTo, bounds.min, bounds.max) : ''
  );
  timeCard.dataset.pickerGran = gran;

  // Nyrendrede (tomme) fra/til fylles med hele det tilgjengelige intervallet.
  ensureRangeDefaults(timeCard);
}

/**
 * Find a picker card in range mode whose from/til are both set and inverted
 * (from > til) — blocks «Hent data» with a message rather than silently
 * swapping. Returns the card or null.
 */
function findInvertedRangePicker() {
  let bad = null;
  document.querySelectorAll('.variable-card[data-time-picker="interval"]').forEach(card => {
    if ((card.dataset.pickerMode || 'range') !== 'range') return;
    const from = readPeriodSide(card, 'from');
    const to = readPeriodSide(card, 'to');
    if (from && to && to < from) bad = card;
  });
  return bad;
}

/**
 * Selected codes for a card regardless of representation: pills → checked
 * radio; value list → .selected items; picker → [] (token-based, no codes).
 */
function getCardSelectedCodes(card) {
  if (!card) return [];
  if (card.dataset.pillGroup === 'true') return getPillSelectedCodes(card);
  const container = card.querySelector('.value-list-container');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.value-list-item.selected'))
    .map(it => it.dataset.code);
}

/**
 * Effective selection mode for a card: pills are always 'specific' (a radio
 * choice is an explicit code); value lists report container.dataset.mode;
 * cards without either (picker) report null.
 */
function getCardMode(card) {
  if (!card) return null;
  if (card.dataset.pillGroup === 'true') return 'specific';
  const container = card.querySelector('.value-list-container');
  return container ? container.dataset.mode : null;
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
    if (!card || getCardMode(card) !== 'specific') { constraints[dimId] = null; return; }
    const sel = getCardSelectedCodes(card);
    constraints[dimId] = sel.length ? new Set(sel) : null;
  });
  return constraints;
}

/**
 * Standard cross-filter: for each dimension D, a value v is enabled iff some valid
 * key has v in D AND matches every OTHER dimension's non-empty selection.
 *
 * `metricSet` (Set av dim-id-er, valgfri) gjør filtreringen ÉNVEIS for
 * måltallsdimensjoner: deres begrensninger anvendes aldri på andre
 * dimensjoner (nøkkeltall er verdier som hentes ut, ikke filtre — at valgt
 * «Pris» skulle nedtone «Tilbakekjøpsauksjon» oppleves baklengs). Filterdims
 * kryssfiltrerer fortsatt hverandre og styrer måltall-listene. Utelatt
 * metricSet = dagens toveis semantikk.
 */
function computeCrossFilterEnabled(vk, constraints, metricSet) {
  const dims = vk.dims;
  const parsed = getParsedValidKeys(vk);
  const enabled = {};
  dims.forEach(d => { enabled[d] = new Set(); });

  parsed.forEach(seg => {
    for (let di = 0; di < dims.length; di++) {
      let ok = true;
      for (let oi = 0; oi < dims.length; oi++) {
        if (oi === di || (metricSet && metricSet.has(dims[oi]))) continue;
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
    if (!card || getCardMode(card) !== 'specific') return false;
    if (card.dataset.elimination === 'true') return false; // valgfri — tomt utvalg er en gyldig sluttilstand
    return getCardSelectedCodes(card).length === 0;
  });
}

/**
 * Vis/skjul kortets kryssfilter-hint: når verdier er nedtonet, forklar hvorfor
 * («N av M tilgjengelig. Verdier uten data for gjeldende utvalg er nedtonet.»)
 * — uten forklaring framstår nedtoningen som vilkårlig for brukeren.
 */
function updateCrossFilterHint(card, enabledCount, totalCount) {
  const hint = card.querySelector('.cross-filter-hint');
  if (!hint) return;
  if (enabledCount < totalCount) {
    hint.textContent = tpl('variable.crossFilterCount', enabledCount, totalCount) +
      ' ' + t('variable.crossFilterHint');
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
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
  // Énveis for måltallsdimensjoner (se computeCrossFilterEnabled); treff-
  // telleren under bruker fortsatt FULL begrensning — den skal reflektere det
  // faktiske uttrekket.
  const metricDims = (tableMetadata.role && tableMetadata.role.metric) || [];
  const metricSet = new Set(metricDims.filter(d => vk.dims.includes(d)));
  const enabled = computeCrossFilterEnabled(vk, constraints, metricSet.size ? metricSet : null);

  vk.dims.forEach(dimId => {
    const card = document.querySelector('.variable-card[data-dimension="' + dimId + '"]');
    if (!card) return;
    const en = enabled[dimId];

    // Radio pill cards: disable incompatible pills, unchecking if needed.
    if (card.dataset.pillGroup === 'true') {
      let pillTotal = 0;
      let pillEnabled = 0;
      card.querySelectorAll('.dim-pill-group input[type="radio"]').forEach(radio => {
        const ok = en.has(radio.value);
        radio.disabled = !ok;
        radio.closest('.api-pill')?.classList.toggle('value-disabled', !ok);
        if (!ok && radio.checked) radio.checked = false; // auto-deselect incompatible value
        pillTotal++;
        if (ok) pillEnabled++;
      });
      updateCrossFilterHint(card, pillEnabled, pillTotal);
      return;
    }

    const container = card.querySelector('.value-list-container');
    if (!container) return;
    let listTotal = 0;
    let listEnabled = 0;
    container.querySelectorAll('.value-list-item').forEach(item => {
      listTotal++;
      if (en.has(item.dataset.code)) {
        item.classList.remove('value-disabled');
        item.removeAttribute('aria-disabled');
        listEnabled++;
      } else {
        item.classList.add('value-disabled');
        item.setAttribute('aria-disabled', 'true');
        item.classList.remove('selected'); // auto-deselect incompatible value
      }
    });
    updateCrossFilterHint(card, listEnabled, listTotal);
    updateValueCounter(card);
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
// Frequency-aware time period filtering (generic, source-agnostic)
// ============================================================
//
// When the metadata carries extension.timePeriodsByFreq — { freqDim, timeDim,
// byFreq: {freqCode: [periodCodes]} }, currently produced by the Norges Bank
// adapter — the time dimension's value list is limited to the periods that
// actually exist for the selected frequency. SDMX time codes are
// frequency-specific ('2025-07-15' daily vs '2025-07' monthly vs '2025'
// annual), so without this a daily date selected together with FREQ=A can
// never match any data. Absent for SSB/FHI → no-op.

/** Return the timePeriodsByFreq spec if present and applicable, else null. */
function getTimeFreqSpec() {
  const s = tableMetadata && tableMetadata.extension && tableMetadata.extension.timePeriodsByFreq;
  if (!s || !s.freqDim || !s.timeDim || !s.byFreq) return null;
  return s;
}

/**
 * Limit the time dimension's value list to periods available for the selected
 * frequency: incompatible periods are hidden (value-freq-hidden) + disabled,
 * and auto-deselected if they were selected. No frequency selection (or
 * star/top mode on the frequency card) means no constraint — all periods show.
 */
function applyTimeFreqFilter() {
  const spec = getTimeFreqSpec();

  // Uten frekvenskart er det ingen verdiliste å filtrere, men et intervallkort
  // (flows uten FREQ, se syncTimePicker) må fortsatt få rendret fra/til-feltene.
  if (!spec) {
    document.querySelectorAll('.variable-card[data-time-picker="interval"]')
      .forEach(card => syncTimePicker(null, card));
    return;
  }

  const timeCard = document.querySelector('.variable-card[data-dimension="' + spec.timeDim + '"]');
  if (!timeCard) return;

  // Interval picker card: no list items to hide — the frequency instead
  // drives the from/til inputs' granularity (date/month/quarter/year).
  if (timeCard.dataset.timePicker === 'interval') {
    syncTimePicker(spec, timeCard);
    return;
  }

  const timeContainer = timeCard.querySelector('.value-list-container');
  if (!timeContainer) return;

  // Read the frequency selection (specific mode only — star/top = no constraint).
  const freqCard = document.querySelector('.variable-card[data-dimension="' + spec.freqDim + '"]');
  let freqCodes = null;
  if (freqCard && getCardMode(freqCard) === 'specific') {
    const sel = getCardSelectedCodes(freqCard);
    if (sel.length) freqCodes = sel;
  }
  if (!freqCodes) freqCodes = Object.keys(spec.byFreq);

  // Union of period codes across the effective frequencies. A selected
  // frequency without a probed period list (adapter probe failed) makes the
  // constraint unknowable — degrade to showing everything rather than nothing.
  const allowed = new Set();
  let unknownFreq = false;
  freqCodes.forEach(f => {
    const codes = spec.byFreq[f];
    if (Array.isArray(codes)) codes.forEach(c => allowed.add(String(c)));
    else unknownFreq = true;
  });

  timeContainer.querySelectorAll('.value-list-item').forEach(item => {
    const ok = unknownFreq || allowed.has(item.dataset.code);
    item.classList.toggle('value-freq-hidden', !ok);
    item.classList.toggle('value-disabled', !ok);
    if (ok) {
      item.removeAttribute('aria-disabled');
    } else {
      item.setAttribute('aria-disabled', 'true');
      item.classList.remove('selected'); // auto-deselect incompatible period
    }
  });

  // Keep the visible total + the time-format hint in the filter placeholder in
  // sync with the periods actually shown (e.g. '2025' for annual, '2025-07' monthly).
  const totalEl = timeCard.querySelector('.total-count');
  if (totalEl) {
    totalEl.textContent =
      timeContainer.querySelectorAll('.value-list-item:not(.value-freq-hidden)').length;
  }
  if (!unknownFreq && allowed.size > 0) {
    const input = timeCard.querySelector('.value-filter-input');
    if (input && typeof tpl === 'function') {
      const sample = Array.from(allowed).sort().slice(-1)[0];
      const hint = tpl('variable.timeFormatHint', sample);
      if (hint) input.placeholder = hint;
    }
  }

  updateValueCounter(timeCard);
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
  // Frequency-aware time filter + cross-filter first (both may auto-deselect
  // incompatible values) so the selection read below already reflects the
  // muted/hidden state. No-ops without the respective metadata extensions.
  applyTimeFreqFilter();
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
      const n = dimSelection.match(/\d+/)?.[0];
      summary.textContent = n ? tpl('status.topMode', n) : dimSelection;
      summary.className = 'variable-selection-summary summary-valid';
    } else if (typeof dimSelection === 'string' && dimSelection.startsWith('range(')) {
      const r = window.SdmxToJsonStat?.parsePeriodRange(dimSelection);
      summary.textContent = (r && (r.from || r.to))
        ? tpl('status.rangeMode', r.from || '…', r.to || '…')
        : t('status.allSelected'); // helt åpen range = full historikk
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

  // Inverted interval range (fra > til) blocks fetch with a message rather
  // than silently swapping the values.
  const invertedCard = findInvertedRangePicker();
  if (invertedCard) {
    statusElement.textContent = t('status.rangeInverted');
    statusElement.className = 'selection-status-invalid';
    fetchButton.disabled = true;
    setCardStatus(invertedCard, 'invalid');
    const summary = invertedCard.querySelector('.variable-selection-summary');
    if (summary) {
      summary.textContent = t('status.rangeInverted');
      summary.className = 'variable-selection-summary summary-invalid';
    }
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
 * Get the true total number of values for a dimension, regardless of UI state.
 *
 * Counting DOM elements is unreliable: the text filter hides non-matching items
 * via style.display, and an active codelist changes which values are shown.
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
 * Uses metadata counts (not DOM element counts) for accurate totals, since the
 * text filter and codelists change which items are present/visible in the DOM.
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

    // Interval time picker: estimate the period count from the mode.
    if (card.dataset.timePicker === 'interval') {
      const P = window.SdmxToJsonStat;
      const pickerMode = card.dataset.pickerMode || 'range';
      const gran = card.dataset.pickerGran || 'day';
      const bounds = timePickerBounds(card, gran, null);
      hasIncludedDimension = true;

      let count;
      if (pickerMode === 'top') {
        const n = parseInt(card.querySelector('.top-n-input')?.value, 10);
        count = n > 0 ? n : 10;
      } else {
        // range/star: tomme sider fylles med katalog-grensene der de finnes;
        // uten grenser faller vi tilbake til den probede listens lengde.
        let from = pickerMode === 'range' ? readPeriodSide(card, 'from') : '';
        let to = pickerMode === 'range' ? readPeriodSide(card, 'to') : '';
        if (!from) from = bounds.min;
        if (!to) to = bounds.max;
        count = (from && to)
          ? P.estimatePeriodCount(from, to, gran)
          : getTrueDimensionValueCount(dimCode);
      }

      if (count > 0) selectedCells *= count;
      else hasMissingMandatory = true; // invertert/tomt intervall
      const maxEstimate = (bounds.min && bounds.max)
        ? P.estimatePeriodCount(bounds.min, bounds.max, gran)
        : getTrueDimensionValueCount(dimCode);
      maxCells *= Math.max(maxEstimate, 1);
      return;
    }

    // Radio pill dimensions: 0 or 1 selected code.
    if (card.dataset.pillGroup === 'true') {
      const isElim = card.dataset.elimination === 'true';
      const n = getPillSelectedCodes(card).length;
      if (n === 0 && isElim) return; // omitted → eliminated
      hasIncludedDimension = true;
      if (n === 0) hasMissingMandatory = true;
      else selectedCells *= n;
      maxCells *= Math.max(getTrueDimensionValueCount(dimCode), 1);
      return;
    }

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

    // Interval time picker: emits a token — top(N) / range(from,to) / '*'.
    if (card.dataset.timePicker === 'interval') {
      selection[dimCode] = readTimePickerToken(card);
      return;
    }

    // Radio pill dimensions: the checked radio as a one-code array.
    if (card.dataset.pillGroup === 'true') {
      const codes = getPillSelectedCodes(card);
      if (card.dataset.elimination === 'true' && codes.length === 0) {
        return; // omit — API aggregates
      }
      selection[dimCode] = codes;
      return;
    }

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
      // display expect chronological order. Recognize both SSB's 'Tid' and
      // role.time dims (e.g. Norges Bank's 'TIME_PERIOD').
      const isTimeDim = dimCode === 'Tid' || dimCode.toLowerCase().includes('tid') ||
        ((tableMetadata?.role?.time || []).includes(dimCode));
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
