/**
 * Variable Selection — Event Setup
 *
 * Wires up all interactive events for the variable selection view:
 * click/shift-click/ctrl-click on value items, text filter inputs,
 * Ctrl+A keyboard shortcut, and mode buttons (Alle/Velg alle/Opphev/Siste N).
 *
 * Codelist dropdown events are handled in variable-select-codelists.js.
 */

// ============================================================
// Event setup
// ============================================================

/**
 * Set up all event listeners for variable selection
 */
function setupVariableEvents() {
  setupListSelectionEvents();
  setupValueFilters();
  setupModeButtons();
  setupKeyboardShortcuts();
  setupCodelistDropdowns();
}

// Module-level drag state for paint-selection
let _dragState = null;   // { dimCode, container, card, startIndex, mode, hasMoved, preSnapshot }
let _dragOccurred = false; // suppresses click handler after a completed drag
let _activeCard = null;  // last .variable-card the user interacted with

// "Committed" selections: items added by plain click or Ctrl/Cmd-click (not the current shift range).
// Displayed selection = committedSelection ∪ current shift range.
// This matches OS-standard list behavior (macOS Finder, Windows Explorer).
const _committedSelection = {}; // dimCode → Set<number>

// Track the last variable card the user interacted with (for Ctrl+A scope)
document.addEventListener('mousedown', (e) => {
  const card = e.target.closest('.variable-card');
  if (card) _activeCard = card;
});

// Clear drag state on mouseup; commit drag result so shift-click after drag works correctly
document.addEventListener('mouseup', () => {
  if (_dragState && _dragState.hasMoved) {
    const { container, dimCode } = _dragState;
    const allItems = Array.from(container.querySelectorAll('.value-list-item'));
    _committedSelection[dimCode] = new Set(
      allItems.filter(it => it.classList.contains('selected'))
              .map(it => parseInt(it.dataset.index, 10))
    );
  }
  _dragState = null;
});

/**
 * Set up click events on value list items (shift-click, ctrl-click, plain click, drag)
 */
function setupListSelectionEvents() {
  // Reset committed-selection state for the freshly rendered variable list
  Object.keys(_committedSelection).forEach(k => delete _committedSelection[k]);

  document.querySelectorAll('.value-list-container').forEach(container => {
    const card = container.closest('.variable-card');
    const dimCode = card.dataset.dimension;

    // Prevent text selection and set up drag state
    container.addEventListener('mousedown', (e) => {
      _activeCard = card;
      const item = e.target.closest('.value-list-item');

      // Prevent Safari from text-selecting list content on any interaction with an item
      if (item && item.style.display !== 'none') e.preventDefault();

      // Shift drag/click: anchor-based range selection handled entirely by the click event
      if (e.shiftKey) return;

      if (!item || item.style.display === 'none') return;

      const isAdditive = e.ctrlKey || e.metaKey;
      const allItems = Array.from(container.querySelectorAll('.value-list-item'));
      const clickedIndex = parseInt(item.dataset.index, 10);

      _dragState = {
        dimCode, container, card,
        startIndex: clickedIndex,
        mode: item.classList.contains('selected') ? 'deselect' : 'select',
        hasMoved: false,
        // Additive drag (ctrl/cmd): preserve existing selection outside the range.
        // Plain drag: empty snapshot so items outside the range are always cleared.
        preSnapshot: isAdditive
          ? new Set(allItems.filter(it => it.classList.contains('selected'))
                            .map(it => parseInt(it.dataset.index, 10)))
          : new Set()
      };
      _dragOccurred = false;
    });

    // Paint selection while holding the mouse button and moving over items
    container.addEventListener('mouseover', (e) => {
      if (!(e.buttons & 1)) return; // left button not held
      if (!_dragState || _dragState.container !== container) return;

      const item = e.target.closest('.value-list-item');
      if (!item || item.style.display === 'none') return;

      const currentIndex = parseInt(item.dataset.index, 10);
      // Ignore the very first hover over the start item (that's handled by click)
      if (currentIndex === _dragState.startIndex && !_dragState.hasMoved) return;

      _dragState.hasMoved = true;
      _dragOccurred = true;

      if (container.dataset.mode !== 'specific') {
        container.dataset.mode = 'specific';
        updateModeVisuals(card);
      }

      const allItems = Array.from(container.querySelectorAll('.value-list-item'));
      const start = Math.min(_dragState.startIndex, currentIndex);
      const end = Math.max(_dragState.startIndex, currentIndex);

      allItems.forEach(it => {
        if (it.style.display === 'none') return;
        const idx = parseInt(it.dataset.index, 10);
        const inRange = idx >= start && idx <= end;
        const wasSelected = _dragState.preSnapshot.has(idx);
        if (inRange) {
          if (_dragState.mode === 'select') it.classList.add('selected');
          else it.classList.remove('selected');
        } else {
          // Outside range: restore to pre-drag state so range dynamically adjusts
          if (wasSelected) it.classList.add('selected');
          else it.classList.remove('selected');
        }
      });

      // Update anchor so a subsequent shift-click extends from the drag endpoint
      lastClickedIndex[dimCode] = currentIndex;
      updateValueCounter(card);
      updateSelectionStatus();
    });

    // Click handler: shift-click range, ctrl-click toggle, plain click single-select
    container.addEventListener('click', (e) => {
      // If a drag just happened, the selection is already applied — skip click logic
      if (_dragOccurred) { _dragOccurred = false; return; }

      const item = e.target.closest('.value-list-item');
      if (!item) return;

      // If in star/top mode, switch back to specific on click
      if (container.dataset.mode !== 'specific') {
        container.dataset.mode = 'specific';
        updateModeVisuals(card);
      }

      const clickedIndex = parseInt(item.dataset.index, 10);
      const allItems = Array.from(container.querySelectorAll('.value-list-item'));

      if (!_committedSelection[dimCode]) _committedSelection[dimCode] = new Set();
      const committed = _committedSelection[dimCode];

      if (e.shiftKey && lastClickedIndex[dimCode] !== undefined && (e.ctrlKey || e.metaKey)) {
        // Shift+Ctrl: add range to committed selection (fully additive, anchor advances)
        const start = Math.min(lastClickedIndex[dimCode], clickedIndex);
        const end   = Math.max(lastClickedIndex[dimCode], clickedIndex);
        allItems.forEach(it => {
          const idx = parseInt(it.dataset.index, 10);
          if (idx >= start && idx <= end) {
            it.classList.add('selected');
            committed.add(idx);
          }
        });
        lastClickedIndex[dimCode] = clickedIndex;
      } else if (e.shiftKey && lastClickedIndex[dimCode] !== undefined) {
        // Shift-click (no Ctrl): replace shift range but preserve committed items
        const start = Math.min(lastClickedIndex[dimCode], clickedIndex);
        const end   = Math.max(lastClickedIndex[dimCode], clickedIndex);
        allItems.forEach(it => {
          const idx = parseInt(it.dataset.index, 10);
          if ((idx >= start && idx <= end) || committed.has(idx))
            it.classList.add('selected');
          else
            it.classList.remove('selected');
        });
        // anchor and committed stay unchanged
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd-click: commit current display (incl. any active shift range), then toggle
        const current = new Set(
          allItems.filter(it => it.classList.contains('selected'))
                  .map(it => parseInt(it.dataset.index, 10))
        );
        if (current.has(clickedIndex)) current.delete(clickedIndex);
        else current.add(clickedIndex);
        _committedSelection[dimCode] = current;
        lastClickedIndex[dimCode] = clickedIndex;
        allItems.forEach(it => {
          const idx = parseInt(it.dataset.index, 10);
          if (current.has(idx)) it.classList.add('selected');
          else it.classList.remove('selected');
        });
      } else {
        // Plain click: reset everything, select only this item
        _committedSelection[dimCode] = new Set([clickedIndex]);
        lastClickedIndex[dimCode] = clickedIndex;
        allItems.forEach(it => it.classList.remove('selected'));
        item.classList.add('selected');
      }

      updateValueCounter(card);
      updateSelectionStatus();
    });
  });
}

