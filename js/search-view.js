/**
 * Search View - Search results page with filters
 *
 * Shows: search input + compact menu bar + filter row + results grouped by subject
 * Filters are synced to URL via replaceState.
 * Debounced auto-search when already on the search page.
 *
 * Enhanced mode additionally queries the SSB API server-side to find tables
 * matched via variable VALUES (not available in the local table list).
 */

// Token to cancel in-flight enhanced searches when a new one starts
let _searchToken = 0;

async function renderSearchView(container) {
  if (!(await BrowserState.ensureLoaded(container))) return;

  const mh = BrowserState.menuHierarchy;
  const filters = BrowserState.searchFilters;

  updatePageTitle(filters.query ? [filters.query] : [t('nav.search')]);

  // Calculate initial hit counts
  const hitCounts = _searchCalcSubjectHitCounts(mh, filters);
  const totalCount = Object.values(hitCounts).reduce((sum, c) => sum + c, 0);
  const updatedCounts = _searchCalcUpdatedFilterCounts(mh, filters);
  const frequencyCounts = BrowserState.calcFrequencyCounts(mh.allTables, filters);

  container.innerHTML = `
    <div class="search-view">
      ${BrowserState.renderSearchInput(filters.query)}

      ${MenuBar.render(mh)}

      <div class="search-filters">
        <label class="filter-checkbox">
          <input type="checkbox" id="include-discontinued" ${filters.includeDiscontinued ? 'checked' : ''} />
          <span>${t('search.includeStopped')}</span>
        </label>

        <label class="filter-checkbox">
          <input type="checkbox" id="enhanced-search" ${filters.enhanced ? 'checked' : ''} />
          <span>${t('search.enhanced')}</span>
        </label>

        <select id="subject-filter" class="filter-select">
          ${_searchRenderSubjectOptions(mh, hitCounts, totalCount, filters.subjectFilter)}
        </select>

        <select id="frequency-filter" class="filter-select">
          ${BrowserState.renderFrequencyFilterOptions(frequencyCounts, {
            selected: filters.frequencyFilter,
            allLabel: `${t('filter.allFrequencies')}${totalCount > 0 ? ` (${totalCount})` : ''}`
          })}
        </select>

        <select id="updated-filter" class="filter-select">
          ${BrowserState.renderUpdatedFilterOptions(updatedCounts, {
            selected: filters.updatedFilter,
            allLabel: `${t('filter.allPeriods')}${totalCount > 0 ? ` (${totalCount})` : ''}`
          })}
        </select>
      </div>

      <div id="search-content-area"></div>
    </div>
  `;

  // Attach menu bar listeners
  MenuBar.attachListeners(container);

  // Search input: override the default Enter-navigation with in-page search
  const searchInput = document.getElementById('page-search');
  if (searchInput) {
    // Remove default handler by replacing with search-specific one
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        const sqId = detectSavedQueryId(searchInput.value);
        if (sqId) {
          URLRouter.navigateTo('sq/' + sqId, {});
          URLRouter.handleRoute();
        } else {
          _searchPerformSearch();
        }
      }
    });

    // Debounced auto-search while on search page
    searchInput.addEventListener('input', debounce(() => {
      _searchPerformSearch();
    }, 500));

    searchInput.focus();
  }

  // Filter change listeners
  const filterIds = ['include-discontinued', 'enhanced-search', 'subject-filter', 'frequency-filter', 'updated-filter'];
  filterIds.forEach(filterId => {
    const element = document.getElementById(filterId);
    if (element) {
      element.addEventListener('change', () => {
        _searchPerformSearch();
      });
    }
  });

  // Perform initial search if query/filters present
  if (filters.query || filters.subjectFilter || filters.frequencyFilter || filters.updatedFilter) {
    _searchPerformSearch();
  } else {
    _searchShowWelcome();
  }
}

/**
 * Show welcome state when no search is active
 */
function _searchShowWelcome() {
  const contentArea = document.getElementById('search-content-area');
  if (!contentArea) return;

  contentArea.innerHTML = `
    <div class="welcome-message">
      <h2>${t('search.heading')}</h2>
      <p>${t('search.instructions')}</p>
    </div>
  `;
}

/**
 * Perform search with all active filters.
 * In enhanced mode, first renders client-side results immediately, then
 * augments with server-side results (which include variable value matching).
 */
