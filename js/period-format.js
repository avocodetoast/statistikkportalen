/**
 * Periodeformatering — Statistikkportalen 2.0
 * ===========================================
 *
 * Normaliserer en periodestreng til formen SSB/PxWeb bruker (2024U17, 2025M10,
 * 2023T1), slik at «Tidsperiode»-kolonnen i tabelloversiktene ser lik ut på
 * tvers av kildene. FHI leverer fem ulike former for uke/måned/tertial
 * («2024 -uke 17», «2024-w40», «2021-01», «Oktober 2025», «2023 1.tertial»);
 * SSB og Norges Bank er allerede på formen (SSB leverer 2006M01, NBs
 * katalogperioder er rene årstall).
 *
 * GJELDER KUN OVERSIKTENE (firstPeriod/lastPeriod). Verdilistene i
 * variabelvelgeren — og dermed også overskriftene i den ferdig hentede
 * datatabellen og CSV-eksporten, som bruker de samme category.label-verdiene —
 * beholder kildens eget format, siden verdikoden brukes i URL og API-kall.
 *
 * `hint` er navnet på tidsvariabelen, og er PÅKREVD for å skille formene som
 * kolliderer: «2025-26» er en SESONG (ngs-917), mens «2021-01» er ÅR-UKE
 * (msis-733). De har identisk form, så verdien alene holder ikke.
 *
 * Ren logikk uten avhengigheter (ingen logger/AppConfig/t()) — fila lastes
 * også av scripts/lib/period-format.mjs (vm) slik at byggescriptet og
 * nettleseren deler ÉN implementasjon.
 */
(function () {
  'use strict';

  const MONTHS = {
    januar: 1, january: 1, jan: 1,
    februar: 2, february: 2, feb: 2,
    mars: 3, march: 3, mar: 3,
    april: 4, apr: 4,
    mai: 5, may: 5,
    juni: 6, june: 6, jun: 6,
    juli: 7, july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    oktober: 10, october: 10, okt: 10, oct: 10,
    november: 11, nov: 11,
    desember: 12, december: 12, des: 12, dec: 12
  };

  const WEEK_HINT = /uke|week/i;
  const MONTH_HINT = /m[åa]ned|month/i;

  /** Allerede normalisert SSB-kode (U/M/K/T/H) — nullpadres og slippes gjennom. */
  const SSB_CODE = /^(\d{4})([UMKTH])(\d{1,2})$/i;
  // «2024 -uke 17», «2024 uke 17», «2024-uke 17», «2024 - uke 7»
  const WEEK_WORD = /^(\d{4})\s*-?\s*uke\s*(\d{1,2})$/i;
  // «2024-w40», «2024w40»
  const WEEK_W = /^(\d{4})-?w(\d{1,2})$/i;
  // «2024.17» (sysvaks verdikode) — trenger uke-hint
  const YEAR_DOT_NUM = /^(\d{4})\.(\d{1,2})$/;
  // «2021-01» (uke) / «2025-07» (måned) / «2025-26» (sesong) — trenger hint
  const YEAR_DASH_NUM = /^(\d{4})-(\d{1,2})$/;
  // «Oktober 2025»
  const MONTH_NAME = /^([a-zæøåA-ZÆØÅ]+)\.?\s+(\d{4})$/;
  // «2023 1.tertial», «2025 3. tertial»
  const TERTIAL = /^(\d{4})\s*(\d)\.?\s*tertial$/i;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Normaliser én periodestreng til SSB-form, eller null når formen ikke er en
   * uke/måned/tertial vi kjenner igjen (enkeltår, sesong, skoleår, flerårige
   * snitt, fritekst). Kalleren skal da beholde originalverdien.
   *
   * @param {string} value - periodestrengen fra kilden («2024 -uke 17»)
   * @param {string} [hint] - navnet på tidsvariabelen («Uke», «Sesong», «Måned»)
   * @returns {string|null} «2024U17» / «2025M10» / «2023T1», ellers null
   */
  function normalizePeriod(value, hint) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;
    const h = String(hint == null ? '' : hint);

    let m = v.match(SSB_CODE);
    if (m) {
      // Uke og måned er tosifret i PxWeb (2024U07, 2024M07); kvartal, tertial
      // og halvår ensifret (2009K1, 2023T1, 2000H1).
      const unit = m[2].toUpperCase();
      return m[1] + unit + (unit === 'U' || unit === 'M' ? pad2(m[3]) : String(Number(m[3])));
    }

    m = v.match(WEEK_WORD) || v.match(WEEK_W);
    if (m) return week(m[1], m[2]);

    m = v.match(TERTIAL);
    if (m) {
      const n = Number(m[2]);
      return n >= 1 && n <= 3 ? m[1] + 'T' + n : null;
    }

    m = v.match(MONTH_NAME);
    if (m) {
      const month = MONTHS[m[1].toLowerCase()];
      return month ? m[2] + 'M' + pad2(month) : null;
    }

    // Formene under er tvetydige og avgjøres av tidsvariabelens navn.
    m = v.match(YEAR_DOT_NUM) || v.match(YEAR_DASH_NUM);
    if (m) {
      if (WEEK_HINT.test(h)) return week(m[1], m[2]);
      if (MONTH_HINT.test(h)) {
        const n = Number(m[2]);
        return n >= 1 && n <= 12 ? m[1] + 'M' + pad2(n) : null;
      }
    }

    return null;
  }

  /** «2024» + «7» → «2024U07», eller null for ukenumre utenfor 1–53. */
  function week(year, num) {
    const n = Number(num);
    return n >= 1 && n <= 53 ? year + 'U' + pad2(n) : null;
  }

  /**
   * Frekvens utledet av NORMALISERTE endepunkter: begge uker → 'Weekly', begge
   * måneder → 'Monthly', ellers null. Kalleren skal aldri la null overstyre en
   * frekvens som allerede er fastslått på annet vis (f.eks. 'Annual').
   *
   * @returns {'Weekly'|'Monthly'|null}
   */
  function classifyTimeUnit(first, last) {
    const f = String(first == null ? '' : first).trim();
    const l = String(last == null ? '' : last).trim();
    if (/^\d{4}U\d{2}$/.test(f) && /^\d{4}U\d{2}$/.test(l)) return 'Weekly';
    if (/^\d{4}M\d{2}$/.test(f) && /^\d{4}M\d{2}$/.test(l)) return 'Monthly';
    return null;
  }

  window.PeriodFormat = {
    normalizePeriod: normalizePeriod,
    classifyTimeUnit: classifyTimeUnit
  };
})();
