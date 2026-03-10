/**
 * Front Page - Landing page with search field and expanded subject grid
 *
 * Shows a prominent search input, all 6 subject groups as an expanded grid,
 * and a "Nylig oppdaterte tabeller" section grouped by topic node and time period.
 */

async function renderFrontPage(container) {
  // Show loading if data not ready
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
  const recentBuckets = _collectRecentUpdateGroups(mh);

  container.innerHTML = `
    <div class="front-page">
      <div class="front-search-container">
        <input
          type="text"
          id="front-search"
          placeholder="Søk etter tabell (ID, tittel, variabler...)"
          class="search-input front-search-input"
        />
      </div>

      <div class="subject-grid">
        ${Object.entries(mh.subjectGroups).map(([, group]) => `
          <div class="subject-group-column">
            <h3 class="subject-group-column-header">${escapeHtml(group.label)}</h3>
            <ul class="subject-list">
              ${group.subjects.map(code => {
                const name = mh.subjectNames[code];
                return `<li><a href="#topic/${code}" class="front-subject-link" data-subject="${code}">${escapeHtml(name)}</a></li>`;
              }).join('')}
            </ul>
          </div>
        `).join('')}
      </div>

      <section class="recently-updated">
          ${recentBuckets.map(bucket => {
            const groupsHTML = bucket.groups.map(group => `
              <details class="update-group">
                <summary class="update-group-summary">
                  <a href="#" class="update-group-link" data-path="${escapeHtml(group.path.join('/'))}">${escapeHtml(group.label)}</a>
                  <span class="update-group-count">${group.tables.length} tabeller</span>
                </summary>
                <div class="update-group-tables">
                  ${BrowserState.renderTableListHTML(group.tables)}
                </div>
              </details>
            `).join('');

            if (bucket.collapsible) {
              return `
                <details class="update-period-collapsible">
                  <summary class="update-period-collapsible-summary">
                    <span class="update-period-name">${escapeHtml(bucket.label)}</span>
                    <span class="update-period-count">${bucket.totalCount} tabeller</span>
                  </summary>
                  <div class="update-group-list">${groupsHTML}</div>
                </details>
              `;
            }
            return `
              <div class="update-period">
                <div class="update-period-label">
                  <span class="update-period-name">${escapeHtml(bucket.label)}</span>
                  ${bucket.totalCount > 0 ? `<span class="update-period-count">${bucket.totalCount} tabeller</span>` : ''}
                </div>
                ${bucket.groups.length > 0
                  ? `<div class="update-group-list">${groupsHTML}</div>`
                  : `<p class="update-period-empty">Ingen tabeller oppdatert</p>`
                }
              </div>
            `;
          }).join('')}
        </section>
    </div>
  `;

  // Search: navigate to search view on Enter
  const searchInput = document.getElementById('front-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (!query) return;
        const sqId = detectSavedQueryId(query);
        if (sqId) {
          URLRouter.navigateTo('sq/' + sqId, {});
          URLRouter.handleRoute();
        } else {
          URLRouter.navigateTo('search', { q: query });
          URLRouter.handleRoute();
        }
      }
    });
    searchInput.focus();
  }

  // Subject links: navigate to topic view
  container.querySelectorAll('.front-subject-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const code = e.currentTarget.dataset.subject;
      URLRouter.navigateTo('topic/' + code, {});
      URLRouter.handleRoute();
    });
  });

  // Recently updated: topic group links → navigate to topic view
  container.querySelectorAll('.update-group-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent <details> toggle
      const path = e.currentTarget.dataset.path;
      BrowserState.resetTopicFilters();
      URLRouter.navigateTo('topic/' + path, {});
      URLRouter.handleRoute();
    });
  });

  // Recently updated: table links → navigate to variable selection
  const recentSection = container.querySelector('.recently-updated');
  if (recentSection) {
    BrowserState.attachTableLinkListeners(recentSection);
  }

  // Update URL without triggering re-render
  URLRouter.navigateTo('home', {}, false);
}

/**
 * Collect recently updated tables grouped by hierarchy node and time bucket.
 * - "I dag" and previous business day always shown (with empty state if needed).
 * - Monday uses "fredag" as previous business day instead of "i går".
 * - "Siste uke" (remaining days) is collapsible and omitted when empty.
 */
function _collectRecentUpdateGroups(mh) {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Previous business day: Mon→Fri (3 days), Sun→Fri (2 days), Sat→Fri (1 day), otherwise 1 day
  const prevBizOffset = dow === 1 ? 3 : dow === 0 ? 2 : 1;
  const startOfPrevBiz = new Date(startOfToday);
  startOfPrevBiz.setDate(startOfPrevBiz.getDate() - prevBizOffset);

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  // Collect nodes at category level (depth 2). If a subtopic has no categories,
  // fall back to subtopic level. Only include a table if its first path matches
  // the node's path, so tables with multiple paths appear in exactly one group.
  const nodeEntries = [];
  function addEntry(node, path) {
    const tables = mh._collectAllTables(node, true).filter(t => {
      const fp = t.paths && t.paths[0];
      if (!fp || fp.length < path.length) return false;
      return path.every((id, i) => fp[i].id === id);
    });
    if (tables.length > 0) nodeEntries.push({ label: node.label, path, tables });
  }
  for (const [subjectCode, subjectNode] of Object.entries(mh.hierarchy)) {
    for (const [subtopicId, subtopicNode] of Object.entries(subjectNode.children)) {
      const categories = Object.entries(subtopicNode.children);
      if (categories.length > 0) {
        for (const [categoryId, categoryNode] of categories) {
          addEntry(categoryNode, [subjectCode, subtopicId, categoryId]);
        }
      } else {
        addEntry(subtopicNode, [subjectCode, subtopicId]);
      }
    }
  }

  const prevBizLabel = (dow === 0 || dow === 1 || dow === 6) ? 'Fredag' : 'I går';
  const buckets = [
    { key: 'today',   label: 'Oppdatert i dag', from: startOfToday,   to: null,          alwaysShow: true,  collapsible: false },
    { key: 'prevbiz', label: prevBizLabel,       from: startOfPrevBiz, to: startOfToday,  alwaysShow: true,  collapsible: false },
    { key: 'week',    label: 'Tidligere siste 7 dager',        from: startOfWeek,    to: startOfPrevBiz, alwaysShow: false, collapsible: true  },
  ];

  return buckets.map(bucket => {
    const groups = nodeEntries.map(({ label, path, tables }) => {
      const matching = tables.filter(t => {
        if (t.discontinued) return false;
        if (!t.updated) return false;
        const d = new Date(t.updated);
        return d >= bucket.from && (!bucket.to || d < bucket.to);
      });
      return matching.length > 0 ? { label, path, tables: matching } : null;
    }).filter(Boolean);

    groups.sort((a, b) => b.tables.length - a.tables.length);
    const totalCount = groups.reduce((s, g) => s + g.tables.length, 0);
    return { key: bucket.key, label: bucket.label, groups, totalCount, alwaysShow: bucket.alwaysShow, collapsible: bucket.collapsible };
  }).filter(b => b.alwaysShow || b.groups.length > 0);
}

window.renderFrontPage = renderFrontPage;
