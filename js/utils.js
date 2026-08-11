/**
 * Utility functions and global state management
 */

// ========== Loading Indicator ==========

function showLoading(show, message = t('loading.app')) {
  const loader = document.getElementById('loading-indicator');
  if (loader) {
    loader.textContent = message;
    loader.style.display = show ? 'block' : 'none';
  }
}

// ========== Error Handling ==========

function showError(message, technicalError = null) {
  const errorDiv = document.getElementById('error-display');
  if (!errorDiv) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'error-message';

  const strong = document.createElement('strong');
  strong.textContent = t('error.prefix') + ' ';
  msgDiv.appendChild(strong);
  msgDiv.appendChild(document.createTextNode(message));

  if (technicalError) {
    const btn = document.createElement('button');
    btn.textContent = t('error.details');
    btn.addEventListener('click', () => logger.log(window.lastError));
    msgDiv.appendChild(document.createTextNode(' '));
    msgDiv.appendChild(btn);

    window.lastError = technicalError;
    logger.error(message, technicalError);
  }

  errorDiv.innerHTML = '';
  errorDiv.appendChild(msgDiv);

  // Auto-hide after configured delay
  setTimeout(() => errorDiv.innerHTML = '', AppConfig.ui.errorAutoHideMs);
}

function clearError() {
  const errorDiv = document.getElementById('error-display');
  if (errorDiv) {
    errorDiv.innerHTML = '';
  }
}

// ========== Safe API Call Wrapper ==========

async function safeApiCall(apiFunction, errorMessage) {
  try {
    showLoading(true);
    clearError();
    const result = await apiFunction();
    showLoading(false);
    return result;
  } catch (error) {
    showLoading(false);
    showError(errorMessage, error);
    return null;
  }
}

// ========== Global Application State ==========

const AppState = {
  currentView: 'home', // 'home' | 'search' | 'topic' | 'variables' | 'table'
  selectedTable: null,
  variableSelection: {},
  activeCodelistIds: {},
  tableData: null,
  tableLayout: { rows: [], columns: [] },
  topicPath: [], // Current topic navigation path (e.g., ['be', 'be02'])
  navigationRef: null, // Hash-path to navigate back to (e.g., 'topic/be/be02'), stored in sessionStorage

  setView(view) {
    this.currentView = view;
    this._updateHash(view);
    renderCurrentView();
  },

  setSelectedTable(table) {
    this.selectedTable = table;
    this.variableSelection = {};
    this.activeCodelistIds = {};
  },

  /**
   * Reset table-related state only (preserves browse state)
   */
  resetTableState() {
    this.selectedTable = null;
    this.variableSelection = {};
    this.activeCodelistIds = {};
    this.tableData = null;
    this.tableLayout = { rows: [], columns: [] };
    this.navigationRef = null;
    sessionStorage.removeItem('ssb_navRef');
  },

  /**
   * Full reset
   */
  reset() {
    this.resetTableState();
    this.topicPath = [];
  },

  /**
   * Update URL hash to reflect current view with encoded state parameters.
   * Only handles variables and table views.
   * Home/search/topic manage their own URLs.
   */
  _updateHash(view) {
    let route;
    const params = {};

    switch (view) {
      case 'variables':
        if (!this.selectedTable) return;

        route = `variables/${this.selectedTable.id}`;

        if (Object.keys(this.variableSelection).length > 0) {
          params.v = URLRouter.encode(this.variableSelection);
        }

        if (Object.keys(this.activeCodelistIds).length > 0) {
          params.c = URLRouter.encode(this.activeCodelistIds);
        }
        break;

      case 'table':
        if (!this.selectedTable) return;

        route = `table/${this.selectedTable.id}`;

        if (Object.keys(this.variableSelection).length > 0) {
          params.v = URLRouter.encode(this.variableSelection);
        }

        if (Object.keys(this.activeCodelistIds).length > 0) {
          params.c = URLRouter.encode(this.activeCodelistIds);
        }

        if (this.tableLayout && (this.tableLayout.rows.length > 0 || this.tableLayout.columns.length > 0)) {
          params.l = URLRouter.encode(this.tableLayout);
        }
        break;

      default:
        // Home/search/topic manage their own URLs
        return;
    }

    URLRouter.navigateTo(route, params, true);
  }
};

// ========== View Rendering Router ==========

let _seoHomeTitleKept = false;

