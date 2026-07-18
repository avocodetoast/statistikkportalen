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
      branding: { name: 'Norges Bank', nameFull: 'Norges Bank', url: 'https://www.norges-bank.no/' },
      dataflows: [
        { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
          paths: [['bf', 'nb-valutakurser'], ['ut', 'nb-valutakurser']],
          label: { nb: 'Valutakurser', en: 'Exchange rates' } },
        { flow: 'IR', version: '1.1', tableId: 'nb-IR',
          path: ['bf', 'nb-renter'],
          label: { nb: 'Styringsrenten', en: 'Key policy rate' } },
      ],
    },
    fhi: {
      adapter: 'fhi',
      enabled: true,
      branding: {
        name: 'FHI', nameFull: 'Folkehelseinstituttet', url: 'https://www.fhi.no/',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.no', licenseName: 'CC BY 4.0',
      },
      sourceIds: ['nokkel'],
    },
  },
  sourceNodes: {
    'nb-valutakurser': { label: { nb: 'Valutakurser (Norges Bank)', en: 'Exchange rates (Norges Bank)' }, sortCode: '910' },
    'nb-renter': { label: { nb: 'Renter (Norges Bank)', en: 'Interest rates (Norges Bank)' }, sortCode: '911' },
    'fhi-nokkel': { label: { nb: 'Folkehelse: nøkkeltall (FHI)', en: 'Public health: key figures (FHI)' }, sortCode: '920' },
  },
};

// Blandet streng/objekt for å teste pickLabel-fleksibiliteten (generatorens
// loadSubjectConfig løser til rene strenger; adapternes SubjectConfig er {nb,en}).
const subjectNames = {
  bf: { nb: 'Bank og finansmarked', en: 'Banking and financial markets' },
  ut: 'Utenriksøkonomi',
  he: { nb: 'Helse', en: 'Health' },
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
    assert.equal(sourceKeyForId('nb-EXR'), 'nb');
    assert.equal(sourceKeyForId('fhi-nokkel-171'), 'fhi');
    assert.equal(sourceKeyForId('13760'), 'ssb');
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

describe('buildNbCatalogue', () => {
  it('bygger én oppføring per dataflow, nettverksfritt', async () => {
    const { buildNbCatalogue } = await mod;
    const tables = buildNbCatalogue(appConfig, subjectNames, 'nb');
    assert.equal(tables.length, 2);
    assert.deepEqual(tables.map(t => t.id), ['nb-EXR', 'nb-IR']);
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
});

describe('buildFhiCatalogue', () => {
  it('bygger oppføringer fra fhi-catalog.json med adapterens id- og labelform', async () => {
    const { buildFhiCatalogue } = await mod;
    const tables = buildFhiCatalogue(fhiCatalog, appConfig, subjectNames, 'nb');
    assert.equal(tables.length, 1);
    const t = tables[0];
    assert.equal(t.id, 'fhi-nokkel-171');
    assert.equal(t.label, 'Forventet levealder (FHI)');
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

describe('enabledSourceNames / joinNamesNo', () => {
  it('lister det globale kildenavnet først, deretter aktiverte kilder med branding', async () => {
    const { enabledSourceNames } = await mod;
    assert.deepEqual(
      enabledSourceNames(appConfig),
      ['Statistisk sentralbyrå', 'Norges Bank', 'Folkehelseinstituttet']
    );
  });

  it('kan gi kortnavn (name) i stedet for fulle navn', async () => {
    const { enabledSourceNames } = await mod;
    assert.deepEqual(enabledSourceNames(appConfig, 'name'), ['SSB', 'Norges Bank', 'FHI']);
  });

  it('hopper over avskrudde kilder', async () => {
    const { enabledSourceNames } = await mod;
    const cfg = { ...appConfig, sources: { ...appConfig.sources, fhi: { ...appConfig.sources.fhi, enabled: false } } };
    assert.deepEqual(enabledSourceNames(cfg), ['Statistisk sentralbyrå', 'Norges Bank']);
  });

  it('binder navnelister med komma og «og»', async () => {
    const { joinNamesNo } = await mod;
    assert.equal(joinNamesNo(['A']), 'A');
    assert.equal(joinNamesNo(['A', 'B']), 'A og B');
    assert.equal(joinNamesNo(['A', 'B', 'C']), 'A, B og C');
  });
});
