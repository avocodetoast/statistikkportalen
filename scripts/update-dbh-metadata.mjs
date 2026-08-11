#!/usr/bin/env node
/** Prober årsdekning og dimensjonsverdier for den kuraterte DBH-katalogen. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './lib/atomic-write.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const outArg = process.argv.indexOf('--out');
const delayArg = process.argv.indexOf('--delay');
const OUT = path.resolve(outArg >= 0 ? process.argv[outArg + 1] : path.join(ROOT, 'data/sources/dbh-metadata.json'));
const DELAY = delayArg >= 0 ? Number(process.argv[delayArg + 1]) : 250;
if (!Number.isFinite(DELAY) || DELAY < 0) throw new Error('--delay må være et ikke-negativt tall');

function loadConfig() {
  const sandbox = { window: {} };
  for (const file of ['sources/nb-catalog.js', 'sources/dbh-catalog.js', 'sources/source-topology.js', 'config.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), sandbox);
  }
  return sandbox.window.AppConfig;
}
const pause = () => new Promise(resolve => setTimeout(resolve, DELAY));
async function query(base, table, dim, kodetekst) {
  const body = { tabell_id: table.rawId, api_versjon: 1,
    filter: [{ variabel: dim.code, selection: { filter: 'all', values: ['*'] } }],
    groupBy: [dim.code], sortBy: [dim.code], statuslinje: 'J',
    kodetekst: kodetekst || 'J', desimal_separator: '.' };
  const res = await fetch(base + 'hentJSONTabellData', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body)
  });
  if (res.status === 500 && (kodetekst || 'J') === 'J') {
    // Navnejoinen bak kodetekst:"J" krever institusjonskontekst for enkelte
    // dimensjoner (f.eks. Avdelingskode i 905) og gir 500 alene — prøv uten
    // navnetekster; kodene brukes da som etiketter.
    await pause();
    return query(base, table, dim, 'N');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${table.id}/${dim.code}`);
  const json = await res.json();
  const status = json[0] && json[0].status;
  if (!status || Number(status.returkode) !== 0) throw new Error(`Ugyldig DBH-svar for ${table.id}/${dim.code}`);
  await pause();
  return json.slice(1);
}
function entries(rows, dim) {
  const seen = new Set();
  return rows.reduce((out, row) => {
    if (row[dim.code] == null) return out;
    const code = String(row[dim.code]);
    if (seen.has(code)) return out;
    seen.add(code);
    const labelKey = dim.nameColumn || Object.keys(row).find(key => key !== dim.code && /navn|tekst/i.test(key));
    out.push({ code, label: labelKey && row[labelKey] != null ? String(row[labelKey]) : code });
    return out;
  }, []);
}
async function main() {
  const cfg = loadConfig();
  const base = cfg.sources.dbh.baseUrl;
  const output = { generatedAt: new Date().toISOString(), source: cfg.sources.dbh.branding.name, tables: {} };
  for (const table of cfg.sources.dbh.tables) {
    console.log(`[dbh-metadata] ${table.id}: årsdekning`);
    const years = entries(await query(base, table, table.dimensions[0]), table.dimensions[0]);
    const yearCodes = years.map(v => v.code).sort();
    const dimensions = {};
    dimensions['Årstall'] = years;
    for (const dim of table.dimensions.slice(1)) {
      console.log(`[dbh-metadata] ${table.id}: ${dim.code}`);
      dimensions[dim.code] = entries(await query(base, table, dim), dim);
    }
    output.tables[table.id] = { periods: {
      firstPeriod: yearCodes[0] || '', lastPeriod: yearCodes[yearCodes.length - 1] || ''
    }, dimensions };
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  atomicWrite(OUT, JSON.stringify(output, null, 2));
  console.log(`[dbh-metadata] Skrev ${Object.keys(output.tables).length} tabeller til ${OUT}`);
}
main().catch(error => { console.error(`[dbh-metadata] FEIL: ${error.message}`); process.exit(1); });
