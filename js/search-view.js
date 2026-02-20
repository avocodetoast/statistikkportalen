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
  // Ensure data is loaded
  if (!BrowserState.isLoaded) {
    container.innerHTML = `
      <div class="loading-spinner">
        <p>Laster tabellliste...</p>
      </div>
    `;
    try {
      await BrowserState.init();
    } catch (error) {
      container.innerHTML = `
        <div class="error-message">
          <h3>Kunne ikke laste data</h3>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
      return;
    }
  }

  const mh = BrowserState.menuHierarchy;
  const filters = BrowserState.searchFilters;

  updatePageTitle(filters.query ? [filters.query] : ['Søk']);

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
          <span>Inkluder avsluttede tabeller</span>
        </label>

        <label class="filter-checkbox">
          <input type="checkbox" id="enhanced-search" ${filters.enhanced ? 'checked' : ''} />
          <span>Forbedret søk <span class="beta-badge">beta</span></span>
        </label>

        <select id="subject-filter" class="filter-select">
          <option value="">Alle emner${totalCount > 0 ? ` (${totalCount})` : ''}</option>
          ${Object.values(mh.subjectGroups).map(group => `
            <optgroup label="${escapeHtml(group.label)}">
              ${group.subjects.map(subjectCode => {
                const subjectName = mh.subjectNames[subjectCode];
                const count = hitCounts[subjectCode] || 0;
                const disabled = count === 0 ? 'disabled' : '';
                const selected = filters.subjectFilter === subjectCode ? 'selected' : '';
                return `<option value="${subjectCode}" ${disabled} ${selected}>${escapeHtml(subjectName)} (${count})</option>`;
              }).join('')}
            </optgroup>
          `).join('')}
        </select>

        <select id="frequency-filter" class="filter-select">
          <option value="" ${!filters.frequencyFilter ? 'selected' : ''}>Alle frekvenser${totalCount > 0 ? ` (${totalCount})` : ''}</option>
          <option value="Monthly" ${filters.frequencyFilter === 'Monthly' ? 'selected' : ''}>Månedlig (${frequencyCounts['Monthly'] || 0})</option>
          <option value="Quarterly" ${filters.frequencyFilter === 'Quarterly' ? 'selected' : ''}>Kvartalsvis (${frequencyCounts['Quarterly'] || 0})</option>
          <option value="Annual" ${filters.frequencyFilter === 'Annual' ? 'selected' : ''}>Årlig (${frequencyCounts['Annual'] || 0})</option>
          <option value="Other" ${filters.frequencyFilter === 'Other' ? 'selected' : ''}>Annet (${frequencyCounts['Other'] || 0})</option>
        </select>

        <select id="updated-filter" class="filter-select">
          <option value="" ${!filters.updatedFilter ? 'selected' : ''}>Alle perioder${totalCount > 0 ? ` (${totalCount})` : ''}</option>
          <option value="1" ${filters.updatedFilter === '1' ? 'selected' : ''}>Oppdatert siste dag${updatedCounts['1'] !== undefined ? ` (${updatedCounts['1']})` : ''}</option>
          <option value="7" ${filters.updatedFilter === '7' ? 'selected' : ''}>Oppdatert siste uke${updatedCounts['7'] !== undefined ? ` (${updatedCounts['7']})` : ''}</option>
          <option value="30" ${filters.updatedFilter === '30' ? 'selected' : ''}>Oppdatert siste måned${updatedCounts['30'] !== undefined ? ` (${updatedCounts['30']})` : ''}</option>
          <option value="365" ${filters.updatedFilter === '365' ? 'selected' : ''}>Oppdatert siste år${updatedCounts['365'] !== undefined ? ` (${updatedCounts['365']})` : ''}</option>
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
        _searchPerformSearch();
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
      <h2>Søk i SSBs statistikkbank</h2>
      <p>Skriv inn søkeord eller bruk filtrene for å finne tabeller</p>
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

  // Enhanced mode: augment with SSB server-side search (finds tables via variable VALUES).
  // Runs one API call per synonym variant so abbreviations like "bnp" also find
  // tables matched via the full term "bruttonasjonalprodukt".
  if (enhanced && query) {
    const myToken = ++_searchToken;

    try {
      const serverQuery = SearchEnhanced.getServerQuery(query);
      const response = await api.getTables({ query: serverQuery, lang: 'no', pageSize: 10000, includeDiscontinued: true });

      // Abort if a newer search has started
      if (myToken !== _searchToken) return;

      // Find tables the server found that weren't in our client results
      const allTablesMap = new Map(mh.allTables.map(t => [t.id, t]));
      const clientIds = new Set(clientResults.map(t => t.id));
      const allServerTables = response.tables || [];

      const serverExtras = allServerTables
        .filter(t => !clientIds.has(t.id))
        .map(t => allTablesMap.get(t.id) || t); // prefer our enriched local version

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
 */
function _renderSearchResults(contentArea, results, mh, preserveOrder) {
  const grouped = _searchGroupBySubject(results, mh, preserveOrder);

  contentArea.innerHTML = `
    <div class="search-results">
      <h2>Søkeresultater</h2>
      <p>${results.length} ${results.length === 1 ? 'tabell' : 'tabeller'} funnet</p>

      ${results.length === 0 ? `
        <div class="no-results">
          <p>Ingen tabeller funnet</p>
        </div>
      ` : grouped.map(group => `
        <details class="search-group" open>
          <summary class="search-group-header">
            ${escapeHtml(group.label)}
            <span class="search-group-count">(${group.tables.length})</span>
          </summary>
          ${BrowserState.renderTableListHTML(group.tables.slice(0, 100))}
          ${group.tables.length > 100 ? `<p class="info-message">Viser de første 100 av ${group.tables.length} resultater i denne gruppen</p>` : ''}
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
        label: mh.subjectNames[code] || code,
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

    subjectFilterEl.innerHTML = `
      <option value="">Alle emner${totalCount > 0 ? ` (${totalCount})` : ''}</option>
      ${Object.entries(mh.subjectGroups).map(([id, group]) => `
        <optgroup label="${escapeHtml(group.label)}">
          ${group.subjects.map(subjectCode => {
            const subjectName = mh.subjectNames[subjectCode];
            const count = hitCounts[subjectCode] || 0;
            const disabled = count === 0 ? 'disabled' : '';
            return `<option value="${subjectCode}" ${disabled}>${escapeHtml(subjectName)} (${count})</option>`;
          }).join('')}
        </optgroup>
      `).join('')}
    `;

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

    frequencyFilterEl.innerHTML = `
      <option value="">Alle frekvenser${totalCount > 0 ? ` (${totalCount})` : ''}</option>
      <option value="Monthly">Månedlig (${frequencyCounts['Monthly'] || 0})</option>
      <option value="Quarterly">Kvartalsvis (${frequencyCounts['Quarterly'] || 0})</option>
      <option value="Annual">Årlig (${frequencyCounts['Annual'] || 0})</option>
      <option value="Other">Annet (${frequencyCounts['Other'] || 0})</option>
    `;

    if (selectedValue) {
      frequencyFilterEl.value = selectedValue;
    }
  }

  // Update updated-filter dropdown
  if (updatedFilterEl) {
    const updatedCounts = _searchCalcUpdatedFilterCounts(mh, filters);
    const selectedValue = updatedFilterEl.value;

    updatedFilterEl.innerHTML = `
      <option value="">Alle perioder${totalCount > 0 ? ` (${totalCount})` : ''}</option>
      <option value="1">Oppdatert siste dag (${updatedCounts['1'] || 0})</option>
      <option value="7">Oppdatert siste uke (${updatedCounts['7'] || 0})</option>
      <option value="30">Oppdatert siste måned (${updatedCounts['30'] || 0})</option>
      <option value="365">Oppdatert siste år (${updatedCounts['365'] || 0})</option>
    `;

    if (selectedValue) {
      updatedFilterEl.value = selectedValue;
    }
  }
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
