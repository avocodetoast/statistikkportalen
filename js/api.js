/**
 * SSBApi - Wrapper for Statistics Norway PxWebApi v2
 *
 * Handles all communication with the SSB API including caching.
 * Base URL: https://data.ssb.no/api/pxwebapi/v2/
 *
 * Rate limit: 30 queries/minute. A minimal throttle ensures requests
 * are spaced at least 100ms apart to avoid hammering the server.
 */
class SSBApi {
  constructor() {
    this.baseUrl = AppConfig.apiBaseUrl;
    this.cache = new CacheManager();
    this.defaultLang = AppConfig.defaultLanguage;
    this._lastRequestTime = 0;
  }

  /**
   * Throttled fetch — ensures minimum 100ms between requests to respect
   * SSB's 30 req/min rate limit and avoid accidental bursts.
   */
  async _throttledFetch(url, options = {}) {
    const now = Date.now();
    const timeSinceLastRequest = now - this._lastRequestTime;
    if (timeSinceLastRequest < 100) {
      await new Promise(r => setTimeout(r, 100 - timeSinceLastRequest));
    }
    this._lastRequestTime = Date.now();
    return fetch(url, options);
  }

  /**
   * Get list of tables with optional search/filtering.
   * Results are cached for 24 hours (tableListTTL).
   *
   * @param {object} options - Search options
   * @param {string} options.query - Search query (searches titles, variables, values)
   * @param {boolean} options.includeDiscontinued - Include discontinued tables (default: true)
   * @param {string} options.lang - Language code (default: 'no')
   * @param {number} options.pageSize - Page size (default: 10000)
   * @param {boolean} options.useCache - Whether to use cached data (default: true)
   * @returns {Promise<object>} - Table list response
   */
  async getTables(options = {}) {
    const {
      query = '',
      includeDiscontinued = true,
      lang = 'no',
      pageSize = 10000,
      useCache = true
    } = options;

    // Build cache key from all parameters that affect the result
    const cacheKey = 'tables_' + lang + '_' + includeDiscontinued + '_' + pageSize +
                     (query ? '_q_' + query : '');

    if (useCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.log('[API] Using cached table list (' + (cached.tables ? cached.tables.length : 0) + ' tables)');
        return cached;
      }
    }

    try {
      // Build URL with parameters
      const params = new URLSearchParams({
        lang: lang,
        pageSize: pageSize.toString(),
        includeDiscontinued: includeDiscontinued.toString()
      });

      // Add query if provided
      if (query && query.trim()) {
        params.append('query', query.trim());
      }

      const url = this.baseUrl + '/tables?' + params.toString();
      logger.log('[API] Fetching tables:', url);

      const response = await this._throttledFetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': lang
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('For mange forespørsler. Vennligst vent litt og prøv igjen.');
        }
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      const data = await response.json();
      logger.log('[API] Fetched ' + (data.tables ? data.tables.length : 0) + ' tables');

      // Cache the result
      await this.cache.set(cacheKey, data, AppConfig.cache.tableListTTL);

