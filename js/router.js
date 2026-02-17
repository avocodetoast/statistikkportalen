/**
 * URLRouter - Client-side hash-based routing with state persistence
 *
 * Handles URL encoding/decoding, route parsing, and state restoration
 * for the SSB Statistics Browser application.
 */

const URLRouter = {
  /**
   * Encode object to URL-safe base64
   * @param {Object} obj - Object to encode
   * @returns {string|null} URL-safe base64 string or null if empty
   */
  encode(obj) {
    if (!obj || Object.keys(obj).length === 0) return null;

    try {
      const json = JSON.stringify(obj);
      const base64 = btoa(unescape(encodeURIComponent(json)));
      // Replace URL-unsafe characters: + → -, / → _, = → ~
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '~');
    } catch (e) {
      logger.error('[Router] Failed to encode:', e);
      return null;
    }
  },

  /**
   * Decode URL-safe base64 to object
   * @param {string} str - Base64 string to decode
   * @returns {Object|null} Decoded object or null on error
   */
  decode(str) {
    if (!str) return null;

    try {
      // Restore original base64 characters: - → +, _ → /, ~ → =
      const base64 = str.replace(/-/g, '+').replace(/_/g, '/').replace(/~/g, '=');
      const json = decodeURIComponent(escape(atob(base64)));
      const obj = JSON.parse(json);

      // Validate structure
      if (typeof obj !== 'object' || obj === null) {
        throw new Error('Invalid object structure');
      }

      return obj;
    } catch (e) {
      logger.error('[Router] Failed to decode parameter:', e);
      return null;
    }
  },

  /**
   * Parse URL hash and extract route + parameters
   * @param {string} hash - Hash to parse (defaults to current location.hash)
   * @returns {Object} {route: string, params: Object}
   */
  parseHash(hash = window.location.hash) {
    // Remove leading # and parse route and query string
    const match = hash.match(/^#([^?]+)(\?(.+))?$/);

    if (!match) {
      return { route: '', params: {} };
    }

    const route = match[1] || '';
    const queryString = match[3] || '';

    // Parse query parameters
    const params = {};
    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      for (const [key, value] of searchParams.entries()) {
        params[key] = value;
      }
    }

    return { route, params };
  },

  /**
   * Build hash URL from route and parameters
   * @param {string} route - Route path (e.g., "browser", "variables/13760")
   * @param {Object} params - Query parameters
   * @returns {string} Complete hash URL
   */
  buildHash(route, params = {}) {
    const queryParts = [];

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        queryParts.push(`${key}=${encodeURIComponent(value)}`);
      }
    }

    if (queryParts.length === 0) {
      return `#${route}`;
    }

    return `#${route}?${queryParts.join('&')}`;
  },

  /**
   * Navigate to a route (updates URL and triggers route handler)
   * @param {string} route - Route path
   * @param {Object} params - Query parameters
   * @param {boolean} shouldPush - Whether to push or replace history state
   */
  navigateTo(route, params = {}, shouldPush = true) {
    const hash = this.buildHash(route, params);

    // Avoid duplicate history entries
    if (window.location.hash === hash) {
      return;
    }

    if (shouldPush) {
      history.pushState(null, '', hash);
    } else {
      history.replaceState(null, '', hash);
    }

    // Don't trigger route handler here - it will be called by popstate or manually
  },

  /**
   * Handle current route (called on popstate/initial load)
   * This is the main route dispatcher
   */
  async handleRoute() {
    const { route, params } = this.parseHash();

    logger.log('[Router] Handling route:', route, params);

    if (!route || route === 'home') {
      await this._handleHomeRoute(params);
    } else if (route === 'search') {
      await this._handleSearchRoute(params);
    } else if (route.startsWith('topic/')) {
      await this._handleTopicRoute(route, params);
    } else if (route.startsWith('variables/')) {
      await this._handleVariablesRoute(route, params);
    } else if (route.startsWith('table/')) {
      await this._handleTableRoute(route, params);
    } else if (route === 'browser' || route.startsWith('browser/') || route.startsWith('browser?')) {
      // Legacy redirect: #browser* → new routes
      this._handleLegacyBrowserRoute(route, params);
    } else {
      logger.warn('[Router] Unknown route:', route);
      this.navigateTo('home', {}, false);
      AppState.currentView = 'home';
      renderCurrentView();
    }
  },

  /**
   * Handle front page route (#home or empty hash)
   */
  async _handleHomeRoute(params) {
    logger.log('[Router] Home route');
    AppState.currentView = 'home';
    renderCurrentView();
  },

  /**
   * Handle search route (#search?q=...&disc=1&subj=be&freq=Annual&upd=30)
   */
  async _handleSearchRoute(params) {
    logger.log('[Router] Search route', params);
    BrowserState.searchFiltersFromParams(params);
    AppState.currentView = 'search';
    renderCurrentView();
  },

  /**
   * Handle topic route (#topic/be/be02?disc=1&freq=Monthly)
   */
  async _handleTopicRoute(route, params) {
    const pathStr = route.replace('topic/', '');
    const path = pathStr.split('/').filter(p => p);

    logger.log('[Router] Topic route - path:', path, 'params:', params);

    BrowserState.topicFiltersFromParams(params);
    AppState.topicPath = path;
    AppState.currentView = 'topic';
    renderCurrentView();
  },

  /**
   * Handle legacy #browser routes by redirecting to new routes
   */
  _handleLegacyBrowserRoute(route, params) {
    const path = route.replace('browser/', '').replace('browser', '');
    const query = params.q || '';
    const mode = params.mode || '';

    if (mode === 'search' || query) {
      // #browser?mode=search&q=... → #search?q=...
      const newParams = {};
      if (query) newParams.q = query;
      this.navigateTo('search', newParams, false);
      this.handleRoute();
    } else if (path) {
      // #browser/be/be02 → #topic/be/be02
      this.navigateTo('topic/' + path, {}, false);
      this.handleRoute();
    } else {
      // #browser → #home
      this.navigateTo('home', {}, false);
      this.handleRoute();
    }
  },

  /**
   * Handle variables view route
   * @param {string} route - Route path (variables/{tableId})
   * @param {Object} params - Query parameters (v = selections, c = codelists)
   */
  async _handleVariablesRoute(route, params) {
    const tableId = route.replace('variables/', '');

    if (!tableId) {
      logger.warn('[Router] No table ID in variables route');
      this.navigateTo('home', {}, false);
      return;
    }

    logger.log('[Router] Variables route - tableId:', tableId);

    // Restore navigation context from sessionStorage if available for this table
    try {
      const stored = JSON.parse(sessionStorage.getItem('ssb_navRef') || 'null');
      AppState.navigationRef = (stored && stored.tableId === tableId) ? stored.ref : null;
    } catch (e) {
      AppState.navigationRef = null;
    }

    // Decode parameters
    const variableSelection = params.v ? this.decode(params.v) : null;
    const codelistIds = params.c ? this.decode(params.c) : null;

    if (variableSelection) {
      logger.log('[Router] Decoded variable selection:', variableSelection);
    }

    if (codelistIds) {
      logger.log('[Router] Decoded codelist IDs:', codelistIds);
    }

    // Set up AppState
    AppState.selectedTable = {
      id: tableId,
      label: tableId + ': (laster...)'
    };

    // Restore variable selection from URL
    if (variableSelection) {
      AppState.variableSelection = variableSelection;
    } else {
      AppState.variableSelection = {};
    }

    // Restore codelist IDs from URL
    if (codelistIds) {
      AppState.activeCodelistIds = codelistIds;
    } else {
      AppState.activeCodelistIds = {};
    }

    AppState.currentView = 'variables';

    // Render view (will fetch metadata and restore selections)
    renderCurrentView();
  },

  /**
   * Handle table view route
   * @param {string} route - Route path (table/{tableId})
   * @param {Object} params - Query parameters (v = selections, c = codelists, l = layout)
   */
  async _handleTableRoute(route, params) {
    const tableId = route.replace('table/', '');

    if (!tableId) {
      logger.warn('[Router] No table ID in table route');
      this.navigateTo('home', {}, false);
      return;
    }

    logger.log('[Router] Table route - tableId:', tableId);

    // Restore navigation context from sessionStorage if available for this table
    try {
      const stored = JSON.parse(sessionStorage.getItem('ssb_navRef') || 'null');
      AppState.navigationRef = (stored && stored.tableId === tableId) ? stored.ref : null;
    } catch (e) {
      AppState.navigationRef = null;
    }

    // Decode parameters
    const variableSelection = params.v ? this.decode(params.v) : null;
    const codelistIds = params.c ? this.decode(params.c) : null;
    const layout = params.l ? this.decode(params.l) : null;

    // Validate that we have variable selections (required for table view)
    if (!variableSelection || Object.keys(variableSelection).length === 0) {
      logger.warn('[Router] No variable selection in table route - redirecting to variables');
      this.navigateTo(`variables/${tableId}`, {}, false);
      return;
    }

    logger.log('[Router] Decoded variable selection:', variableSelection);
    if (codelistIds) logger.log('[Router] Decoded codelist IDs:', codelistIds);
    if (layout) logger.log('[Router] Decoded layout:', layout);

    // Set up AppState
    AppState.selectedTable = {
      id: tableId,
      label: tableId + ': (laster...)'
    };

    AppState.variableSelection = variableSelection;

    if (codelistIds) {
      AppState.activeCodelistIds = codelistIds;
    } else {
      AppState.activeCodelistIds = {};
    }

    if (layout) {
      AppState.tableLayout = layout;
    } else {
      AppState.tableLayout = { rows: [], columns: [] };
    }

    AppState.currentView = 'table';

    // Render view (will fetch data)
    renderCurrentView();
  }
};

