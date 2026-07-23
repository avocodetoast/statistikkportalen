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
  recentTables: null,
  isLoaded: false,
  _initPromise: null,

  // Search view filters (independent from topic filters)
  // sourceFilter: kildenøkler ('ssb'/'nb'/'fhi') — tom liste = alle kilder
  searchFilters: {
    query: '',
    includeDiscontinued: AppConfig.ui.showDiscontinuedByDefault,
    subjectFilter: '',
    frequencyFilter: '',
    updatedFilter: '',
    sourceFilter: [],
    enhanced: true
  },

  // Lazy search index for enhanced mode (built on first use, cached forever)
  _searchIndex: null,

  // Topic view filters (independent from search filters)
  // Reset when navigating to a new topic
  topicFilters: {
    includeDiscontinued: AppConfig.ui.showDiscontinuedByDefault,
    frequencyFilter: '',
    updatedFilter: '',
    sourceFilter: []
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

  reset() {
    this.isLoaded = false;
    this._initPromise = null;
    this.allTables = [];
    this.menuHierarchy = null;
  },

  async _doInit() {
    try {
      logger.log('[BrowserState] Fetching all tables (including discontinued)...');

      // Fetch API config first to apply server limits before any data requests
      await api.getConfig();

      // Fetch all tables (with automatic pagination if needed)
      const response = await api.getAllTables({
        lang: getCurrentApiLang(),
        includeDiscontinued: true
      });

      this.allTables = response.tables;
      logger.log(`[BrowserState] Loaded ${this.allTables.length} tables`);

      // Alle kilder nede med tom cache → tydelig, retry-bar feil i stedet
      // for et stille tomt emnegrid (feilvisningen i front-page.js).
      if (this.allTables.length === 0) {
        throw new Error(t('apiStatus.allSourcesFailed'));
      }

      this.menuHierarchy = new MenuHierarchy();
      this.menuHierarchy.buildHierarchy(this.allTables);

      this.isLoaded = true;
    } catch (error) {
      logger.error('[BrowserState] Error fetching tables:', error);
      this._initPromise = null;
      throw error;
    }
  },

  /**
   * Ren hjelper: erstatt én kildes tabeller i en aggregert tabelliste.
   * Kilde-eierskap avgjøres av sourceForFn (fasadens api.sourceFor).
   * Muterer ikke input; de øvrige kildenes rekkefølge bevares.
   */
  mergeSourceTables(allTables, sourceId, newTables, sourceForFn) {
    return (allTables || [])
      .filter(t => sourceForFn(t.id) !== sourceId)
      .concat(newTables || []);
  },

  /**
   * Ta i bruk en ny tabelliste for én kilde: merge inn, invalider
   * søkeindeksen (ellers serverer enhanced-søket døde tabellobjekter),
   * og bygg emnehierarkiet på nytt. Eneste mutasjonssti etter init.
   */
  applySourceTables(sourceId, tables) {
    this.allTables = this.mergeSourceTables(
      this.allTables, sourceId, tables, (id) => api.sourceFor(id)
    );
    this._searchIndex = null;
    this.recentTables = null;
    this.menuHierarchy = new MenuHierarchy();
    this.menuHierarchy.buildHierarchy(this.allTables);
    this.isLoaded = true;
    logger.log('[BrowserState] Reloaded source «' + sourceId + '» — ' +
               this.allTables.length + ' tables total');
  },

  /**
   * Hent én kildes katalog på nytt (retry etter feil / manuell refresh) og
   * merge resultatet inn. Re-rendering av visningen er callerens ansvar
   * (source-status.js re-rendrer browse-visningene).
   */
  async reloadSource(sourceId, options) {
    const opts = options || {};
    const force = opts.force !== false;
    if (!this.isLoaded) {
      // Aldri initialisert (f.eks. alle kilder nede ved kald start) — kjør
      // full init i stedet; _initPromise ble nullet ved feilen, så dette
      // er et reelt nytt forsøk.
      await this.init();
      return;
    }
    const result = await api.reloadSource(sourceId, { force: force });
    this.applySourceTables(sourceId, result.tables);
  },

  // ========== Filter ↔ URL sync ==========

  /**
   * Convert search filters to URL query params
   */
  searchFiltersToParams() {
    const params = {};
    if (this.searchFilters.query) params.q = this.searchFilters.query;
    if (this.searchFilters.includeDiscontinued) params.disc = '1';
    if (this.searchFilters.subjectFilter) params.subj = this.searchFilters.subjectFilter;
    if (this.searchFilters.frequencyFilter) params.freq = this.searchFilters.frequencyFilter;
    if (this.searchFilters.updatedFilter) params.upd = this.searchFilters.updatedFilter;
    if (this.searchFilters.sourceFilter.length) params.src = this.searchFilters.sourceFilter.join(',');
    if (!this.searchFilters.enhanced) params.enh = '0';
    return params;
  },

  /**
   * Set search filters from URL query params
   */
  searchFiltersFromParams(params) {
    this.searchFilters.query = params.q || '';
    this.searchFilters.includeDiscontinued = params.disc === '1';
    this.searchFilters.subjectFilter = params.subj || '';
    this.searchFilters.frequencyFilter = params.freq || '';
    this.searchFilters.updatedFilter = params.upd || '';
    this.searchFilters.sourceFilter = this.parseSourceParam(params.src);
    this.searchFilters.enhanced = params.enh !== '0';
  },

  /**
   * Tolk `src`-parameteren ('nb,fhi') som en liste kildenøkler. Ukjente eller
   * deaktiverte kilder droppes, så en håndredigert URL ikke kan filtrere bort
   * alt uten at noen avkrysningsboks viser hvorfor.
   * @param {string} [value]
   * @returns {string[]}
   */
  parseSourceParam(value) {
    if (!value) return [];
    const known = new Set(listEnabledSources().map(s => s.key));
    return String(value).split(',').map(s => s.trim()).filter(s => known.has(s));
  },

  /**
   * Convert topic filters to URL query params
   */
  topicFiltersToParams() {
    const params = {};
    if (this.topicFilters.includeDiscontinued) params.disc = '1';
    if (this.topicFilters.frequencyFilter) params.freq = this.topicFilters.frequencyFilter;
    if (this.topicFilters.updatedFilter) params.upd = this.topicFilters.updatedFilter;
    if (this.topicFilters.sourceFilter.length) params.src = this.topicFilters.sourceFilter.join(',');
    return params;
  },

  /**
   * Set topic filters from URL query params
   */
  topicFiltersFromParams(params) {
    this.topicFilters.includeDiscontinued = params.disc === '1';
    this.topicFilters.frequencyFilter = params.freq || '';
    this.topicFilters.updatedFilter = params.upd || '';
    this.topicFilters.sourceFilter = this.parseSourceParam(params.src);
  },

  /**
   * Reset topic filters (called when navigating to a new topic)
   */
  resetTopicFilters() {
    this.topicFilters.includeDiscontinued = AppConfig.ui.showDiscontinuedByDefault;
    this.topicFilters.frequencyFilter = '';
    this.topicFilters.updatedFilter = '';
    this.topicFilters.sourceFilter = [];
  },

  // ========== Shared filter utilities ==========

  /**
   * Filter tables by all active filters, optionally excluding one dimension.
   * Used for calculating per-value hit counts in filter dropdowns.
   *
   * @param {Array} tables - Tables to filter
   * @param {Object} filters - {query, includeDiscontinued, subjectFilter, frequencyFilter, updatedFilter, sourceFilter, enhanced}
   * @param {string} [excludeFilter] - 'subject', 'frequency', 'updated', or 'source' to skip
   * @returns {Array} Filtered tables (sorted by relevance when enhanced mode is on)
   */
  filterTables(tables, filters, excludeFilter) {
    // Treat '*' (or blank) as match-all — no text filter applied
    if (filters.query === '*') filters = { ...filters, query: '' };

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
    const sourceFilter = filters.sourceFilter || [];

    let updatedThreshold = null;
    if (updatedFilter && excludeFilter !== 'updated') {
      const daysAgo = parseInt(updatedFilter, 10);
      updatedThreshold = new Date();
      updatedThreshold.setDate(updatedThreshold.getDate() - daysAgo);
    }

    return tables.filter(table => {
      if (table.discontinued === true && !includeDiscontinued) return false;
      if (excludeFilter !== 'subject' && subjectFilter && table.subjectCode !== subjectFilter) return false;

      // Tom kildeliste = alle kilder (ingen avkrysningsboks huket av)
      if (excludeFilter !== 'source' && sourceFilter.length &&
          sourceFilter.indexOf(sourceKeyForTableId(table.id)) === -1) return false;

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
   * @returns {Object} {'1': N, '7': N, '30': N, '365': N, '730': N}
   */
  calcUpdatedCounts(tables, filters) {
    const base = this.filterTables(tables, filters, 'updated');
    const periods = [1, 7, 30, 365, 730];
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

  /**
   * Count tables per source key. Excludes the source filter itself, so each
   * checkbox shows how many tables it WOULD add — same semantics as the
   * subject/frequency/updated counts.
   * @returns {Object} {ssb: N, nb: N, fhi: N} — one entry per enabled source
   */
  calcSourceCounts(tables, filters) {
    const base = this.filterTables(tables, filters, 'source');
    const counts = {};
    listEnabledSources().forEach(s => { counts[s.key] = 0; });

    base.forEach(table => {
      const key = sourceKeyForTableId(table.id);
      if (key in counts) counts[key]++;
    });

    return counts;
  },

  // ========== Shared filter-dropdown rendering ==========

  FREQUENCY_OPTIONS: [
    ['Monthly', 'filter.monthly'],
    ['Quarterly', 'filter.quarterly'],
    ['Annual', 'filter.annual'],
    ['Other', 'filter.other']
  ],

  UPDATED_OPTIONS: [
    ['1', 'filter.lastDay'],
    ['7', 'filter.lastWeek'],
    ['30', 'filter.lastMonth'],
    ['365', 'filter.lastYear'],
    ['730', 'filter.last2Years']
  ],

  /**
   * Render <option> elements for the frequency `<select>` (search-view.js and
   * topic-view.js both use this, for both the initial render and the
   * dynamic dropdown-count update — see calcFrequencyCounts).
   *
   * @param {Object} counts - {Monthly, Quarterly, Annual, Other} from calcFrequencyCounts
   * @param {Object} [opts]
   * @param {string} [opts.selected] - Currently selected value; when given, marks the
   *   matching <option> with `selected` inline (initial render). Omit for a dynamic
   *   update where the caller restores the DOM element's `.value` afterward instead.
   * @param {string} opts.allLabel - Pre-formatted label (incl. translation + count) for
   *   the "all" option — callers compute this since the count's semantics differ
   *   (search-view: subject-hit total, shown only when >0; topic-view: filtered
   *   subtree total, always shown).
   * @returns {string}
   */
  renderFrequencyFilterOptions(counts, opts) {
    return this._renderFilterOptions(this.FREQUENCY_OPTIONS, counts, opts);
  },

  /**
   * Render <option> elements for the "updated" `<select>` (search-view.js and
   * topic-view.js). See renderFrequencyFilterOptions for the opts contract.
   * @param {Object} counts - {'1', '7', '30', '365', '730'} from calcUpdatedCounts
   */
  renderUpdatedFilterOptions(counts, opts) {
    return this._renderFilterOptions(this.UPDATED_OPTIONS, counts, opts);
  },

  /**
   * Summary shown on the source filter's dropdown toggle: either the
   * "all sources" label with the grand total, or the picked sources' short
   * names (in config order, not click order) with their combined count.
   *
   * @param {Object} counts - {ssb, nb, fhi} from calcSourceCounts
   * @param {string[]} selected - Selected source keys
   * @returns {string} Plain text (caller escapes)
   */
  sourceFilterSummary(counts, selected) {
    const sources = listEnabledSources();
    const chosen = sources.filter(s => (selected || []).indexOf(s.key) !== -1);
    const total = (list) => list.reduce((sum, s) => sum + (counts[s.key] || 0), 0);

    if (!chosen.length) return `${t('filter.allSources')} (${total(sources)})`;
    const names = chosen.map(s => s.branding.shortName || s.branding.name || s.key);
    return `${names.join(', ')} (${total(chosen)})`;
  },

  /**
   * Render the source filter as a dropdown holding one checkbox per enabled
   * source — it sits in the same filter row as the frequency/updated
   * `<select>`s and stays the same width no matter how many sources exist.
   * Multi-select by design: nothing checked means "all sources", so the
   * default state needs no explanation.
   *
   * The per-source count lives in its own `<span class="source-filter-count">`
   * so the dynamic count update can rewrite just the number without rebuilding
   * the inputs (which would drop focus and check state mid-interaction).
   *
   * Interaction (open/close, outside click, Escape) is wired by
   * setupSourceFilterDropdown().
   *
   * @param {Object} counts - {ssb, nb, fhi} from calcSourceCounts
   * @param {string[]} selected - Currently selected source keys
   * @param {string} [idPrefix] - '' (search view) or 'topic-' (topic view)
   * @returns {string} HTML, or '' for single-source instances (no filter to offer)
   */
  renderSourceFilter(counts, selected, idPrefix) {
    const sources = listEnabledSources();
    if (sources.length < 2) return '';

    const prefix = idPrefix || '';
    const chosen = selected || [];

    const options = sources.map(({ key, branding }) => {
      const id = prefix + 'source-filter-' + key;
      const label = branding.shortName || branding.name || key;
      const checked = chosen.indexOf(key) !== -1 ? ' checked' : '';
      const full = branding.nameFull || branding.name || label;
      // Ingen for=: input-en ligger inne i label-en, og et for= som peker på
      // den samme nestede boksen gir dobbelt-toggle i enkelte nettlesere.
      return `<label class="filter-checkbox source-filter">
            <input type="checkbox" id="${escapeHtml(id)}" value="${escapeHtml(key)}"${checked} />
            <span class="source-filter-name">${escapeHtml(label)}</span>
            <span class="source-filter-full">${escapeHtml(full)}</span>
            <span class="source-filter-count">(${counts[key] || 0})</span>
          </label>`;
    }).join('\n          ');

    return `<div class="source-filter-dropdown">
          <button type="button" class="filter-select source-filter-toggle" aria-expanded="false" aria-haspopup="true">
            <span class="source-filter-summary">${escapeHtml(this.sourceFilterSummary(counts, chosen))}</span>
          </button>
          <div class="source-filter-panel" hidden>
            ${options}
          </div>
        </div>`;
  },

  /**
   * Read the checked source keys out of a rendered source filter.
   * @param {ParentNode} root - Container holding the .source-filter labels
   * @returns {string[]}
   */
  readSourceFilter(root) {
    return Array.from(root.querySelectorAll('.source-filter input:checked'))
      .map(input => input.value);
  },

  /**
   * Refresh the per-source hit counts and the toggle summary in place,
   * without touching the inputs.
   * @param {ParentNode} root
   * @param {Object} counts - from calcSourceCounts
   */
  updateSourceFilterCounts(root, counts) {
    root.querySelectorAll('.source-filter').forEach(label => {
      const input = label.querySelector('input');
      const countEl = label.querySelector('.source-filter-count');
      if (input && countEl) countEl.textContent = `(${counts[input.value] || 0})`;
    });

    const summaryEl = root.querySelector('.source-filter-summary');
    if (summaryEl) {
      summaryEl.textContent = this.sourceFilterSummary(counts, this.readSourceFilter(root));
    }
  },

  /**
   * Wire up the source filter dropdown: toggle on click, close on Escape,
   * outside click or blur, and call onChange whenever a box is (un)checked.
   * The panel deliberately stays OPEN while checking boxes — it is a
   * multi-select, and closing after the first click would make picking two
   * sources needlessly tedious.
   *
   * @param {HTMLElement} container - View container holding the filter row
   * @param {Function} onChange - Called after any checkbox change
   */
  setupSourceFilterDropdown(container, onChange) {
    const dropdown = container.querySelector('.source-filter-dropdown');
    if (!dropdown) return; // single-source instance — nothing rendered

    const toggle = dropdown.querySelector('.source-filter-toggle');
    const panel = dropdown.querySelector('.source-filter-panel');
    let removeEscape = null;

    const close = () => {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocumentClick, true);
      if (removeEscape) { removeEscape(); removeEscape = null; }
    };

    function onDocumentClick(e) {
      if (!dropdown.contains(e.target)) close();
    }

    const open = () => {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', onDocumentClick, true);
      removeEscape = addEscapeHandler(close);
    };

    toggle.addEventListener('click', () => {
      if (panel.hidden) open(); else close();
    });

    panel.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', onChange);
    });
  },

  _renderFilterOptions(optionDefs, counts, opts) {
    const o = opts || {};
    const hasSelected = typeof o.selected === 'string';
    const selectedAttr = (value) =>
      hasSelected ? (o.selected === value ? ' selected' : '') : '';
    const emptySelectedAttr = hasSelected ? (!o.selected ? ' selected' : '') : '';

    const options = optionDefs.map(([value, labelKey]) =>
      `<option value="${value}"${selectedAttr(value)}>${t(labelKey)} (${counts[value] || 0})</option>`
    ).join('\n          ');

    return `<option value=""${emptySelectedAttr}>${o.allLabel}</option>\n          ${options}`;
  },

  /**
   * Ensure BrowserState.init() has completed before a browse view renders,
   * showing a spinner meanwhile and an error message on failure. Shared by
   * front-page.js/search-view.js/topic-view.js, which otherwise repeated the
   * same isLoaded-check/spinner/try-catch boilerplate.
   *
   * @param {HTMLElement} container
   * @param {Object} [opts]
   * @param {function(HTMLElement)} [opts.renderSpinner] - Custom spinner rendering
   *   (e.g. topic-view's SEO-placeholder skip, front-page's SEO-intro swap-in).
   *   Defaults to `container.innerHTML = <loading.tables spinner>`.
   * @returns {Promise<boolean>} true if loaded (caller should proceed with rendering);
   *   false if init failed (an error message has already been rendered into
   *   `container` — caller should return immediately).
   */
  async ensureLoaded(container, opts) {
    if (this.isLoaded) return true;

    const renderSpinner = (opts && opts.renderSpinner) || ((c) => {
      c.innerHTML = `
        <div class="loading-spinner">
          <p>${t('loading.tables')}</p>
        </div>
      `;
    });
    renderSpinner(container);

    try {
      await this.init();
      return true;
    } catch (error) {
      container.innerHTML = `
        <div class="error-message">
          <h3>${t('error.loadData')}</h3>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
      return false;
    }
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
            <th>Tabell</th>
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
                <td title="${escapeHtml(table.id)}">${escapeHtml(displayTableId(table.id))}</td>
                <td>
                  <a href="#variables/${table.id}" class="table-link"${table.description ? ` title="${escapeHtml(table.description)}"` : ''}>${escapeHtml(this.cleanTableLabel(table.label, table.firstPeriod, table.lastPeriod))}</a>
                  ${sourceBadgeHTML(table.id)}
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
   * Clean table label (remove table ID prefix if present, and optionally the
   * trailing time period that SSB appends to many titles).
   *
   * The trailing period is only stripped when AppConfig.ui.hidePeriodInTableTitles
   * is enabled and the suffix actually matches the table's first/last period,
   * so we never accidentally cut off part of a real title.
   */
  cleanTableLabel(label, firstPeriod, lastPeriod) {
    let cleaned = label.replace(/^\d+:\s*/, '');
    if (AppConfig.ui.hidePeriodInTableTitles) {
      cleaned = this.stripTrailingPeriod(cleaned, firstPeriod, lastPeriod);
    }
    return cleaned;
  },

  /**
   * Remove the trailing time period from a table title when it matches the
   * recoded first/last period shown in the "Tidsperiode" column.
   *
   * Handles both simple ranges ("2010-2025", "2016M01-2025M12") and titles
   * where each endpoint is itself a range, written with parentheses
   * ("(1990-2000)-(2024-2025)"). When first and last period are equal, a single
   * period at the end ("2025" or "(2025)") is matched too.
   */
  stripTrailingPeriod(label, firstPeriod, lastPeriod) {
    const fp = (firstPeriod || '').trim();
    const lp = (lastPeriod || '').trim();
    if (!fp && !lp) return label;

    const candidates = [];
    if (fp && lp) {
      if (fp === lp) {
        candidates.push(fp, `(${fp})`);
      } else {
        candidates.push(`(${fp})-(${lp})`, `${fp}-${lp}`);
      }
    } else {
      const single = fp || lp;
      candidates.push(single, `(${single})`);
    }

    const trimmed = label.replace(/\s+$/, '');
    for (const candidate of candidates) {
      if (candidate && trimmed.endsWith(candidate)) {
        // Drop the period, then any trailing separator (". ", " ", "-", ":", ",").
        return trimmed
          .slice(0, trimmed.length - candidate.length)
          .replace(/[\s.,:;-]+$/, '');
      }
    }
    return label;
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
        if (!row) return;
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
