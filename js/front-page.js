/**
 * Front Page - Landing page with search field and expanded subject grid
 *
 * Shows a prominent search input, all 6 subject groups as an expanded grid,
 * and a "Nylig oppdaterte tabeller" section grouped by topic node and time period.
 */

async function renderFrontPage(container) {
  // Pre-rendret SEO-forside: behold søkefeltet og emnegridet (som speiler
  // denne visningen) som plassholder, og vis spinneren bare der «Nylig
  // oppdaterte tabeller» kommer — siden blinker ikke ved oppstart
  // (se scripts/generate-seo-pages.mjs)
  const loaded = await BrowserState.ensureLoaded(container, {
    renderSpinner: (c) => {
      const spinnerHTML = `
        <div class="loading-spinner">
          <p>${t('loading.tables')}</p>
        </div>
      `;
      const seoIntro = seoContentMatchesRoute([]) && c.querySelector('.front-seo-intro');
      if (seoIntro) {
        seoIntro.outerHTML = spinnerHTML;
      } else {
        c.innerHTML = spinnerHTML;
      }
    }
  });
  if (!loaded) return;

  const mh = BrowserState.menuHierarchy;
  const recentBuckets = _collectRecentUpdateGroups(mh, BrowserState.recentTables);

  // Ta vare på søketekst skrevet i det statiske SEO-søkefeltet før re-render
  const preRenderQuery = container.querySelector('#front-search')?.value || '';

  container.innerHTML = `
    <div class="front-page">
      <div class="front-search-container">
        <input
          type="text"
          id="front-search"
          placeholder="${t('search.placeholder')}"
          class="search-input front-search-input"
        />
      </div>

      <div class="subject-grid">
        ${Object.entries(mh.subjectGroups).map(([, group]) => `
          <div class="subject-group-column">
            <h3 class="subject-group-column-header">${escapeHtml(t('subject.group.' + group.id))}</h3>
            <ul class="subject-list">
              ${group.subjects.map(code => {
                const name = t('subject.name.' + code) || mh.subjectNames[code];
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
                  <span class="update-group-count">${group.tables.length} ${group.tables.length === 1 ? t('unit.table.one') : t('unit.table.many')}</span>
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
                    <span class="update-period-count">${bucket.totalCount} ${bucket.totalCount === 1 ? t('unit.table.one') : t('unit.table.many')}</span>
                  </summary>
                  <div class="update-group-list">${groupsHTML}</div>
                </details>
              `;
            }
            return `
              <div class="update-period">
                <div class="update-period-label">
                  <span class="update-period-name">${escapeHtml(bucket.label)}</span>
                  ${bucket.totalCount > 0 ? `<span class="update-period-count">${bucket.totalCount} ${bucket.totalCount === 1 ? t('unit.table.one') : t('unit.table.many')}</span>` : ''}
                </div>
                ${bucket.groups.length > 0
                  ? `<div class="update-group-list">${groupsHTML}</div>`
                  : `<p class="update-period-empty">${t('date.noTablesUpdated')}</p>`
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
    if (preRenderQuery) searchInput.value = preRenderQuery;
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
 * True når tabellen skal utelates fra «Nylig oppdatert» fordi den oppdateres
 * tilnærmet daglig (se AppConfig.ui.recentUpdates). Defensiv mot config uten
 * nøkkelen (eldre config-filer / SEO-sandkassen).
 */
function _isHighFrequencyTable(table) {
  const cfg = (AppConfig.ui && AppConfig.ui.recentUpdates) || {};
  if (cfg.showHighFrequency) return false;
  const units = cfg.highFrequencyTimeUnits || [];
  return units.indexOf(table.timeUnit) !== -1;
}

/**
 * Collect recently updated tables grouped by hierarchy node and time bucket.
 * - "I dag" and previous business day always shown (with empty state if needed).
 * - Monday uses "fredag" as previous business day instead of "i går".
 * - "Siste uke" (remaining days) is collapsible and omitted when empty.
 *
 * @param {MenuHierarchy} mh - Menu hierarchy for grouping by topic
 * @param {Array|null} recentTables - Pre-fetched tables from pastDays=7 API call.
 *   When provided, only these tables are scanned (much smaller than the full 7000+ list).
 *   Falls back to scanning all tables in the hierarchy if not provided.
 */
function _collectRecentUpdateGroups(mh, recentTables) {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Previous business day: Mon→Fri (3 days), Sun→Fri (2 days), Sat→Fri (1 day), otherwise 1 day
  const prevBizOffset = dow === 1 ? 3 : dow === 0 ? 2 : 1;
  const startOfPrevBiz = new Date(startOfToday);
  startOfPrevBiz.setDate(startOfPrevBiz.getDate() - prevBizOffset);

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  // When we have pre-fetched recent tables (from pastDays API parameter),
  // group them by their first path instead of walking the full hierarchy tree.
  // This avoids scanning all ~7000 tables when we only need the ~50-200 recent ones.
  const nodeEntries = [];

  if (recentTables && recentTables.length > 0) {
    // Group pre-fetched tables by their topic node path
    const byPath = {};
    for (const t of recentTables) {
      const fp = t.paths && t.paths[0];
      if (!fp || fp.length < 2) continue;
      // Use depth 2 (category) if available, else depth 1 (subtopic)
      const depth = fp.length >= 3 ? 3 : 2;
      const pathIds = fp.slice(0, depth).map(p => p.id);
      const key = pathIds.join('/');
      if (!byPath[key]) {
        // Derive label from the deepest node in the path
        const label = fp[depth - 1].label || pathIds[depth - 1];
        byPath[key] = { label, path: pathIds, tables: [] };
      }
      byPath[key].tables.push(t);
    }
    for (const entry of Object.values(byPath)) {
      nodeEntries.push(entry);
    }
  } else {
    // Fallback: walk the full hierarchy tree
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
  }

  const prevBizLabel = (dow === 0 || dow === 1 || dow === 6) ? t('date.friday') : t('date.yesterday');
  const buckets = [
    { key: 'today',   label: t('date.updatedToday'), from: startOfToday,   to: null,          alwaysShow: true,  collapsible: false },
    { key: 'prevbiz', label: prevBizLabel,            from: startOfPrevBiz, to: startOfToday,  alwaysShow: true,  collapsible: false },
    { key: 'week',    label: t('date.earlier7Days'),  from: startOfWeek,    to: startOfPrevBiz, alwaysShow: false, collapsible: true  },
  ];

  return buckets.map(bucket => {
    const groups = nodeEntries.map(({ label, path, tables }) => {
      const matching = tables.filter(t => {
        if (t.discontinued) return false;
        if (_isHighFrequencyTable(t)) return false;
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
window._isHighFrequencyTable = _isHighFrequencyTable;
