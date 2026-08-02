/**
 * Index Refresh — holder klientens katalogindeks i takt med serverens.
 *
 * Indeksen (data/index/) bygges av cron flere ganger i døgnet, mens klienten
 * cacher manifest + shards i 24 timer og bare revalideres på SSBs to faste
 * klokkeslett (js/cache.js). En fane som står åpen over natta kan derfor bla i
 * en foreldet katalog. Denne modulen eier UTLØSEREN som fikser det; selve
 * oppdagelsen og anvendelsen er allerede skrevet:
 *
 *   CatalogIndex.checkForUpdate() → henter manifestet på nytt (~600 B) og
 *     returnerer hvilke kilder som faktisk byttet innholdshashet shard-filnavn
 *   BrowserState.applyIndex()     → merger inn kun de endrede kildene
 *   api.seedSourceStatus()        → oppdaterer ferskhets-badgen
 *
 * DESIGNVALG — sjekken skal være USYNLIG. Dataene byttes i BrowserState med én
 * gang, men autostien re-rendrer ALDRI: å bygge om listen under brukerens
 * markør ville kostet scrollposisjon og fokus for en gevinst brukeren ikke ba
 * om. Neste navigering rendrer uansett fra BrowserState.allTables og viser da
 * de ferske dataene. Kun den manuelle knappen («Se etter ny indeks» i
 * statuspanelet) ber om re-rendring, via render: true — der ER oppdateringen
 * hele poenget med klikket.
 *
 * Utløsere: fanen blir synlig igjen, og navigering i appen (router.handleRoute).
 * Bevisst INGEN setInterval — de to dekker realistisk bruk uten en timer som må
 * ryddes opp, og begge deler ett minsteintervall (AppConfig.catalogIndex
 * .autoCheckMs), så antall nettverkskall er uavhengig av hvor mye brukeren
 * klikker.
 *
 * Laster etter browser-state.js (trenger BrowserState + fasaden) og før
 * source-status.js (som deler apply-stien herfra og låner BROWSE_VIEWS).
 */
