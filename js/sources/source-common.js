/**
 * Shared helpers for source adapters (Norges Bank, FHI) — Statistikkportalen 2.0
 * ===============================================================================
 *
 * Loads BEFORE norges-bank-adapter.js/fhi-adapter.js (after sdmx-to-jsonstat.js
 * in index.html), pushes onto window.SourceCommon. Extracted because both
 * adapters implemented byte-identical label-lookup and fetch-timeout logic
 * independently — see CLAUDE.md's adapter contract note in source-registry.js.
 */
(function () {
  'use strict';

  /** config-labels use {nb,en}. 'no' -> 'nb', everything else passed through. */
  function uiLabelLang(lang) {
    const l = String(lang || 'nb').toLowerCase();
    return l === 'no' ? 'nb' : l;
  }

  /** Look up a {nb,en} label for the current language, falling back to nb then en. */
  function pickLabel(labelObj, lang) {
    if (!labelObj) return '';
    const l = uiLabelLang(lang);
    return labelObj[l] || labelObj.nb || labelObj.en || '';
  }

  /**
   * fetch() wrapped in an AbortSignal.timeout so a hanging source API can't
   * block app initialization (the catalogue aggregation in source-registry.js
   * waits for every source). Rethrows a friendlier Error on timeout/abort;
   * other errors (real network failures) propagate unchanged.
   *
   * @param {string} url
   * @param {object} [fetchOptions] - passed through to fetch() (headers etc.)
   * @param {object} opts
   * @param {number} opts.timeoutMs
   * @param {string} opts.timeoutErrorPrefix - e.g. '[NBAdapter] Tidsavbrudd'
   * @returns {Promise<Response>}
   */
  async function fetchWithTimeout(url, fetchOptions, opts) {
    const o = opts || {};
    const timeoutMs = o.timeoutMs || 15000;
    const fetchOpts = Object.assign({}, fetchOptions, { signal: AbortSignal.timeout(timeoutMs) });
    try {
      return await fetch(url, fetchOpts);
    } catch (e) {
      // AbortSignal.timeout gir DOMException 'TimeoutError' (noen miljøer 'AbortError').
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        const prefix = o.timeoutErrorPrefix || 'Tidsavbrudd';
        throw new Error(prefix + ' etter ' + timeoutMs + ' ms: ' + url);
      }
      throw e; // Ekte nettverksfeil.
    }
  }

  window.SourceCommon = { pickLabel, uiLabelLang, fetchWithTimeout };
})();