function renderCurrentView() {
  const content = document.getElementById('content');
  if (!content) return;

  if (window.SEOHead) SEOHead.sync();

  switch(AppState.currentView) {
    case 'home':
      // Pre-rendret forside har en emnerik tittel som skal stå i Googles
      // snapshot — behold den ved første rendring, men bare da (navigerer
      // brukeren bort og hjem igjen, må tittelen tilbakestilles som vanlig)
      if (seoContentMatchesRoute([]) && !_seoHomeTitleKept) {
        _seoHomeTitleKept = true;
      } else {
        updatePageTitle([]);
      }
      renderFrontPage(content);
      break;
    case 'search':
      renderSearchView(content);
      break;
    case 'topic':
      renderTopicView(content);
      break;
    case 'variables':
      renderVariableSelection(content);
      break;
    case 'table':
      renderTableDisplay(content);
      break;
    default:
      content.innerHTML = '<p>' + t('error.unknownView') + '</p>';
  }
}

// ========== Hash Routing ==========

/**
 * Handle browser back/forward navigation via URL hash.
 *
 * Delegates to URLRouter for parsing and state restoration.
 * Hash formats:
 *   #home                                    -> front page
 *   #search?q=...&disc=1&subj=be&freq=...   -> search results
 *   #topic/be/be02?disc=1&freq=Monthly       -> topic navigation
 *   #variables/13760?v={enc}&c={enc}         -> variable selection
 *   #table/13760?v={enc}&c={enc}&l={enc}     -> table display
 */
function handleHashChange() {
  URLRouter.handleRoute();
}

// ========== Helper Functions ==========

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Format a number for display
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted number
 */
function formatNumber(value, decimals = null) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const num = parseFloat(value);
  if (isNaN(num)) {
    return value.toString();
  }

  // Auto-detect decimals if not specified: use the original precision
  if (decimals === null) {
    const str = String(value);
    const dotIndex = str.indexOf('.');
    decimals = dotIndex === -1 ? 0 : str.length - dotIndex - 1;
  }

  // Use Norwegian number formatting (space as thousands separator, comma as decimal)
  return num.toFixed(decimals).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Celletak for kilden som eier en tabell.
 *
 * Grensene er KILDESPESIFIKKE, og de to semantikkene må ikke blandes:
 *   maxCells       HARD grense — kun SSB, der den er en ekte API-regel
 *                  (maxDataCells fra /config, 403 ved brudd). null = ingen
 *                  hard grense, og Hent-knappen skal da aldri sperres.
 *   warnCells      MYK: stor spørring, kan ta tid.
 *   slowWarnCells  MYK: vil trolig gå i tidsavbrudd.
 *   denseWarnCells MYK, mot det tette kryssproduktet (klientminne).
 *
 * Norges Bank og FHI har ingen cellegrense i det hele tatt (målt 2026-08-02,
 * se API-FINDINGS.md) — store uttak der er trege, ikke ulovlige.
 *
 * Ukjent kilde (eller en instans uten api.sourceFor, jf. config-sv.js) faller
 * tilbake på AppConfig.limits-reserven.
 *
 * @param {string} tableId
 * @returns {{maxCells: number|null, warnCells: number|null,
 *            slowWarnCells: number|null, denseWarnCells: number|null}}
 */
function cellLimitsFor(tableId) {
  const limits = (window.AppConfig && AppConfig.limits) || {};
  const fallback = {
    maxCells: limits.maxCells != null ? limits.maxCells : null,
    warnCells: limits.cellWarningThreshold != null ? limits.cellWarningThreshold : null,
    slowWarnCells: null,
    denseWarnCells: null
  };

  const sourceId = (typeof api !== 'undefined' && api && typeof api.sourceFor === 'function')
    ? api.sourceFor(tableId)
    : null;
  const entry = (sourceId && limits.bySource) ? limits.bySource[sourceId] : null;

  return entry ? Object.assign({}, fallback, entry) : fallback;
}

/**
 * Generate a timestamp string for file names
 * @returns {string} - Timestamp in format YYYYMMDD_HHMMSS
 */
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');

  return year + month + day + '_' + hour + minute + second;
}

/**
 * Extract clean title from label (removes ID prefix like "13760: ")
 * @param {string} label - Table label
 * @returns {string} - Clean title
 */
function extractTableTitle(label) {
  if (!label) return t('table.unnamed');
  const match = label.match(/^\d+:\s*(.+)$/);
  return match ? match[1] : label;
}

/**
 * Kildenøkkel for en tabell-id, avledet fra AppConfig.sources[*].idPrefix.
 * Tabell-id-er uten et konfigurert prefiks tilhører standardkilden SSB.
 * @param {string} tableId
 * @returns {string}
 */
function sourceKeyForTableId(tableId) {
  const s = String(tableId || '');
  const sources = AppConfig.sources || {};
  for (const [key, source] of Object.entries(sources)) {
    if (source && typeof source === 'object' && source.idPrefix && s.indexOf(source.idPrefix) === 0) {
      return key;
    }
  }
  return 'ssb';
}

/**
 * Kildeattribusjon ({name, nameFull, url, licenseUrl?, licenseName?}) for en
 * tabell-id: AppConfig.sources.<kilde>.branding når det finnes, ellers det
 * globale AppConfig.source. Speiler sourceBrandingFor i seo-sources.mjs.
 * @param {string} tableId
 * @returns {Object}
 */
