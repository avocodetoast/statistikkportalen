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
    updatePageTitle([mh.subjectGroups[firstId].label]);
  } else {
    const breadcrumbs = mh.getBreadcrumbs(path);
    const lastCrumb = breadcrumbs[breadcrumbs.length - 1];
    updatePageTitle(lastCrumb ? [lastCrumb.label] : ['Emner']);
  }

  if (isGroupId && path.length === 1) {
    // Level 1: Show subjects in a group (cards)
    _topicRenderGroupSubjects(container, mh, firstId);
  } else if (path.length === 1) {
    // Level 2: Show subtopics for a subject
    _topicRenderSubtopics(container, mh, path);
  } else if (path.length === 2) {
    // Level 3: Categories or table list
    _topicRenderCategories(container, mh, path);
  } else {
    // Level 4+: Table list with hierarchy
    _topicRenderTables(container, mh, path);
  }
}

/**
 * Level 1: Show subjects within a group as cards
 */
function _topicRenderGroupSubjects(container, mh, groupId) {
  const group = mh.subjectGroups[groupId];
  if (!group) {
    container.innerHTML = '<p class="error-message">Ukjent emnegruppe</p>';
    return;
  }

  const subjects = mh.getSubjectsForGroup(groupId);

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      <div class="breadcrumbs">
        <a href="#home" class="breadcrumb-link" data-path="">Forsiden</a>
      </div>

      <h1>${escapeHtml(group.label)}</h1>

      <div class="subtopic-cards">
        ${subjects.map(subject => `
          <div class="subtopic-card" data-subject-id="${subject.id}">
            <h3>${escapeHtml(subject.label)}</h3>
            <p>${subject.tableCount} tabeller</p>
            <span class="card-arrow">&rarr;</span>
          </div>
        `).join('')}
      </div>
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
 * Level 2: Show subtopics for a subject as cards
 */
function _topicRenderSubtopics(container, mh, path) {
  const subjectCode = path[0];
  const subtopics = mh.getSubtopicsForSubject(subjectCode);
  const subjectName = mh.subjectNames[subjectCode];
  const breadcrumbs = mh.getBreadcrumbs([subjectCode]);

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      ${_topicRenderBreadcrumbs(breadcrumbs)}

      <h1>${escapeHtml(subjectName)}</h1>

      <div class="subtopic-cards">
        ${subtopics.map(subtopic => `
          <div class="subtopic-card" data-subtopic-id="${subtopic.id}">
            <h3>${escapeHtml(subtopic.label)}</h3>
            <p>${subtopic.tableCount} tabeller</p>
            <span class="card-arrow">&rarr;</span>
          </div>
        `).join('')}
      </div>
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
 * Level 3: Categories or fall through to table list
 */
function _topicRenderCategories(container, mh, path) {
  const [subjectCode, subtopicId] = path;
  const categories = mh.getCategoriesForSubtopic(subjectCode, subtopicId);
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

      <div class="category-cards">
        ${categories.map(cat => `
          <div class="category-card" data-category-id="${cat.id}">
            <h3>${escapeHtml(cat.label)}</h3>
            <p>${cat.tableCount} tabeller</p>
            <span class="card-arrow">&rarr;</span>
          </div>
        `).join('')}
      </div>
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
    container.innerHTML = '<p class="error-message">Fant ingen tabeller for denne stien</p>';
    return;
  }

  // Collect all tables in this subtree for dropdown counts
  const subtreeTables = mh._collectAllTables(node, true);
  const frequencyCounts = BrowserState.calcFrequencyCounts(subtreeTables, filters);
  const updatedCounts = BrowserState.calcUpdatedCounts(subtreeTables, filters);
  const totalFiltered = BrowserState.filterTables(subtreeTables, filters).length;

  container.innerHTML = `
    <div class="topic-view">
      ${BrowserState.renderSearchInput()}
      ${MenuBar.render(mh)}

      ${_topicRenderBreadcrumbs(breadcrumbs)}

      <div class="search-filters">
        <label class="filter-checkbox">
          <input type="checkbox" id="topic-include-discontinued" ${filters.includeDiscontinued ? 'checked' : ''} />
          <span>Inkluder avsluttede tabeller</span>
        </label>

        <select id="topic-frequency-filter" class="filter-select">
          <option value="" ${!filters.frequencyFilter ? 'selected' : ''}>Alle frekvenser (${totalFiltered})</option>
          <option value="Monthly" ${filters.frequencyFilter === 'Monthly' ? 'selected' : ''}>Månedlig (${frequencyCounts['Monthly'] || 0})</option>
          <option value="Quarterly" ${filters.frequencyFilter === 'Quarterly' ? 'selected' : ''}>Kvartalsvis (${frequencyCounts['Quarterly'] || 0})</option>
          <option value="Annual" ${filters.frequencyFilter === 'Annual' ? 'selected' : ''}>Årlig (${frequencyCounts['Annual'] || 0})</option>
          <option value="Other" ${filters.frequencyFilter === 'Other' ? 'selected' : ''}>Annet (${frequencyCounts['Other'] || 0})</option>
        </select>

        <select id="topic-updated-filter" class="filter-select">
          <option value="" ${!filters.updatedFilter ? 'selected' : ''}>Alle perioder (${totalFiltered})</option>
          <option value="1" ${filters.updatedFilter === '1' ? 'selected' : ''}>Oppdatert siste dag (${updatedCounts['1'] || 0})</option>
          <option value="7" ${filters.updatedFilter === '7' ? 'selected' : ''}>Oppdatert siste uke (${updatedCounts['7'] || 0})</option>
          <option value="30" ${filters.updatedFilter === '30' ? 'selected' : ''}>Oppdatert siste måned (${updatedCounts['30'] || 0})</option>
          <option value="365" ${filters.updatedFilter === '365' ? 'selected' : ''}>Oppdatert siste år (${updatedCounts['365'] || 0})</option>
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
  const filterIds = ['topic-include-discontinued', 'topic-frequency-filter', 'topic-updated-filter'];
  filterIds.forEach(filterId => {
    const element = document.getElementById(filterId);
    if (element) {
      element.addEventListener('change', () => {
        // Update BrowserState filters from DOM
        BrowserState.topicFilters.includeDiscontinued =
          document.getElementById('topic-include-discontinued')?.checked || false;
        BrowserState.topicFilters.frequencyFilter =
          document.getElementById('topic-frequency-filter')?.value || '';
        BrowserState.topicFilters.updatedFilter =
          document.getElementById('topic-updated-filter')?.value || '';

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
      });
    }
  });
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
          <span class="hierarchy-count">(${childTableCount} tabeller)</span>
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

  const freqEl = document.getElementById('topic-frequency-filter');
  if (freqEl) {
    const selected = freqEl.value;
    freqEl.innerHTML = `
      <option value="">Alle frekvenser (${totalFiltered})</option>
      <option value="Monthly">Månedlig (${frequencyCounts['Monthly'] || 0})</option>
      <option value="Quarterly">Kvartalsvis (${frequencyCounts['Quarterly'] || 0})</option>
      <option value="Annual">Årlig (${frequencyCounts['Annual'] || 0})</option>
      <option value="Other">Annet (${frequencyCounts['Other'] || 0})</option>
    `;
    if (selected) freqEl.value = selected;
  }

  const updEl = document.getElementById('topic-updated-filter');
  if (updEl) {
    const selected = updEl.value;
    updEl.innerHTML = `
      <option value="">Alle perioder (${totalFiltered})</option>
      <option value="1">Oppdatert siste dag (${updatedCounts['1'] || 0})</option>
      <option value="7">Oppdatert siste uke (${updatedCounts['7'] || 0})</option>
      <option value="30">Oppdatert siste måned (${updatedCounts['30'] || 0})</option>
      <option value="365">Oppdatert siste år (${updatedCounts['365'] || 0})</option>
    `;
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
