/**
 * scripts/lib/catalog-build.mjs — orkestreringen og de fem garantiene bak
 * katalogindeksen («aldri en halv indeks over en god»).
 *
 * HVORFOR HER OG IKKE I CLI-EN: guardene er den eneste grunnen til at
 * byggetidslaget finnes. Ligger de i scripts/build-catalog-index.mjs, kan de
 * bare testes ved å kjøre et script som henter fra nettet og skriver til disk.
 * Her injiseres BÅDE radbyggingen, komprimeringen og skrivingen som fakes:
 * ingen nettverk, ingen ekte filer, og «ble det skrevet noe?» blir en
 * assertion i stedet for en manuell inspeksjon.
 *
 * Garantiene som asserteres:
 *   (a) --min-tables avviser en for kort SSB-liste
 *   (b) krympe-guarden avviser >maxShrink %, men slipper gjennom mindre fall
 *   (c) en feilende fremmed kilde bærer forrige shard-oppføring verbatim
 *       videre, og kjøringen lykkes fortsatt for SSB
 *   (d) SSB-feil gir feil OG null skriveoperasjoner
 *   (e) catalog-manifest.json skrives SIST av alt
 *   (f) en kilde som IKKE bygges denne kjøringen (carryForward) bærer forrige
 *       shard-oppføring videre — manifestet beskriver alltid en HEL indeks,
 *       også når bare én kilde oppdateres
 */
'use strict';

const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// CJS kan ikke require() en ESM-modul — dynamisk import, delt promise
// (samme mønster som tests/unit/seo-sources.test.js).
const mod = import('../../scripts/lib/catalog-build.mjs');

const GEN_AT = '2026-07-28T03:15:00.000Z';
const OUT_DIR = '/webroot/data/index';

/** Én syntetisk katalograd i samme form som en adapters getTables(). */
function row(id) {
  return {
    id: String(id),
    label: `${id}: Tabell ${id}`,
    updated: '2026-07-01T06:00:00Z',
    firstPeriod: '2000',
    lastPeriod: '2026',
    subjectCode: 'al',
    sortCode: '0000000020',
    timeUnit: 'Annual',
    variableNames: ['kjønn'],
    paths: [[{ id: 'al', label: 'Arbeid og lønn', sortCode: '0000001' }]],
  };
}

function rows(n, prefix = '1') {
  return Array.from({ length: n }, (_, i) => row(`${prefix}${String(i).padStart(4, '0')}`));
}

/** Fake brotli: testene skal ikke bruke tid på ekte komprimering (kvalitet 11
 *  på et par hundre rader er sekunder), og innholdet er uinteressant her. */
const fakeCompress = (content) => Buffer.from(`br:${Buffer.byteLength(content)}`);

/** Fake writer som logger rekkefølgen. Skiller skriving fra sletting, slik at
 *  (e) kan assertere på skriverekkefølgen alene. */
function makeWriter() {
  const writes = [];
  const removes = [];
  const dirs = [];
  return {
    writes, removes, dirs,
    mkdir: (d) => { dirs.push(d); },
    writeFile: (p, content) => { writes.push({ path: p, bytes: Buffer.byteLength(content) }); },
    removeFile: (p) => { removes.push(p); },
    names: () => writes.map((w) => path.basename(w.path)),
  };
}

function ssbSource(rowList) {
  return { key: 'ssb', lang: 'no', primary: true, build: async () => rowList };
}

function manifestEntry(source, count, file) {
  return { source, lang: 'no', file, count, bytes: count * 100, generatedAt: '2026-07-21T03:00:00.000Z' };
}

describe('contentHash', () => {
  it('er stabil, kort og innholdsavhengig', async () => {
    const { contentHash } = await mod;
    const a = contentHash('{"a":1}');
    assert.equal(a, contentHash('{"a":1}'));
    assert.notEqual(a, contentHash('{"a":2}'));
    assert.match(a, /^[0-9a-f]{8}$/);
  });
});

describe('planBuild — (a) --min-tables-guarden', () => {
  it('avviser en for kort SSB-liste og markerer kjøringen som mislykket', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [ssbSource(rows(83))],
      previousManifest: null,
      minTables: 5000,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, false);
    assert.ok(plan.errors.some((e) => e.fatal && /83/.test(e.message) && /5000/.test(e.message)),
      `forventet en fatal feil som nevner 83 og 5000, fikk: ${JSON.stringify(plan.errors)}`);
    assert.equal(plan.shards.length, 0);
  });

  it('slipper gjennom en liste på nøyaktig terskelen', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [ssbSource(rows(50))],
      previousManifest: null,
      minTables: 50,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.shards.length, 1);
    assert.equal(plan.shards[0].count, 50);
  });
});