/**
 * Set up search/filter inputs for value lists.
 * Since codelists now re-render the DOM (not just hide/show), the text filter
 * only needs to handle text-based filtering of whatever items are in the DOM.
 */
function setupValueFilters() {
  document.querySelectorAll('.value-filter-input').forEach(input => {
    const card = input.closest('.variable-card');
    const container = card.querySelector('.value-list-container');

    input.addEventListener('input', debounce(() => {
      const query = input.value.trim().toLowerCase();
      const items = container.querySelectorAll('.value-list-item');

      items.forEach(item => {
        const label = item.querySelector('.value-list-label').textContent.toLowerCase();
        const codeText = item.querySelector('.value-list-code').textContent.toLowerCase();

        if (!query || label.includes(query) || codeText.includes(query)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    }, 150));
  });
}

/**
 * Set up Ctrl+A keyboard shortcut to select all visible values in the active variable card.
 * Triggers when focus is inside a value list, or when the user has clicked anywhere in a card.
 * The value-list-container has tabindex="0" so it can also receive keyboard focus directly.
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      // Don't override when the user is typing in a text input
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

      // Use focused value-list if available, otherwise fall back to last clicked card
      const container =
        activeEl?.closest('.value-list-container') ??
        _activeCard?.querySelector('.value-list-container');
      if (!container) return;
      // Only act when within the variable-select view
      if (!container.closest('#variables-container')) return;

      e.preventDefault();

      const card = container.closest('.variable-card');

      // Switch to specific mode (individual selections)
      container.dataset.mode = 'specific';

      // Select all VISIBLE items (respects both codelist and text filter)
      container.querySelectorAll('.value-list-item').forEach(item => {
        if (item.style.display !== 'none') {
          item.classList.add('selected');
        }
      });

      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    }
  });
}

/**
 * Set up mode buttons (select all, select none, star, top)
 */
function setupModeButtons() {
  // "Siste N" button — requests last N values (time dimensions)
  document.querySelectorAll('.select-top-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'top';
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // Top-n input: auto-activate top mode when user types a number
  document.querySelectorAll('.top-n-input').forEach(input => {
    input.addEventListener('input', () => {
      const card = input.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'top';
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // "Velg alle" button — requests all values via the API wildcard (star mode)
  document.querySelectorAll('.select-all-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'star';
      updateModeVisuals(card);
      updateValueCounter(card);
      updateSelectionStatus();
    });
  });

  // "Opphev alle" button — deselects everything
  document.querySelectorAll('.select-none-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
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
