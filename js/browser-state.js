/**
 * BrowserState - Shared state and utilities for the browser views
 * (front page, search, topic navigation)
 *
 * Holds:
 * - The MenuHierarchy instance and loaded table data
 * - Independent filter objects for search and topic views
 * - Shared rendering helpers (table lists, date formatting, etc.)
 */

const BrowserState = {
  menuHierarchy: null,
  allTables: [],
  isLoaded: false,
  _initPromise: null,

  // Search view filters (independent from topic filters)
  searchFilters: {
    query: '',
    includeDiscontinued: true,
    subjectFilter: '',
    frequencyFilter: '',
    updatedFilter: '',
    enhanced: false
  },

  // Lazy search index for enhanced mode (built on first use, cached forever)
  _searchIndex: null,

  // Topic view filters (independent from search filters)
  // Reset when navigating to a new topic
  topicFilters: {
    includeDiscontinued: true,
    frequencyFilter: '',
    updatedFilter: ''
  },

  /**
   * Initialize: fetch all tables and build hierarchy (once)
   */
  async init() {
    if (this.isLoaded) return;

    // Prevent duplicate parallel inits
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    await this._initPromise;
  },

  async _doInit() {
    try {
      logger.log('[BrowserState] Fetching all tables (including discontinued)...');

      const response = await api.getTables({
        lang: 'no',
        pageSize: 10000,
        includeDiscontinued: true
      });

      this.allTables = response.tables;
      logger.log(`[BrowserState] Loaded ${this.allTables.length} tables`);

      this.menuHierarchy = new MenuHierarchy();
      this.menuHierarchy.buildHierarchy(this.allTables);

      this.isLoaded = true;
    } catch (error) {
      logger.error('[BrowserState] Error fetching tables:', error);
      this._initPromise = null;
      throw error;
    }
  },

  // ========== Filter ↔ URL sync ==========

  /**
   * Convert search filters to URL query params
   */
  searchFiltersToParams() {
    const params = {};
    if (this.searchFilters.query) params.q = this.searchFilters.query;
    if (!this.searchFilters.includeDiscontinued) params.disc = '0';
    if (this.searchFilters.subjectFilter) params.subj = this.searchFilters.subjectFilter;
    if (this.searchFilters.frequencyFilter) params.freq = this.searchFilters.frequencyFilter;
    if (this.searchFilters.updatedFilter) params.upd = this.searchFilters.updatedFilter;
    if (this.searchFilters.enhanced) params.enh = '1';
    return params;
  },

  /**
   * Set search filters from URL query params
   */
  searchFiltersFromParams(params) {
    this.searchFilters.query = params.q || '';
    this.searchFilters.includeDiscontinued = params.disc !== '0';
    this.searchFilters.subjectFilter = params.subj || '';
    this.searchFilters.frequencyFilter = params.freq || '';
    this.searchFilters.updatedFilter = params.upd || '';
    this.searchFilters.enhanced = params.enh === '1';
  },

  /**
   * Convert topic filters to URL query params
   */
  topicFiltersToParams() {
    const params = {};
    if (!this.topicFilters.includeDiscontinued) params.disc = '0';
    if (this.topicFilters.frequencyFilter) params.freq = this.topicFilters.frequencyFilter;
    if (this.topicFilters.updatedFilter) params.upd = this.topicFilters.updatedFilter;
    return params;
  },

  /**
   * Set topic filters from URL query params
   */
  topicFiltersFromParams(params) {
    this.topicFilters.includeDiscontinued = params.disc !== '0';
    this.topicFilters.frequencyFilter = params.freq || '';
    this.topicFilters.updatedFilter = params.upd || '';
  },

  /**
   * Reset topic filters (called when navigating to a new topic)
   */
  resetTopicFilters() {
    this.topicFilters.includeDiscontinued = true;
    this.topicFilters.frequencyFilter = '';
    this.topicFilters.updatedFilter = '';
  },

  // ========== Shared filter utilities ==========

  /**
   * Filter tables by all active filters, optionally excluding one dimension.
   * Used for calculating per-value hit counts in filter dropdowns.
   *
   * @param {Array} tables - Tables to filter
   * @param {Object} filters - {query, includeDiscontinued, subjectFilter, frequencyFilter, updatedFilter, enhanced}
   * @param {string} [excludeFilter] - 'subject', 'frequency', or 'updated' to skip
   * @returns {Array} Filtered tables (sorted by relevance when enhanced mode is on)
   */
  filterTables(tables, filters, excludeFilter) {
    // Enhanced mode: use SearchEnhanced for text matching + ranking
    if (filters.enhanced && filters.query && excludeFilter !== 'query') {
      if (!this._searchIndex) {
        this._searchIndex = SearchEnhanced.buildIndex(tables);
      }
      // Apply non-query filters first
      const preFiltered = this._filterNonQuery(tables, filters, excludeFilter);
      // Build sub-index for pre-filtered set
      const preFilteredSet = new Set(preFiltered.map(t => t.id));
      const subIndex = this._searchIndex.filter(e => preFilteredSet.has(e.table.id));
      return SearchEnhanced.filterAndRank(subIndex, filters);
    }

    // Standard mode
    const queryLower = (filters.query || '').toLowerCase();
    return this._filterNonQuery(tables, filters, excludeFilter).filter(table => {
      if (queryLower) {
        const matchesQuery =
          table.label.toLowerCase().includes(queryLower) ||
          table.id.includes(queryLower) ||
          (table.variableNames && table.variableNames.some(v => v.toLowerCase().includes(queryLower)));
        if (!matchesQuery) return false;
      }
      return true;
    });
  },

  /**
   * Apply only the non-query filters (discontinued, subject, frequency, updated).
   * Shared by both standard and enhanced filterTables paths.
   *
   * @param {Array} tables
   * @param {Object} filters
   * @param {string} [excludeFilter]
   * @returns {Array}
   */
  _filterNonQuery(tables, filters, excludeFilter) {
    const includeDiscontinued = filters.includeDiscontinued;
    const subjectFilter = filters.subjectFilter || '';
    const frequencyFilter = filters.frequencyFilter || '';
    const updatedFilter = filters.updatedFilter || '';

    let updatedThreshold = null;
    if (updatedFilter && excludeFilter !== 'updated') {
      const daysAgo = parseInt(updatedFilter, 10);
      updatedThreshold = new Date();
      updatedThreshold.setDate(updatedThreshold.getDate() - daysAgo);
    }

    return tables.filter(table => {
      if (table.discontinued === true && !includeDiscontinued) return false;
      if (excludeFilter !== 'subject' && subjectFilter && table.subjectCode !== subjectFilter) return false;

      if (excludeFilter !== 'frequency' && frequencyFilter) {
        if (frequencyFilter === 'Other') {
          if (table.timeUnit === 'Monthly' || table.timeUnit === 'Quarterly' || table.timeUnit === 'Annual') return false;
        } else {
          if (table.timeUnit !== frequencyFilter) return false;
        }
      }

      if (excludeFilter !== 'updated' && updatedThreshold) {
        if (!table.updated) return false;
        if (new Date(table.updated) < updatedThreshold) return false;
      }

      return true;
    });
  },

  /**
   * Count tables per frequency value. Excludes frequency filter itself.
   * @returns {Object} {Monthly: N, Quarterly: N, Annual: N, Other: N}
   */
  calcFrequencyCounts(tables, filters) {
    const base = this.filterTables(tables, filters, 'frequency');
    const counts = { Monthly: 0, Quarterly: 0, Annual: 0, Other: 0 };

    base.forEach(table => {
      const tu = table.timeUnit;
      if (tu === 'Monthly' || tu === 'Quarterly' || tu === 'Annual') {
        counts[tu]++;
      } else {
        counts['Other']++;
      }
    });

    return counts;
  },

  /**
   * Count tables per update period. Excludes updated filter itself.
   * @returns {Object} {'1': N, '7': N, '30': N, '365': N}
   */
  calcUpdatedCounts(tables, filters) {
    const base = this.filterTables(tables, filters, 'updated');
    const periods = [1, 7, 30, 365];
    const counts = {};

    for (const daysAgo of periods) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - daysAgo);
      counts[String(daysAgo)] = base.filter(t => {
        if (!t.updated) return false;
        return new Date(t.updated) >= threshold;
      }).length;
    }

    return counts;
  },

  /**
   * Count tables per subject code. Excludes subject filter itself.
   * @returns {Object} {'be': N, 'al': N, ...}
   */
  calcSubjectCounts(tables, filters) {
    const base = this.filterTables(tables, filters, 'subject');
    const counts = {};

    base.forEach(table => {
      const code = table.subjectCode || 'other';
      counts[code] = (counts[code] || 0) + 1;
    });

    return counts;
  },

  // ========== Shared rendering helpers ==========

  /**
   * Render a flat table list as an HTML table
   */
  renderTableListHTML(tables) {
    return `
      <table class="table-list">
        <thead>
          <tr>
            <th>Tabellnr.</th>
            <th>Tittel</th>
            <th>Tidsperiode</th>
            <th>Sist oppdatert</th>
          </tr>
        </thead>
        <tbody>
          ${tables.map(table => {
            const isDiscontinued = table.discontinued === true;
            return `
              <tr class="table-row ${isDiscontinued ? 'discontinued' : ''}" data-table-id="${table.id}">
                <td>${escapeHtml(table.id)}</td>
                <td>
                  <a href="#variables/${table.id}" class="table-link">${escapeHtml(this.cleanTableLabel(table.label))}</a>
                  ${isDiscontinued ? '<span class="discontinued-badge">Avsluttet</span>' : ''}
                </td>
                <td>${escapeHtml(table.firstPeriod || '')} - ${escapeHtml(table.lastPeriod || '')}</td>
                <td>${escapeHtml(this.formatUpdatedDate(table.updated))}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  /**
   * Clean table label (remove table ID prefix if present)
   */
  cleanTableLabel(label) {
    return label.replace(/^\d+:\s*/, '');
  },

  /**
   * Format ISO date string for display (DD.MM.YYYY)
   */
  formatUpdatedDate(isoDateString) {
    if (!isoDateString) return '-';
    try {
      const date = new Date(isoDateString);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}.${month}.${year}`;
    } catch (e) {
      return '-';
    }
  },

  /**
   * Attach click listeners to all table links in a container
   */
  attachTableLinkListeners(container) {
    container.querySelectorAll('.table-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const row = e.target.closest('.table-row');
        const tableId = row.dataset.tableId;
        this.selectTable(tableId);
      });
    });
  },

  /**
   * Select a table and navigate to variable selection
   */
  selectTable(tableId) {
    logger.log('[BrowserState] Selected table:', tableId);

    const table = this.allTables.find(t => t.id === tableId);
    if (!table) {
      logger.error('[BrowserState] Table not found:', tableId);
      return;
    }

    // Capture navigation context so "Tilbake til tabelloversikt" works correctly
    let ref = 'home';
    if (AppState.currentView === 'topic' && AppState.topicPath.length > 0) {
      const topicPath = AppState.topicPath.join('/');
      const filterStr = new URLSearchParams(BrowserState.topicFiltersToParams()).toString();
      ref = filterStr ? `topic/${topicPath}?${filterStr}` : `topic/${topicPath}`;
    } else if (AppState.currentView === 'search') {
      const filterStr = new URLSearchParams(BrowserState.searchFiltersToParams()).toString();
      ref = filterStr ? `search?${filterStr}` : 'search';
    }
    AppState.navigationRef = ref;
    sessionStorage.setItem('ssb_navRef', JSON.stringify({ tableId, ref }));

    AppState.setSelectedTable(table);
    AppState.setView('variables');
  },

  /**
   * Render the search input that appears on all pages
   * On Enter, navigates to the search view
   */
  renderSearchInput(currentQuery) {
    return `
      <div class="search-container">
        <input
          type="text"
          id="page-search"
          placeholder="Søk etter tabell (ID, tittel, variabler...)"
          class="search-input"
          value="${escapeHtml(currentQuery || '')}"
        />
      </div>
    `;
  },

  /**
   * Attach Enter-key handler to the search input
   * Navigates to #search?q=... on Enter
   */
  attachSearchInputListener() {
    const searchInput = document.getElementById('page-search');
    if (!searchInput) return;

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
          URLRouter.navigateTo('search', { q: query });
          URLRouter.handleRoute();
        }
      }
    });
  }
};

window.BrowserState = BrowserState;