      return data;
    } catch (error) {
      logger.error('[API] Failed to fetch tables:', error);
      throw error;
    }
  }

  /**
   * Get metadata for a specific table
   * @param {string} tableId - Table ID (e.g., "13760")
   * @param {boolean} useCache - Whether to use cached data
   * @param {string} lang - Language code (no/en)
   * @returns {Promise<object>} - Table metadata (JSON-Stat2 format)
   */
  async getTableMetadata(tableId, useCache = true, lang = this.defaultLang) {
    const cacheKey = 'table_' + tableId + '_' + lang;

    if (useCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    try {
      const url = this.baseUrl + '/tables/' + tableId + '/metadata?lang=' + lang;
      logger.log('[API] Fetching metadata for table ' + tableId + ':', url);

      const response = await this._throttledFetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': lang
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('For mange forespørsler. Vennligst vent litt og prøv igjen.');
        }
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      const data = await response.json();
      logger.log('[API] Fetched metadata for table ' + tableId);

      // Cache for 7 days
      await this.cache.set(cacheKey, data, AppConfig.cache.metadataTTL);

      return data;
    } catch (error) {
      logger.error('[API] Failed to fetch metadata for table ' + tableId + ':', error);
      throw error;
    }
  }

  /**
   * Build POST request body from a valueCodes object.
   * Converts { Kjonn: ["0","1"], Tid: "top(3)" } to the POST JSON format:
   * { selection: [{ variableCode: "Kjonn", valueCodes: ["0","1"] }, ...] }
   *
   * @param {object} valueCodes - Dimension filters
   * @returns {object} - POST body object
   */
  buildPostBody(valueCodes, options = {}) {
    const codelistIds = options.codelistIds || {};

    const selection = Object.keys(valueCodes).map(dimension => {
      const values = valueCodes[dimension];
      const valueCodesArray = Array.isArray(values) ? values : [values];
      const entry = { variableCode: dimension, valueCodes: valueCodesArray };
      // Include codelist ID when a codelist is active for this dimension
      if (codelistIds[dimension]) {
        entry.codelist = codelistIds[dimension];
      }
      return entry;
    });
    const body = { selection };

    // Add placement (stub/heading) if provided
    if (options.stub || options.heading) {
      body.placement = {};
      if (options.heading && options.heading.length > 0) body.placement.heading = options.heading;
      if (options.stub && options.stub.length > 0) body.placement.stub = options.stub;
    }

    return body;
  }

  /**
   * Get data for a specific table with dimension filters.
   * Uses POST to avoid URL length limits with large selections.
   *
   * Dimensions omitted from valueCodes are "eliminated" by the API —
   * the server aggregates across all values for that dimension.
   * Only dimensions with extension.elimination=true can be omitted.
   *
   * @param {string} tableId - Table ID (e.g., "13760")
   * @param {object} valueCodes - Dimension filters, e.g., { Kjonn: "0", Tid: "top(3)" }
   *   Supports: array of codes, "*" (all), "top(N)" (last N values)
   * @param {string} lang - Language code (no/en)
   * @param {object} codelistIds - Active codelist IDs per dimension (optional)
   * @returns {Promise<object>} - Table data (JSON-Stat2 format)
   */
  async getTableData(tableId, valueCodes, lang = this.defaultLang, codelistIds = {}) {
    try {
      const url = this.baseUrl + '/tables/' + tableId + '/data?lang=' + lang;
      const body = this.buildPostBody(valueCodes, { codelistIds });

      logger.log('[API] Fetching data (POST) for table ' + tableId);
      logger.log('[API] POST body:', body);

      const response = await this._throttledFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Language': lang
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('For mange forespørsler. Vennligst vent litt og prøv igjen.');
        }
        const errorText = await response.text();
        logger.error('[API] Error response:', errorText);
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      const data = await response.json();
      logger.log('[API] Fetched data for table ' + tableId);
      logger.log('[API] Data dimensions:', data.id);
      logger.log('[API] Data size:', data.size);
      logger.log('[API] Value count:', data.value ? data.value.length : 0);

      return data;
    } catch (error) {
      logger.error('[API] Failed to fetch data for table ' + tableId + ':', error);
      throw error;
    }
  }

  /**
   * Fetch a codelist (valueset) from the API.
   *
   * Codelists define alternative groupings for a dimension's values.
   * For example, "Investeringsart" may have an aggregated and detailed codelist,
   * each containing a different subset of the dimension's value codes.
   *
   * Response format:
   *   { id, label, elimination, eliminationValueCode, type: "Valueset",
   *     values: [{ code, label, valueMap }, ...] }
   *
   * @param {string} codelistId - Codelist ID (e.g., "vs_NRInvArtAgg3")
   * @param {boolean} useCache - Whether to use cached data (default: true)
   * @param {string} lang - Language code (default: 'no')
   * @returns {Promise<object>} - Codelist data
   */
  async getCodeList(codelistId, useCache = true, lang = this.defaultLang) {
    const cacheKey = 'codelist_' + codelistId + '_' + lang;

    if (useCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    try {
      const url = this.baseUrl + '/codeLists/' + codelistId + '?lang=' + lang;
      logger.log('[API] Fetching codelist ' + codelistId + ':', url);

      const response = await this._throttledFetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': lang
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('For mange forespørsler. Vennligst vent litt og prøv igjen.');
        }
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      const data = await response.json();
      logger.log('[API] Fetched codelist ' + codelistId + ': ' + (data.values ? data.values.length : 0) + ' values');

      // Cache for 7 days (same TTL as metadata)
      await this.cache.set(cacheKey, data, AppConfig.cache.codelistTTL);

      return data;
    } catch (error) {
      logger.error('[API] Failed to fetch codelist ' + codelistId + ':', error);
      throw error;
    }
  }

  /**
   * Trigger download of table data in specified format.
   * Downloads the file as a blob and saves it with a custom filename.
   *
   * @param {string} tableId - Table ID
   * @param {object} valueCodes - Dimension filters
   * @param {object} options - Export options
   * @param {string} options.format - Output format: 'csv', 'xlsx', 'px', 'html', 'parquet'
   * @param {string[]} options.stub - Dimensions to place in stub (rows)
   * @param {string[]} options.heading - Dimensions to place in heading (columns)
   * @param {string[]} options.formatParams - Output format parameters (e.g., 'IncludeTitle', 'UseTexts')
   * @param {string} options.lang - Language code (default: 'no')
   * @returns {Promise<void>}
   */
  async downloadTableData(tableId, valueCodes, options) {
    const format = options.format || 'csv';
    const lang = options.lang || this.defaultLang;

    const postParams = new URLSearchParams({ lang: lang });
    postParams.append('outputFormat', format);
    if (options.formatParams && options.formatParams.length > 0) {
      postParams.append('outputFormatParams', options.formatParams.join(','));
    }
    const postUrl = this.baseUrl + '/tables/' + tableId + '/data?' + postParams.toString();
    const body = this.buildPostBody(valueCodes, {
      stub: options.stub,
      heading: options.heading,
      codelistIds: options.codelistIds || {}
    });

    logger.log('[API] Downloading via POST:', postUrl);

    try {
      const response = await this._throttledFetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': lang
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('For mange forespørsler. Vennligst vent litt og prøv igjen.');
        }
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      const blob = await response.blob();

      // Generate custom filename: tablenum_yyyymmdd-hhmmss.format
      const timestamp = getTimestamp().replace('_', '-');
      const filename = tableId + '_' + timestamp + '.' + format;

      // Create download link and trigger download
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      logger.log('[API] Download complete:', filename);
    } catch (error) {
      logger.error('[API] Download failed:', error);
      throw error;
    }
  }

  /**
   * Save current query to SSB's saved queries service.
   *
   * @param {string} tableId - Table ID
   * @param {object} valueCodes - Dimension filters (same format as getTableData)
   * @param {object} options - { stub, heading, codelistIds, lang }
   * @returns {Promise<object>} - Response with id and savedQuery fields
   */
  async saveSavedQuery(tableId, valueCodes, options = {}) {
    const body = {
      id: '',
      tableId: tableId,
      outputFormat: 'json-stat2',
      outputFormatParams: [],
      selection: this.buildPostBody(valueCodes, {
        stub: options.stub,
        heading: options.heading,
        codelistIds: options.codelistIds || {}
      }),
      language: options.lang || 'no'
    };

    const url = this.baseUrl + '/savedqueries';
    logger.log('[API] Saving query for table', tableId, ':', url);

    const response = await this._throttledFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }

    const data = await response.json();
    logger.log('[API] Saved query created, id:', data.id);
    return data;
  }

  /**
   * Fetch a saved query by ID.
   *
   * @param {string} id - Saved query ID (e.g. "30116027")
   * @returns {Promise<object>} - Saved query object
   */
  async getSavedQuery(id) {
    const url = this.baseUrl + '/savedqueries/' + encodeURIComponent(id);
    logger.log('[API] Fetching saved query', id, ':', url);

    const response = await this._throttledFetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }

    return response.json();
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {object} - Cache stats
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clean up expired cache entries
   * @returns {number} - Number of entries removed
   */
  cleanupCache() {
    return this.cache.cleanup();
  }
}

// Create global API instance
const api = new SSBApi();
