/**
 * Variable Selection — Module State
 *
 * Shared mutable state used across all variable-select-*.js modules.
 * Must be loaded first in the variable-select file group.
 */

// Store metadata for current table
let tableMetadata = null;

// Track last clicked item index per dimension for shift-click range selection
const lastClickedIndex = {};

/**
 * Track active codelist per dimension.
 * Key: dimension code (e.g., "Investeringsart")
 * Value: null (no codelist, show all values) or {
 *   codelistId: string,
 *   elimination: boolean,
 *   isAggregated: boolean,
 *   values: Array<{code, label, valueMap}>,
 *   originalCodes: Set<string>
 * }
 *
 * When a codelist is active, the value list is always re-rendered from codelist
 * data (via renderCodelistValues), ensuring values appear in the codelist's order.
 * The codelist's own elimination property may override the dimension's default.
 */
const activeCodelists = {};

/**
 * Pre-loaded value ordering per dimension from the first codelist.
 * Key: dimension code, Value: array of codes in the codelist's order.
 * Used by renderValueList() to order "Velg fritt" values consistently
 * with codelist-defined ordering (codelist codes first, remaining after).
 */
const dimensionValueOrder = {};

// URL update debounce timer
let urlUpdateTimer = null;

/**
 * Debounced URL update to avoid excessive history entries
 * Updates URL with current variable selections and codelist IDs
 */
function debouncedURLUpdate() {
  clearTimeout(urlUpdateTimer);

  urlUpdateTimer = setTimeout(() => {
    if (!AppState.selectedTable) return;

    const params = {};

    // Get current variable selection
    const selection = getVariableSelection();
    if (selection && Object.keys(selection).length > 0) {
      params.v = URLRouter.encode(selection);
    }

    // Get current codelist IDs
    if (Object.keys(AppState.activeCodelistIds).length > 0) {
      params.c = URLRouter.encode(AppState.activeCodelistIds);
    }

    // Update URL (use replaceState, not pushState, to avoid creating history entries for every selection change)
    URLRouter.navigateTo(
      `variables/${AppState.selectedTable.id}`,
      params,
      false  // replaceState
    );
  }, 500); // 500ms debounce
}
