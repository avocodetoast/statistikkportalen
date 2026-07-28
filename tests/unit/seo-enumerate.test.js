/**
 * scripts/lib/seo-enumerate.mjs — SEO-generatorens lesing av den
 * byggetidsbygde katalogindeksen (P6: generatoren bygger ikke lenger
 * katalogen selv, den KONSUMERER {webroot}/data/index/).
 *
 * (a) En NB- og en FHI-rad, kodet gjennom scripts/lib/catalog-format.mjs sin
 *     encodeCatalog() og lest tilbake via enumerateAllTables(), skal ha
 *     nøyaktig de samme feltverdiene buildNbCatalogue()/buildFhiCatalogue()
 *     ga direkte FØR P6 — samme appConfig-/fhiCatalog-fixtureform som
 *     tests/unit/seo-sources.test.js (trimmet til én rad per kilde). Det er
 *     kontrakten denne pakken skal bevare.
 * (b) Manglende/ugyldig indeks (manifest finnes ikke / format !== 1) kaster,
 *     og gjør INGEN skriving selv — bevist med en fake fs uten
 *     write-metoder i det hele tatt (finnes ingen å kalle).
 * (c) --min-tables håndheves på DEKODET SSB-antall, ikke et API-svar.
 *
 * Ren ESM importert dynamisk (CJS kan ikke require() en ESM-modul) — samme
 * mønster som tests/unit/seo-sources.test.js og catalog-format.test.js.
 * Ingen nettverk, ingen browser-globals; (a)/(c) bruker ekte midlertidige
 * mapper (mkdtempSync), samme mønster som tests/unit/atomic-write.test.js.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const enumerateMod = import('../../scripts/lib/seo-enumerate.mjs');
const formatMod = import('../../scripts/lib/catalog-format.mjs');
const sourcesMod = import('../../scripts/lib/seo-sources.mjs');

// Trimmet variant av appConfig-fixturen i tests/unit/seo-sources.test.js —
// nok felter til at buildNbCatalogue/buildFhiCatalogue og apiLang() virker.
const appConfig = {
  apiBaseUrl: 'https://data.ssb.no/api/pxwebapi/v2',
  source: { name: 'SSB', nameFull: 'Statistisk sentralbyrå' },
  languages: [{ code: 'nb', apiLang: 'no' }, { code: 'en', apiLang: 'en' }],
  defaultLanguage: 'nb',
  sources: {
    ssb: { adapter: 'ssb', enabled: true },
    nb: {
      adapter: 'norges-bank',
      enabled: true,
      branding: { name: 'Norges Bank', nameFull: 'Norges Bank' },
      dataflows: [
        { flow: 'EXR', version: '1.0', tableId: 'nb-EXR',
          path: ['bf', 'nb-valutakurser'],
          label: { nb: 'Valutakurser', en: 'Exchange rates' } },
      ],
      variableNames: { EXR: ['Valutakurser', 'Valuta'] },
    },
    fhi: {
      adapter: 'fhi',
      enabled: true,
      branding: { name: 'FHI', nameFull: 'Folkehelseinstituttet' },
      sourceIds: ['nokkel'],
    },
  },
  sourceNodes: {
    'nb-valutakurser': { label: { nb: 'Valutakurser (Norges Bank)' }, sortCode: '910' },
    'fhi-nokkel': { label: { nb: 'Folkehelse: nøkkeltall (FHI)' }, sortCode: '920' },
  },
};

const subjectNames = { bf: 'Bank og finansmarked', he: 'Helse' };

const fhiCatalog = {
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

/** Tre syntetiske SSB-rader i adapterform — nok til å teste --min-tables. */
function ssbRow(id) {
  return {
    id, label: `${id}: Tabell ${id}`, updated: '2026-01-01T00:00:00Z',
    firstPeriod: '2000', lastPeriod: '2026', subjectCode: 'al', sortCode: '0000000020',
    timeUnit: 'Annual', discontinued: false, variableNames: ['kjønn'],
    paths: [[{ id: 'al', label: 'Arbeid og lønn', sortCode: '0000001' }]], description: '',
  };
}
const SSB_ROWS = ['10001', '10002', '10003'].map(ssbRow);