describe('planBuild — (b) krympe-guarden mot det deployede manifestet', () => {
  const previousManifest = {
    format: 1,
    generatedAt: '2026-07-21T03:00:00.000Z',
    shards: [manifestEntry('ssb', 100, 'ssb-no-deadbeef.json')],
  };

  it('avviser et shard som krymper mer enn --max-shrink %', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [ssbSource(rows(89))],
      previousManifest,
      minTables: 0,
      maxShrink: 10,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, false);
    const msg = plan.errors.map((e) => e.message).join('\n');
    // Tallene MÅ stå i feilmeldingen — det er hele poenget med guarden.
    assert.match(msg, /89/);
    assert.match(msg, /100/);
  });

  it('aksepterer et shard som krymper mindre enn terskelen', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [ssbSource(rows(91))],
      previousManifest,
      minTables: 0,
      maxShrink: 10,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, true, `forventet suksess, fikk: ${JSON.stringify(plan.errors)}`);
    assert.equal(plan.shards[0].count, 91);
  });

  it('aksepterer vekst uten å se på terskelen', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [ssbSource(rows(400))],
      previousManifest,
      minTables: 0,
      maxShrink: 10,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });
    assert.equal(plan.ok, true);
  });
});

describe('planBuild — (c) fremmede kilder feilisoleres', () => {
  it('bærer forrige shard-oppføring verbatim videre og lykkes for SSB', async () => {
    const { planBuild } = await mod;
    const forrigeFhi = manifestEntry('fhi', 370, 'fhi-no-cafebabe.json');
    const previousManifest = {
      format: 1,
      generatedAt: '2026-07-21T03:00:00.000Z',
      shards: [manifestEntry('ssb', 100, 'ssb-no-deadbeef.json'), forrigeFhi],
    };

    const plan = await planBuild({
      sources: [
        ssbSource(rows(100)),
        { key: 'fhi', lang: 'no', build: async () => { throw new Error('FHI-katalogen mangler'); } },
      ],
      previousManifest,
      minTables: 0,
      maxShrink: 10,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, true, `FHI-feil skal ikke velte kjøringen: ${JSON.stringify(plan.errors)}`);
    // SSB ble bygget
    assert.deepEqual(plan.shards.map((s) => s.source), ['ssb']);
    // ...og FHI-oppføringen er den FORRIGE, ordrett.
    const fhiEntry = plan.manifest.shards.find((s) => s.source === 'fhi');
    assert.deepEqual(fhiEntry, forrigeFhi);
    // Feilen skal fortsatt rapporteres, bare ikke fatalt.
    assert.ok(plan.errors.some((e) => e.source === 'fhi' && !e.fatal));
    assert.ok(plan.skipped.some((s) => s.source === 'fhi' && s.carriedForward === true));
  });

  it('hopper over en feilende fremmed kilde uten forrige oppføring, uten å feile', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [
        ssbSource(rows(100)),
        { key: 'fhi', lang: 'no', build: async () => { throw new Error('FHI-katalogen mangler'); } },
      ],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.manifest.shards.filter((s) => s.source === 'fhi').length, 0);
    assert.ok(plan.skipped.some((s) => s.source === 'fhi' && s.carriedForward === false));
  });
});

