/**
 * fhi-adapter.js — katalogen bygges fra den innsjekkede katalogfila, UTEN
 * nettverk ved oppstart.
 *
 * Adapteren hentet tidligere /Common/source + /{kilde}/table ved hver app-init
 * (14 kall, blokkerende for BrowserState.init()). Alt de leverte —
 * tabellmedlemskap, titler, perioder, kategorier, kildeinfo — ligger allerede i
 * data/sources/fhi-catalog.js (window.FhiCatalog), som index.html laster som
 * <script>. Live-lista er fortsatt fallback for kilder katalogfila ikke dekker,
 * og hentes på nytt når brukeren ber om det (useCache: false).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// Adapteren låser AppConfig.sources.fhi.sourceIds i en kopi ved lastetidspunkt,
// så testen kan ikke krympe kildelista etterpå. CATALOG-objektet sendes derimot
// inn som global FØR lastingen og fylles etter — getCatalog() leser det først
// ved første kall. Kildene fylles derfor ut fra den faktiske config-lista under.
const CATALOG = { generatedAt: '2026-07-25T09:13:46.315Z', sources: {} };

// Én kilde holdes UTENFOR katalogfila: representerer en sourceId aktivert i
// config før katalogen ble regenerert (skal falle tilbake til live-lista).
const UNCOVERED = 'skast';

const MFR_TABLES = [
  { tableId: 411, title: 'Fødte og fødsler', category: 'fodsler',
    firstPeriod: '1967', lastPeriod: '2025', timeUnit: 'Annual',
    variableNames: ['Geografi', 'År'], description: 'Fødte per år.',
    updated: '2026-01-15T08:00:00Z' },
  { tableId: 448, title: 'Fødsler ved institusjon',
    firstPeriod: '1999', lastPeriod: '2025', timeUnit: null,
    variableNames: [], description: '', updated: '' }
];

// Live-lista brukes bare for udekkede kilder og ved tvungen oppfriskning.
const TABLE_ROWS = {
  mfr: [
    { tableId: 411, title: 'F0: Fødte og fødsler', modifiedAt: '2026-02-01' },
    { tableId: 448, title: 'Is3d: Fødsler ved institusjon', modifiedAt: '' },
    // Ny tabell som ikke finnes i katalogfila ennå.
    { tableId: 999, title: 'Ny tabell', modifiedAt: '2026-07-20' }
  ],
  [UNCOVERED]: [
    { tableId: 1, title: 'Tabell fra udekket kilde', modifiedAt: '2026-07-01' }
  ]
};

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const requested = [];
const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    requested.push(u);
    if (u.endsWith('/Common/source')) {
      return jsonResponse([
        { id: 'mfr', title: 'MFR fra API-et', aboutUrl: 'https://api/mfr', publishedBy: 'API' }
      ]);
    }
    const m = /\/([^/]+)\/table$/.exec(u);
    if (m) return jsonResponse(TABLE_ROWS[m[1]] || []);
    throw new Error('uventet URL i test: ' + u);
  },
  globals: { FhiCatalog: CATALOG }
});

const SOURCE_IDS = app.AppConfig.sources.fhi.sourceIds.slice();
assert.ok(SOURCE_IDS.includes('mfr') && SOURCE_IDS.includes(UNCOVERED),
  'testen forutsetter at både mfr og ' + UNCOVERED + ' er aktiverte kilder');

for (const id of SOURCE_IDS) {
  if (id === UNCOVERED) continue;
  CATALOG.sources[id] = id === 'mfr'
    ? {
        title: 'Medisinsk fødselsregister (MFR)',
        aboutUrl: 'https://www.fhi.no/op/mfr',
        publishedBy: 'Folkehelseinstituttet',
        categories: { fodsler: { label: 'Fødsler og fødte', sortCode: '010' } },
        tables: MFR_TABLES
      }
    : {
        title: 'Kilde ' + id,
        aboutUrl: 'https://example.test/' + id,
        publishedBy: 'Folkehelseinstituttet',
        tables: [{
          tableId: 1, title: 'Tabell i ' + id, firstPeriod: '2020', lastPeriod: '2025',
          timeUnit: 'Annual', variableNames: [], description: '', updated: ''
        }]
      };
}

delete app.AppConfig.sources.fhi.paths;

const adapter = app.SourceAdapters.find(a => a.sourceId === 'fhi');
const mfrCalls = () => requested.filter(u => u.endsWith('/mfr/table'));

describe('FHIAdapter.getTables — nettverksfri oppstart', () => {
  it('bygger dekkede kilder uten et eneste nettverkskall', async () => {
    requested.length = 0;
    const { tables } = await adapter.getTables({});
    // Kun den udekkede kilden koster nettverk — ingen /Common/source, og
    // ingen /{kilde}/table for kildene katalogfila dekker.
    assert.deepEqual(requested, [
      app.AppConfig.sources.fhi.baseUrl.replace(/\/+$/, '') + '/' + UNCOVERED + '/table'
    ]);
    assert.equal(tables.filter(t => t.id.startsWith('fhi-mfr-')).length, 2);
  });

  it('tar med tittel, perioder, timeUnit, beskrivelse og søkeord fra fila', async () => {
    const { tables } = await adapter.getTables({});
    const t = tables.find(x => x.id === 'fhi-mfr-411');
    assert.equal(t.label, 'Fødte og fødsler');
    assert.equal(t.firstPeriod, '1967');
    assert.equal(t.lastPeriod, '2025');
    assert.equal(t.timeUnit, 'Annual');
    assert.equal(t.description, 'Fødte per år.');
    assert.deepEqual(t.variableNames, ['Geografi', 'År']);
    assert.equal(t.updated, '2026-01-15T08:00:00Z');
  });

  it('beholder kategorinivået i emnetre-pathen', async () => {
    const { tables } = await adapter.getTables({});
    const medKategori = tables.find(x => x.id === 'fhi-mfr-411');
    const utenKategori = tables.find(x => x.id === 'fhi-mfr-448');
    assert.equal(medKategori.paths[0].length, 3);
    assert.equal(medKategori.paths[0][2].id, 'fhi-mfr-fodsler');
    assert.equal(utenKategori.paths[0].length, 2);
  });

  it('bruker kildetittelen fra fila i kildefeltet', async () => {
    const { tables } = await adapter.getTables({});
    assert.equal(tables.find(t => t.id === 'fhi-mfr-411').source,
      'FHI/Medisinsk fødselsregister (MFR)');
  });

  it('holder updated som streng (menu-hierarchy sorterer uten null-guard)', async () => {
    const { tables } = await adapter.getTables({});
    assert.equal(typeof tables.find(x => x.id === 'fhi-mfr-448').updated, 'string');
  });

  it('rapporterer katalogen som ikke-nettverkshentet i sourceMeta', async () => {
    const { sourceMeta } = await adapter.getTables({});
    assert.equal(sourceMeta.fromCache, true,
      'alt kom fra katalogfila eller cachen — ingenting fra nett');
    assert.equal(sourceMeta.stale, false);
    assert.ok(sourceMeta.fetchedAt, 'statuspanelet viser når katalogen er fra');
  });
});

describe('FHIAdapter.getTables — live-fallback', () => {
  it('tar med tabeller fra kilder katalogfila ikke dekker', async () => {
    requested.length = 0;
    const { tables } = await adapter.getTables({});

    assert.equal(mfrCalls().length, 0, 'mfr kommer fra fila');
    assert.ok(tables.some(t => t.id === 'fhi-' + UNCOVERED + '-1'),
      'den udekkede kilden hentes fra live-lista');
    assert.ok(tables.some(t => t.id === 'fhi-mfr-411'));
  });

  it('går live for ALLE kilder ved tvungen oppfriskning (useCache: false)', async () => {
    requested.length = 0;
    const { tables } = await adapter.getTables({ useCache: false });
    assert.ok(mfrCalls().length > 0, 'statuspanelets «Oppdater» skal treffe API-et');
    // Live-lista er da fasit på medlemskapet — den nye tabellen kommer med.
    assert.ok(tables.some(t => t.id === 'fhi-mfr-999'));
  });

  it('beriker den live-hentede lista med titler fra fila', async () => {
    const { tables } = await adapter.getTables({ useCache: false });
    // 411 finnes i fila → kuratert tittel vinner over den rå API-tittelen.
    assert.equal(tables.find(t => t.id === 'fhi-mfr-411').label, 'Fødte og fødsler');
    // 999 finnes ikke i fila → rå API-tittel.
    assert.equal(tables.find(t => t.id === 'fhi-mfr-999').label, 'Ny tabell');
  });
});
