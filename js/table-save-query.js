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
    showError(t('saveQuery.noActiveQuery'));
    return;
  }

  const branding = sourceBrandingForTable(AppState.selectedTable.id);

  // Fingerprint the current selection so we can skip the POST if nothing changed
  const layout = AppState.tableLayout;
  const fingerprint = JSON.stringify({
    tableId: AppState.selectedTable.id,
    selection: AppState.variableSelection,
    codelistIds: AppState.activeCodelistIds || {},
    rows: layout ? layout.rows : [],
    columns: layout ? layout.columns : []
  });

  const needsLoading = !(_lastSavedQuery && _lastSavedQuery.fingerprint === fingerprint);

  // Skall, ESC, bakgrunnsklikk (inkl. guarden mot lukking ved tekstmarkering
  // i lenkefeltene) og ARIA: js/dialog.js
  openDialog({
    id: 'save-query-dialog',
    title: t('saveQuery.dialogTitle'),
    maxWidth: '540px',
    bodyHtml: `<div id="save-query-content">
          ${needsLoading ? `<p class="loading-message">${escapeHtml(tpl('saveQuery.saving', branding.name))}</p>` : ''}
        </div>`
  });

  const showLinks = (id) => {
    const ssbUrl = 'https://www.ssb.no/statbank/sq/' + id;
    const portalUrl = window.location.origin + window.location.pathname + '#sq/' + id;

    document.getElementById('save-query-content').innerHTML = `
      <p>${escapeHtml(t('saveQuery.saved'))}</p>

      <div class="form-group">
        <label class="form-label">${escapeHtml(tpl('saveQuery.openInPortal', AppConfig.app.name))}</label>
        <div class="save-query-link-row">
          <input type="text" class="save-query-link-input" readonly
                 id="portal-link-input" value="${escapeHtml(portalUrl)}">
          <button class="btn-secondary" id="copy-portal-link">${escapeHtml(t('saveQuery.copy'))}</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${escapeHtml(tpl('saveQuery.openInSource', branding.name))}</label>
        <div class="save-query-link-row">
          <input type="text" class="save-query-link-input" readonly
                 id="ssb-link-input" value="${escapeHtml(ssbUrl)}">
          <button class="btn-secondary" id="copy-ssb-link">${escapeHtml(t('saveQuery.copy'))}</button>
        </div>
        <a href="${escapeHtml(ssbUrl)}" target="_blank" rel="noopener"
           style="display:inline-block; margin-top: 6px; font-size: 0.9em;">
          ${escapeHtml(tpl('saveQuery.openInSourceLink', branding.name))}
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
          btn.textContent = t('saveQuery.copied');
          setTimeout(() => { btn.textContent = t('saveQuery.copy'); }, 2000);
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
    if (!id) throw new Error(t('saveQuery.noIdInResponse'));

    _lastSavedQuery = { fingerprint, id };
    showLinks(id);

  } catch (e) {
    logger.error('[TableDisplay] Failed to save query:', e);
    document.getElementById('save-query-content').innerHTML =
      `<p class="error-message">${escapeHtml(tpl('saveQuery.saveFailed', e.message))}</p>`;
  }
}
