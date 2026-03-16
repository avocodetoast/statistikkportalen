/**
 * Table Save Query - Save current query and present shareable links
 */

// Cache the last saved query so repeated clicks reuse the same ID
let _lastSavedQuery = null; // { fingerprint: string, id: string }

/**
 * Show dialog for saving the current query and presenting shareable links.
 * POSTs to SSB's /savedqueries endpoint and displays both an SSB link
 * and a Statistikkportalen deep-link using the returned query ID.
 */
async function showSaveQueryDialog() {
  if (!currentData || !AppState.selectedTable || !AppState.variableSelection) {
    showError('Ingen aktiv spørring å lagre');
    return;
  }

  // Fingerprint the current selection so we can skip the POST if nothing changed
  const layout = AppState.tableLayout;
  const fingerprint = JSON.stringify({
    tableId: AppState.selectedTable.id,
    selection: AppState.variableSelection,
    codelistIds: AppState.activeCodelistIds || {},
    rows: layout ? layout.rows : [],
    columns: layout ? layout.columns : []
  });

  // Remove any existing dialog
  document.getElementById('save-query-dialog')?.remove();

  const needsLoading = !(_lastSavedQuery && _lastSavedQuery.fingerprint === fingerprint);

  const dialogHtml = `
    <div class="dialog-overlay" id="save-query-dialog">
      <div class="dialog-container" style="max-width: 540px;">
        <div class="dialog-header">
          <h3>Få lenke til spørringen</h3>
          <button class="dialog-close" id="save-query-close">&times;</button>
        </div>
        <div class="dialog-content" id="save-query-content">
          ${needsLoading ? '<p class="loading-message">Lagrer spørring hos SSB...</p>' : ''}
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', dialogHtml);

  const dialog = document.getElementById('save-query-dialog');
  const closeDialog = () => { dialog.remove(); removeEscape(); };
  const removeEscape = addEscapeHandler(closeDialog);

  document.getElementById('save-query-close')?.addEventListener('click', closeDialog);

  // Only close overlay click if the mousedown also started on the overlay —
  // prevents accidental close when dragging to select text in the inputs.
  let mouseDownOnOverlay = false;
  dialog.addEventListener('mousedown', (e) => {
    mouseDownOnOverlay = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && mouseDownOnOverlay) closeDialog();
  });

  const showLinks = (id) => {
    const ssbUrl = 'https://www.ssb.no/statbank/sq/' + id;
    const portalUrl = window.location.origin + window.location.pathname + '#sq/' + id;

    document.getElementById('save-query-content').innerHTML = `
      <p>Spørringen er lagret. Bruk lenkene nedenfor for å dele eller gjenåpne den.</p>

      <div class="form-group">
        <label class="form-label">Åpne i Statistikkportalen:</label>
        <div class="save-query-link-row">
          <input type="text" class="save-query-link-input" readonly
                 id="portal-link-input" value="${escapeHtml(portalUrl)}">
          <button class="btn-secondary" id="copy-portal-link">Kopier</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Åpne i SSBs statistikkbank:</label>
        <div class="save-query-link-row">
          <input type="text" class="save-query-link-input" readonly
                 id="ssb-link-input" value="${escapeHtml(ssbUrl)}">
          <button class="btn-secondary" id="copy-ssb-link">Kopier</button>
        </div>
        <a href="${escapeHtml(ssbUrl)}" target="_blank" rel="noopener"
           style="display:inline-block; margin-top: 6px; font-size: 0.9em;">
          Åpne i SSBs statistikkbank ↗
        </a>
      </div>
    `;

    const makeCopyHandler = (inputId, btnId) => {
      document.getElementById(btnId)?.addEventListener('click', () => {
        const val = document.getElementById(inputId)?.value || '';
        navigator.clipboard.writeText(val).catch(() => {
          const input = document.getElementById(inputId);
          if (input) { input.select(); document.execCommand('copy'); }
        });
        const btn = document.getElementById(btnId);
        if (btn) {
          btn.textContent = 'Kopiert!';
          setTimeout(() => { btn.textContent = 'Kopier'; }, 2000);
        }
      });
    };

    makeCopyHandler('portal-link-input', 'copy-portal-link');
    makeCopyHandler('ssb-link-input', 'copy-ssb-link');
  };

  // Reuse cached ID if the selection is unchanged
  if (!needsLoading) {
    showLinks(_lastSavedQuery.id);
    return;
  }

  try {
    const result = await api.saveSavedQuery(
      AppState.selectedTable.id,
      AppState.variableSelection,
      {
        stub: layout ? layout.rows : [],
        heading: layout ? layout.columns : [],
        codelistIds: AppState.activeCodelistIds || {},
        lang: getCurrentApiLang()
      }
    );

    const id = result.id || result.savedQuery?.id;
    if (!id) throw new Error('Ingen ID i svar fra API');

    _lastSavedQuery = { fingerprint, id };
    showLinks(id);

  } catch (e) {
    logger.error('[TableDisplay] Failed to save query:', e);
    document.getElementById('save-query-content').innerHTML =
      '<p class="error-message">Kunne ikke lagre spørringen: ' + escapeHtml(e.message) + '</p>';
  }
}
