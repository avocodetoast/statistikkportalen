/**
 * Atomisk filskriving — den delte tmp-fil + rename-rutinen.
 *
 * HVORFOR: alle byggescriptene i scripts/ skriver filer som noen andre leser
 * samtidig (nginx serverer webroot, appen leser data/sources/, en parallell
 * kjøring leser forrige generasjon). En rå fs.writeFileSync gjør målfila
 * synlig i halvskrevet tilstand mens skrivingen pågår — en leser som treffer
 * det vinduet får et avkortet JSON-dokument. rename(2) er atomisk innenfor
 * samme filsystem, så leseren ser enten hele det gamle eller hele det nye
 * innholdet.
 *
 * Rutinen lå tidligere ordrett duplisert i generate-seo-pages.mjs,
 * update-nb-periods.mjs og update-fhi-catalog.mjs. Den bor her nå; de tre
 * importerer den.
 *
 * Ren ESM. fsImpl-parameteren er en testsøm (tests/unit/atomic-write.test.js
 * asserterer rekkefølgen writeFileSync → renameSync) — produksjonskallene
 * sender den aldri.
 */

import fs from 'node:fs';

/**
 * Skriv innhold til filePath atomisk (tmp-fil ved siden av, så rename).
 *
 * @param {string} filePath - Målfilen.
 * @param {string|Buffer} content - Innholdet. Buffer brukes for .br-tvillingene.
 * @param {object} [fsImpl] - fs-modulen (injiserbar for test).
 */
export function atomicWrite(filePath, content, fsImpl = fs) {
  const tmp = `${filePath}.tmp`;
  // 'utf8' ignoreres av Node når content er en Buffer, så samme kall dekker
  // både tekst- og binærskriving.
  fsImpl.writeFileSync(tmp, content, 'utf8');
  fsImpl.renameSync(tmp, filePath);
}

/**
 * Skriv et objekt som pent formatert JSON, atomisk.
 *
 * @param {string} filePath - Målfilen.
 * @param {*} obj - Verdien som serialiseres.
 * @param {object} [fsImpl] - fs-modulen (injiserbar for test).
 */
export function writeJsonAtomic(filePath, obj, fsImpl = fs) {
  atomicWrite(filePath, `${JSON.stringify(obj, null, 2)}\n`, fsImpl);
}