function mkTmpWebroot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seo-enumerate-'));
}

/** Skriv en ekte data/index/ (manifest + shards) i en midlertidig webroot. */
async function writeIndex(dir, { ssbRows = SSB_ROWS, nbRows = [], fhiRows = [], lang = 'no' } = {}) {
  const { encodeCatalog } = await formatMod;
  const indexDir = path.join(dir, 'data', 'index');
  fs.mkdirSync(indexDir, { recursive: true });

  const defs = [
    { source: 'ssb', rows: ssbRows },
    { source: 'nb', rows: nbRows },
    { source: 'fhi', rows: fhiRows },
  ].filter(d => d.rows.length > 0);

  const manifestShards = defs.map(({ source, rows }) => {
    const doc = encodeCatalog(rows, { source, lang, generatedAt: '2026-07-25T00:00:00.000Z' });
    const file = `${source}-${lang}.json`;
    fs.writeFileSync(path.join(indexDir, file), JSON.stringify(doc));
    return { source, lang, file, count: rows.length };
  });

  fs.writeFileSync(
    path.join(indexDir, 'catalog-manifest.json'),
    JSON.stringify({ format: 1, generatedAt: '2026-07-25T00:00:00.000Z', shards: manifestShards })
  );
}

/** Fake fs uten write-metoder — finnes ingen å kalle, så en påstått
 *  «ingen skriving» blir strukturelt sann, ikke bare observert. */
function fakeFsReadOnly(handlers) {
  return { readFileSync: handlers };
}