/**
 * SSBURLMapper - URL mapping for Chrome extension integration
 *
 * Converts URLs from SSB's statistikkbank to app hash URLs
 */
const SSBURLMapper = {
  /**
   * Convert SSB.no URL to app hash
   *
   * @param {string} ssbUrl - SSB statistikkbank URL
   * @returns {string} App hash URL
   *
   * @example
   * fromSSB('https://www.ssb.no/statbank/table/13760')
   * // Returns: '#variables/13760'
   *
   * @example
   * fromSSB('https://www.ssb.no/statbank/?query=unemployment')
   * // Returns: '#browser?q=unemployment'
   */
  fromSSB(ssbUrl) {
    try {
      const url = new URL(ssbUrl);

      // Table view: /statbank/table/{tableId}
      const tableMatch = url.pathname.match(/\/statbank\/table\/(\d+)/);
      if (tableMatch) {
        const tableId = tableMatch[1];
        return URLRouter.buildHash(`variables/${tableId}`, {});
      }

      // Search: /statbank/?query={term}
      const query = url.searchParams.get('query');
      if (query) {
        return URLRouter.buildHash('search', { q: query });
      }

      // Default to home
      return URLRouter.buildHash('home', {});
    } catch (e) {
      logger.error('[SSBURLMapper] Invalid SSB URL:', e);
      return URLRouter.buildHash('home', {});
    }
  },

  /**
   * Generate deep link from current app state
   * @returns {string} Full URL with hash
   */
  toDeepLink() {
    const baseUrl = window.location.origin + window.location.pathname;
    return baseUrl + window.location.hash;
  }
};

// Expose globally
window.URLRouter = URLRouter;
window.SSBURLMapper = SSBURLMapper;
