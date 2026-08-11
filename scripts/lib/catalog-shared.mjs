/** ESM-tilgang til den avhengighetsfrie browserfila for byggescriptene. */
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = new URL('../../js/sources/catalog-shared.js', import.meta.url);
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(SOURCE, 'utf8'), sandbox, {
  filename: 'js/sources/catalog-shared.js'
});

export const CatalogShared = sandbox.window.CatalogShared;
export const SUBJECT_SORTCODE = CatalogShared.SUBJECT_SORTCODE;

// Flytt resultatene tilbake til Node-realmens prototyper. Selve byggelogikken
// forblir browserfilas; dette gjør bare objektene naturlige for ESM-konsumenter.
export const buildPathSegments = (...args) =>
  structuredClone(CatalogShared.buildPathSegments(...args));
export const buildNbRows = (...args) =>
  structuredClone(CatalogShared.buildNbRows(...args));
export const buildFhiRows = (...args) =>
  structuredClone(CatalogShared.buildFhiRows(...args));
