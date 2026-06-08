/**
 * Table Metadata - Build collapsible metadata section for table display
 */

/**
 * Convert a URN from link.describedby to a browsable URL.
 * Handles SSB Klass (classification) and VarDok (variable definition) URNs.
 *
 * @param {string} href - URN or URL from the link.describedby entry
 * @returns {string|null} - Browsable URL, or null if unrecognised
 */
function _urnToUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;

  const klassMatch = href.match(/^urn:ssb:classification:klass:(\d+)$/);
  if (klassMatch) {
    return 'https://www.ssb.no/klass/klassifikasjoner/' + klassMatch[1];
  }

  const vardokMatch = href.match(/^urn:ssb:conceptvariable:vardok:(\d+)$/);
  if (vardokMatch) {
    const lang = typeof getCurrentApiLang === 'function' && getCurrentApiLang() === 'en' ? 'en' : 'nb';
    return 'https://www.ssb.no/a/metadata/conceptvariable/vardok/' + vardokMatch[1] + '/' + lang;
  }

  return null;
}

/**
 * Resolve the short-name (kortnavn) for a table from BrowserState.allTables.
 * Per SSB convention, the 3rd level in a table's `paths` entry is the
 * statistic's short-name, used in ssb.no URLs (e.g. ssb.no/folkemengde).
 * Returns null if BrowserState is not loaded or no path has 3+ levels.
 *
 * @param {string} tableId
 * @returns {string|null}
 */
function _getStatisticShortName(tableId) {
  if (!tableId || typeof BrowserState === 'undefined') return null;
  const tables = BrowserState.allTables;
  if (!Array.isArray(tables)) return null;
  const table = tables.find(t => t.id === tableId);
  if (!table || !Array.isArray(table.paths)) return null;
  for (const path of table.paths) {
    if (Array.isArray(path) && path.length >= 3 && path[2]?.id) {
      return path[2].id;
    }
  }
  return null;
}

/**
 * Convert markdown-style links [text](url) to HTML anchor tags
 * @param {string} text - Text with potential markdown links
 * @returns {string} - HTML with anchor tags
 */
function convertMarkdownLinks(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
}

/**
 * Build the collapsible metadata section HTML
 * @returns {string} - HTML string
 */
function buildMetadataSection() {
  if (!currentFullMetadata) return '';

  const meta = currentFullMetadata;

  // Format updated date
  let updatedStr = '';
  if (meta.updated) {
    try {
      const date = new Date(meta.updated);
      updatedStr = date.toLocaleDateString('no-NO', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      updatedStr = meta.updated;
    }
  }

  // Build notes HTML
  let notesHtml = '';
  if (meta.note && Array.isArray(meta.note) && meta.note.length > 0) {
    notesHtml = '<dt>Merknader</dt><dd>';
    meta.note.forEach(note => {
      notesHtml += '<p>' + convertMarkdownLinks(note) + '</p>';
    });
    notesHtml += '</dd>';
  }

  // Build contact HTML
  let contactHtml = '';
  if (meta.extension && meta.extension.contact && meta.extension.contact.length > 0) {
    contactHtml = '<dt>Kontakt</dt><dd>';
    meta.extension.contact.forEach(contact => {
      const parts = [];
      if (contact.name) parts.push(escapeHtml(contact.name));
      if (contact.phone) parts.push('tlf: ' + escapeHtml(contact.phone));
      if (contact.mail) {
        parts.push('<a href="mailto:' + escapeHtml(contact.mail) + '">' +
                   escapeHtml(contact.mail) + '</a>');
      }
      contactHtml += '<p>' + parts.join(', ') + '</p>';
    });
    contactHtml += '</dd>';
  }

  // Official statistics flag
  let officialHtml = '';
  if (meta.extension && meta.extension.px && meta.extension.px['official-statistics']) {
    officialHtml = '<dt>Status</dt><dd>Offisiell statistikk</dd>';
  }

  // "Om statistikken"-lenke. SSB convention: 3rd level in `paths` is the
  // statistic's short-name (kortnavn) used in ssb.no URLs.
  let aboutHtml = '';
  const kortnavn = _getStatisticShortName(AppState.selectedTable?.id);
  if (kortnavn) {
    const lang = typeof getCurrentApiLang === 'function' && getCurrentApiLang() === 'en' ? 'en/' : '';
    const url = 'https://www.ssb.no/' + lang + encodeURIComponent(kortnavn) + '#om-statistikken';
    aboutHtml = '<dt>Om statistikken</dt><dd><a href="' + escapeHtml(url) +
                '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a></dd>';
  }

  // Build links from link.describedby URNs (Klass classifications + VarDok definitions).
  // Collected from both dataset level and per-dimension level, deduplicated by href.
  let linksHtml = '';
  const seenHrefs = new Set();
  const linkItems = [];

  const addLinks = (entries, dimLabel) => {
    (entries || []).forEach(entry => {
      if (!entry.href || seenHrefs.has(entry.href)) return;
      const url = _urnToUrl(entry.href);
      if (!url) return;
      seenHrefs.add(entry.href);
      const displayLabel = entry.label || entry.href;
      const prefix = dimLabel ? `<span class="metadata-dim-label">${escapeHtml(dimLabel)}:</span> ` : '';
      linkItems.push(`<li>${prefix}<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(displayLabel)}</a></li>`);
    });
  };

  addLinks(meta.link?.describedby, null);
  if (meta.dimension) {
    Object.values(meta.dimension).forEach(dim => addLinks(dim.link?.describedby, dim.label));
  }

  if (linkItems.length > 0) {
    linksHtml = '<dt>Klassifikasjoner og definisjoner</dt><dd><ul class="metadata-links">' +
                linkItems.join('') + '</ul></dd>';
  }

  return `
    <div class="table-metadata">
      <h4 class="metadata-toggle-btn" role="button" tabindex="0" aria-expanded="false">
        <span class="metadata-toggle-icon">&#9654;</span> Tabellinfo
      </h4>
      <div class="metadata-content" style="display: none;">
        <dl>
          ${meta.source ? '<dt>Kilde</dt><dd>' + escapeHtml(meta.source) + '</dd>' : ''}
          ${updatedStr ? '<dt>Sist oppdatert</dt><dd>' + updatedStr + '</dd>' : ''}
          ${officialHtml}
          ${aboutHtml}
          ${notesHtml}
          ${contactHtml}
          ${linksHtml}
        </dl>
      </div>
    </div>
  `;
}
