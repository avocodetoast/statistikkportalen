/**
 * Source Status UI — API-statusbadge i headeren + statuspanel.
 *
 * Viser en klikkbar badge («3/3 API-er lastet inn», grønn/gul/rød) drevet av
 * fasadens katalogstatus (api.getSourceStatus / api.onSourceStatusChange —
 * se js/sources/source-registry.js). Klikk åpner et panel med én rad per
 * aktivert kilde: status, tabellantall, cache-info (alder/stale), feilmelding,
 * og knapper for retry/refresh per kilde, «Oppdater alle» og tøm cache per
 * kilde. Retry/refresh går via BrowserState.reloadSource som merger kildens
 * tabeller inn og bygger emnetreet på nytt; browse-visningene re-rendres.
 *
 * Fargesemantikk: grønn = alle kilder ferske; gul = alle lastet men minst én
 * stale/delvis/lastende; rød = minst én kilde helt uten data.
 *
 * Laster etter front-page.js (trenger translations, utils, fasaden og
 * BrowserState); ingenting senere avhenger av denne.
 */
(function () {
  'use strict';

  const logger = window.logger || console;

  const PANEL_ID = 'source-status-dialog';
  const CONTENT_ID = 'source-status-content';
  const BROWSE_VIEWS = ['home', 'search', 'topic'];

  let _badge = null;
  let _removeEscape = null;
  const _pending = new Set(); // kilder med pågående retry/refresh

  /** Kildens visningsnavn fra AppConfig.sources[id].displayName (nb-fallback). */
  function sourceDisplayName(sourceId) {
    const src = (window.AppConfig && AppConfig.sources && AppConfig.sources[sourceId]) || {};
    const name = src.displayName;
    if (!name) return sourceId;
    if (typeof name === 'string') return name;
    const lang = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'nb';
    return name[lang] || name.nb || name.en || sourceId;
  }

  function formatAge(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return tpl('apiStatus.age.minutes', Math.max(min, 1));
    const hours = Math.round(min / 60);
    if (hours < 24) return tpl('apiStatus.age.hours', hours);
    return tpl('apiStatus.age.days', Math.round(hours / 24));
  }

  /** Oppdater badgen (tekst + farge) fra gjeldende status; re-rendrer åpent panel. */
  function update() {
    if (!_badge) return;
    const statuses = api.getSourceStatus();
    if (!statuses.length) return; // ingen aggregering kjørt ennå

    const total = statuses.length;
    const loaded = statuses.filter(s => s.status === 'ok' || s.status === 'partial').length;
    const degraded = statuses.some(s =>
      s.stale || s.status === 'partial' || s.status === 'loading');

    _badge.textContent = tpl('apiStatus.badge', loaded, total);
    _badge.title = t('apiStatus.badgeTitle');
    _badge.classList.remove('status-ok', 'status-warn', 'status-error');
    _badge.classList.add(
      loaded < total ? 'status-error' : (degraded ? 'status-warn' : 'status-ok'));
    _badge.hidden = false;

    renderPanelContent();
  }

  // ---- Statuspanel ----

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
    if (_removeEscape) { _removeEscape(); _removeEscape = null; }
  }

  function openPanel() {
    closePanel();

    const html = `
      <div class="dialog-overlay" id="${PANEL_ID}">
        <div class="dialog-container source-status-dialog" style="max-width: 560px;">
          <div class="dialog-header">
            <h3>${escapeHtml(t('apiStatus.title'))}</h3>
            <button class="dialog-close" id="source-status-close"
                    aria-label="${escapeHtml(t('apiStatus.close'))}">&times;</button>
          </div>
          <div class="dialog-content" id="${CONTENT_ID}"></div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    const dialog = document.getElementById(PANEL_ID);
    const close = () => closePanel();
    _removeEscape = addEscapeHandler(close);
    document.getElementById('source-status-close')?.addEventListener('click', close);

    // Lukk kun når mousedown OG click begge traff overlayet (samme mønster
    // som table-save-query.js — hindrer utilsiktet lukking ved tekstmarkering).
    let mouseDownOnOverlay = false;
    dialog.addEventListener('mousedown', (e) => {
      mouseDownOnOverlay = e.target === dialog;
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && mouseDownOnOverlay) close();
    });

    // Én delegert klikklytter overlever re-rendring av innholdet.
    document.getElementById(CONTENT_ID).addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const sourceId = btn.dataset.source;
      if (action === 'retry' || action === 'refresh') {
        reloadSource(sourceId);
      } else if (action === 'clear-cache') {
        clearSourceCache(sourceId);
      } else if (action === 'refresh-all') {
        refreshAll();
      }
    });

    renderPanelContent();
  }

  /** Én rad i panelet for én kildes status. */
  function renderSourceRow(s) {
    const pending = _pending.has(s.sourceId);
    const statusKey = pending ? 'loading' : s.status;
    const name = sourceDisplayName(s.sourceId);

    const lines = [];
    if (s.status === 'ok' || s.status === 'partial') {
      lines.push(escapeHtml(tpl('apiStatus.tableCount', s.tableCount)));
      if (s.fromCache && s.fetchedAt) {
        lines.push(escapeHtml(
          t('apiStatus.fromCache') + ' · ' +
          tpl('apiStatus.fetchedAgo', formatAge(Date.now() - s.fetchedAt))));
      }
      if (s.stale) {
        lines.push('<span class="source-status-stale">' +
          escapeHtml(t('apiStatus.stale')) + '</span>');
      }
      if (s.partial && s.partial.length) {
        lines.push('<span class="source-status-stale">' +
          escapeHtml(tpl('apiStatus.failedSubsources', s.partial.join(', '))) + '</span>');
      }
    }
    if (s.status === 'error' && s.error) {
      lines.push('<span class="source-status-error-msg">' + escapeHtml(s.error) + '</span>');
    }

    const actionBtn = pending
      ? `<button class="btn-secondary" disabled>${escapeHtml(t('apiStatus.loading'))}</button>`
      : s.status === 'error'
        ? `<button class="btn-secondary" data-action="retry" data-source="${escapeHtml(s.sourceId)}">${escapeHtml(t('apiStatus.retry'))}</button>`
        : `<button class="btn-secondary" data-action="refresh" data-source="${escapeHtml(s.sourceId)}">${escapeHtml(t('apiStatus.refresh'))}</button>`;

    const clearBtn =
      `<button class="btn-secondary source-status-clear" data-action="clear-cache" ` +
      `data-source="${escapeHtml(s.sourceId)}" ${pending ? 'disabled' : ''}>` +
      escapeHtml(t('apiStatus.clearSourceCache')) + '</button>';

    return `
      <div class="source-status-row">
        <div class="source-status-info">
          <div class="source-status-name">
            <span class="source-status-dot dot-${escapeHtml(statusKey)}" aria-hidden="true"></span>
            ${escapeHtml(name)}
            <span class="source-status-state">${escapeHtml(t('apiStatus.' + statusKey))}</span>
          </div>
          ${lines.length ? '<div class="source-status-details">' + lines.join('<br>') + '</div>' : ''}
        </div>
        <div class="source-status-actions">
          ${actionBtn}
          ${clearBtn}
        </div>
      </div>
    `;
  }

  /** Re-rendrer panelinnholdet (no-op når panelet er lukket). */
  function renderPanelContent() {
    const content = document.getElementById(CONTENT_ID);
    if (!content) return;

    const statuses = api.getSourceStatus();
    const anyPending = _pending.size > 0;
    content.innerHTML =
      statuses.map(renderSourceRow).join('') +
      `<div class="source-status-footer">
        <button class="btn-secondary" data-action="refresh-all" ${anyPending ? 'disabled' : ''}>
          ${escapeHtml(t('apiStatus.refreshAll'))}
        </button>
      </div>`;
  }

  // ---- Handlinger ----

  async function reloadSource(sourceId) {
    if (!sourceId || _pending.has(sourceId)) return;
    _pending.add(sourceId);
    renderPanelContent();
    try {
      await BrowserState.reloadSource(sourceId, { force: true });
      if (BROWSE_VIEWS.includes(AppState.currentView)) {
        renderCurrentView();
      }
    } catch (e) {
      // Status er allerede satt til 'error' av fasaden; panelet viser meldingen.
      logger.error('[SourceStatus] Reload av «' + sourceId + '» feilet:', e);
    } finally {
      _pending.delete(sourceId);
      update();
    }
  }

  /** Sekvensielt (respekterer SSB-throttlen) — én kilde av gangen. */
  async function refreshAll() {
    const ids = api.getSourceStatus().map(s => s.sourceId);
    for (const id of ids) {
      await reloadSource(id);
    }
  }

  async function clearSourceCache(sourceId) {
    const c = api.cache;
    if (!c || typeof c.clearForSource !== 'function') return;
    const removed = await c.clearForSource(sourceId);
    logger.log('[SourceStatus] Tømte ' + removed + ' cacheoppføringer for «' + sourceId + '»');
    renderPanelContent();
  }

  // ---- Init ----

  function init() {
    _badge = document.getElementById('api-status-badge');
    if (!_badge) return;
    _badge.setAttribute('aria-live', 'polite');
    _badge.addEventListener('click', openPanel);
    api.onSourceStatusChange(update);
    update(); // fang status som allerede finnes (init kan ha rukket å kjøre)
  }

  window.SourceStatusUI = {
    init: init,
    /** Re-render badge + panel (kalles ved språkbytte fra applyTranslatableUI). */
    refresh: update
  };
})();
