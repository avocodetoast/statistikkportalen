/**
 * Utility functions and global state management
 */

// ========== Loading Indicator ==========

function showLoading(show, message = 'Laster...') {
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
  strong.textContent = 'Feil: ';
  msgDiv.appendChild(strong);
  msgDiv.appendChild(document.createTextNode(message));

  if (technicalError) {
    const btn = document.createElement('button');
    btn.textContent = 'Se tekniske detaljer';
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

function renderCurrentView() {
  const content = document.getElementById('content');
  if (!content) return;

  switch(AppState.currentView) {
    case 'home':
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
      content.innerHTML = '<p>Ukjent visning</p>';
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
  if (!label) return 'Uten navn';
  const match = label.match(/^\d+:\s*(.+)$/);
  return match ? match[1] : label;
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
