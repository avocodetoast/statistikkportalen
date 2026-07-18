/**
 * scripts/lib/fhi-curation.mjs — fletting av håndkuratert tittel-/kategorifil
 * (data/sources/fhi-curation.json) inn i den API-byggede FHI-katalogen
 * (scripts/update-fhi-catalog.mjs). Kurateringen skal overleve regenerering:
 * byggescriptet henter alt på nytt fra API-et og fletter kurateringen inn på
 * toppen ved hver kjøring.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// CJS kan ikke require() en ESM-modul — dynamisk import, delt promise.
const mod = import('../../scripts/lib/fhi-curation.mjs');

function builtSource() {
  return {
    title: 'Medisinsk fødselsregister (MFR)',
    tables: [
      { tableId: 411, title: 'F0: Fødte og fødsler per år og måned', internalName: 'F0: Fødte og fødsler per år og måned', description: 'x', firstPeriod: '1967', lastPeriod: '2025', timeUnit: 'Annual', variableNames: [], updated: '2026-01-01' },
      { tableId: 448, title: 'Is3d: Fødsler ved institusjon', internalName: 'Is3d: Fødsler ved institusjon', description: 'y', firstPeriod: '', lastPeriod: '', timeUnit: null, variableNames: [], updated: '' }
    ]
  };
}

describe('applyCuration', () => {
  it('returnerer bygget kilde uendret uten kuratering', async () => {
    const { applyCuration } = await mod;
    const built = builtSource();
    const out = applyCuration(built, null);
    assert.deepEqual(out, built);
    assert.equal(out.categories, undefined);
  });

  it('overstyrer tittel og beholder internalName; kobler kategori', async () => {
    const { applyCuration } = await mod;
    const warnings = [];
    const out = applyCuration(builtSource(), {
      categories: {
        fodsler: { label: 'Fødsler og fødte', sortCode: '010' },
        institusjon: { label: 'Fødeinstitusjoner', sortCode: '020' }
      },
      tables: {
        411: { title: 'Fødte og fødsler, etter år og måned', category: 'fodsler' },
        448: { category: 'institusjon' }
      }
    }, m => warnings.push(m));

    const t411 = out.tables.find(t => t.tableId === 411);
    assert.equal(t411.title, 'Fødte og fødsler, etter år og måned');
    assert.equal(t411.internalName, 'F0: Fødte og fødsler per år og måned');
    assert.equal(t411.category, 'fodsler');

    const t448 = out.tables.find(t => t.tableId === 448);
    assert.equal(t448.title, 'Is3d: Fødsler ved institusjon', 'uten tittel-overstyring beholdes utledet tittel');
    assert.equal(t448.category, 'institusjon');

    assert.deepEqual(out.categories, {
      fodsler: { label: 'Fødsler og fødte', sortCode: '010' },
      institusjon: { label: 'Fødeinstitusjoner', sortCode: '020' }
    });
    assert.deepEqual(warnings, [], 'fullt kuratert kilde skal ikke gi advarsler');
  });

  it('muterer ikke input-objektet', async () => {
    const { applyCuration } = await mod;
    const built = builtSource();
    const before = JSON.stringify(built);
    applyCuration(built, {
      categories: { c: { label: 'C', sortCode: '010' } },
      tables: { 411: { title: 'Ny', category: 'c' } }
    });
    assert.equal(JSON.stringify(built), before);
  });

  it('advarer om ukjent kategori-referanse og setter den ikke', async () => {
    const { applyCuration } = await mod;
    const warnings = [];
    const out = applyCuration(builtSource(), {
      categories: { fodsler: { label: 'Fødsler', sortCode: '010' } },
      tables: { 411: { category: 'finnes-ikke' }, 448: { category: 'fodsler' } }
    }, m => warnings.push(m));
    assert.equal(out.tables.find(t => t.tableId === 411).category, undefined);
    assert.ok(warnings.some(m => m.includes('finnes-ikke')), warnings.join('; '));
  });

  it('advarer om kuraterte tabell-id-er som ikke finnes i API-katalogen', async () => {
    const { applyCuration } = await mod;
    const warnings = [];
    applyCuration(builtSource(), {
      tables: { 99999: { title: 'Borte' } }
    }, m => warnings.push(m));
    assert.ok(warnings.some(m => m.includes('99999')), warnings.join('; '));
  });

  it('advarer med antall ukategoriserte tabeller når kilden har kategorier', async () => {
    const { applyCuration } = await mod;
    const warnings = [];
    applyCuration(builtSource(), {
      categories: { fodsler: { label: 'Fødsler', sortCode: '010' } },
      tables: { 411: { category: 'fodsler' } }
    }, m => warnings.push(m));
    assert.ok(warnings.some(m => m.includes('448')),
      'ukategoriserte tabell-id-er skal listes: ' + warnings.join('; '));
  });
});