(function () {
  'use strict';

  const logger = window.logger || console;

  /**
   * Visningene som faktisk viser katalogen. Står brukeren i variables/table er
   * katalogen ikke på skjermen, og en applyIndex() som bygger emnetreet på nytt
   * midt i en asynkron tabellrute har ingenting å tilby. Eksportert fordi
   * source-status.js trenger nøyaktig samme liste.
   */
  const BROWSE_VIEWS = ['home', 'search', 'topic'];

  const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

  let _lastCheckAt = 0;
  let _running = null; // Promise mens en sjekk pågår (dedupe), ellers null

  function settings() {
    const cfg = (window.AppConfig && window.AppConfig.catalogIndex) || {};
    return {
      enabled: cfg.enabled === true && cfg.autoCheck !== false,
      // Number.isFinite, ikke `||`: et bevisst autoCheckMs: 0 betyr «ingen
      // struping» (nyttig ved feilsøking), mens `||` stille hadde gitt
      // standardintervallet i stedet.
      intervalMs: Number.isFinite(cfg.autoCheckMs) ? cfg.autoCheckMs : DEFAULT_INTERVAL_MS
    };
  }

  /**
   * Hele policyen for om en bakgrunnssjekk skal kjøres nå — ren med vilje, så
   * den kan verifiseres uten DOM, timere eller nettverk (se
   * tests/unit/index-refresh-throttle.test.js).
   *
   * `online: undefined` regnes som online: navigator.onLine er et hint, ikke en
   * garanti, og en nettleser som ikke svarer skal ikke fryse oppdateringene.
   * Feiler nettet likevel, degraderer checkForUpdate() stille.
   *
   * @param {object} s
   * @param {number} s.now - Date.now() fra kalleren (ikke lest internt).
   * @param {number} s.lastCheckAt - tidspunkt for forrige FORSØK (0 = aldri).
   * @param {boolean} s.running - sjekk allerede i gang.
   * @param {boolean} s.visible - fanen er synlig.
   * @param {boolean} [s.online] - navigator.onLine, eller undefined.
   * @param {boolean} s.browsing - gjeldende visning er en bla-visning.
   * @param {number} [s.intervalMs] - minsteintervall. Mangler den, brukes
   *   30 min; et bevisst 0 slår av strupingen.
   * @returns {boolean}
   */
  function shouldCheck(s) {
    if (!s || s.running) return false;
    if (s.visible === false) return false;
    if (s.online === false) return false;
    if (!s.browsing) return false;
    const interval = Number.isFinite(s.intervalMs) ? s.intervalMs : DEFAULT_INTERVAL_MS;
    return (s.now - (s.lastCheckAt || 0)) >= interval;
  }

  /**
   * Kjør sjekken NÅ og ta resultatet i bruk. Ubetinget — strupingen ligger i
   * maybeRun(). Kaster aldri: en bakgrunnsoppgave som velter, skal ikke kunne
   * ta med seg en rute eller en knapp i fallet.
   *
   * @param {object} [options]
   * @param {boolean} [options.render] - re-rendre bla-visningen etterpå
   *   (kun den manuelle knappen; autostien er stum, se filheaderen).
   * @returns {Promise<{available:boolean, changed:string[], tableCount:number}>}
   */
  function run(options) {
    if (_running) return _running;
    const render = !!(options && options.render);
    _lastCheckAt = Date.now();
    _running = doRun(render).finally(() => { _running = null; });
    return _running;
  }

  async function doRun(render) {
    const empty = { available: false, changed: [], tableCount: 0 };
    if (!window.CatalogIndex || typeof CatalogIndex.checkForUpdate !== 'function') return empty;

    let result;
    try {
      result = await CatalogIndex.checkForUpdate({ lang: getCurrentApiLang() });
    } catch (e) {
      // checkForUpdate degraderer selv, men en uventet feil (f.eks. i cachen)
      // skal heller ikke boble ut hit.
      logger.warn('[IndexRefresh] Sjekk etter ny indeks feilet:', e);
      return empty;
    }

    if (!result || !result.available) return empty;

    const changed = result.changed || [];
    if (changed.length) BrowserState.applyIndex(result);

    // Også når ingenting endret seg: stale-flaggene i meta er nettopp regnet
    // om mot Date.now(), så badgen skal oppdateres uansett.
    api.seedSourceStatus(result.meta);

    const tableCount = changed.reduce(
      (sum, id) => sum + (((result.bySource || {})[id] || []).length), 0);

    if (changed.length) {
      logger.log('[IndexRefresh] Ny indeks tatt i bruk — kilder: ' + changed.join(', ') +
                 ' (' + tableCount + ' tabeller)');
      if (render && BROWSE_VIEWS.includes(AppState.currentView)) renderCurrentView();
    }

    return { available: true, changed: changed, tableCount: tableCount };
  }

  /**
   * Utløserstien: sjekk policyen, og planlegg i så fall en kjøring når
   * nettleseren er ledig — en navigering skal aldri vente på oss.
   * Fire-and-forget; returnerer om den ble planlagt (til testing/logging).
   *
   * @param {string} reason - hva som utløste forsøket (kun logging).
   * @returns {boolean}
   */
  function maybeRun(reason) {
    const cfg = settings();
    if (!cfg.enabled) return false;
    if (window.location && window.location.protocol === 'file:') return false;

    const nav = window.navigator;
    if (!shouldCheck({
      now: Date.now(),
      lastCheckAt: _lastCheckAt,
      running: !!_running,
      visible: !(window.document && window.document.hidden),
      online: nav ? nav.onLine : undefined,
      browsing: !!(window.AppState && BROWSE_VIEWS.includes(AppState.currentView)),
      intervalMs: cfg.intervalMs
    })) return false;

    logger.log('[IndexRefresh] Bakgrunnssjekk planlagt (' + reason + ')');
    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
      idle(() => run(), { timeout: 5000 });
    } else {
      setTimeout(() => run(), 0);
    }
    return true;
  }

  /**
   * Registrer synlighetsutløseren. Navigeringsutløseren hektes på i
   * router.handleRoute().
   *
   * _lastCheckAt seedes med oppstartstidspunktet med vilje: sidelasting har
   * nettopp hentet manifestet via CatalogIndex.load(), og uten seeding ville
   * den første handleRoute() gitt en ekstra, overflødig manifest-henting ved
   * HVER sidelasting.
   */
  function init() {
    _lastCheckAt = Date.now();
    const doc = window.document;
    if (!doc || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('visibilitychange', () => {
      if (!doc.hidden) maybeRun('visibilitychange');
    });
  }

  window.IndexRefresh = {
    init: init,
    run: run,
    maybeRun: maybeRun,
    shouldCheck: shouldCheck,
    BROWSE_VIEWS: BROWSE_VIEWS
  };
})();
