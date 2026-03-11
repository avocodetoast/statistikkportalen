/**
 * Table Rotation - Change table layout (pivot dimensions between rows and columns)
 */

/**
 * Open rotation dialog
 */
function openRotationDialog() {
  logger.log('[TableRotation] Opening rotation dialog');

  if (!currentData) {
    showError('Ingen data å rotere');
    return;
  }

  const dimensions = currentData.id;
  const currentLayout = AppState.tableLayout;

  // Create dialog overlay
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-header">
        <h3>Roter tabell</h3>
        <button class="dialog-close" id="close-rotation-dialog">×</button>
      </div>

      <div class="dialog-content">
        <p class="dialog-description">
          Dra dimensjoner mellom rader og kolonner for å endre tabellens layout.
        </p>

        <div class="rotation-container">
          <div class="dimension-zone">
            <h4>Rader</h4>
            <div id="rows-zone" class="dimension-dropzone">
              ${renderDimensionList(currentLayout.rows, 'row')}
            </div>
          </div>

          <div class="dimension-zone">
            <h4>Kolonner</h4>
            <div id="columns-zone" class="dimension-dropzone">
              ${renderDimensionList(currentLayout.columns, 'col')}
            </div>
          </div>
        </div>

        <div class="rotation-presets">
          <p><strong>Hurtigvalg:</strong></p>
          <button class="btn-link preset-btn" data-preset="default">Standard</button>
          <button class="btn-link preset-btn" data-preset="transpose">Transponér</button>
          ${dimensions.length > 2 ? '<button class="btn-link preset-btn" data-preset="all-rows">Alle som rader</button>' : ''}
          ${dimensions.length > 2 ? '<button class="btn-link preset-btn" data-preset="all-cols">Alle som kolonner</button>' : ''}
        </div>
      </div>

      <div class="dialog-footer">
        <button id="apply-rotation-btn" class="btn-primary">Bruk layout</button>
        <button id="cancel-rotation-btn" class="btn-secondary">Avbryt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Set up event listeners
  setupRotationEvents(overlay, dimensions);
}

/**
 * Render list of dimensions as draggable items
 * @param {Array} dimCodes - Dimension codes
 * @param {string} zone - Zone identifier ('row' or 'col')
 * @returns {string} - HTML
 */
function renderDimensionList(dimCodes, zone) {
  if (!currentData) return '';

  if (dimCodes.length === 0) {
    return '<p class="empty-zone">Dra dimensjoner hit</p>';
  }

  let html = '';
  dimCodes.forEach((dimCode, index) => {
    const dimension = currentData.dimension[dimCode];
    const label = dimension.label || dimCode;
    const valueCount = Object.keys(dimension.category.index).length;

    html += `
      <div class="dimension-chip" draggable="true"
           data-dimension="${escapeHtml(dimCode)}"
           data-zone="${zone}"
           data-index="${index}">
        <span class="dimension-name">${escapeHtml(label)}</span>
        <span class="dimension-count">${valueCount} verdier</span>
      </div>
    `;
  });

  return html;
}

/**
 * Set up event listeners for rotation dialog
 * @param {HTMLElement} overlay - Dialog overlay element
 * @param {Array} dimensions - All dimension codes
 */
function setupRotationEvents(overlay, dimensions) {
  // Close button
  overlay.querySelector('#close-rotation-dialog')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#cancel-rotation-btn')?.addEventListener('click', () => {
    overlay.remove();
  });

  // Apply button
  overlay.querySelector('#apply-rotation-btn')?.addEventListener('click', () => {
    applyRotation(overlay);
  });

  // Preset buttons
  overlay.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      applyPreset(preset, dimensions, overlay);
    });
  });

  // Drag and drop
  setupDragAndDrop(overlay);
}

// Track the current drag-drop abort controller to remove old listeners
let dragDropAbortController = null;

/**
 * Set up drag and drop functionality
 * @param {HTMLElement} overlay - Dialog overlay element
 */
function setupDragAndDrop(overlay) {
  // Abort previous listeners if re-initializing (e.g. after preset)
  if (dragDropAbortController) {
    dragDropAbortController.abort();
  }
  dragDropAbortController = new AbortController();
  const signal = dragDropAbortController.signal;

  let draggedElement = null;

  // Drag start — defer the visual class so the browser captures the chip's
  // normal appearance as the drag ghost image before it turns into a slot.
  overlay.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.dimension-chip');
    if (!chip) return;
    draggedElement = chip;
    requestAnimationFrame(() => {
      if (draggedElement) draggedElement.classList.add('dragging');
    });
  }, { signal });

  // Drag end — fires for both successful drops and cancelled drags.
  // The chip is already in the right position (we moved it live during dragover),
  // so we just restore its appearance and tidy up.
  overlay.addEventListener('dragend', () => {
    if (draggedElement) {
      draggedElement.classList.remove('dragging');
      draggedElement = null;
    }
    overlay.querySelectorAll('.dimension-dropzone').forEach(z => z.classList.remove('drag-over'));
    updateEmptyZones(overlay);
  }, { signal });

  // Single dragover on the overlay handles both zone-switching and reordering.
  // Moving the chip live (rather than a separate placeholder) keeps zone sizes
  // stable and avoids any double-element layout glitch.
  overlay.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedElement) return;

    const dropzone = e.target.closest('.dimension-dropzone');
    if (!dropzone) return;

    // Highlight only the current target zone
    overlay.querySelectorAll('.dimension-dropzone').forEach(z => {
      z.classList.toggle('drag-over', z === dropzone);
    });

    // Clear any "empty zone" message so the chip has room to enter
    const emptyMsg = dropzone.querySelector('.empty-zone');
    if (emptyMsg) emptyMsg.remove();

    // Calculate where the chip should land
    const afterElement = getDragAfterElement(dropzone, e.clientY, draggedElement);

    // Only touch the DOM when the position has actually changed — prevents
    // oscillation when the chip is near the midpoint of a neighbour.
    const alreadyInPlace =
      draggedElement.parentNode === dropzone &&
      draggedElement.nextElementSibling === afterElement;

    if (!alreadyInPlace) {
      if (afterElement == null) {
        dropzone.appendChild(draggedElement);
      } else {
        dropzone.insertBefore(draggedElement, afterElement);
      }
      draggedElement.dataset.zone = dropzone.id === 'rows-zone' ? 'row' : 'col';
    }
  }, { signal });

  overlay.querySelectorAll('.dimension-dropzone').forEach(zone => {
    // dragleave fires when the cursor moves to a child element (e.g. a chip
    // label span), which would flicker the highlight off. Guard with relatedTarget.
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove('drag-over');
      }
    }, { signal });

    // drop: the chip is already in its final position from dragover. Just
    // prevent the browser default and let dragend do the cleanup.
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
    }, { signal });
  });
}

