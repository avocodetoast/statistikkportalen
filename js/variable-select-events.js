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

/**
 * Set up click events on value list items (shift-click, ctrl-click, plain click)
 */
function setupListSelectionEvents() {
  document.querySelectorAll('.value-list-container').forEach(container => {
    const card = container.closest('.variable-card');
    const dimCode = card.dataset.dimension;

    container.addEventListener('click', (e) => {
      const item = e.target.closest('.value-list-item');
      if (!item) return;

      // If in star/top mode, switch back to specific on click
      if (container.dataset.mode !== 'specific') {
        container.dataset.mode = 'specific';
        updateModeVisuals(card);
      }

      const clickedIndex = parseInt(item.dataset.index, 10);
      const allItems = Array.from(container.querySelectorAll('.value-list-item'));

      if (e.shiftKey && lastClickedIndex[dimCode] !== undefined) {
        // Shift-click: select range between last click and current click
        const start = Math.min(lastClickedIndex[dimCode], clickedIndex);
        const end = Math.max(lastClickedIndex[dimCode], clickedIndex);

        if (!e.ctrlKey && !e.metaKey) {
          // Without Ctrl: replace selection with range
          allItems.forEach(it => it.classList.remove('selected'));
        }

        allItems.forEach(it => {
          const idx = parseInt(it.dataset.index, 10);
          if (idx >= start && idx <= end) {
            it.classList.add('selected');
          }
        });
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd-click: toggle individual item
        item.classList.toggle('selected');
      } else {
        // Plain click: select only this item
        allItems.forEach(it => it.classList.remove('selected'));
        item.classList.add('selected');
      }

      lastClickedIndex[dimCode] = clickedIndex;
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
 * Set up Ctrl+A keyboard shortcut to select all visible values in a focused value list.
 * The value-list-container has tabindex="0" so it can receive focus.
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      // Check if focus is inside a value list container
      const container = document.activeElement?.closest('.value-list-container');
      if (!container) return; // Not inside a value list — let browser handle normally

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
  // "Alle (*)" button — requests all values via the API wildcard
  document.querySelectorAll('.select-star-btn').forEach(btn => {
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

  // "Velg alle" button — selects all visible items individually
  document.querySelectorAll('.select-all-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = btn.closest('.variable-card');
      const container = card.querySelector('.value-list-container');
      container.dataset.mode = 'specific';
      // Select only visible items (respects codelist filter)
      container.querySelectorAll('.value-list-item').forEach(item => {
        if (item.style.display !== 'none') {
          item.classList.add('selected');
        }
      });
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
