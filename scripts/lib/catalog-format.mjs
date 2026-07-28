/**
 * Kompakt katalogserialisering — encode-siden. Motstykket til js/catalog-index.js
 * (CatalogIndex.decode), som denne fila IKKE reimplementerer: loadDecoder()
 * kjører den ekte nettleserfila via node:vm, slik at byggeren/testene bruker
 * NØYAKTIG den koden nettleseren kjører (samme loadBrowserGlobal-mønster som
 * scripts/generate-seo-pages.mjs bruker for config.js).
 *
 * FORMATET (se headerkommentaren i js/catalog-index.js for den fulle
 * kontrakten — hold de to i sync):
 *
 *   {
 *     format: 1, source, lang, generatedAt, count,
 *     fields: [...],           // rekkefølgen radene i `tables` er kodet i
 *     nodes:  [[id,label,sortCode], ...],
 *     paths:  [[nodeIdx, ...], ...],
 *     vars:   ["kjønn", ...],
 *     tables: [[...felt i fields-rekkefølge...], ...]
 *   }
 *
 * KRAV SOM MÅ HOLDE (se tests/unit/catalog-format.test.js):
 *   1. Path-noder interneres på TRIPPELEN (id, label, sortCode) — ALDRI på
 *      id alene. Samme node-id bærer ulik sortCode på ulike plasseringer i
 *      det ekte SSB-emnetreet (f.eks. "aku"); interning på id alene ville
 *      kollapse dem stille.
 *   2. `links`, `category` og `source` droppes — ingen konsument i js/ leser
 *      dem, og `links` alene er 31,7 % av bytene i en rå katalograd.
 *   3. Kun "{id}: "-prefikset stripples fra `label` — ALDRI periodehalen
 *      ("… 2006M01-2026M06"). Periodehalen brukes av søkeindeksens normLabel
 *      og av AppConfig.ui.hidePeriodInTableTitles ved rendering.
 *
 * Ren ESM, ingen browser-globals, ingen I/O utover loadDecoder()s filles.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

/** Feltrekkefølgen `tables`-radene kodes i. decode() leser denne fra
 *  doc.fields i stedet for å anta rekkefølgen, så formatet tåler at et felt
 *  legges til senere — men encode må likevel skrive dem i en fast rekkefølge. */
const FIELDS = [
  'id', 'label', 'updated', 'firstPeriod', 'lastPeriod', 'subjectCode',
  'sortCode', 'timeUnit', 'discontinued', 'variableNames', 'paths', 'description'
];

/** Kun "{id}: "-prefikset SSB legger på label — periodehalen skal bli stående. */
const LABEL_ID_PREFIX = /^\d+:\s*/;

/** Interner en verdi i en tabell (array) + oppslagskart, returner indeksen. */
function intern(table, index, key, buildEntry) {
  let i = index.get(key);
  if (i === undefined) {
    i = table.length;
    table.push(buildEntry());
    index.set(key, i);
  }
  return i;
}

/**
 * Koder en flat radliste (samme form som en adapters getTables()/getAllTables()
 * returnerer) til det kompakte katalogdokumentet.
 *
 * @param {object[]} rows - Katalograder (id, label, paths[], variableNames[], ...).
 * @param {object} meta
 * @param {string} meta.source - Kilde-id ('ssb' | 'nb' | 'fhi').
 * @param {string} meta.lang - Språkkode raden er bygget for.
 * @param {string} meta.generatedAt - ISO 8601-tidsstempel for bygget.
 * @returns {object} doc - Katalogdokument, se format-headeren over.
 */
export function encodeCatalog(rows, { source, lang, generatedAt } = {}) {
  const nodes = [];
  const nodeIndex = new Map();
  const paths = [];
  const pathIndex = new Map();
  const vars = [];
  const varIndex = new Map();

  function internNode(node) {
    // Trippelnøkkel — se krav 1 i headeren: id alene er IKKE unikt.
    const key = `${node.id} ${node.label} ${node.sortCode}`;
    return intern(nodes, nodeIndex, key, () => [node.id, node.label, node.sortCode]);
  }

  function internPath(path) {
    const nodeIdxs = path.map(internNode);
    return intern(paths, pathIndex, nodeIdxs.join(','), () => nodeIdxs);
  }

  function internVar(name) {
    return intern(vars, varIndex, name, () => name);
  }

  const tables = rows.map(row => {
    const label = row.label == null ? null : String(row.label).replace(LABEL_ID_PREFIX, '');
    const variableNameIdxs = (row.variableNames || []).map(internVar);
    const pathIdxs = (row.paths || []).map(internPath);

    return [
      row.id ?? null,
      label,
      row.updated ?? null,
      row.firstPeriod ?? null,
      row.lastPeriod ?? null,
      row.subjectCode ?? null,
      row.sortCode ?? null,
      row.timeUnit ?? null,
      row.discontinued ? 1 : 0,
      variableNameIdxs,
      pathIdxs,
      row.description ?? null
    ];
  });

  return {
    format: 1,
    source,
    lang,
    generatedAt,
    count: tables.length,
    fields: FIELDS,
    nodes,
    paths,
    vars,
    tables
  };
}

/** Kjør en browser-global appfil i en sandkasse og les ut window.{key}.
 *  Samme mønster som loadBrowserGlobal() i scripts/generate-seo-pages.mjs. */
function loadBrowserGlobal(relPath, key) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'js', relPath), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  const value = sandbox.window[key];
  if (!value) throw new Error(`Klarte ikke å lese ${key} fra js/${relPath}`);
  return value;
}

/**
 * Laster CatalogIndex.decode fra js/catalog-index.js via node:vm, slik at
 * byggeren og testene kjører NØYAKTIG den koden nettleseren kjører — ingen
 * dobbeltimplementasjon av dekodingslogikken her.
 *
 * @returns {function(object): object[]} decode
 */
export function loadDecoder() {
  const CatalogIndex = loadBrowserGlobal('catalog-index.js', 'CatalogIndex');
  return CatalogIndex.decode.bind(CatalogIndex);
}
