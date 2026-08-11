/**
 * Kontrakttester for kilde-dispatchen i scripts/lib/catalog-sources.mjs.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// CJS kan ikke require() en ESM-modul — dynamisk import, delt promise.
const mod = import('../../scripts/lib/catalog-sources.mjs');

describe('buildSourceRows', () => {
  it('kaster en lesbar feil for ukjent adapter', async () => {
    const { buildSourceRows } = await mod;
    const appConfig = {
      sources: {
        ukjent: { adapter: 'framtidig-adapter' },
      },
    };

    await assert.rejects(
      buildSourceRows('ukjent', { appConfig }),
      {
        message: 'Kilden «ukjent» har ukjent adapter «framtidig-adapter» — legg til en gren i scripts/lib/catalog-sources.mjs.',
      },
    );
  });
});