describe('planBuild — (f) kilder som ikke bygges denne kjøringen', () => {
  // Per-kilde-oppdatering: hver kilde har sitt eget publiseringstidspunkt og
  // sin egen cron. Da bygges ÉN kilde om gangen, og de andre må stå urørt i
  // manifestet — ellers forsvinner de fra portalen selv om shard-filene ligger
  // på disk.
  it('bærer ikke-forespurte kilders shards verbatim videre', async () => {
    const { planBuild } = await mod;
    const forrigeSsb = manifestEntry('ssb', 7747, 'ssb-no-deadbeef.json');
    const forrigeFhi = manifestEntry('fhi', 370, 'fhi-no-cafebabe.json');
    const previousManifest = {
      format: 1,
      generatedAt: '2026-07-21T03:00:00.000Z',
      shards: [forrigeSsb, manifestEntry('nb', 31, 'nb-no-01020304.json'), forrigeFhi],
    };

    const plan = await planBuild({
      sources: [
        { key: 'ssb', lang: 'no', primary: true, carryForward: true },
        { key: 'nb', lang: 'no', build: async () => rows(31, '9') },
        { key: 'fhi', lang: 'no', carryForward: true },
      ],
      previousManifest,
      // Terskelen skal ikke slå til på en videreført primærkilde — den bygges
      // jo ikke, så det finnes ingen radliste å måle.
      minTables: 5000,
      maxShrink: 10,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, true, `Videreføring skal ikke velte kjøringen: ${JSON.stringify(plan.errors)}`);
    // Bare NB ble faktisk bygget...
    assert.deepEqual(plan.shards.map((s) => s.source), ['nb']);
    // ...men manifestet beskriver fortsatt alle tre.
    assert.deepEqual(plan.manifest.shards.map((s) => s.source), ['ssb', 'nb', 'fhi']);
    assert.deepEqual(plan.manifest.shards.find((s) => s.source === 'ssb'), forrigeSsb);
    assert.deepEqual(plan.manifest.shards.find((s) => s.source === 'fhi'), forrigeFhi);
    // Videreføring er ikke en feil.
    assert.deepEqual(plan.errors, []);
  });

  it('hopper over en ikke-forespurt kilde som ikke har noe tidligere shard', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [
        ssbSource(rows(100)),
        { key: 'fhi', lang: 'no', carryForward: true },
      ],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.manifest.shards.map((s) => s.source), ['ssb']);
    assert.deepEqual(plan.errors, []);
  });

  it('bygger kilden når carryForward ikke er satt (uendret oppførsel)', async () => {
    const { planBuild } = await mod;
    const plan = await planBuild({
      sources: [ssbSource(rows(100)), { key: 'nb', lang: 'no', build: async () => rows(31, '9') }],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      log: () => {}, warn: () => {},
    });

    assert.deepEqual(plan.shards.map((s) => s.source), ['ssb', 'nb']);
  });
});

describe('buildCatalogIndex — (d) SSB-feil skriver ingenting', () => {
  it('kaller aldri writeren når SSB-hentingen feiler', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    const res = await buildCatalogIndex({
      sources: [
        { key: 'ssb', lang: 'no', primary: true, build: async () => { throw new Error('API-feil 503'); } },
        { key: 'nb', lang: 'no', build: async () => rows(31, '9') },
      ],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      log: () => {}, warn: () => {},
    });

    assert.equal(res.ok, false);
    assert.equal(writer.writes.length, 0, 'ingen filer skal skrives ved SSB-feil');
    assert.equal(writer.removes.length, 0, 'ingen filer skal slettes ved SSB-feil');
  });

  it('kaller aldri writeren når --min-tables-guarden slår til', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    const res = await buildCatalogIndex({
      sources: [ssbSource(rows(83))],
      previousManifest: null,
      minTables: 5000,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      log: () => {}, warn: () => {},
    });

    assert.equal(res.ok, false);
    assert.equal(writer.writes.length, 0);
  });

  it('skriver ingenting i --dry-run, men rapporterer plana', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    const res = await buildCatalogIndex({
      sources: [ssbSource(rows(100))],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      dryRun: true,
      log: () => {}, warn: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.plan.shards.length, 1);
    assert.equal(writer.writes.length, 0);
  });
});

describe('buildCatalogIndex — (e) skriverekkefølgen', () => {
  it('skriver catalog-manifest.json aller sist', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    const res = await buildCatalogIndex({
      sources: [
        ssbSource(rows(100)),
        { key: 'nb', lang: 'no', build: async () => rows(31, '9') },
      ],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      log: () => {}, warn: () => {},
    });

    assert.equal(res.ok, true);
    const names = writer.names();
    assert.equal(names[names.length - 1], 'catalog-manifest.json',
      `manifestet må være siste skriv, fikk rekkefølgen: ${names.join(', ')}`);

    // ...og byggerens egen sporing rett før det, etter alle shard-filene.
    const iIndex = names.indexOf('.index-manifest.json');
    assert.ok(iIndex >= 0, '.index-manifest.json skal skrives');
    assert.ok(iIndex < names.length - 1);

    // Alle shard-filer (+ .br-tvillingene) skal ligge FØR begge manifestene.
    const shardNames = names.filter((n) => /^(ssb|nb)-no-[0-9a-f]{8}\.json(\.br)?$/.test(n));
    assert.equal(shardNames.length, 4, `forventet 2 shards × (json + br), fikk: ${names.join(', ')}`);
    for (const n of shardNames) assert.ok(names.indexOf(n) < iIndex);
  });

  it('skriver .br-tvillingen ved siden av hvert shard', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    await buildCatalogIndex({
      sources: [ssbSource(rows(10))],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      log: () => {}, warn: () => {},
    });

    const names = writer.names();
    const json = names.find((n) => /^ssb-no-[0-9a-f]{8}\.json$/.test(n));
    assert.ok(json, `fant ingen ssb-shard i ${names.join(', ')}`);
    assert.ok(names.includes(`${json}.br`), 'brotli-tvillingen mangler');
  });
});

