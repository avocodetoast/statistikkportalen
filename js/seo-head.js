/**
 * SEOHead - holder <head>-metadata i synk med gjeldende rute.
 *
 * Pre-rendrede SEO-sider (scripts/generate-seo-pages.mjs) har canonical,
 * og:-tagger, meta description og JSON-LD satt statisk i <head>. Så lenge
 * ruten matcher den pre-rendrede siden røres ingenting (Googlebots rendrede
 * snapshot beholder de genererte verdiene). Ved klientside-navigering bort
 * fra den pre-rendrede ruten oppdateres canonical/og:url, beskrivelse og
 * og:title, og den sidespesifikke JSON-LD-en (#seo-jsonld) fjernes så den
 * ikke beskriver feil side. Den globale WebSite-JSON-LD-en (#seo-root-jsonld)
 * er gyldig for hele nettstedet og beholdes alltid.
 *
 * Canonical-mål slås opp i /seo-map.json (skrives av generatoren i webroot):
 * emnestier → pene URL-er, og listen over tabell-id-er som har /table/{id}/-
 * sider. Fila hentes lazy ved første navigering og feiler stille — appen
 * fungerer uendret uten pre-genererte filer (dev, file://, andre instanser).
 */

const SEOHead = {
  // undefined = ikke forsøkt hentet, null = utilgjengelig, objekt = lastet
  _map: undefined,
  _tableSet: null,
  _mapRequested: false,

  // Bootstrap-variablene fra generatoren, fanget én gang ved load
  _prerender: {
    topicPath: Array.isArray(window.__SEO_TOPIC_PATH__) ? window.__SEO_TOPIC_PATH__ : null,
    tableId: window.__SEO_TABLE_ID__ ? String(window.__SEO_TABLE_ID__) : null
  },

  /**
   * Synkroniser head-metadata med gjeldende rute.
   * Kalles fra renderCurrentView() ved hvert visningsbytte.
   */
  sync() {
    const { route } = URLRouter.parseHash();

    // Ruten matcher den pre-rendrede siden — la de genererte verdiene stå
    if (this._routeMatchesPrerender(route)) return;

    this._loadMap();

    // Sidespesifikk generator-JSON-LD beskriver ikke lenger gjeldende side
    const stale = document.getElementById('seo-jsonld');
    if (stale) stale.remove();

    const canonical = this._canonicalFor(route);
    this._set('link[rel="canonical"]', 'href', canonical);
    this._set('meta[property="og:url"]', 'content', canonical);

    const description = this._descriptionFor(route);
    this._set('#meta-description', 'content', description);
    this._set('meta[property="og:description"]', 'content', description);

    this.syncTitle();
  },

  /**
   * Speil document.title inn i og:title.
   * Kalles fra updatePageTitle() etter at visningene har satt tittelen.
   */
  syncTitle() {
    this._set('meta[property="og:title"]', 'content', document.title);
  },

  _routeMatchesPrerender(route) {
    const p = this._prerender;
    if (p.tableId) return route === 'variables/' + p.tableId;
    if (p.topicPath) {
      if (p.topicPath.length === 0) return !route || route === 'home';
      return route === 'topic/' + p.topicPath.join('/');
    }
    return false;
  },

  /** Kanonisk URL for en rute. Hash-ruter uten egen statisk side → forsiden. */
  _canonicalFor(route) {
    const origin = window.location.origin;
    if (route.startsWith('topic/')) {
      const dir = this._map && this._map.topics && this._map.topics[route.slice('topic/'.length)];
      if (dir) return origin + '/' + dir + '/';
    } else if (route.startsWith('variables/') || route.startsWith('table/')) {
      const id = route.split('/')[1];
      if (id && this._tableSet && this._tableSet.has(id)) {
        return origin + '/table/' + id + '/';
      }
    }
    return origin + '/';
  },

  /** Enkel rutespesifikk beskrivelse; faller tilbake på appens tagline. */
  _descriptionFor(route) {
    const tagline = this._tagline();
    if (route.startsWith('topic/')) {
      const label = this._topicLabel(route.slice('topic/'.length).split('/'));
      if (label) return 'Statistikk om ' + label.toLowerCase() + '. ' + tagline;
    } else if (route.startsWith('variables/') || route.startsWith('table/')) {
      const id = route.split('/')[1];
      const table = (BrowserState.isLoaded && BrowserState.allTables.find(t => t.id === id)) || null;
      if (table) {
        const src = this._brandingFor(id);
        return '«' + extractTableTitle(table.label) + '»: statistikktabell ' + id +
          ' fra ' + (src.nameFull || src.name || '') + '.';
      }
    }
    return tagline;
  },

  /** Kildeattribusjon per tabell-id: AppConfig.sources.<kilde>.branding for
   *  nb-/fhi-tabeller (samme prefiksregel som kildefasaden), ellers det
   *  globale AppConfig.source — speiler sourceBrandingFor i
   *  scripts/lib/seo-sources.mjs. */
  _brandingFor(id) {
    return sourceBrandingForTable(id);
  },

  _topicLabel(pathIds) {
    if (!BrowserState.isLoaded || !BrowserState.menuHierarchy) return null;
    try {
      const crumbs = BrowserState.menuHierarchy.getBreadcrumbs(pathIds);
      // Gruppenivå (#topic/okonomi): pathIds[0] er en gruppe-id, ikke emnekode
      if (pathIds.length === 1 && BrowserState.menuHierarchy.subjectGroups[pathIds[0]]) {
        return t('subject.group.' + pathIds[0]);
      }
      return crumbs.length ? crumbs[crumbs.length - 1].label : null;
    } catch (e) {
      return null;
    }
  },

  _tagline() {
    const raw = (AppConfig.app && AppConfig.app.tagline) || '';
    return (typeof raw === 'object') ? (raw[currentLanguage] ?? raw.nb ?? '') : raw;
  },

  _set(selector, attr, value) {
    if (!value) return;
    const el = selector.startsWith('#')
      ? document.getElementById(selector.slice(1))
      : document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  },

  /** Hent /seo-map.json én gang, helt stille — fravær er normalt. */
  _loadMap() {
    if (this._mapRequested) return;
    this._mapRequested = true;
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      this._map = null; // file:// o.l. — ingen fetch
      return;
    }
    fetch('/seo-map.json')
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null)
      .then(map => {
        this._map = map || null;
        if (map) {
          this._tableSet = new Set(map.tables || []);
          this.sync(); // oppdater canonical nå som mappingen finnes
        }
      });
  }
};

// window-eksponering så andre moduler kan sjekke `window.SEOHead` (samme
// mønster som config.js/subjects.js — const lager ikke window-property)
window.SEOHead = SEOHead;
