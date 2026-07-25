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