function sourceBrandingForTable(tableId) {
  const key = sourceKeyForTableId(tableId);
  const srcCfg = AppConfig.sources && AppConfig.sources[key];
  return (srcCfg && srcCfg.branding) || AppConfig.source || {};
}

/**
 * Tabell-id slik den VISES i tabellistenes id-kolonne: det konfigurerte
 * kildeprefikset strippes, siden kilden nå fremgår av badgen bak tittelen —
 * å gjenta den i id-en er støy og presser lange id-er ut i ellipse.
 * Den fulle id-en beholdes i rad-datasettet og som hover-tittel, så den
 * fortsatt kan leses av og kopieres.
 * @param {string} tableId
 * @returns {string}
 */
function displayTableId(tableId) {
  const s = String(tableId || '');
  const key = sourceKeyForTableId(s);
  const source = AppConfig.sources && AppConfig.sources[key];
  const prefix = source && source.idPrefix;
  return prefix ? s.slice(prefix.length) : s;
}

/**
 * Kilde-badge for en tabell-id: markerer tabeller som IKKE kommer fra
 * standardkilden (SSB). SSB-tabeller er normalen og merkes ikke — badgen
 * ville da stått på ~95 % av radene uten å skille noe.
 *
 * Teksten er `branding.shortName` (fallback `branding.name`), hele
 * institusjonsnavnet `branding.nameFull` — se AppConfig.sources.*.branding
 * i config.js.
 *
 * Navnet ligger i `data-tooltip` og vises via CSS (css/menu-navigator.css),
 * ikke i `title`: nettleserens innebygde tooltip har ~1 sekunds forsinkelse
 * som ikke kan overstyres. `aria-label` gir skjermlesere det samme navnet.
 * Speiles av sourceBadgeHtml() i scripts/lib/seo-sources.mjs (samme klasser
 * og markup, slik at statiske SEO-sider ser identiske ut).
 *
 * @param {string} tableId
 * @returns {string} HTML, eller '' for SSB / kilder uten egen branding
 */
