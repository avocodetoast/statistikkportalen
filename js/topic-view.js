/**
 * Topic View - Browse statistics by subject hierarchy
 *
 * Shows: search input + compact menu bar + breadcrumbs + content
 * Content varies by depth:
 *   Level 2: subtopic cards (e.g., Befolkning → Barn, Flytting, Folketall...)
 *   Level 3: category cards or table list
 *   Level 4+: table list with recursive hierarchy + filters
 *
 * Filters (include discontinued, frequency, period) appear only at table-listing levels.
 * Filters reset when navigating to a new topic (new pushState).
 */

async function renderTopicView(container) {
  // Pre-rendret SEO-emneside for samme rute: behold det statiske innholdet
  // som plassholder under lastingen i stedet for spinner, så siden ikke
  // blinker ved oppstart (se scripts/generate-seo-pages.mjs)
  const loaded = await BrowserState.ensureLoaded(container, {
    renderSpinner: (c) => {
      if (!seoContentMatchesRoute(AppState.topicPath)) {
        c.innerHTML = `
          <div class="loading-spinner">
            <p>${t('loading.tables')}</p>
          </div>
        `;
      }
    }
  });
  if (!loaded) return;

  const mh = BrowserState.menuHierarchy;
  const path = AppState.topicPath || [];

  if (path.length === 0) {
    // No path - redirect to home
    URLRouter.navigateTo('home', {}, false);
    renderFrontPage(container);
    return;
  }

  // Determine what to render based on path depth
  const firstId = path[0];
  const isGroupId = Object.keys(mh.subjectGroups).includes(firstId);

  // Update page title with deepest named topic
  if (isGroupId && path.length === 1) {
    updatePageTitle([t('subject.group.' + firstId)]);
  } else {
    const breadcrumbs = mh.getBreadcrumbs(path);
    const lastCrumb = breadcrumbs[breadcrumbs.length - 1];
    updatePageTitle(lastCrumb ? [lastCrumb.label] : [t('nav.subjects')]);
  }

  // Antall stinivåer som vises som navigasjonskort før tabellisten
  // (konfigurerbart per instans; SSB-standard er 2)
  const cardDepth = AppConfig.ui?.topicCardDepth ?? 2;

  if (isGroupId && path.length === 1) {
    // Level 1: Show subjects in a group (cards)
    _topicRenderGroupSubjects(container, mh, firstId);
  } else if (path.length === 1 && cardDepth >= 1) {
    // Level 2: Show subtopics for a subject
    _topicRenderSubtopics(container, mh, path);
  } else if (path.length <= cardDepth) {
    // Card levels below subject: categories or fall through to table list
    _topicRenderCategories(container, mh, path);
  } else {
    // Below cardDepth: Table list with hierarchy
    _topicRenderTables(container, mh, path);
  }
}

/**
 * Level 1: Show subjects within a group as cards
 */