async function _searchPerformSearch() {
  const contentArea = document.getElementById('search-content-area');
  if (!contentArea) return;

  const mh = BrowserState.menuHierarchy;

  // Read current filter values from DOM
  const query = (document.getElementById('page-search')?.value || '').trim();
  const includeDiscontinued = document.getElementById('include-discontinued')?.checked || false;
  const enhanced = document.getElementById('enhanced-search')?.checked || false;
  const subjectFilter = document.getElementById('subject-filter')?.value || '';
  const frequencyFilter = document.getElementById('frequency-filter')?.value || '';
  const updatedFilter = document.getElementById('updated-filter')?.value || '';

  // Update BrowserState filters
  BrowserState.searchFilters.query = query;
  BrowserState.searchFilters.includeDiscontinued = includeDiscontinued;
  BrowserState.searchFilters.enhanced = enhanced;
  BrowserState.searchFilters.subjectFilter = subjectFilter;
  BrowserState.searchFilters.frequencyFilter = frequencyFilter;
  BrowserState.searchFilters.updatedFilter = updatedFilter;

  // Update URL without triggering re-render
  URLRouter.navigateTo('search', BrowserState.searchFiltersToParams(), false);

  // Keep the page title in sync with the latest search term
  updatePageTitle(query ? [query] : [t('nav.search')]);

  // If no query and no filters, show welcome
  if (!query && !subjectFilter && !frequencyFilter && !updatedFilter) {
    _searchShowWelcome();
    // Update dropdown counts
    _searchUpdateDropdownCounts();
    return;
  }

  // Update dropdown counts dynamically
  _searchUpdateDropdownCounts();

  // Client-side results (instant — uses local table list)
  const clientResults = BrowserState.filterTables(mh.allTables, BrowserState.searchFilters);
  _renderSearchResults(contentArea, clientResults, mh, enhanced);

  // Server-side augmentation and fuzzy fallback.
  // - Enhanced: queries SSB API to find tables matched via variable VALUES.
  //   Runs synonym-expanded query so abbreviations like "bnp" also find
  //   tables matched via the full term "bruttonasjonalprodukt".
  // - Fuzzy fallback: if 0 results from both client and server, retries once
  //   with Lucene ~1 edit-distance query (catches single-character typos).
  if (query && query !== '*') {
    const myToken = ++_searchToken;

    try {
      const allTablesMap = new Map(mh.allTables.map(t => [t.id, t]));
      const clientIds = new Set(clientResults.map(t => t.id));
      const _extractExtras = (response) =>
        (response.tables || [])
          .filter(t => !clientIds.has(t.id))
          .map(t => allTablesMap.get(t.id) || t); // prefer our enriched local version

      let serverExtras = [];

      if (enhanced) {
        const serverQuery = SearchEnhanced.getServerQuery(query);
        const response = await api.getAllTables({ query: serverQuery, lang: getCurrentApiLang(), includeDiscontinued: true });

        // Abort if a newer search has started
        if (myToken !== _searchToken) return;

        serverExtras = _extractExtras(response);
      }

      // Fuzzy fallback: 0 results from client + server → retry with ~1 Lucene fuzzy query
      if (clientResults.length === 0 && serverExtras.length === 0) {
        const fuzzyQuery = SearchEnhanced.buildFuzzyQuery(query);
        const fuzzyResponse = await api.getAllTables({ query: fuzzyQuery, lang: getCurrentApiLang(), includeDiscontinued: true });
        if (myToken !== _searchToken) return;
        const filteredFuzzy = BrowserState._filterNonQuery(_extractExtras(fuzzyResponse), BrowserState.searchFilters);
        if (filteredFuzzy.length > 0) {
          _renderSearchResults(contentArea, filteredFuzzy, mh, false, true);
        }
        return;
      }

      // Apply non-query filters (subject, frequency, updated, discontinued)
      const filteredExtras = BrowserState._filterNonQuery(serverExtras, BrowserState.searchFilters);

      if (filteredExtras.length > 0) {
        const combined = [...clientResults, ...filteredExtras];
        _renderSearchResults(contentArea, combined, mh, enhanced);
      }
    } catch (e) {
      logger.warn('[SearchView] Server-side augmentation failed:', e);
    }
  }
}

/**
 * Render search results into the content area.
 * Extracted so both the immediate client-side render and the
 * server-augmented re-render can share the same logic.
 * @param {boolean} fuzzyFallback - True when results come from automatic fuzzy retry
 */
function _renderSearchResults(contentArea, results, mh, preserveOrder, fuzzyFallback = false) {
  const grouped = _searchGroupBySubject(results, mh, preserveOrder);

  contentArea.innerHTML = `
    <div class="search-results">
      <h2>${t('search.results')}</h2>
      ${fuzzyFallback ? `<p class="info-message">${t('search.fuzzyFallback')}</p>` : ''}
      <p>${results.length} ${results.length === 1 ? t('unit.table.one') : t('unit.table.many')} ${t('search.found')}</p>

      ${results.length === 0 ? `
        <div class="no-results">
          <p>${t('search.noResults')}</p>
        </div>
      ` : grouped.map(group => `
        <details class="search-group" open>
          <summary class="search-group-header">
            ${escapeHtml(group.label)}
            <span class="search-group-count">(${group.tables.length})</span>
          </summary>
          ${BrowserState.renderTableListHTML(group.tables.slice(0, 100))}
          ${group.tables.length > 100 ? `<p class="info-message">${tpl('search.showingFirst', group.tables.length)}</p>` : ''}
        </details>
      `).join('')}
    </div>
  `;

  BrowserState.attachTableLinkListeners(contentArea);
}

