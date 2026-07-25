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
  // Kortnavn-konvensjonen gjelder bare SSB-eide tabeller — fremmede kilder
  // (nb-*/fhi-*) kan også ha 3-nivås paths (FHI-register → kategori), men de
  // skal ikke få en ssb.no-«Om statistikken»-lenke.
  if (sourceKeyForTableId(tableId) !== 'ssb') return null;
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
 * @param {Object} [metadata] - JSON-Stat2 metadata; defaults to currentFullMetadata
 *                              (table-display) so existing callers are unchanged
 * @returns {string} - HTML string
 */
function buildMetadataSection(metadata) {
  const meta = metadata
    || (typeof currentFullMetadata !== 'undefined' ? currentFullMetadata : null);
  if (!meta) return '';

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

  // Radene samles opp i rekkefølge via addRow(). Kildens egne avsnittstitler
  // (extension.sections) kolliderer i praksis med våre faste etiketter — FHI
  // har både et «Kilde»- og et «Om statistikken»-avsnitt — og to <dt> med
  // samme tekst i samme <dl> er forvirrende. addRow SLÅR DERFOR SAMMEN
  // innholdet under den første raden med den etiketten, i stedet for å lage en
  // duplikatrad.
  const rows = [];
  const rowIndexByLabel = new Map();
  const addRow = (label, contentHtml) => {
    if (!label || !contentHtml) return;
    const key = label.trim().toLowerCase();
    const existing = rowIndexByLabel.get(key);
    if (existing !== undefined) {
      rows[existing].content += contentHtml;
      return;
    }
    rowIndexByLabel.set(key, rows.length);
    rows.push({ label: label, content: contentHtml });
  };
  const paragraphs = lines => lines.map(line => '<p>' + convertMarkdownLinks(line) + '</p>').join('');

  if (meta.source) addRow(t('metadata.source'), escapeHtml(meta.source));

  // Hvem som faktisk publiserer statistikken, når det avviker fra kildenavnet
  // (FHI-registeret «nokkel» utgis f.eks. av Helsedirektoratet).
  const publishedBy = meta.extension && meta.extension.publishedBy;
  if (publishedBy && String(meta.source || '').indexOf(publishedBy) === -1) {
    addRow(t('metadata.publishedBy'), escapeHtml(publishedBy));
  }

  if (updatedStr) addRow(t('metadata.updated'), updatedStr);

  // Official statistics flag
  if (meta.extension && meta.extension.px && meta.extension.px['official-statistics']) {
    addRow(t('metadata.status'), escapeHtml(t('metadata.official')));
  }

  // "Om statistikken"-lenke. SSB convention: 3rd level in `paths` is the
  // statistic's short-name (kortnavn) used in ssb.no URLs. Andre kilder får
  // lenken fra adapteren i stedet (FHI: registerets aboutUrl fra /Common/source).
  const kortnavn = _getStatisticShortName(AppState.selectedTable?.id);
  const aboutUrl = kortnavn
    ? 'https://www.ssb.no/' +
      (typeof getCurrentApiLang === 'function' && getCurrentApiLang() === 'en' ? 'en/' : '') +
      encodeURIComponent(kortnavn) + '#om-statistikken'
    : (meta.extension && meta.extension.aboutUrl) || '';
  if (aboutUrl) {
    addRow(t('metadata.about'),
      '<p><a href="' + escapeHtml(aboutUrl) + '" target="_blank" rel="noopener">' +
      escapeHtml(aboutUrl) + '</a></p>');
  }

  // Merknader. Hopp over når kilden leverer sine egne avsnitt: da er noten
  // (FHI-katalogens beskrivelse) et utdrag av nettopp det første avsnittet, og
  // ville stått ordrett to ganger. Andre noter (f.eks. EN-språknoten) beholdes.
  const sections = (meta.extension && meta.extension.sections) || null;
  if (Array.isArray(meta.note) && meta.note.length > 0) {
    const sectionText = new Set(
      (sections || []).flatMap(s => (s.lines || []).map(l => l.trim()))
    );
    const notes = sections
      ? meta.note.filter(n => !sectionText.has(String(n).trim()))
      : meta.note;
    if (notes.length) addRow(t('metadata.notes'), paragraphs(notes));
  }

  // Kildens egne metadata-avsnitt (FHI: «Om statistikken», «Definisjoner»,
  // «Tolking og feilkilder» …). Adapteren har allerede konvertert HTML til rene
  // linjer og filtrert bort de redundante dimensjonsopplistingene — se
  // js/sources/fhi-adapter.js. Overskriftene kommer fra kilden og oversettes
  // ikke. Faller stille bort for kilder som ikke leverer feltet (SSB/NB).
  (sections || []).forEach(section => {
    if (!section || !section.header || !Array.isArray(section.lines) || !section.lines.length) return;
    addRow(section.header, paragraphs(section.lines));
  });

  // Tegnforklaring for undertrykte celler (FHI /flag).
  const flags = meta.extension && meta.extension.flags;
  if (Array.isArray(flags) && flags.length > 0) {
    addRow(t('metadata.flags'), '<ul class="metadata-flags">' +
      flags.map(flag =>
        '<li><code>' + escapeHtml(flag.symbol) + '</code> ' + escapeHtml(flag.description) + '</li>'
      ).join('') + '</ul>');
  }

  // Build contact HTML
  if (meta.extension && meta.extension.contact && meta.extension.contact.length > 0) {
    let contactHtml = '';
    meta.extension.contact.forEach(contact => {
      const parts = [];
      if (contact.name) parts.push(escapeHtml(contact.name));
      if (contact.phone) parts.push(escapeHtml(t('metadata.phone')) + ': ' + escapeHtml(contact.phone));
      if (contact.mail) {
        parts.push('<a href="mailto:' + escapeHtml(contact.mail) + '">' +
                   escapeHtml(contact.mail) + '</a>');
      }
      contactHtml += '<p>' + parts.join(', ') + '</p>';
    });
    addRow(t('metadata.contact'), contactHtml);
  }

  // Build links from link.describedby URNs (Klass classifications + VarDok definitions).
  // Collected from both dataset level and per-dimension level, deduplicated by href.
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
    addRow(t('metadata.classifications'),
      '<ul class="metadata-links">' + linkItems.join('') + '</ul>');
  }

  const rowsHtml = rows.map(row =>
    '<dt>' + escapeHtml(row.label) + '</dt><dd>' + row.content + '</dd>'
  ).join('');

  return `
    <div class="table-metadata">
      <h4 class="metadata-toggle-btn" role="button" tabindex="0" aria-expanded="false">
        <span class="metadata-toggle-icon">&#9654;</span> ${escapeHtml(t('metadata.title'))}
      </h4>
      <div class="metadata-content" style="display: none;">
        <dl>${rowsHtml}</dl>
      </div>
    </div>
  `;
}

/**
 * Wire up expand/collapse (click + Enter/Space) for a metadata section
 * rendered by buildMetadataSection(). Used by both the table-display and
 * variable-select views.
 * @param {HTMLElement} container - Element containing the .table-metadata markup
 */
function setupMetadataToggle(container) {
  const metaToggle = container?.querySelector('.metadata-toggle-btn');
  if (!metaToggle) return;
  metaToggle.addEventListener('click', () => {
    const content = container.querySelector('.metadata-content');
    const icon = metaToggle.querySelector('.metadata-toggle-icon');
    if (content.style.display === 'none') {
      content.style.display = 'block';
      icon.innerHTML = '&#9660;';
      metaToggle.setAttribute('aria-expanded', 'true');
    } else {
      content.style.display = 'none';
      icon.innerHTML = '&#9654;';
      metaToggle.setAttribute('aria-expanded', 'false');
    }
  });
  metaToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      metaToggle.click();
    }
  });
}
