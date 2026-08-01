/**
 * ESM-tilgang til js/period-format.js for byggescriptene.
 *
 * Fila er en klassisk browser-global-modul (window.PeriodFormat) uten
 * avhengigheter, og kjøres her i en tom vm-kontekst med kun `window` — samme
 * teknikk som tests/helpers/app-env.js bruker. Alternativet, en håndsynket
 * kopi av parseren (slik isTimeDim/collectLeafCategories er duplisert i
 * scripts/update-fhi-catalog.mjs), ville betydd ~60 linjer regex i to filer.
 * Katalogen og nettleseren MÅ enes om formatet, så her er én implementasjon
 * verdt det lille lasteapparatet.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = new URL('../../js/period-format.js', import.meta.url);

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(SOURCE, 'utf8'), sandbox, {
  filename: 'js/period-format.js'
});

export const PeriodFormat = sandbox.window.PeriodFormat;
export const normalizePeriod = PeriodFormat.normalizePeriod;
export const classifyTimeUnit = PeriodFormat.classifyTimeUnit;