describe('enumerateAllTables — (a) samme radform gjennom indeksen som providerne ga før P6', () => {
  it('en NB-rad matcher buildNbCatalogue sine feltverdier etter encode/decode', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const { buildNbCatalogue } = await sourcesMod;
    const [nbRow] = buildNbCatalogue(appConfig, subjectNames, 'nb');
    assert.equal(nbRow.id, 'nb-EXR');

    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, { nbRows: [nbRow] });
      const tables = enumerateAllTables(appConfig, 0, { webroot: dir, lang: 'no' });
      const decoded = tables.find(t => t.id === 'nb-EXR');
      assert.ok(decoded, `nb-EXR mangler blant ${tables.map(t => t.id).join(', ')}`);

      // Kontrakten fra seo-sources.test.js sin 'setter katalogfeltene som
      // norges-bank-adapter.buildCatalogue'-test, minus det som droppes
      // (links/category/source — se catalog-format.mjs sin FIELDS-liste).
      assert.equal(decoded.label, 'Valutakurser');
      assert.equal(decoded.timeUnit, 'Business');
      assert.equal(decoded.updated, '');
      assert.equal(decoded.firstPeriod, '');
      assert.equal(decoded.lastPeriod, '');
      assert.equal(decoded.discontinued, false);
      assert.equal(decoded.subjectCode, 'bf');
      assert.deepEqual(decoded.variableNames, nbRow.variableNames);
      assert.equal(decoded.paths.length, 1);
      assert.equal(decoded.paths[0][0].id, 'bf');
      assert.equal(decoded.paths[0][1].id, 'nb-valutakurser');
      assert.equal(decoded.paths[0][1].label, 'Valutakurser (Norges Bank)');
      // source droppes av encode — sourceBrandingFor/sourceBadgeHtml utleder
      // kilden fra id-prefikset i stedet (se scripts/lib/seo-sources.mjs).
      assert.equal(decoded.source, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('en FHI-rad matcher buildFhiCatalogue sine feltverdier etter encode/decode', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const { buildFhiCatalogue } = await sourcesMod;
    const [fhiRow] = buildFhiCatalogue(fhiCatalog, appConfig, subjectNames, 'nb');
    assert.equal(fhiRow.id, 'fhi-nokkel-171');

    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, { fhiRows: [fhiRow] });
      const tables = enumerateAllTables(appConfig, 0, { webroot: dir, lang: 'no' });
      const decoded = tables.find(t => t.id === 'fhi-nokkel-171');
      assert.ok(decoded, `fhi-nokkel-171 mangler blant ${tables.map(t => t.id).join(', ')}`);

      // Kontrakten fra seo-sources.test.js sin
      // 'bygger oppføringer fra fhi-catalog.json ...'-test.
      assert.equal(decoded.label, 'Forventet levealder');
      assert.equal(decoded.firstPeriod, '1990');
      assert.equal(decoded.lastPeriod, '2026');
      assert.equal(decoded.timeUnit, 'Annual');
      assert.equal(decoded.updated, '2026-06-01T00:00:00Z');
      assert.deepEqual(decoded.variableNames, ['Levealder', 'Dødelighet']);
      assert.equal(decoded.description, 'Forventet levealder ved fødsel.');
      assert.equal(decoded.sortCode, '000171');
      assert.equal(decoded.paths[0][0].id, 'he');
      assert.equal(decoded.paths[0][1].id, 'fhi-nokkel');
      assert.equal(decoded.source, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('en fremmed kildes ødelagte/manglende shard logges og hoppes over — SSB fortsetter', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, {});
      const manifestPath = path.join(dir, 'data', 'index', 'catalog-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      // Manifestet peker på et nb-shard som aldri ble skrevet til disk.
      manifest.shards.push({ source: 'nb', lang: 'no', file: 'nb-no-mangler.json', count: 5 });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const warnings = [];
      const tables = enumerateAllTables(appConfig, 0, {
        webroot: dir, lang: 'no', warn: msg => warnings.push(msg),
      });
      assert.equal(tables.length, 3); // kun de tre SSB-radene
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /«nb»/);
      assert.match(warnings[0], /hopper over/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('enumerateAllTables — (b) manglende/ugyldig indeks aborter uten å skrive', () => {
  it('kaster når manifestet mangler — fake fs har ingen write-metode å kalle', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const fakeFs = fakeFsReadOnly(() => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    });
    assert.throws(
      () => enumerateAllTables(appConfig, 0, { webroot: '/uansett/hvor', lang: 'no', fs: fakeFs }),
      /Fant ikke katalogindeksen/
    );
  });

  it('kaster når manifestet har ukjent format', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const fakeFs = fakeFsReadOnly(() => JSON.stringify({ format: 2, shards: [] }));
    assert.throws(
      () => enumerateAllTables(appConfig, 0, { webroot: '/uansett/hvor', lang: 'no', fs: fakeFs }),
      /ukjent format/
    );
  });

  it('kaster når manifestet mangler shards-arrayet', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const fakeFs = fakeFsReadOnly(() => JSON.stringify({ format: 1 }));
    assert.throws(
      () => enumerateAllTables(appConfig, 0, { webroot: '/uansett/hvor', lang: 'no', fs: fakeFs }),
      /ukjent format/
    );
  });

  it('kaster når indeksen mangler SSB-shardet for språket', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, { ssbRows: [], nbRows: [{ ...ssbRow('nb-X'), id: 'nb-X' }] });
      assert.throws(
        () => enumerateAllTables(appConfig, 0, { webroot: dir, lang: 'no' }),
        /mangler SSB-shardet/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('enumerateAllTables — (c) --min-tables håndheves på DEKODET antall', () => {
  it('kaster når dekodet SSB-antall er under terskelen', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, {});
      assert.throws(
        () => enumerateAllTables(appConfig, 10, { webroot: dir, lang: 'no' }),
        /Bare 3 dekodede SSB-rader.*forventet minst 10/
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('slipper gjennom når dekodet SSB-antall møter terskelen nøyaktig', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, {});
      const tables = enumerateAllTables(appConfig, 3, { webroot: dir, lang: 'no' });
      assert.equal(tables.length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('enumerateAllTables — språkvalg', () => {
  it('bruker apiLang(appConfig) som default når opts.lang ikke er satt', async () => {
    const { enumerateAllTables } = await enumerateMod;
    const dir = mkTmpWebroot();
    try {
      await writeIndex(dir, {}); // shardene tagges 'no' — apiLang(appConfig) for nb er 'no'
      const tables = enumerateAllTables(appConfig, 0, { webroot: dir });
      assert.equal(tables.length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