/**
 * Get element to insert before when dragging.
 * @param {HTMLElement} container - Dropzone element
 * @param {number} y - Mouse Y position
 * @param {HTMLElement} excluded - The chip being dragged (excluded from targets)
 * @returns {HTMLElement|null} - Element to insert before, or null to append
 */
function getDragAfterElement(container, y, excluded) {
  const candidates = [...container.querySelectorAll('.dimension-chip')]
    .filter(el => el !== excluded);

  return candidates.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Update empty zone messages
 * @param {HTMLElement} overlay - Dialog overlay element
 */
function updateEmptyZones(overlay) {
  overlay.querySelectorAll('.dimension-dropzone').forEach(zone => {
    const chips = zone.querySelectorAll('.dimension-chip');

    if (chips.length === 0 && !zone.querySelector('.empty-zone')) {
      zone.innerHTML = '<p class="empty-zone">Dra dimensjoner hit</p>';
    }
  });
}

/**
 * Apply preset layout
 * @param {string} preset - Preset name
 * @param {Array} dimensions - All dimension codes
 * @param {HTMLElement} overlay - Dialog overlay element
 */
function applyPreset(preset, dimensions, overlay) {
  const rowsZone = overlay.querySelector('#rows-zone');
  const colsZone = overlay.querySelector('#columns-zone');

  if (!rowsZone || !colsZone) return;

  let newRows = [];
  let newCols = [];

  switch (preset) {
    case 'default':
      // Default layout from determineDefaultLayout
      const timeDimIndex = dimensions.findIndex(d =>
        d === 'Tid' || d.toLowerCase().includes('tid')
      );
      if (timeDimIndex !== -1) {
        const nonTimeDims = dimensions.filter((_, i) => i !== timeDimIndex);
        if (nonTimeDims.length > 0) {
          newRows = [dimensions[timeDimIndex]];
          newCols = nonTimeDims;
        } else {
          newRows = [dimensions[timeDimIndex]];
          newCols = [];
        }
      } else if (dimensions.length > 1) {
        newRows = dimensions.slice(0, -1);
        newCols = [dimensions[dimensions.length - 1]];
      } else {
        newRows = [];
        newCols = dimensions;
      }
      break;

    case 'transpose':
      // Swap rows and columns
      const currentRows = Array.from(rowsZone.querySelectorAll('.dimension-chip'))
        .map(chip => chip.dataset.dimension);
      const currentCols = Array.from(colsZone.querySelectorAll('.dimension-chip'))
        .map(chip => chip.dataset.dimension);
      newRows = currentCols;
      newCols = currentRows;
      break;

    case 'all-rows':
      newRows = dimensions;
      newCols = [];
      break;

    case 'all-cols':
      newRows = [];
      newCols = dimensions;
      break;
  }

  // Update zones
  rowsZone.innerHTML = renderDimensionList(newRows, 'row');
  colsZone.innerHTML = renderDimensionList(newCols, 'col');

  // Re-setup drag and drop
  setupDragAndDrop(overlay);
}

/**
 * Apply rotation and update table
 * @param {HTMLElement} overlay - Dialog overlay element
 */
function applyRotation(overlay) {
  const rowsZone = overlay.querySelector('#rows-zone');
  const colsZone = overlay.querySelector('#columns-zone');

  if (!rowsZone || !colsZone) return;

  // Get new layout
  const newRows = Array.from(rowsZone.querySelectorAll('.dimension-chip'))
    .map(chip => chip.dataset.dimension);
  const newCols = Array.from(colsZone.querySelectorAll('.dimension-chip'))
    .map(chip => chip.dataset.dimension);

  // Validate: must have all dimensions
  const allDims = [...newRows, ...newCols].sort();
  const expectedDims = [...currentData.id].sort();

  if (JSON.stringify(allDims) !== JSON.stringify(expectedDims)) {
    showError('Alle dimensjoner må være enten i rader eller kolonner');
    return;
  }

  // Validate: at least one dimension in rows OR columns
  if (newRows.length === 0 && newCols.length === 0) {
    showError('Tabellen må ha minst én dimensjon');
    return;
  }

  // Update app state
  AppState.tableLayout = {
    rows: newRows,
    columns: newCols
  };

  logger.log('[TableRotation] New layout:', AppState.tableLayout);

  // Close dialog
  overlay.remove();

  // Re-render table
  displayData();
}
