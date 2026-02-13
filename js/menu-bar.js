/**
 * MenuBar - Shared compact menu bar component
 * Used by search-view and topic-view (not by front-page, which shows expanded grid)
 *
 * Renders a horizontal bar with 6 subject group buttons.
 * On hover: dropdown shows subjects within that group.
 * Clicking a subject navigates to #topic/{subjectCode}.
 */

const MenuBar = {
  /**
   * Render the compact menu bar HTML
   * @param {MenuHierarchy} menuHierarchy
   * @returns {string} HTML string
   */
  render(menuHierarchy) {
    return `
      <nav class="subject-groups">
        <div class="subject-group-menu">
          ${Object.entries(menuHierarchy.subjectGroups).map(([id, group]) => `
            <div class="subject-group-item" data-group-id="${id}">
              <button class="subject-group-button">
                <span class="chevron">&#8250;</span> ${escapeHtml(group.label)}
              </button>
              <div class="subject-dropdown">
                ${group.subjects.map(subjectCode => {
                  const subjectName = menuHierarchy.subjectNames[subjectCode];
                  return `
                    <a href="#topic/${subjectCode}" class="subject-link" data-subject-id="${subjectCode}">
                      ${escapeHtml(subjectName || subjectCode)}
                    </a>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </nav>
    `;
  },

  /**
   * Attach click listeners for subject links in the menu bar
   * Navigates to #topic/{subjectCode} on click
   * @param {HTMLElement} container
   */
  attachListeners(container) {
    container.querySelectorAll('.subject-groups .subject-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const subjectId = e.currentTarget.dataset.subjectId;
        URLRouter.navigateTo('topic/' + subjectId, {});
        URLRouter.handleRoute();
      });
    });
  }
};

window.MenuBar = MenuBar;