describe('buildCatalogIndex — generasjoner og selveierskap', () => {
  it('sletter kun filer byggeren selv har skrevet, og bare utenfor keep-vinduet', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    const indexManifest = {
      format: 1,
      generations: [
        { generatedAt: '2026-07-21T03:00:00.000Z', files: ['ssb-no-gen1.json', 'ssb-no-gen1.json.br'] },
        { generatedAt: '2026-07-14T03:00:00.000Z', files: ['ssb-no-gen2.json', 'ssb-no-gen2.json.br'] },
        { generatedAt: '2026-07-07T03:00:00.000Z', files: ['ssb-no-gen3.json', 'ssb-no-gen3.json.br'] },
      ],
    };

    const res = await buildCatalogIndex({
      sources: [ssbSource(rows(100))],
      previousManifest: null,
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      indexManifest,
      keepGenerations: 2,
      log: () => {}, warn: () => {},
    });

    assert.equal(res.ok, true);
    const removed = writer.removes.map((p) => path.basename(p)).sort();
    // keepGenerations=2 → ny generasjon + gen1 beholdes; gen2 og gen3 ryddes.
    assert.deepEqual(removed,
      ['ssb-no-gen2.json', 'ssb-no-gen2.json.br', 'ssb-no-gen3.json', 'ssb-no-gen3.json.br']);
  });

  it('sletter aldri et shard som fortsatt bæres av manifestet', async () => {
    const { buildCatalogIndex } = await mod;
    const writer = makeWriter();

    const forrigeFhi = manifestEntry('fhi', 370, 'fhi-no-cafebabe.json');
    const res = await buildCatalogIndex({
      sources: [
        ssbSource(rows(100)),
        { key: 'fhi', lang: 'no', build: async () => { throw new Error('nede'); } },
      ],
      previousManifest: { format: 1, generatedAt: GEN_AT, shards: [forrigeFhi] },
      minTables: 0,
      generatedAt: GEN_AT,
      compress: fakeCompress,
      outDir: OUT_DIR,
      writer,
      indexManifest: {
        format: 1,
        generations: [
          { generatedAt: '2026-07-21T03:00:00.000Z', files: ['fhi-no-cafebabe.json', 'fhi-no-cafebabe.json.br'] },
          { generatedAt: '2026-07-14T03:00:00.000Z', files: ['fhi-no-cafebabe.json', 'fhi-no-cafebabe.json.br'] },
          { generatedAt: '2026-07-07T03:00:00.000Z', files: ['fhi-no-cafebabe.json', 'fhi-no-cafebabe.json.br'] },
        ],
      },
      keepGenerations: 1,
      log: () => {}, warn: () => {},
    });

    assert.equal(res.ok, true);
    assert.deepEqual(writer.removes, [],
      'filen manifestet fortsatt peker på må aldri slettes, uansett generasjonsvindu');
  });
});

describe('deriveSnapshotGeneratedAt', () => {
  it('er deterministisk og avledet av radenes egne updated-verdier', async () => {
    const { deriveSnapshotGeneratedAt } = await mod;
    const list = [
      { id: 'a', updated: '2026-01-01T00:00:00Z' },
      { id: 'b', updated: '2026-07-21T06:00:00Z' },
      { id: 'c', updated: '' },
    ];
    const first = deriveSnapshotGeneratedAt(list);
    assert.equal(first, deriveSnapshotGeneratedAt(list.slice().reverse()));
    assert.equal(first, new Date('2026-07-21T06:00:00Z').toISOString());
  });

  it('faller tilbake til epoken når ingen rad har updated', async () => {
    const { deriveSnapshotGeneratedAt } = await mod;
    assert.equal(deriveSnapshotGeneratedAt([{ id: 'a' }]), '1970-01-01T00:00:00.000Z');
  });
});