/**
 * Group tables by subject code
 * @param {boolean} preserveOrder - When true, skip sortCode re-sort to preserve relevance ranking
 */
function _searchGroupBySubject(tables, mh, preserveOrder) {
  const groups = {};

  tables.forEach(table => {
    const code = table.subjectCode || 'other';
    if (!groups[code]) {
      groups[code] = {
        code: code,
        label: t('subject.name.' + code) || mh.subjectNames[code] || code,
        tables: []
      };
    }
    groups[code].tables.push(table);
  });

  return Object.values(groups)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(group => {
      if (!preserveOrder) {
        group.tables.sort((a, b) => a.sortCode.localeCompare(b.sortCode));
      }
      return group;
    });
}

/**
 * Update subject and updated-filter dropdowns with dynamic hit counts
 */
function _searchUpdateDropdownCounts() {
  const mh = BrowserState.menuHierarchy;
  const filters = BrowserState.searchFilters;

  const subjectFilterEl = document.getElementById('subject-filter');
  const updatedFilterEl = document.getElementById('updated-filter');

  // Recalculate hit counts
  const hitCounts = _searchCalcSubjectHitCounts(mh, filters);
  const totalCount = Object.values(hitCounts).reduce((sum, c) => sum + c, 0);

  // Update subject dropdown
  if (subjectFilterEl) {
    const selectedValue = subjectFilterEl.value;

    subjectFilterEl.innerHTML = _searchRenderSubjectOptions(mh, hitCounts, totalCount);

    if (selectedValue && hitCounts[selectedValue] > 0) {
      subjectFilterEl.value = selectedValue;
    } else {
      subjectFilterEl.value = '';
    }
  }

  // Update frequency dropdown
  const frequencyFilterEl = document.getElementById('frequency-filter');
  if (frequencyFilterEl) {
    const frequencyCounts = BrowserState.calcFrequencyCounts(mh.allTables, filters);
    const selectedValue = frequencyFilterEl.value;

    frequencyFilterEl.innerHTML = BrowserState.renderFrequencyFilterOptions(frequencyCounts, {
      allLabel: `${t('filter.allFrequencies')}${totalCount > 0 ? ` (${totalCount})` : ''}`
    });

    if (selectedValue) {
      frequencyFilterEl.value = selectedValue;
    }
  }

  // Update updated-filter dropdown
  if (updatedFilterEl) {
    const updatedCounts = _searchCalcUpdatedFilterCounts(mh, filters);
    const selectedValue = updatedFilterEl.value;

    updatedFilterEl.innerHTML = BrowserState.renderUpdatedFilterOptions(updatedCounts, {
      allLabel: `${t('filter.allPeriods')}${totalCount > 0 ? ` (${totalCount})` : ''}`
    });

    if (selectedValue) {
      updatedFilterEl.value = selectedValue;
    }
  }
}

/**
 * Render <option>/<optgroup> elements for the subject `<select>`. Used both
 * by the initial render (with `selected` so the current filter is marked
 * inline) and _searchUpdateDropdownCounts (without `selected` — the caller
 * restores the DOM element's `.value` afterward instead).
 */
function _searchRenderSubjectOptions(mh, hitCounts, totalCount, selected) {
  const hasSelected = typeof selected === 'string';
  return `
    <option value="">${t('filter.allSubjects')}${totalCount > 0 ? ` (${totalCount})` : ''}</option>
    ${Object.values(mh.subjectGroups).map(group => `
      <optgroup label="${escapeHtml(t('subject.group.' + group.id))}">
        ${group.subjects.map(subjectCode => {
          const subjectName = t('subject.name.' + subjectCode) || mh.subjectNames[subjectCode];
          const count = hitCounts[subjectCode] || 0;
          const disabled = count === 0 ? 'disabled' : '';
          const selectedAttr = hasSelected && selected === subjectCode ? 'selected' : '';
          return `<option value="${subjectCode}" ${disabled} ${selectedAttr}>${escapeHtml(subjectName)} (${count})</option>`;
        }).join('')}
      </optgroup>
    `).join('')}
  `;
}

/**
 * Calculate hit counts per subject (delegates to shared utility)
 */
function _searchCalcSubjectHitCounts(mh, filters) {
  return BrowserState.calcSubjectCounts(mh.allTables, filters);
}

/**
 * Calculate hit counts for each updated-filter period (delegates to shared utility)
 */
function _searchCalcUpdatedFilterCounts(mh, filters) {
  return BrowserState.calcUpdatedCounts(mh.allTables, filters);
}

window.renderSearchView = renderSearchView;