function _topicRenderGroupSubjects(container, mh, groupId) {
  const group = mh.subjectGroups[groupId];
  if (!group) {
    container.innerHTML = '<p class="error-message">' + t('topic.unknownGroup') + '</p>';
    return;
  }

  const subjects = mh.getSubjectsForGroup(groupId);

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      <div class="breadcrumbs">
        <a href="#home" class="breadcrumb-link" data-path="">${t('nav.home')}</a>
      </div>

      <h1>${escapeHtml(t('subject.group.' + groupId))}</h1>

      ${_topicRenderCardGrid('subtopic-cards', 'subtopic-card', subjects, 'subject-id')}
    </div>
  `;

  _topicAttachCommonListeners(container);

  container.querySelectorAll('.subtopic-card').forEach(card => {
    card.addEventListener('click', () => {
      const subjectId = card.dataset.subjectId;
      BrowserState.resetTopicFilters();
      URLRouter.navigateTo('topic/' + subjectId, {});
      URLRouter.handleRoute();
    });
  });
}

/**
 * Render a grid of navigation cards ({id, label, tableCount} items) — shared
 * by the group-subjects, subtopics, and categories card levels, which only
 * differ in CSS class names and the data-* attribute used for navigation.
 */
function _topicRenderCardGrid(gridClass, cardClass, items, dataAttr) {
  return `
    <div class="${gridClass}">
      ${items.map(item => `
        <div class="${cardClass}" data-${dataAttr}="${item.id}">
          <h3>${escapeHtml(item.label)}</h3>
          <p>${item.tableCount} ${item.tableCount === 1 ? t('unit.table.one') : t('unit.table.many')}</p>
          <span class="card-arrow">&rarr;</span>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Level 2: Show subtopics for a subject as cards
 */
function _topicRenderSubtopics(container, mh, path) {
  const subjectCode = path[0];
  const subtopics = mh.getSubtopicsForSubject(subjectCode);
  const subjectName = t('subject.name.' + subjectCode) || mh.subjectNames[subjectCode];
  const breadcrumbs = mh.getBreadcrumbs([subjectCode]);

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      ${_topicRenderBreadcrumbs(breadcrumbs)}

      <h1>${escapeHtml(subjectName)}</h1>

      ${_topicRenderCardGrid('subtopic-cards', 'subtopic-card', subtopics, 'subtopic-id')}
    </div>
  `;

  _topicAttachCommonListeners(container);

  container.querySelectorAll('.subtopic-card').forEach(card => {
    card.addEventListener('click', () => {
      const subtopicId = card.dataset.subtopicId;
      BrowserState.resetTopicFilters();
      URLRouter.navigateTo('topic/' + subjectCode + '/' + subtopicId, {});
      URLRouter.handleRoute();
    });
  });
}

/**
 * Card levels below the subject level (any depth up to topicCardDepth):
 * categories as cards, or fall through to table list
 */
function _topicRenderCategories(container, mh, path) {
  const categories = mh.getChildrenForPath(path);
  const breadcrumbs = mh.getBreadcrumbs(path);

  // If no subcategories, go directly to table list
  if (categories.length === 0) {
    _topicRenderTables(container, mh, path);
    return;
  }

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      ${_topicRenderBreadcrumbs(breadcrumbs)}

      <h1>${escapeHtml(breadcrumbs[breadcrumbs.length - 1].label)}</h1>

      ${_topicRenderCardGrid('category-cards', 'category-card', categories, 'category-id')}
    </div>
  `;

  _topicAttachCommonListeners(container);

  container.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      const categoryId = card.dataset.categoryId;
      BrowserState.resetTopicFilters();
      URLRouter.navigateTo('topic/' + path.join('/') + '/' + categoryId, {});
      URLRouter.handleRoute();
    });
  });
}

/**
 * Level 4+: Table list with recursive hierarchy and filters
 */
function _topicRenderTables(container, mh, path) {
  const node = mh.getNodeForPath(path);
  const breadcrumbs = mh.getBreadcrumbs(path);
  const filters = BrowserState.topicFilters;

  if (!node) {
    container.innerHTML = '<p class="error-message">' + t('error.noTablesPath') + '</p>';
    return;
  }

  // Collect all tables in this subtree for dropdown counts
  const subtreeTables = mh._collectAllTables(node, true);
  const frequencyCounts = BrowserState.calcFrequencyCounts(subtreeTables, filters);
  const updatedCounts = BrowserState.calcUpdatedCounts(subtreeTables, filters);
  const sourceCounts = BrowserState.calcSourceCounts(subtreeTables, filters);
  const totalFiltered = BrowserState.filterTables(subtreeTables, filters).length;

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      ${_topicRenderBreadcrumbs(breadcrumbs)}

      <div class="search-filters">
        <label class="filter-checkbox">
          <input type="checkbox" id="topic-include-discontinued" ${filters.includeDiscontinued ? 'checked' : ''} />
          <span>${t('search.includeStopped')}</span>
        </label>

        ${BrowserState.renderSourceFilter(sourceCounts, filters.sourceFilter, 'topic-')}

        <select id="topic-frequency-filter" class="filter-select">
          ${BrowserState.renderFrequencyFilterOptions(frequencyCounts, {
            selected: filters.frequencyFilter,
            allLabel: `${t('filter.allFrequencies')} (${totalFiltered})`
          })}
        </select>

        <select id="topic-updated-filter" class="filter-select">
          ${BrowserState.renderUpdatedFilterOptions(updatedCounts, {
            selected: filters.updatedFilter,
            allLabel: `${t('filter.allPeriods')} (${totalFiltered})`
          })}
        </select>
      </div>

      <h1>${escapeHtml(breadcrumbs[breadcrumbs.length - 1].label)}</h1>

      <div id="topic-table-area" class="table-groups">
        ${_topicRenderSubtree(node, 0, mh, filters)}
      </div>
    </div>
  `;

  _topicAttachCommonListeners(container);

  // Attach table link listeners
  const tableArea = document.getElementById('topic-table-area');
  if (tableArea) {
    BrowserState.attachTableLinkListeners(tableArea);
  }

  // Filter change listeners: re-render only the table area
  const onFilterChange = () => {
    // Update BrowserState filters from DOM
    BrowserState.topicFilters.includeDiscontinued =
      document.getElementById('topic-include-discontinued')?.checked || false;
    BrowserState.topicFilters.frequencyFilter =
      document.getElementById('topic-frequency-filter')?.value || '';
    BrowserState.topicFilters.updatedFilter =
      document.getElementById('topic-updated-filter')?.value || '';
    BrowserState.topicFilters.sourceFilter = BrowserState.readSourceFilter(document);

    // Update URL with new filters (replaceState)
    const urlParams = BrowserState.topicFiltersToParams();
    URLRouter.navigateTo('topic/' + path.join('/'), urlParams, false);

    // Re-render table area
    const area = document.getElementById('topic-table-area');
    if (area) {
      area.innerHTML = _topicRenderSubtree(node, 0, mh, BrowserState.topicFilters);
      BrowserState.attachTableLinkListeners(area);
    }

    // Update dropdown counts
    _topicUpdateDropdownCounts(subtreeTables);
  };

  const filterIds = ['topic-include-discontinued', 'topic-frequency-filter', 'topic-updated-filter'];
  filterIds.forEach(filterId => {
    const element = document.getElementById(filterId);
    if (element) {
      element.addEventListener('change', onFilterChange);
    }
  });

  // Source filter dropdown: rendered only when the instance has more than
  // one source (setupSourceFilterDropdown is a no-op otherwise)
  BrowserState.setupSourceFilterDropdown(container, onFilterChange);
}

/**
 * Recursively render a hierarchy subtree with nested collapsible sections
 */
function _topicRenderSubtree(node, depth, mh, filters) {
  let html = '';

  // Render tables at this node level (if any)
  if (node.tables.length > 0) {
    const filteredTables = BrowserState.filterTables(node.tables, filters);

    // Deduplicate
    const uniqueTables = new Map();
    filteredTables.forEach(t => uniqueTables.set(t.id, t));
    const tables = Array.from(uniqueTables.values());

    if (tables.length > 0) {
      const tableGroups = mh.groupTables(tables);
      const onlyFallbackGroup = tableGroups.length === 1 && tableGroups[0].isFallback;

      if (onlyFallbackGroup) {
        // Every table landed in the generic "Andre tabeller" catch-all (no
        // base year / no SSB-style timeUnit to group by — typical for
        // foreign-source nodes like NB or FHI). A single meaningless group
        // header is just noise, so drop the header — but keep the same card
        // chrome as .table-group so the section looks identical to siblings
        // that do have real groups.
        html += `
          <div class="table-group table-group--plain">
            ${BrowserState.renderTableListHTML(tableGroups[0].tables)}
          </div>
        `;
      } else {
        html += tableGroups.map(group => `
          <details class="table-group" open>
            <summary class="table-group-header">
              <span class="expand-icon">&#9660;</span>
              ${escapeHtml(group.name)}
            </summary>
            ${BrowserState.renderTableListHTML(group.tables)}
          </details>
        `).join('');
      }
    }
  }

  // Render child nodes as nested collapsible sections
  const children = Object.values(node.children)
    .sort((a, b) => a.sortCode.localeCompare(b.sortCode));

  for (const child of children) {
    const childTableCount = _topicCountFilteredTables(child, filters, mh);
    if (childTableCount === 0) continue;

    html += `
      <details class="hierarchy-group depth-${depth}" ${depth < 2 ? 'open' : ''}>
        <summary class="hierarchy-group-header">
          ${escapeHtml(child.label)}
          <span class="hierarchy-count">(${childTableCount} ${childTableCount === 1 ? t('unit.table.one') : t('unit.table.many')})</span>
        </summary>
        <div class="hierarchy-group-content">
          ${_topicRenderSubtree(child, depth + 1, mh, filters)}
        </div>
      </details>
    `;
  }

  return html;
}

/**
 * Count tables in a node respecting current topic filters (delegates to shared utility)
 */
function _topicCountFilteredTables(node, filters, mh) {
  const allTables = mh._collectAllTables(node, true);
  return BrowserState.filterTables(allTables, filters).length;
}

/**
 * Update frequency and updated-filter dropdowns with dynamic hit counts
 */
function _topicUpdateDropdownCounts(subtreeTables) {
  const filters = BrowserState.topicFilters;
  const frequencyCounts = BrowserState.calcFrequencyCounts(subtreeTables, filters);
  const updatedCounts = BrowserState.calcUpdatedCounts(subtreeTables, filters);
  const totalFiltered = BrowserState.filterTables(subtreeTables, filters).length;

  BrowserState.updateSourceFilterCounts(
    document, BrowserState.calcSourceCounts(subtreeTables, filters)
  );

  const freqEl = document.getElementById('topic-frequency-filter');
  if (freqEl) {
    const selected = freqEl.value;
    freqEl.innerHTML = BrowserState.renderFrequencyFilterOptions(frequencyCounts, {
      allLabel: `${t('filter.allFrequencies')} (${totalFiltered})`
    });
    if (selected) freqEl.value = selected;
  }

  const updEl = document.getElementById('topic-updated-filter');
  if (updEl) {
    const selected = updEl.value;
    updEl.innerHTML = BrowserState.renderUpdatedFilterOptions(updatedCounts, {
      allLabel: `${t('filter.allPeriods')} (${totalFiltered})`
    });
    if (selected) updEl.value = selected;
  }
}

// ========== Breadcrumbs ==========

function _topicRenderBreadcrumbs(breadcrumbs) {
  return `
    <div class="breadcrumbs">
      ${breadcrumbs.map((crumb, i) => `
        ${i > 0 ? '<span class="breadcrumb-sep">/</span>' : ''}
        <a href="#" class="breadcrumb-link" data-path="${crumb.path.join(',')}">${escapeHtml(crumb.label)}</a>
      `).join('')}
    </div>
  `;
}

// ========== Common event listeners ==========

function _topicAttachCommonListeners(container) {
  // Menu bar listeners
  MenuBar.attachListeners(container);

  // Search input listener (Enter → navigate to search)
  BrowserState.attachSearchInputListener();

  // Breadcrumb listeners
  container.querySelectorAll('.breadcrumb-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const pathStr = e.currentTarget.dataset.path;

      if (!pathStr) {
        // Navigate to home
        URLRouter.navigateTo('home', {});
        URLRouter.handleRoute();
        return;
      }

      const pathParts = pathStr.split(',').filter(p => p);

      if (pathParts.length === 0) {
        URLRouter.navigateTo('home', {});
        URLRouter.handleRoute();
        return;
      }

      // Check if first part is a group ID
      const mh = BrowserState.menuHierarchy;
      const isGroupId = Object.keys(mh.subjectGroups).includes(pathParts[0]);

      if (isGroupId && pathParts.length === 1) {
        // Navigate to group level
        BrowserState.resetTopicFilters();
        URLRouter.navigateTo('topic/' + pathParts[0], {});
      } else {
        // Navigate to path level - keep filters only if same base path
        BrowserState.resetTopicFilters();
        URLRouter.navigateTo('topic/' + pathParts.join('/'), {});
      }
      URLRouter.handleRoute();
    });
  });
}

window.renderTopicView = renderTopicView;
