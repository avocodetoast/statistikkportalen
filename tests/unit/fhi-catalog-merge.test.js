/**
 * scripts/lib/fhi-catalog-merge.mjs — inkrementell oppdatering av
 * data/sources/fhi-catalog.json.
 *
 * FHI har ingen bulk-vei til periode/metadata (ett kall per tabell), så full
 * regenerering er ~740 kall. Inkrementell kjøring henter kun de tabellene som
 * er nye eller har fått ny modifiedAt, og fletter dem inn i den eksisterende
 * katalogen. Rene funksjoner — ingen I/O.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const importMerge = () => import('../../scripts/lib/fhi-catalog-merge.mjs');

const existing = [
  { tableId: 1, title: 'Uendret', internalName: 'A_1', firstPeriod: '2000', lastPeriod: '2024' },
  { tableId: 2, title: 'Endret', internalName: 'A_2', firstPeriod: '2000', lastPeriod: '2023' },
  { tableId: 3, title: 'Fjernet', internalName: 'A_3', firstPeriod: '1990', lastPeriod: '2010' }
];

const liveRows = [
  { tableId: 1, title: 'A_1', modifiedAt: '2026-01-01T00:00:00Z' },
  { tableId: 2, title: 'A_2', modifiedAt: '2026-07-20T00:00:00Z' },
  { tableId: 4, title: 'A_4', modifiedAt: '2026-07-21T00:00:00Z' }
];

describe('selectStaleTableIds', () => {
  it('velger tabeller endret etter cutoff', async () => {
    const { selectStaleTableIds } = await importMerge();
    const ids = selectStaleTableIds(existing, liveRows, '2026-07-18T00:00:00Z');
    assert.ok(ids.includes(2), 'modifiedAt nyere enn cutoff → re-probes');
    assert.ok(!ids.includes(1), 'uendret tabell hoppes over');
  });

  it('velger alltid tabeller som ikke finnes i katalogen fra før', async () => {
    const { selectStaleTableIds } = await importMerge();
    const ids = selectStaleTableIds(existing, liveRows, '2026-07-18T00:00:00Z');
    assert.ok(ids.includes(4), 'ny tabell → probes uansett modifiedAt');
  });

  it('faller tilbake til publishedAt når modifiedAt mangler', async () => {
    const { selectStaleTableIds } = await importMerge();
    const rows = [{ tableId: 1, publishedAt: '2026-07-20T00:00:00Z' }];
    assert.deepEqual(selectStaleTableIds(existing, rows, '2026-07-18T00:00:00Z'), [1]);
  });

  it('re-prober en tabell uten dato-felt i det hele tatt (kan ikke avgjøres)', async () => {
    const { selectStaleTableIds } = await importMerge();
    const rows = [{ tableId: 1 }];
    assert.deepEqual(selectStaleTableIds(existing, rows, '2026-07-18T00:00:00Z'), [1]);
  });

  it('gir tom liste når ingenting er endret', async () => {
    const { selectStaleTableIds } = await importMerge();
    const rows = [{ tableId: 1, modifiedAt: '2026-01-01T00:00:00Z' }];
    assert.deepEqual(selectStaleTableIds(existing, rows, '2026-07-18T00:00:00Z'), []);
  });
});

describe('mergeCatalogSource', () => {
  const probed = [
    { tableId: 2, title: 'Endret (ny)', internalName: 'A_2', firstPeriod: '2000', lastPeriod: '2025' },
    { tableId: 4, title: 'Ny tabell', internalName: 'A_4', firstPeriod: '2020', lastPeriod: '2025' }
  ];

  it('beholder uendrede rader ordrett', async () => {
    const { mergeCatalogSource } = await importMerge();
    const { tables } = mergeCatalogSource(existing, liveRows, probed);
    assert.deepEqual(tables.find(t => t.tableId === 1), existing[0]);
  });

  it('erstatter probede rader', async () => {
    const { mergeCatalogSource } = await importMerge();
    const { tables } = mergeCatalogSource(existing, liveRows, probed);
    assert.equal(tables.find(t => t.tableId === 2).lastPeriod, '2025');
  });

  it('legger til nye rader og fjerner rader som ikke lenger finnes i API-et', async () => {
    const { mergeCatalogSource } = await importMerge();
    const { tables, added, updated, removed } = mergeCatalogSource(existing, liveRows, probed);
    assert.deepEqual(tables.map(t => t.tableId), [1, 2, 4], 'sortert på tableId');
    assert.deepEqual(added, [4]);
    assert.deepEqual(updated, [2]);
    assert.deepEqual(removed, [3]);
  });

  it('tomt delta gir en identisk katalog', async () => {
    const { mergeCatalogSource } = await importMerge();
    const rows = existing.map(t => ({ tableId: t.tableId, modifiedAt: '2026-01-01T00:00:00Z' }));
    const { tables, added, updated, removed } = mergeCatalogSource(existing, rows, []);
    assert.deepEqual(tables, existing);
    assert.deepEqual([added, updated, removed], [[], [], []]);
  });

  it('muterer ikke input', async () => {
    const { mergeCatalogSource } = await importMerge();
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergeCatalogSource(existing, liveRows, probed);
    assert.deepEqual(existing, snapshot);
  });

  it('hopper over en live-rad som verken er probet eller finnes fra før', async () => {
    const { mergeCatalogSource } = await importMerge();
    const rows = liveRows.concat([{ tableId: 9, modifiedAt: '2026-07-22T00:00:00Z' }]);
    const { tables } = mergeCatalogSource(existing, rows, probed);
    assert.ok(!tables.some(t => t.tableId === 9));
  });

  it('sammenligner tabell-id-er på tvers av tall og streng', async () => {
    const { mergeCatalogSource } = await importMerge();
    const { tables, updated } = mergeCatalogSource(
      [{ tableId: '2', title: 'Streng-id', lastPeriod: '2023' }],
      [{ tableId: 2, modifiedAt: '2026-07-20T00:00:00Z' }],
      [{ tableId: 2, title: 'Tall-id', lastPeriod: '2025' }]
    );
    assert.equal(tables.length, 1);
    assert.equal(tables[0].lastPeriod, '2025');
    assert.deepEqual(updated, [2]);
  });
});

/**
 * Passet kjører over HELE katalogen (ikke bare de nyhentede radene), fordi en
 * --incremental-kjøring beholder uendrede rader ordrett: uten dette ville de
 * bli liggende på FHIs råformat til neste fulle regenerering (~740 kall).
 * Radene er de faktiske formene i data/sources/fhi-catalog.json.
 */
