/**
 * Front Page - Landing page with search field and expanded subject grid
 *
 * Shows a prominent search input and all 6 subject groups as an expanded grid,
 * with their subjects listed as clickable links below each group header.
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
        ${Object.entries(mh.subjectGroups).map(([id, group]) => `
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

  // Update URL without triggering re-render
  URLRouter.navigateTo('home', {}, false);
}

window.renderFrontPage = renderFrontPage;
