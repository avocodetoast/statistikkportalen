/**
 * Menu Hierarchy Builder
 * Recreates SSB's subject -> topic -> subtopic -> tables navigation
 */

class MenuHierarchy {
  constructor() {
    // SSB's manual subject groupings (not in API, hardcoded)
    this.subjectGroups = {
      'arbeid': {
        id: 'arbeid',
        label: 'Arbeid, lønn og utdanning',
        subjects: ['al', 'if', 'du']
      },
      'befolkning': {
        id: 'befolkning',
        label: 'Befolkning og bolig',
        subjects: ['be', 'bb', 'in']
      },
      'helse': {
        id: 'helse',
        label: 'Helse og samfunn',
        subjects: ['he', 'kf', 'sk', 'sv', 'va']
      },
      'miljo': {
        id: 'miljo',
        label: 'Miljø og transport',
        subjects: ['nm', 'tr']
      },
      'naring': {
        id: 'naring',
        label: 'Næringsliv og teknologi',
        subjects: ['ei', 'js', 'ti', 'vt', 'vf']
      },
      'okonomi': {
        id: 'okonomi',
        label: 'Økonomi',
        subjects: ['bf', 'nk', 'os', 'pp', 'ut']
      }
    };

    // Subject code to full name mapping
    this.subjectNames = {
      'al': 'Arbeid og lønn',
      'if': 'Inntekt og forbruk',
      'du': 'Utdanning',
      'be': 'Befolkning',
      'bb': 'Bygg, bolig og eiendom',
      'in': 'Innvandring og innvandrere',
      'he': 'Helse',
      'kf': 'Kultur og fritid',
      'sk': 'Sosiale forhold og kriminalitet',
      'sv': 'Svalbard',
      'va': 'Valg',
      'nm': 'Natur og miljø',
      'tr': 'Transport og reiseliv',
      'ei': 'Energi og industri',
      'js': 'Jord, skog, jakt og fiskeri',
      'ti': 'Teknologi og innovasjon',
      'vt': 'Varehandel og tjenesteyting',
      'vf': 'Bedrifter, foretak og regnskap',
      'bf': 'Bank og finansmarked',
      'nk': 'Nasjonalregnskap og konjunkturer',
      'os': 'Offentlig sektor',
      'pp': 'Priser og prisindekser',
      'ut': 'Utenriksøkonomi'
    };

    this.allTables = [];
    this.hierarchy = {};
  }

  /**
   * Build the complete hierarchy from all tables
   */
  buildHierarchy(tables) {
    // Store all tables for search and reference
    this.allTables = tables;
    this.hierarchy = {};

    logger.log(`[MenuHierarchy] Building hierarchy from ${tables.length} tables`);

    tables.forEach(table => {
      // Some tables might not have paths
      if (table.paths && table.paths.length > 0) {
        table.paths.forEach(path => {
          this._addPathToHierarchy(path, table);
        });
      }
    });

    logger.log(`[MenuHierarchy] Built hierarchy with ${Object.keys(this.hierarchy).length} top-level subjects`);

    return this.hierarchy;
  }

  /**
   * Add a single path to the hierarchy tree
   */
  _addPathToHierarchy(path, table) {
    if (path.length === 0) return;

    const subjectCode = path[0].id;

    // Initialize subject if doesn't exist
    if (!this.hierarchy[subjectCode]) {
      this.hierarchy[subjectCode] = {
        id: subjectCode,
        label: path[0].label,
        sortCode: path[0].sortCode,
        children: {},
        tables: []
      };
    }

    // Navigate down the path
    let currentNode = this.hierarchy[subjectCode];

    for (let i = 1; i < path.length; i++) {
      const segment = path[i];

      if (!currentNode.children[segment.id]) {
        currentNode.children[segment.id] = {
          id: segment.id,
          label: segment.label,
          sortCode: segment.sortCode,
          depth: i,
          children: {},
          tables: []
        };
      }

      currentNode = currentNode.children[segment.id];
    }

    // Add table to the leaf node
    currentNode.tables.push(table);
  }

  /**
   * Get all subjects for a subject group
   */
  getSubjectsForGroup(groupId) {
    const group = this.subjectGroups[groupId];
    if (!group) return [];

    return group.subjects.map(subjectCode => {
      const node = this.hierarchy[subjectCode];
      return {
        id: subjectCode,
        label: this.subjectNames[subjectCode] || subjectCode,
        tableCount: this._countTables(node),
        node: node
      };
    }).filter(s => s.node); // Only include subjects that have tables
  }

  /**
   * Get subtopics for a subject code (level 2 nodes)
   */
  getSubtopicsForSubject(subjectCode) {
    const subject = this.hierarchy[subjectCode];
    if (!subject) return [];

    return Object.values(subject.children)
      .map(child => ({
        id: child.id,
        label: child.label,
        sortCode: child.sortCode,
        tableCount: this._countTables(child),
        hasSubcategories: Object.keys(child.children).length > 0
      }))
      .sort((a, b) => a.sortCode.localeCompare(b.sortCode));
  }

