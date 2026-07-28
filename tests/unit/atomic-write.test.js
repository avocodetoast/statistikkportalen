/**
 * scripts/lib/atomic-write.mjs — den delte tmp-fil + rename-skrivingen som
 * generate-seo-pages.mjs, update-nb-periods.mjs, update-fhi-catalog.mjs og
 * build-catalog-index.mjs alle bruker.
 *
 * HVORFOR TESTES DETTE: hele poenget er at målfila ALDRI finnes i halvskrevet
 * tilstand — en leser (nginx, appen, en parallell byggekjøring) skal se enten
 * gammelt eller nytt innhold, aldri et avkortet dokument. Det er en egenskap
 * ved REKKEFØLGEN av fs-kallene, ikke ved sluttresultatet, så den asserteres
 * mot en injisert fs-fake. Den ekte disken dekkes av en runde i en midlertidig
 * mappe under.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mod = import('../../scripts/lib/atomic-write.mjs');

describe('atomicWrite', () => {
  it('skriver til en tmp-fil og renamer den på plass — aldri direkte på målet', async () => {
    const { atomicWrite } = await mod;
    const calls = [];
    const fsFake = {
      writeFileSync: (p, content, enc) => calls.push(['writeFileSync', p, String(content), enc]),
      renameSync: (from, to) => calls.push(['renameSync', from, to]),
    };

    atomicWrite('/ut/katalog.json', '{"a":1}', fsFake);

    assert.equal(calls.length, 2);
    const [write, rename] = calls;
    assert.equal(write[0], 'writeFileSync');
    assert.notEqual(write[1], '/ut/katalog.json', 'må aldri skrive rett på målfila');
    assert.equal(write[2], '{"a":1}');
    assert.equal(rename[0], 'renameSync');
    assert.equal(rename[1], write[1], 'renamer nøyaktig fila som ble skrevet');
    assert.equal(rename[2], '/ut/katalog.json');
  });

  it('lander innholdet på disk og etterlater ingen tmp-fil', async () => {
    const { atomicWrite } = await mod;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
    try {
      const target = path.join(dir, 'fil.txt');
      atomicWrite(target, 'hei');
      assert.equal(fs.readFileSync(target, 'utf8'), 'hei');
      assert.deepEqual(fs.readdirSync(dir), ['fil.txt']);

      // Overskriving skal også være atomisk og etterlate ryddig tilstand.
      atomicWrite(target, 'hei igjen');
      assert.equal(fs.readFileSync(target, 'utf8'), 'hei igjen');
      assert.deepEqual(fs.readdirSync(dir), ['fil.txt']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tåler Buffer-innhold (brotli-tvillingene er binære)', async () => {
    const { atomicWrite } = await mod;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
    try {
      const target = path.join(dir, 'fil.bin');
      atomicWrite(target, Buffer.from([0x1b, 0x00, 0xff]));
      assert.deepEqual([...fs.readFileSync(target)], [0x1b, 0x00, 0xff]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writeJsonAtomic', () => {
  it('skriver pent formatert JSON atomisk', async () => {
    const { writeJsonAtomic } = await mod;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
    try {
      const target = path.join(dir, 'manifest.json');
      writeJsonAtomic(target, { format: 1, shards: [] });
      const raw = fs.readFileSync(target, 'utf8');
      assert.deepEqual(JSON.parse(raw), { format: 1, shards: [] });
      assert.match(raw, /\n/, 'JSON skal være innrykket, ikke én lang linje');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
