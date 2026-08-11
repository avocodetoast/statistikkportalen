/**
 * scripts/lib/seo-sources.mjs — per-kilde katalogleverandører og attribusjon
 * for SEO-generatoren (scripts/generate-seo-pages.mjs).
 *
 * Modulen er ren ESM (ingen browser-globals) og importeres direkte — ikke via
 * loadApp-harnesset. Fixtures speiler formene i js/config.js
 * (AppConfig.sources/sourceNodes) og data/sources/fhi-catalog.json.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// CJS kan ikke require() en ESM-modul — dynamisk import, delt promise.
const mod = import('../../scripts/lib/seo-sources.mjs');

const appConfig = {
  source: {
    name: 'SSB',
    nameFull: 'Statistisk sentralbyrå',
    url: 'https://www.ssb.no/',
    licenseUrl: 'https://www.ssb.no/diverse/lisens',
    licenseName: 'CC BY 4.0',
  },
  sources: {
    ssb: { adapter: 'ssb', enabled: true },
    nb: {
      adapter: 'norges-bank',
      enabled: true,
      idPrefix: 'nb-',
      branding: { name: 'Norges Bank', nameFull: 'Norges Bank', shortName: 'NB', url: 'https://www.norges-bank.no/' },
      dataflows: [
        { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
          paths: [['bf', 'nb-valutakurser'], ['ut', 'nb-valutakurser']],
          label: { nb: 'Valutakurser', en: 'Exchange rates' } },
        { flow: 'IR', version: '1.1', tableId: 'nb-IR',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Styringsrenten', en: 'Key policy rate' } },
        // Dyp kryssplassering: subjekt + SSB-passthrough-noder + NB-leaf.
        { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES',
          paths: [['bf', 'bf03', 'renter', 'nb-pengepolitikk']],
          label: { nb: 'Kortsiktige renter', en: 'Short-term rates' } },
        // Kuratert snitt: deler flow med raden over, men overstyrer
        // frekvensbøtte og søkeord per tabell (jf. buildCatalogue i adapteren).
        { flow: 'SHORT_RATES', version: '1.2', tableId: 'nb-SHORT_RATES-NOWA',
          paths: [['bf', 'bf03', 'renter', 'nb-pengepolitikk']],
          slice: { TENOR: 'ON' }, probeKey: 'B.ON.',
          timeUnit: 'Quarterly', keywords: ['NOWA', 'Overnight'],
          label: { nb: 'NOWA', en: 'NOWA' } },
      ],
      // Statiske søkeord per flow (jf. window.NbCatalog.variableNames →
      // AppConfig.sources.nb.variableNames). Fallback når en rad mangler `keywords`.
      variableNames: {
        EXR: ['Valutakurser', 'Valuta', 'Exchange rates', 'Currency'],
        IR: ['Styringsrenten', 'Rente', 'Key policy rate'],
        SHORT_RATES: ['Interbankrente', 'Short-term interest rates'],
      },
    },
    fhi: {
      adapter: 'fhi',
      enabled: true,
      idPrefix: 'fhi-',
      branding: {
        name: 'FHI', nameFull: 'Folkehelseinstituttet', shortName: 'FHI', url: 'https://www.fhi.no/',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.no', licenseName: 'CC BY 4.0',
      },
      sourceIds: ['nokkel'],
    },
    dbh: {
      adapter: 'dbh', enabled: true, idPrefix: 'dbh-',
      branding: { name: 'DBH', nameFull: 'Database for statistikk om høgare utdanning', shortName: 'DBH' },
      tables: [{
        id: 'dbh-226', rawId: 226, title: 'Areal', paths: [['ud', 'dbh-annet']],
        timeUnit: 'year', dimensions: [{ code: 'Årstall', label: 'Årstall' }],
        measures: ['Brutto m2']
      }]
    },
  },
  sourceNodes: {
    'nb-valutakurser': { label: { nb: 'Valutakurser (Norges Bank)', en: 'Exchange rates (Norges Bank)' }, sortCode: '910' },
    'nb-renter': { label: { nb: 'Renter (Norges Bank)', en: 'Interest rates (Norges Bank)' }, sortCode: '911' },
    // SSB-passthrough + NB-leaf for dyp-path-testen
    'bf03': { label: { nb: 'Finansinstitusjoner og andre finansielle foretak' }, sortCode: '0000008' },
    'renter': { label: { nb: 'Renter i banker og kredittforetak' }, sortCode: '0000009' },
    'nb-pengepolitikk': { label: { nb: 'Pengepolitikk og pengemarked', en: 'Monetary policy and money market' }, sortCode: '910' },
    'fhi-nokkel': { label: { nb: 'Folkehelse: nøkkeltall (FHI)', en: 'Public health: key figures (FHI)' }, sortCode: '920' },
    'dbh-annet': { label: { nb: 'Institusjonsdata', en: 'Institution data' }, sortCode: '925' },
  },
};

// Blandet streng/objekt for å teste pickLabel-fleksibiliteten (generatorens
// loadSubjectConfig løser til rene strenger; adapternes SubjectConfig er {nb,en}).
const subjectNames = {
  bf: { nb: 'Bank og finansmarked', en: 'Banking and financial markets' },
  ut: 'Utenriksøkonomi',
  he: { nb: 'Helse', en: 'Health' },
  ud: { nb: 'Utdanning', en: 'Education' },
};

const fhiCatalog = {
  generatedAt: '2026-07-15T06:00:00.000Z',
  sources: {
    nokkel: {
      title: 'Folkehelse: nøkkeltall',
      tables: [
        { tableId: 171, title: 'Forventet levealder', internalName: 'levealder',
          description: 'Forventet levealder ved fødsel.', firstPeriod: '1990', lastPeriod: '2026',
          timeUnit: 'Annual', variableNames: ['Levealder', 'Dødelighet'], updated: '2026-06-01T00:00:00Z' },
      ],
    },
  },
};

describe('isoPeriod', () => {
  it('konverterer SSB/FHI-periodekoder til ISO 8601', async () => {
    const { isoPeriod } = await mod;
    assert.equal(isoPeriod('2026'), '2026');
    assert.equal(isoPeriod('2006M01'), '2006-01');
    assert.equal(isoPeriod('2006K1'), '2006');
  });

  it('gir null for tomme/uparsbare verdier', async () => {
    const { isoPeriod } = await mod;
    assert.equal(isoPeriod(''), null);
    assert.equal(isoPeriod(null), null);
    assert.equal(isoPeriod('ukjent'), null);
  });
});

describe('sourceKeyForId', () => {
  it('ruter på tabell-id-prefiks som kildefasaden', async () => {
    const { sourceKeyForId } = await mod;
    assert.equal(sourceKeyForId('nb-EXR', appConfig), 'nb');
    assert.equal(sourceKeyForId('fhi-nokkel-171', appConfig), 'fhi');
    assert.equal(sourceKeyForId('dbh-226', appConfig), 'dbh');
    assert.equal(sourceKeyForId('13760', appConfig), 'ssb');
  });

  it('deriverer prefikset fra AppConfig', async () => {
    const { sourceKeyForId } = await mod;
    const config = {
      sources: {
        ssb: { enabled: true },
        test: { enabled: true, idPrefix: 'test-' },
      },
    };
    assert.equal(sourceKeyForId('test-tabell', config), 'test');
  });
});

describe('sourceBrandingFor', () => {
  it('gir kildens branding for nb-/fhi-id-er', async () => {
    const { sourceBrandingFor } = await mod;
    assert.equal(sourceBrandingFor('nb-EXR', appConfig).name, 'Norges Bank');
    assert.equal(sourceBrandingFor('fhi-nokkel-171', appConfig).nameFull, 'Folkehelseinstituttet');
  });

  it('gir det globale source-objektet for SSB-id-er', async () => {
    const { sourceBrandingFor } = await mod;
    assert.equal(sourceBrandingFor('13760', appConfig), appConfig.source);
  });

  it('faller tilbake til det globale source-objektet når branding mangler', async () => {
    const { sourceBrandingFor } = await mod;
    const cfg = { ...appConfig, sources: { ...appConfig.sources, nb: { ...appConfig.sources.nb, branding: undefined } } };
    assert.equal(sourceBrandingFor('nb-EXR', cfg), appConfig.source);
  });

  it('utelater lisens for Norges Bank (branding uten licenseUrl)', async () => {
    const { sourceBrandingFor } = await mod;
    assert.equal(sourceBrandingFor('nb-EXR', appConfig).licenseUrl, undefined);
  });
});

describe('sourceBadgeHtml', () => {
  it('merker ikke SSB-tabeller (standardkilden)', async () => {
    const { sourceBadgeHtml } = await mod;
    assert.equal(sourceBadgeHtml('13760', appConfig), '');
  });

  it('bruker shortName som badgetekst og nameFull som tooltip', async () => {
    const { sourceBadgeHtml } = await mod;
    const nb = sourceBadgeHtml('nb-EXR', appConfig);
    assert.match(nb, /class="source-badge source-badge--nb"/);
    assert.match(nb, /data-tooltip="Norges Bank"/);
    assert.match(nb, />NB</);

    const fhi = sourceBadgeHtml('fhi-nokkel-171', appConfig);
    assert.match(fhi, /source-badge--fhi/);
    assert.match(fhi, /data-tooltip="Folkehelseinstituttet"/);
    assert.match(fhi, />FHI</);
  });

  it('faller tilbake til name uten shortName', async () => {
    const { sourceBadgeHtml } = await mod;
    const cfg = { ...appConfig, sources: { ...appConfig.sources,
      nb: { ...appConfig.sources.nb, branding: { name: 'Norges Bank', nameFull: 'Norges Bank' } } } };
    assert.match(sourceBadgeHtml('nb-EXR', cfg), />Norges Bank</);
  });

  it('merker ikke en kilde uten egen branding (arver ikke SSBs)', async () => {
    const { sourceBadgeHtml } = await mod;
    const cfg = { ...appConfig, sources: { ...appConfig.sources, nb: { ...appConfig.sources.nb, branding: undefined } } };
    assert.equal(sourceBadgeHtml('nb-EXR', cfg), '');
  });
});

describe('buildNbCatalogue', () => {
  it('bygger én oppføring per dataflow, nettverksfritt', async () => {
    const { buildNbCatalogue } = await mod;
    const tables = buildNbCatalogue(appConfig, subjectNames, 'nb');
    assert.equal(tables.length, 4);
    assert.deepEqual(tables.map(t => t.id),
      ['nb-EXR', 'nb-IR', 'nb-SHORT_RATES', 'nb-SHORT_RATES-NOWA']);
  });

  it('lar en snittet rad overstyre timeUnit og keywords per tabell', async () => {
    const { buildNbCatalogue } = await mod;
    const cat = buildNbCatalogue(appConfig, subjectNames, 'nb');
    const full = cat.find(t => t.id === 'nb-SHORT_RATES');
    const nowa = cat.find(t => t.id === 'nb-SHORT_RATES-NOWA');
    assert.equal(full.timeUnit, 'Business');
    assert.equal(nowa.timeUnit, 'Quarterly');
    assert.deepEqual(nowa.variableNames, ['NOWA', 'Overnight']);
    // Rader som deler flow beholder egne, unike sortCodes.
    assert.notEqual(full.sortCode, nowa.sortCode);
  });

  it('setter katalogfeltene som norges-bank-adapter.buildCatalogue', async () => {
    const { buildNbCatalogue } = await mod;
    const [exr] = buildNbCatalogue(appConfig, subjectNames, 'nb');
    assert.equal(exr.label, 'Valutakurser');
    assert.equal(exr.timeUnit, 'Business');
    assert.equal(exr.updated, '');
    assert.equal(exr.firstPeriod, '');
    assert.equal(exr.lastPeriod, '');
    assert.equal(exr.discontinued, false);
    assert.equal(exr.subjectCode, 'bf');
    assert.equal(exr.source, 'Norges Bank');
    assert.ok(exr.variableNames.includes('Valutakurser'));
  });

  it('gir flere emnetre-plasseringer via paths, med legacy path-fallback', async () => {
    const { buildNbCatalogue } = await mod;
    const [exr, ir] = buildNbCatalogue(appConfig, subjectNames, 'nb');
    assert.equal(exr.paths.length, 2);
    assert.equal(ir.paths.length, 1);
    // Hvert path-segment har id/label/sortCode (kontrakten buildHierarchy krever)
    const [subjSeg, nodeSeg] = exr.paths[0];
    assert.equal(subjSeg.id, 'bf');
    assert.equal(subjSeg.label, 'Bank og finansmarked');
    assert.equal(nodeSeg.id, 'nb-valutakurser');
    assert.equal(nodeSeg.label, 'Valutakurser (Norges Bank)');
    assert.equal(nodeSeg.sortCode, '910');
    // Andre plassering under 'ut' (streng-label i subjectNames)
    assert.equal(exr.paths[1][0].id, 'ut');
    assert.equal(exr.paths[1][0].label, 'Utenriksøkonomi');
  });

  it('velger engelske labels ved lang=en', async () => {
    const { buildNbCatalogue } = await mod;
    const [exr] = buildNbCatalogue(appConfig, subjectNames, 'en');
    assert.equal(exr.label, 'Exchange rates');
    assert.equal(exr.paths[0][1].label, 'Exchange rates (Norges Bank)');
  });

  it('bygger vilkårlig dype paths (subjekt + passthrough + leaf)', async () => {
    const { buildNbCatalogue } = await mod;
    const cat = buildNbCatalogue(appConfig, subjectNames, 'nb');
    const t = cat.find(x => x.id === 'nb-SHORT_RATES');
    assert.ok(t);
    assert.equal(t.paths.length, 1);
    const path = t.paths[0];
    assert.equal(path.length, 4);
    assert.deepEqual(path.map(s => s.id), ['bf', 'bf03', 'renter', 'nb-pengepolitikk']);
    assert.equal(path[1].label, 'Finansinstitusjoner og andre finansielle foretak');
    assert.equal(path[2].label, 'Renter i banker og kredittforetak');
    assert.equal(path[3].label, 'Pengepolitikk og pengemarked');
    path.forEach(seg => {
      assert.ok(typeof seg.label === 'string' && seg.label.length > 0);
      assert.ok(typeof seg.sortCode === 'string' && seg.sortCode.length > 0);
    });
  });
});

describe('buildFhiCatalogue', () => {
  it('bygger oppføringer fra fhi-catalog.json med adapterens id- og labelform', async () => {
    const { buildFhiCatalogue } = await mod;
    const tables = buildFhiCatalogue(fhiCatalog, appConfig, subjectNames, 'nb');
    assert.equal(tables.length, 1);
    const t = tables[0];
    assert.equal(t.id, 'fhi-nokkel-171');
    // Ingen «(FHI)»-suffiks: kilden vises som badge, ikke i tittelen
    assert.equal(t.label, 'Forventet levealder');
    assert.equal(t.firstPeriod, '1990');
    assert.equal(t.lastPeriod, '2026');
    assert.equal(t.timeUnit, 'Annual');
    assert.equal(t.updated, '2026-06-01T00:00:00Z');
    assert.deepEqual(t.variableNames, ['Levealder', 'Dødelighet']);
    assert.equal(t.description, 'Forventet levealder ved fødsel.');
    assert.equal(t.sortCode, '000171');
    assert.equal(t.source, 'FHI/Folkehelse: nøkkeltall');
  });

  it('plasserer tabellene under standardstien he/fhi-{source}', async () => {
    const { buildFhiCatalogue } = await mod;
    const [t] = buildFhiCatalogue(fhiCatalog, appConfig, subjectNames, 'nb');
    assert.equal(t.subjectCode, 'he');
    assert.equal(t.paths.length, 1);
    assert.equal(t.paths[0][0].id, 'he');
    assert.equal(t.paths[0][0].label, 'Helse');
    assert.equal(t.paths[0][1].id, 'fhi-nokkel');
    assert.equal(t.paths[0][1].label, 'Folkehelse: nøkkeltall (FHI)');
    assert.equal(t.paths[0][1].sortCode, '920');
  });

  it('respekterer paths-overstyring i AppConfig.sources.fhi.paths', async () => {
    const { buildFhiCatalogue } = await mod;
    const cfg = {
      ...appConfig,
      sources: {
        ...appConfig.sources,
        fhi: { ...appConfig.sources.fhi, paths: { nokkel: [['he', 'fhi-nokkel'], ['bf', 'fhi-nokkel']] } },
      },
    };
    const [t] = buildFhiCatalogue(fhiCatalog, cfg, subjectNames, 'nb');
    assert.equal(t.paths.length, 2);
    assert.equal(t.paths[1][0].id, 'bf');
  });

  it('bygger vilkårlig dyp FHI-path (subjekt + passthrough + leaf)', async () => {
    const { buildFhiCatalogue } = await mod;
    const cfg = {
      ...appConfig,
      sources: {
        ...appConfig.sources,
        fhi: { ...appConfig.sources.fhi, paths: { nokkel: [['bf', 'bf03', 'renter', 'fhi-nokkel']] } },
      },
    };
    const [t] = buildFhiCatalogue(fhiCatalog, cfg, subjectNames, 'nb');
    assert.equal(t.paths.length, 1);
    assert.equal(t.paths[0].length, 4);
    assert.deepEqual(t.paths[0].map(s => s.id), ['bf', 'bf03', 'renter', 'fhi-nokkel']);
    assert.equal(t.paths[0][1].label, 'Finansinstitusjoner og andre finansielle foretak');
    assert.equal(t.paths[0][2].label, 'Renter i banker og kredittforetak');
  });

  it('hopper over sourceIds som mangler i katalogfila', async () => {
    const { buildFhiCatalogue } = await mod;
    const cfg = {
      ...appConfig,
      sources: { ...appConfig.sources, fhi: { ...appConfig.sources.fhi, sourceIds: ['nokkel', 'mfr'] } },
    };
    const tables = buildFhiCatalogue(fhiCatalog, cfg, subjectNames, 'nb');
    assert.equal(tables.length, 1); // 'mfr' finnes ikke i fixture-katalogen
  });

  it('bygger kategorisegment (register → kategori) fra katalogens categories', async () => {
    const { buildFhiCatalogue } = await mod;
    const catalog = {
      sources: {
        nokkel: {
          title: 'Folkehelse: nøkkeltall',
          categories: { befolkning: { label: 'Befolkning', sortCode: '010' } },
          tables: [
            { tableId: 171, title: 'Forventet levealder', category: 'befolkning' },
            { tableId: 175, title: 'Uten kategori' },
            { tableId: 180, title: 'Udefinert kategori', category: 'finnes-ikke' },
          ],
        },
      },
    };
    const tables = buildFhiCatalogue(catalog, appConfig, subjectNames, 'nb');

    const kategorisert = tables.find(t => t.id === 'fhi-nokkel-171');
    assert.equal(kategorisert.paths.length, 1);
    assert.equal(kategorisert.paths[0].length, 3);
    assert.deepEqual(kategorisert.paths[0][2],
      { id: 'fhi-nokkel-befolkning', label: 'Befolkning', sortCode: '010' });

    // Uten kategori (eller med udefinert referanse) → dagens 2-segments path.
    assert.equal(tables.find(t => t.id === 'fhi-nokkel-175').paths[0].length, 2);
    assert.equal(tables.find(t => t.id === 'fhi-nokkel-180').paths[0].length, 2);
  });
});

describe('buildDbhCatalogue', () => {
  it('bygger kuraterte DBH-rader nettverksfritt via CatalogShared', async () => {
    const { buildDbhCatalogue } = await mod;
    const tables = buildDbhCatalogue(appConfig, subjectNames, 'nb');
    assert.equal(tables.length, 1);
    assert.equal(tables[0].id, 'dbh-226');
    assert.equal(tables[0].label, 'Areal');
    assert.deepEqual(tables[0].paths[0].map(segment => segment.id), ['ud', 'dbh-annet']);
    assert.equal(tables[0].source, 'DBH');
  });
});

describe('enabledSourceNames / joinNamesNo', () => {
  it('lister det globale kildenavnet først, deretter aktiverte kilder med branding', async () => {
    const { enabledSourceNames } = await mod;
    assert.deepEqual(
      enabledSourceNames(appConfig),
      ['Statistisk sentralbyrå', 'Norges Bank', 'Folkehelseinstituttet',
        'Database for statistikk om høgare utdanning']
    );
  });

  it('kan gi kortnavn (name) i stedet for fulle navn', async () => {
    const { enabledSourceNames } = await mod;
    assert.deepEqual(enabledSourceNames(appConfig, 'name'), ['SSB', 'Norges Bank', 'FHI', 'DBH']);
  });

  it('hopper over avskrudde kilder', async () => {
    const { enabledSourceNames } = await mod;
    const cfg = { ...appConfig, sources: { ...appConfig.sources, fhi: { ...appConfig.sources.fhi, enabled: false } } };
    assert.deepEqual(enabledSourceNames(cfg), ['Statistisk sentralbyrå', 'Norges Bank',
      'Database for statistikk om høgare utdanning']);
  });

  it('binder navnelister med komma og «og»', async () => {
    const { joinNamesNo } = await mod;
    assert.equal(joinNamesNo(['A']), 'A');
    assert.equal(joinNamesNo(['A', 'B']), 'A og B');
    assert.equal(joinNamesNo(['A', 'B', 'C']), 'A, B og C');
  });
});
