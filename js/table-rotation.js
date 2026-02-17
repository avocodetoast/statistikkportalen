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

  // Drag start
  overlay.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('dimension-chip')) {
      draggedElement = e.target;
      e.target.classList.add('dragging');
    }
  }, { signal });

  // Drag end
  overlay.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('dimension-chip')) {
      e.target.classList.remove('dragging');
      draggedElement = null;
    }
  }, { signal });

  // Drag over zones
  overlay.querySelectorAll('.dimension-dropzone').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    }, { signal });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    }, { signal });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');

      if (!draggedElement) return;

      // Move element to new zone
      const targetZone = zone.id === 'rows-zone' ? 'row' : 'col';
      draggedElement.dataset.zone = targetZone;

      // Remove empty zone message if present
      const emptyMsg = zone.querySelector('.empty-zone');
      if (emptyMsg) emptyMsg.remove();

      // Append to zone
      zone.appendChild(draggedElement);

      // Update empty zone messages
      updateEmptyZones(overlay);
    }, { signal });
  });

  // Drag over individual chips (for reordering within zone)
  overlay.addEventListener('dragover', (e) => {
    if (!draggedElement) return;

    const dropzone = e.target.closest('.dimension-dropzone');
    if (!dropzone) return;

    const afterElement = getDragAfterElement(dropzone, e.clientY);

    if (afterElement == null) {
      dropzone.appendChild(draggedElement);
    } else {
      dropzone.insertBefore(draggedElement, afterElement);
    }
  }, { signal });
}

/**
 * Get element to insert before when dragging
 * @param {HTMLElement} container - Container element
 * @param {number} y - Mouse Y position
 * @returns {HTMLElement|null} - Element to insert before
 */
function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll('.dimension-chip:not(.dragging)')
  ];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
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