function sourceBadgeHTML(tableId) {
  const key = sourceKeyForTableId(tableId);
  if (key === 'ssb') return '';
  // Egen branding kreves: sourceBrandingForTable faller tilbake til det
  // globale (SSB-)kildeobjektet, og å merke en NB-tabell «SSB» er verre enn
  // ingen badge.
  const srcCfg = AppConfig.sources && AppConfig.sources[key];
  const branding = srcCfg && srcCfg.branding;
  if (!branding) return '';
  const text = branding.shortName || branding.name;
  if (!text) return '';
  const title = branding.nameFull || branding.name || text;
  return `<span class="source-badge source-badge--${escapeHtml(key)}" data-tooltip="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

/**
 * Alle AKTIVERTE kilder som {key, branding}, i config-rekkefølge. Kilder uten
 * egen branding (SSB) faller tilbake til det globale AppConfig.source.
 * Instanser uten `sources` (f.eks. SCB-instansen, config-sv.js) gir én
 * ssb-oppføring med det globale kildeobjektet.
 * @returns {{key: string, branding: Object}[]}
 */
function listEnabledSources() {
  const result = [];
  const sources = AppConfig.sources || {};
  Object.keys(sources).forEach(key => {
    const src = sources[key];
    // Hopp over ikke-kildeoppføringer (fetchTimeoutMs o.l.) og deaktiverte kilder
    if (!src || typeof src !== 'object' || !src.adapter || !src.enabled) return;
    const branding = src.branding || AppConfig.source;
    if (branding) result.push({ key: key, branding: branding });
  });
  if (!result.length && AppConfig.source) {
    result.push({ key: 'ssb', branding: AppConfig.source });
  }
  return result;
}

/**
 * Branding-objekter for alle aktiverte kilder — brukes av footeren
 * («Data fra … , … og …»). Se listEnabledSources().
 * @returns {Object[]}
 */
function listSourceBrandings() {
  return listEnabledSources().map(s => s.branding);
}

/**
 * Update the browser tab title.
 * @param {string[]} parts - Title parts prepended before "Statistikkportalen"
 */
function updatePageTitle(parts) {
  document.title = [...parts, AppConfig.app?.name || 'Statistikkportalen'].join(' – ');
  if (window.SEOHead) SEOHead.syncTitle();
}

/**
 * True når siden er pre-rendret av SEO-generatoren (scripts/generate-seo-pages.mjs)
 * og det statiske innholdet i #content matcher gjeldende rute. Visningene lar
 * da innholdet stå som plassholder under første datalasting i stedet for å
 * vise spinner — unngår at siden «blinker» ved oppstart.
 * @param {string[]} topicPath - Rutens topic-path ([] for forsiden)
 * @returns {boolean}
 */
function seoContentMatchesRoute(topicPath) {
  const seoPath = window.__SEO_TOPIC_PATH__;
  return Array.isArray(seoPath) && seoPath.join('/') === (topicPath || []).join('/');
}

/**
 * True når siden er en pre-rendret tabellside (/table/{id}/ fra SEO-generatoren)
 * for nettopp denne tabellen — da skal den genererte tittelen stå urørt.
 * @param {string} tableId - Tabell-id fra ruten
 * @returns {boolean}
 */
function seoTableMatchesRoute(tableId) {
  return !!window.__SEO_TABLE_ID__ && String(window.__SEO_TABLE_ID__) === String(tableId);
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Register an Escape key handler that closes a dialog.
 * The handler removes itself when it fires. Call the returned function
 * to remove it early (e.g. when the dialog is closed by a button click).
 * @param {Function} closeFn - Function to call when Escape is pressed
 * @returns {Function} - Cleanup function to remove the listener
 */
function addEscapeHandler(closeFn) {
  const handler = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', handler);
      closeFn();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

// ========== Navigation Breadcrumb ==========

/**
 * Build breadcrumb HTML for variable-select and table-display views.
 * Shows the topic path that led to this table, plus the table itself as
 * the final (non-linked) crumb.
 *
 * - From topic navigation: uses the path recorded in AppState.navigationRef
 * - All other cases (search, direct URL, home): uses the table's first known
 *   path from BrowserState (requires BrowserState to be loaded first)
 *
 * Returns an empty string when no path context is available.
 *
 * @param {string} tableId    - Table ID (e.g. '09772')
 * @param {string} tableLabel - Human-readable table title (already extracted)
 * @returns {string} HTML string
 */
function buildNavigationBreadcrumb(tableId, tableLabel) {
  const mh = BrowserState && BrowserState.menuHierarchy;
  const ref = AppState.navigationRef;

  const tableCrumb = '<span class="breadcrumb-current">' +
    escapeHtml(tableId) + (tableLabel ? ' ' + escapeHtml(tableLabel) : '') +
    '</span>';

  function renderPathLinks(crumbs) {
    return crumbs.map((crumb, i) =>
      (i > 0 ? '<span class="breadcrumb-sep">/</span>' : '') +
      '<a href="#topic/' + crumb.path.join('/') + '" class="breadcrumb-link">' +
      escapeHtml(crumb.label) + '</a>'
    ).join('');
  }

  function wrapBreadcrumbs(innerHtml) {
    return '<div class="breadcrumbs">' + innerHtml +
      '<span class="breadcrumb-sep">/</span>' + tableCrumb + '</div>';
  }

  if (!mh) return '';

  // --- From topic navigation: use the exact path the user browsed ---
  if (ref && ref.startsWith('topic/')) {
    const pathStr = ref.replace('topic/', '').split('?')[0];
    const pathIds = pathStr.split('/').filter(p => p);
    if (pathIds.length > 0) {
      const crumbs = mh.getBreadcrumbs(pathIds);
      if (crumbs.length > 0) return wrapBreadcrumbs(renderPathLinks(crumbs));
    }
  }

  // --- All other cases: use table's first known path from BrowserState ---
  const tableObj = BrowserState.allTables.find(t => t.id === tableId);
  if (!tableObj || !tableObj.paths || tableObj.paths.length === 0) return '';
  const firstPathIds = tableObj.paths[0].map(p => p.id);
  const crumbs = mh.getBreadcrumbs(firstPathIds);
  if (crumbs.length === 0) return '';
  return wrapBreadcrumbs(renderPathLinks(crumbs));
}

/**
 * Detect if text is a saved-query URL and return the query ID.
 * Handles:
 *   https://www.ssb.no/statbank/sq/{id}          (SSB direct saved-query link)
 *   https://www.ssb.no/statbank/table/{id}?sq=N  (SSB table link with sq param)
 *   {any URL}?sq={id}                             (generic sq query param)
 *   {any URL}#sq/{id}                             (statistikkportalen deep-link)
 *
 * @param {string} text
 * @returns {string|null} - Numeric query ID, or null if not recognised
 */
function detectSavedQueryId(text) {
  if (!text) return null;
  const t = text.trim();
  // /statbank/sq/{id} path
  const pathMatch = t.match(/\/statbank\/sq\/(\d+)/);
  if (pathMatch) return pathMatch[1];
  // ?sq={id} or &sq={id} query parameter
  const paramMatch = t.match(/[?&]sq=(\d+)/);
  if (paramMatch) return paramMatch[1];
  // #sq/{id} hash (statistikkportalen deep-link)
  const hashMatch = t.match(/#sq\/(\d+)/);
  if (hashMatch) return hashMatch[1];
  return null;
}
