/**
 * js/period-format.js — normalisering av periodestrenger til SSBs form
 * (yyyyUxx / yyyyMxx / yyyyTx) for tabelloversiktenes «Tidsperiode»-kolonne.
 *
 * Casene er de FAKTISKE strengene i data/sources/fhi-catalog.json (370
 * tabeller kartlagt): fem ulike former for uke/måned/tertial, pluss former
 * som IKKE skal røres (sesong, skoleår, flerårige snitt).
 *
 * Den viktigste egenskapen som testes: `2025-26` (Sesong, ngs-917) har
 * nøyaktig samme form som ukekoden `2021-01` (Prøveår og uke, msis-733).
 * Disambigueringen kan derfor ikke gjøres på verdien alene — den må bruke
 * navnet på tidsvariabelen (hint).
 *
 * scripts/lib/period-format.mjs laster den SAMME fila (vm), så byggescriptet
 * og nettleseren aldri kan drifte fra hverandre; siste describe-blokk vokter
 * at loaderen faktisk virker.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/app-env.js');

const app = loadApp(['js/period-format.js']);
const { normalizePeriod, classifyTimeUnit } = app.PeriodFormat;

// CJS kan ikke require() en ESM-modul — dynamisk import, delt promise.
const mjs = import('../../scripts/lib/period-format.mjs');

describe('normalizePeriod — uke', () => {
  it('sysvak: «2024 -uke 17» → 2024U17', () => {
    assert.equal(normalizePeriod('2024 -uke 17', 'Uke'), '2024U17');
    assert.equal(normalizePeriod('2025 -uke 22', 'Uke'), '2025U22');
  });

  it('tåler skrivemåtevariantene av samme form', () => {
    assert.equal(normalizePeriod('2024 uke 17', 'Uke'), '2024U17');
    assert.equal(normalizePeriod('2024-uke 17', 'Uke'), '2024U17');
    assert.equal(normalizePeriod('2024 - uke 7', 'Uke'), '2024U07');
  });

  it('msis: «2024-w40» → 2024U40 (også uten bindestrek)', () => {
    assert.equal(normalizePeriod('2024-w40', 'År og uke'), '2024U40');
    assert.equal(normalizePeriod('2026-w29', 'År og uke'), '2026U29');
    assert.equal(normalizePeriod('2024w40', 'År og uke'), '2024U40');
  });

  it('nullpadder ensifrede ukenumre', () => {
    assert.equal(normalizePeriod('2024-w4', 'År og uke'), '2024U04');
    assert.equal(normalizePeriod('2024 -uke 5', 'Uke'), '2024U05');
  });

  it('sysvak-kodeformen «2024.17» krever et uke-hint', () => {
    assert.equal(normalizePeriod('2024.17', 'Uke'), '2024U17');
    assert.equal(normalizePeriod('2024.17', 'Sesong'), null);
  });

  it('msis: «2021-01» → 2021U01 når hintet nevner uke', () => {
    assert.equal(normalizePeriod('2021-01', 'Prøveår og uke'), '2021U01');
    assert.equal(normalizePeriod('2026-30', 'Prøveår og uke'), '2026U30');
  });

  it('avviser ugyldige ukenumre', () => {
    assert.equal(normalizePeriod('2024 -uke 54', 'Uke'), null);
    assert.equal(normalizePeriod('2024 -uke 0', 'Uke'), null);
    assert.equal(normalizePeriod('2024-w99', 'År og uke'), null);
  });
});

describe('normalizePeriod — måned', () => {
  it('ngs: norske månedsnavn → yyyyMxx', () => {
    assert.equal(normalizePeriod('Oktober 2025', 'Måned'), '2025M10');
    assert.equal(normalizePeriod('April 2026', 'Måned'), '2026M04');
    assert.equal(normalizePeriod('Februar 2020', 'Måned'), '2020M02');
    assert.equal(normalizePeriod('Desember 2025', 'Måned'), '2025M12');
  });

  it('er ufølsom for store/små bokstaver og godtar engelske navn', () => {
    assert.equal(normalizePeriod('mars 2026', 'Måned'), '2026M03');
    assert.equal(normalizePeriod('October 2025', 'Month'), '2025M10');
  });

  it('«2025-07» → 2025M07 når hintet nevner måned', () => {
    assert.equal(normalizePeriod('2025-07', 'Måned'), '2025M07');
    assert.equal(normalizePeriod('2025-13', 'Måned'), null);
  });
});

describe('normalizePeriod — tertial', () => {
  it('npr: «2023 1.tertial» → 2023T1', () => {
    assert.equal(normalizePeriod('2023 1.tertial', 'Periode (År, Tertial)'), '2023T1');
    assert.equal(normalizePeriod('2025 3. tertial', 'Periode (År, Tertial)'), '2025T3');
  });

  it('avviser tertial utenfor 1–3', () => {
    assert.equal(normalizePeriod('2023 4.tertial', 'Periode (År, Tertial)'), null);
  });
});

describe('normalizePeriod — former som skal være urørt', () => {
  it('sesong «2025-26» disambigueres bort fra uke', () => {
    assert.equal(normalizePeriod('2025-26', 'Sesong'), null);
  });

  it('skoleår, flerårige snitt og enkeltår røres ikke', () => {
    assert.equal(normalizePeriod('2022/23', 'Skoleår'), null);
    assert.equal(normalizePeriod('2022/23-2024/25', 'Skoleår'), null);
    assert.equal(normalizePeriod('2015/2016', 'Årstall'), null);
    assert.equal(normalizePeriod('Skoleåret 2006/07', 'Skoleår'), null);
    assert.equal(normalizePeriod('1990-1999', 'År'), null);
    assert.equal(normalizePeriod('2024', 'År'), null);
    assert.equal(normalizePeriod('2025*', 'Dødsår'), null);
  });

  it('degraderer til null for tomme og uparsbare verdier', () => {
    assert.equal(normalizePeriod('', 'Uke'), null);
    assert.equal(normalizePeriod(null, 'Uke'), null);
    assert.equal(normalizePeriod(undefined, undefined), null);
    assert.equal(normalizePeriod('Alle år', 'År'), null);
  });
});

describe('normalizePeriod — idempotens', () => {
  it('lar allerede normaliserte SSB-koder stå', () => {
    assert.equal(normalizePeriod('2024U17', 'Uke'), '2024U17');
    assert.equal(normalizePeriod('2006M01', 'Måned'), '2006M01');
    assert.equal(normalizePeriod('2009K1', 'Kvartal'), '2009K1');
    assert.equal(normalizePeriod('2000H1', 'Halvår'), '2000H1');
    assert.equal(normalizePeriod('2023T1', 'Tertial'), '2023T1');
  });

  it('nullpadder ensifrede uke-/månedsnumre i SSB-form', () => {
    assert.equal(normalizePeriod('2024U7', 'Uke'), '2024U07');
    assert.equal(normalizePeriod('2024M7', 'Måned'), '2024M07');
  });

  it('gir samme resultat når den kjøres på nytt', () => {
    const once = normalizePeriod('2024 -uke 17', 'Uke');
    assert.equal(normalizePeriod(once, 'Uke'), once);
  });
});

describe('classifyTimeUnit', () => {
  it('utleder Weekly og Monthly av normaliserte endepunkter', () => {
    assert.equal(classifyTimeUnit('2024U17', '2025U22'), 'Weekly');
    assert.equal(classifyTimeUnit('2025M10', '2026M04'), 'Monthly');
  });

  it('gir null når endepunktene ikke er entydige uke-/månedskoder', () => {
    assert.equal(classifyTimeUnit('2024', '2025'), null);
    assert.equal(classifyTimeUnit('2023T1', '2025T3'), null);
    assert.equal(classifyTimeUnit('2024U17', '2025M04'), null);
    assert.equal(classifyTimeUnit('2025-26', '2025-26'), null);
    assert.equal(classifyTimeUnit('', ''), null);
    assert.equal(classifyTimeUnit(null, null), null);
  });
});

describe('scripts/lib/period-format.mjs', () => {
  it('eksponerer den samme implementasjonen som nettleserfila', async () => {
    const { normalizePeriod: n, classifyTimeUnit: c, PeriodFormat } = await mjs;
    assert.equal(typeof n, 'function');
    assert.equal(typeof c, 'function');
    assert.equal(n('2024 -uke 17', 'Uke'), '2024U17');
    assert.equal(n('Oktober 2025', 'Måned'), '2025M10');
    assert.equal(n('2025-26', 'Sesong'), null);
    assert.equal(c('2024U17', '2025U22'), 'Weekly');
    assert.equal(PeriodFormat.normalizePeriod('2024-w40', 'År og uke'), '2024U40');
  });
});