  /**
   * Get categories for a subtopic (level 3+ nodes)
   */
  getCategoriesForSubtopic(subjectCode, subtopicId) {
    const subject = this.hierarchy[subjectCode];
    if (!subject) return [];

    const subtopic = subject.children[subtopicId];
    if (!subtopic) return [];

    return Object.values(subtopic.children)
      .map(child => ({
        id: child.id,
        label: child.label,
        sortCode: child.sortCode,
        tableCount: this._countTables(child),
        hasChildren: Object.keys(child.children).length > 0
      }))
      .sort((a, b) => a.sortCode.localeCompare(b.sortCode));
  }

  /**
   * Get the hierarchy node at a specific path without flattening.
   * Returns the node itself (with children and tables).
   * @param {string[]} pathIds - Path IDs to navigate
   * @returns {object|null} - Hierarchy node
   */
  getNodeForPath(pathIds) {
    if (!pathIds || pathIds.length === 0) return null;

    let node = this.hierarchy[pathIds[0]];
    if (!node) return null;

    for (let i = 1; i < pathIds.length; i++) {
      node = node.children[pathIds[i]];
      if (!node) return null;
    }

    return node;
  }

  /**
   * Get tables for a specific category path (flat list, deduplicated)
   */
  getTablesForPath(pathIds) {
    const node = this.getNodeForPath(pathIds);
    return this._collectAllTables(node);
  }

  /**
   * Collect all tables from a node and its children
   * @param {object} node - Hierarchy node
   * @param {boolean} includeDiscontinued - Whether to include discontinued tables
   */
  _collectAllTables(node, includeDiscontinued = true) {
    if (!node) return [];

    let tables = [...node.tables];

    Object.values(node.children).forEach(child => {
      tables.push(...this._collectAllTables(child, includeDiscontinued));
    });

    // Remove duplicates (tables can appear in multiple paths)
    const uniqueTables = new Map();
    tables.forEach(t => uniqueTables.set(t.id, t));

    let result = Array.from(uniqueTables.values());

    if (!includeDiscontinued) {
      result = result.filter(t => !t.discontinued);
    }

    return result.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  /**
   * Count total tables in a node and its children
   * @param {object} node - Hierarchy node
   * @param {boolean} includeDiscontinued - Whether to include discontinued tables
   */
  _countTables(node, includeDiscontinued = true) {
    if (!node) return 0;
    return this._collectAllTables(node, includeDiscontinued).length;
  }

  /**
   * Group tables by a custom criteria (for Level 4+ display)
   * Example: "Månedstall (basisår 2025)", "Årsstall (basisår 2015)"
   */
  groupTables(tables) {
    const groups = {};

    tables.forEach(table => {
      // Extract grouping info from label
      // Example: "14700: Konsumprisindeks, etter vare- og tjenestegruppe (2025=100)"
      const baseYearMatch = table.label.match(/\((\d{4})=100\)/);
      const baseYear = baseYearMatch ? baseYearMatch[1] : null;

      let groupKey;
      if (baseYear) {
        if (table.timeUnit === 'Monthly') {
          groupKey = `Månedstall (basisår ${baseYear})`;
        } else if (table.timeUnit === 'Quarterly') {
          groupKey = `Kvartalstall (basisår ${baseYear})`;
        } else if (table.timeUnit === 'Annual') {
          groupKey = `Årsstall (basisår ${baseYear})`;
        } else {
          groupKey = `Andre tall (basisår ${baseYear})`;
        }
      } else {
        // No base year, group by time unit
        if (table.timeUnit === 'Monthly') {
          groupKey = 'Månedstall';
        } else if (table.timeUnit === 'Quarterly') {
          groupKey = 'Kvartalstall';
        } else if (table.timeUnit === 'Annual') {
          groupKey = 'Årsstall';
        } else {
          groupKey = 'Andre tabeller';
        }
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(table);
    });

    // Sort groups by name (reverse to get newest base years first)
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([name, tables]) => ({
        name,
        tables: tables.sort((a, b) => a.sortCode.localeCompare(b.sortCode))
      }));
  }

  /**
   * Get breadcrumb path for current navigation
   */
  getBreadcrumbs(pathIds) {
    const breadcrumbs = [];

    if (pathIds.length === 0) return breadcrumbs;

    // Find subject group
    const subjectCode = pathIds[0];
    for (const [groupId, group] of Object.entries(this.subjectGroups)) {
      if (group.subjects.includes(subjectCode)) {
        breadcrumbs.push({
          label: group.label,
          path: [groupId]
        });
        break;
      }
    }

    // Add subject
    breadcrumbs.push({
      label: this.subjectNames[subjectCode] || subjectCode,
      path: [subjectCode]
    });

    // Navigate path to build remaining breadcrumbs
    let node = this.hierarchy[subjectCode];
    for (let i = 1; i < pathIds.length; i++) {
      node = node.children[pathIds[i]];
      if (node) {
        breadcrumbs.push({
          label: node.label,
          path: pathIds.slice(0, i + 1)
        });
      }
    }

    return breadcrumbs;
  }
}

// Global instance
window.MenuHierarchy = MenuHierarchy;
