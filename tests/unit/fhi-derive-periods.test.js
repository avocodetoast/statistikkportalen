/**
 * fhi-adapter.js — extension.periods (derivePeriods) skal normaliseres til
 * SSB-form, ellers ville «Tidsperiode»-kolonnen falle tilbake til FHIs
 * råformat i det brukeren åpner tabellen: derivePeriods friskes opp mot live
 * /dimension, og BrowserState.syncTablePeriodsFromMetadata skriver resultatet
 * tilbake i tabellista over den normaliserte katalogverdien.
 *
 * Dimensjonen speiler ekte sysvak-324 (verdikode «2024.17», etikett
 * «2024 -uke 17»). Ingen innspilt FHI-fixture finnes, så strukturen bygges
 * inline som i de øvrige fhi-*-testene.
 *
 * Egen testfil: adapteren memoiserer katalogfil-promiset (getCatalog), så en
 * test med FUNGERENDE katalogfil kan ikke dele prosess med tester uten.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const CATALOG = {
  generatedAt: '2026-07-18T00:00:00Z',
  sources: {
    sysvak: {
      title: 'Nasjonalt vaksinasjonsregister (SYSVAK)',
      tables: [
        { tableId: 324, title: 'Influensavaksinasjon, sesongen 2024/2025 (ukestall)',
          description: '', firstPeriod: '2024U17', lastPeriod: '2025U22',
          timeUnit: 'Weekly', variableNames: ['Uke'], updated: '2026-01-05T08:00:00Z' },
        { tableId: 750, title: 'Koronavaksinasjon (årlige tall)', description: '',
          firstPeriod: '2024/2025', lastPeriod: '2024/2025', timeUnit: null,
          variableNames: ['Årstall'], updated: '2026-01-05T08:00:00Z' }
      ]
    }
  }
};

const TABLE_ROWS = [
  { tableId: 324, title: 'SYSVAK influensavaksinasjon 24/25',
    publishedAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-05T08:00:00Z' },
  { tableId: 750, title: 'SYSVAK korona årlig',
    publishedAt: '2026-01-01T00:00:00Z', modifiedAt: '' }
];

/** sysvak-324: ukesdimensjon der etiketten er FHIs lange form. */
const WEEKLY_DIMENSIONS = {
  dimensions: [
    {
      code: 'Geografi', label: 'Geografi',
      categories: [{ value: '0', label: 'Hele landet' }]
    },
    {
      code: 'Uke', label: 'Uke',
      categories: [
        { value: '2024.17', label: '2024 -uke 17' },
        { value: '2024.18', label: '2024 -uke 18' },
        { value: '2025.22', label: '2025 -uke 22' }
      ]
    },
    {
      code: 'MEASURE_TYPE', label: 'Måltall',
      categories: [{ value: 'Antall', label: 'Antall vaksinerte' }]
    }
  ]
};

/** sysvak-750: sesongform («2024/2025») som IKKE skal normaliseres. */
const SEASON_DIMENSIONS = {
  dimensions: [
    {
      code: 'Aarstall', label: 'Årstall',
      categories: [
        { value: '2023/2024', label: '2023/2024' },
        { value: '2024/2025', label: '2024/2025' }
      ]
    },
    {
      code: 'MEASURE_TYPE', label: 'Måltall',
      categories: [{ value: 'Antall', label: 'Antall' }]
    }
  ]
};

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

const app = loadApp(SCRIPTS.sources, {
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('fhi-catalog.json')) return jsonResponse(CATALOG);
    if (u.endsWith('/Common/source')) {
      return jsonResponse([{ id: 'sysvak', title: 'Nasjonalt vaksinasjonsregister (SYSVAK)' }]);
    }
    if (/\/Table\/324\/dimension$/.test(u)) return jsonResponse(WEEKLY_DIMENSIONS);
    if (/\/Table\/750\/dimension$/.test(u)) return jsonResponse(SEASON_DIMENSIONS);
    if (/\/Table\/\d+\/query$/.test(u)) return jsonResponse({ dimensions: [] });
    if (/\/Table\/\d+\/metadata$/.test(u)) return jsonResponse({ paragraphs: [] });
    if (/\/Table\/\d+\/flag$/.test(u)) return jsonResponse([]);
    if (/\/[^/]+\/table$/.test(u)) return jsonResponse(TABLE_ROWS);
    throw new Error('uventet URL i test: ' + u);
  }
});

const adapter = app.SourceAdapters.find(a => a.ownsTableId('fhi-sysvak-324'));

describe('FHI-adapter — extension.periods normaliseres', () => {
  it('ukesetiketter blir yyyyUxx', async () => {
    const meta = await adapter.getTableMetadata('fhi-sysvak-324', false, 'nb');
    assert.deepEqual(meta.extension.periods, { first: '2024U17', last: '2025U22' });
  });

  it('lar verdilisten i variabelvelgeren stå på kildens format', async () => {
    const meta = await adapter.getTableMetadata('fhi-sysvak-324', true, 'nb');
    assert.equal(meta.dimension.Uke.category.label['2024.17'], '2024 -uke 17');
    assert.equal(meta.dimension.Uke.category.label['2025.22'], '2025 -uke 22');
  });

  it('rører ikke sesongperioder («2024/2025»)', async () => {
    const meta = await adapter.getTableMetadata('fhi-sysvak-750', false, 'nb');
    assert.deepEqual(meta.extension.periods, { first: '2023/2024', last: '2024/2025' });
  });
});
