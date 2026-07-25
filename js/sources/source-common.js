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

  // ---- HTML → rene tekstlinjer ----

  // Intern markør for linjeskift under HTML→tekst-konverteringen (se
  // htmlToPlainLines). Et tegn som aldri finnes i ekte innhold.
  const BREAK = '\u0001';

  const NAMED_ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…'
  };

  /** Dekod de entitetene FHI faktisk bruker + alle numeriske (des/hex). */
  function decodeEntities(text) {
    return text
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&([a-z]+);/gi, (m, name) => {
        const key = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
      });
  }

  /**
   * HTML-fragment → array med rene tekstlinjer.
   *
   * Brukes på FHIs /Table/{id}/metadata-avsnitt (paragraphs[].content), som er
   * HTML med <p>/<strong>/<ul><li> og av og til <a>. Visningslaget
   * (js/table-metadata.js) escaper alt før rendring, så HTML kan ikke sendes
   * videre som den er — og vi vil ikke innføre en HTML-sanitizer for én kilde.
   * Lenker konverteres derfor til markdown, som den eksisterende
   * convertMarkdownLinks() i table-metadata.js gjør om til ekte <a> igjen.
   *
   * MERK: scripts/update-fhi-catalog.mjs har sin egen, enklere htmlToText()
   * (flater alt til ÉN linje — den skal bare utlede en tittel/beskrivelse).
   * Bevisst duplisering: byggescriptet kan ikke laste nettleser-globaler.
   * Hold reglene her og der i sync ved endring.
   *
   * @param {string} html
   * @returns {string[]} én streng per linje/avsnitt, tomme linjer fjernet
   */
  function htmlToPlainLines(html) {
    if (!html) return [];

    let s = String(html);

    // 1. Lenker → markdown. Må skje FØR tag-strippingen under. Indre markup i
    //    lenketeksten strippes (FHI bruker av og til <strong> inni <a>).
    s = s.replace(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
      (_, __, dq, sq, inner) => {
        const url = (dq !== undefined ? dq : sq) || '';
        const textOnly = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (!url) return textOnly;
        return '[' + (textOnly || url) + '](' + url + ')';
      });

    // 2. Linjeskift markeres med en SENTINEL, ikke '\n': rå linjeskift i
    //    kildemarkupen er bare whitespace i HTML og skal ikke gi egne linjer.
    //    Listepunkter får kulepunkt-prefiks (bruddet kommer fra </li>).
    s = s.replace(/<li\b[^>]*>/gi, BREAK + '• ');
    s = s.replace(/<br\b[^>]*\/?>/gi, BREAK);
    s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, BREAK);

    // 3. Resterende tagger fjernes (<strong>/<em>/<span> beholder teksten sin,
    //    som dermed blir inline der den var inline og egen linje der den sto
    //    alene i et <p>).
    s = s.replace(/<[^>]*>/g, '');

    // 4. Entiteter dekodes ETTER strippingen — ellers ville en &lt;-dekodet «<»
    //    fått tag-regexen over til å spise opp resten av teksten.
    s = decodeEntities(s);

    return s
      .split(BREAK)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0 && line !== '•');
  }

  // ---- Opprydding av kilde-leverte tabelltitler ----

  // «[Oppdatert 16.02.2026]» på slutten. FHI har selv en skrivefeil der
  // klammen lukkes med krøllparentes, så begge godtas.
  const UPDATED_TAIL = /[[{]\s*oppdatert[^\]}]*[\]}]\s*$/i;
  // «. 2004-2025.» / «. 2004 – 2025» som EGEN setning til slutt. Kravet om et
  // punktum foran er bevisst: det skiller lmr-halen fra årstall som er en del
  // av selve navnet («Grossistbasert legemiddelstatistikk 1999-2025»).
  const PERIOD_TAIL = /\.\s*\d{4}\s*[–—-]\s*\d{4}\s*\.?\s*$/;

  /**
   * Fjern periode- og oppdateringshale fra en RÅ tabelltittel fra kilden.
   *
   * Legemiddelregisteret (lmr) navngir tabellene sine
   * «Legemiddelgruppe – ADHD-midler. 2004-2025. [Oppdatert 16.02.2026]» —
   * begge deler har egne kolonner i tabellistene. Verifisert mot live-API-et:
   * 7 av 7 lmr-tabeller, 0 av de 363 øvrige FHI-tabellene.
   *
   * Brukes kun på FALLBACK-titler (rå /table-titler når den kuraterte
   * katalogen ikke er tilgjengelig) — kuraterte titler er allerede rene.
   * Etterlater aldri en tom streng: blir alt strippet, beholdes originalen.
   *
   * @param {string} title
   * @returns {string}
   */
  function stripTitleMetadataTail(title) {
    const original = String(title == null ? '' : title).trim();
    if (!original) return '';

    let out = original.replace(UPDATED_TAIL, '').trim();
    out = out.replace(PERIOD_TAIL, '').trim();
    out = out.replace(/[.\s]+$/, '').trim();

    return out || original;
  }

  window.SourceCommon = {
    pickLabel, uiLabelLang, fetchWithTimeout, htmlToPlainLines, stripTitleMetadataTail
  };
})();