describe('normalizeCatalogPeriods', () => {
  const rows = () => [
    { tableId: 324, firstPeriod: '2024 -uke 17', lastPeriod: '2025 -uke 22',
      timeUnit: null, variableNames: ['Geografi', 'Aldersgruppe', 'Uke', 'Måltall'] },
    { tableId: 724, firstPeriod: '2024-w40', lastPeriod: '2026-w29',
      timeUnit: null, variableNames: ['År og uke', 'Aldersgruppe', 'Måltall'] },
    { tableId: 733, firstPeriod: '2021-01', lastPeriod: '2026-30',
      timeUnit: null, variableNames: ['Smittestoff', 'Prøveår og uke', 'Måltall'] },
    { tableId: 832, firstPeriod: 'Oktober 2025', lastPeriod: 'April 2026',
      timeUnit: null, variableNames: ['Måned', 'Pangolin-nomenklatur', 'Måltall'] },
    { tableId: 785, firstPeriod: '2023 1.tertial', lastPeriod: '2025 3.tertial',
      timeUnit: null, variableNames: ['Periode (År, Tertial)', 'Behandlingssted'] },
    { tableId: 917, firstPeriod: '2025-26', lastPeriod: '2025-26',
      timeUnit: null, variableNames: ['RSV A', 'Sesong', 'Måltall'] },
    { tableId: 268, firstPeriod: '1986', lastPeriod: '2025*',
      timeUnit: 'Annual', variableNames: ['Dødsår', 'Bofylke', 'Måltall'] },
    { tableId: 342, firstPeriod: '1990-1999', lastPeriod: '2015-2024',
      timeUnit: null, variableNames: ['Geografi', 'År', 'Måltall'] }
  ];

  const byId = (tables, id) => tables.find(t => t.tableId === id);

  it('normaliserer alle uke- og månedsformene', async () => {
    const { normalizeCatalogPeriods } = await importMerge();
    const out = normalizeCatalogPeriods(rows());
    assert.deepEqual(
      [byId(out, 324).firstPeriod, byId(out, 324).lastPeriod], ['2024U17', '2025U22']);
    assert.deepEqual(
      [byId(out, 724).firstPeriod, byId(out, 724).lastPeriod], ['2024U40', '2026U29']);
    assert.deepEqual(
      [byId(out, 733).firstPeriod, byId(out, 733).lastPeriod], ['2021U01', '2026U30']);
    assert.deepEqual(
      [byId(out, 832).firstPeriod, byId(out, 832).lastPeriod], ['2025M10', '2026M04']);
    assert.deepEqual(
      [byId(out, 785).firstPeriod, byId(out, 785).lastPeriod], ['2023T1', '2025T3']);
  });

  it('utleder Weekly/Monthly, men overstyrer aldri en fastslått frekvens', async () => {
    const { normalizeCatalogPeriods } = await importMerge();
    const out = normalizeCatalogPeriods(rows());
    assert.equal(byId(out, 324).timeUnit, 'Weekly');
    assert.equal(byId(out, 733).timeUnit, 'Weekly');
    assert.equal(byId(out, 832).timeUnit, 'Monthly');
    assert.equal(byId(out, 785).timeUnit, null, 'tertial får ingen frekvens');
    assert.equal(byId(out, 268).timeUnit, 'Annual', 'Annual fra deriveTimeInfo står');
  });

  it('lar sesong, flerårige snitt og enkeltår stå urørt', async () => {
    const { normalizeCatalogPeriods } = await importMerge();
    const out = normalizeCatalogPeriods(rows());
    assert.deepEqual(
      [byId(out, 917).firstPeriod, byId(out, 917).lastPeriod], ['2025-26', '2025-26']);
    assert.equal(byId(out, 917).timeUnit, null);
    assert.deepEqual(
      [byId(out, 342).firstPeriod, byId(out, 342).lastPeriod], ['1990-1999', '2015-2024']);
    assert.deepEqual(
      [byId(out, 268).firstPeriod, byId(out, 268).lastPeriod], ['1986', '2025*']);
  });

  it('er idempotent og muterer ikke input', async () => {
    const { normalizeCatalogPeriods } = await importMerge();
    const input = rows();
    const snapshot = JSON.parse(JSON.stringify(input));
    const once = normalizeCatalogPeriods(input);
    assert.deepEqual(input, snapshot, 'input uendret');
    assert.deepEqual(normalizeCatalogPeriods(once), once);
  });

  it('tåler rader uten perioder eller variableNames', async () => {
    const { normalizeCatalogPeriods } = await importMerge();
    const out = normalizeCatalogPeriods([{ tableId: 1, firstPeriod: '', lastPeriod: '' }]);
    assert.deepEqual(out[0], { tableId: 1, firstPeriod: '', lastPeriod: '' });
  });
});
