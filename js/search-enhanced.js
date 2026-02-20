/**
 * SearchEnhanced - Beta enhanced search engine
 *
 * Features vs. basic search:
 * - Multi-word AND matching (each word must match somewhere)
 * - Diacritic normalization (arbok → matches Årbok)
 * - Relevance ranking (title match ranks higher than path match)
 * - Synonym expansion (AKU → Arbeidskraftundersøkelsen)
 * - Topic path search at Level 4+ (path.slice(2) segments)
 *
 * Used by BrowserState.filterTables() when filters.enhanced is true.
 */

const SearchEnhanced = {

  /**
   * Bidirectional synonym groups: each array is a set of equivalent terms (all normalized).
   * If a query token matches ANY term in a group, the search also tries ALL other terms in the group.
   * Add/remove groups or terms freely — order within a group doesn't matter.
   */
  SYNONYM_GROUPS: [
    ['aku', 'arbeidskraftundersokelsen', 'arbeidskraftmaling'],
    ['bnp', 'bruttonasjonalprodukt', 'bruttoprodukt'],
    ['kpi', 'konsumprisindeks', 'prisvekst', 'inflasjon'],
    ['knr', 'nasjonalregnskap'],
    ['fob', 'folke og boligtellingen', 'folke boligtellingen'],
    ['ssb', 'statistisk sentralbyra'],
    ['nav', 'arbeids og velferdsetaten'],
    ['nho', 'naeringslivets hovedorganisasjon'],
    ['sfo', 'skolefritidsordning'],
    ['vgs', 'videregaende skole', 'videregaende opplaering'],
    ['gsi', 'grunnskolens informasjonssystem'],
    ['kostra', 'kommune stat rapportering'],
    ['fhi', 'folkehelseinstituttet'],
    ['mva', 'merverdiavgift', 'merverdi'],
    ['helse', 'helseforetak', 'sykehus'],
    ['bolig', 'eiendom', 'boliger'],
    ['sysselsetting', 'sysselsatte', 'arbeidsforhold'],
    ['arbeidsledig', 'arbeidsledighet', 'ledige', 'ledighetsprosent'],
  ],

  /**
   * Normalize a string: lowercase + strip Norwegian/common diacritics.
   */
  normalizeText(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/å/g, 'a')
      .replace(/ø/g, 'o')
      .replace(/æ/g, 'ae')
      .replace(/é|è|ê|ë/g, 'e')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ä/g, 'ae');
  },

  /**
   * Build a search index from a table array.
   * Called lazily and cached on BrowserState._searchIndex.
   *
   * @param {Array} tables - Full table list from BrowserState.allTables
   * @returns {Array} Index entries, one per table
   */
  buildIndex(tables) {
    logger.log('[SearchEnhanced] Building search index for', tables.length, 'tables');
    const norm = (s) => this.normalizeText(s);

    return tables.map(table => {
      // Collect path labels and IDs from Level 4+ (path.slice(2))
      const normPathLabels = [];
      const normPathIds = [];

      if (table.paths) {
        table.paths.forEach(path => {
          path.slice(2).forEach(segment => {
            if (segment.label) normPathLabels.push(norm(segment.label));
            if (segment.id) normPathIds.push(segment.id.toLowerCase());
          });
        });
      }

      return {
        table,
        normLabel: norm(table.label),
        normId: (table.id || '').toLowerCase(),
        normVariables: (table.variableNames || []).map(v => norm(v)),
        normPathLabels,
        normPathIds
      };
    });
  },

  /**
   * Expand query tokens with synonyms (bidirectional group lookup).
   * If a token appears in any synonym group, all other terms in that group are added as alternatives.
   * Returns an array of token groups: each group = [original, ...synonymVariants]
   *
   * @param {string[]} tokens - Normalized query tokens
   * @returns {string[][]} tokenGroups
   */
  _expandTokens(tokens) {
    return tokens.map(token => {
      const variants = new Set([token]);
      for (const group of this.SYNONYM_GROUPS) {
        if (group.includes(token)) {
          group.forEach(t => variants.add(t));
        }
      }
      return Array.from(variants);
    });
  },

  /**
   * Score a single index entry against token groups.
   * Returns -1 if any token group has no match (AND logic).
   *
   * Scoring:
   *   Label starts with token: +30
   *   Label contains token:    +20
   *   ID matches token:        +15
   *   Variable contains token: +10
   *   Path label/id contains:  +8
   */
  _scoreEntry(entry, tokenGroups) {
    let totalScore = 0;

    for (const variants of tokenGroups) {
      let tokenScore = -1;

      for (const variant of variants) {
        let s = 0;

        if (entry.normLabel.startsWith(variant)) {
          s = Math.max(s, 30);
        } else if (entry.normLabel.includes(variant)) {
          s = Math.max(s, 20);
        }

        if (entry.normId === variant || entry.normId.includes(variant)) {
          s = Math.max(s, 15);
        }

        if (entry.normVariables.some(v => v.includes(variant))) {
          s = Math.max(s, 10);
        }

        if (
          entry.normPathLabels.some(l => l.includes(variant)) ||
          entry.normPathIds.some(id => id.includes(variant))
        ) {
          s = Math.max(s, 8);
        }

        if (s > 0) {
          tokenScore = Math.max(tokenScore, s);
        }
      }

      if (tokenScore < 0) return -1; // This token group had no match: AND fails
      totalScore += tokenScore;
    }

    return totalScore;
  },

  /**
   * Build a single query string for the SSB API using OR syntax.
   * For single-token queries with synonyms, joins all variants with " OR " so
   * the API returns the union in one request (e.g. "bnp OR bruttonasjonalprodukt OR bruttoprodukt").
   * For multi-token queries, returns the original unchanged.
   *
   * Short synonym variants (< 4 chars) are excluded to avoid broad false positives.
   *
   * @param {string} rawQuery - The user's raw query string
   * @returns {string} Query string, possibly OR-expanded
   */
  getServerQuery(rawQuery) {
    const norm = this.normalizeText(rawQuery);
    const tokens = norm.trim().split(/\s+/).filter(t => t.length > 0);

    if (tokens.length === 1) {
      const token = tokens[0];
      const variants = new Set([rawQuery]);
      for (const group of this.SYNONYM_GROUPS) {
        if (group.includes(token)) {
          group.forEach(variant => {
            if (variant.length >= 4) variants.add(variant);
          });
        }
      }
      if (variants.size > 1) {
        return Array.from(variants).join(' OR ');
      }
    }

    return rawQuery;
  },

  /**
   * Filter and rank a pre-built sub-index by the query in filters.
   * Non-query filters (discontinued, subject, etc.) have already been applied.
   *
   * @param {Array} subIndex - Index entries for the already-filtered table subset
   * @param {Object} filters - BrowserState.searchFilters (must have .query)
   * @returns {Array} Tables sorted by relevance score descending
   */
  filterAndRank(subIndex, filters) {
    const normQuery = this.normalizeText(filters.query || '');
    const tokens = normQuery.trim().split(/\s+/).filter(t => t.length > 0);

    if (tokens.length === 0) {
      return subIndex.map(e => e.table);
    }

    const tokenGroups = this._expandTokens(tokens);
    const scored = [];

    for (const entry of subIndex) {
      const score = this._scoreEntry(entry, tokenGroups);
      if (score >= 0) {
        scored.push({ table: entry.table, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map(r => r.table);
  }
};

window.SearchEnhanced = SearchEnhanced;
