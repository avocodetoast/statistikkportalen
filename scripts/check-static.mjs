#!/usr/bin/env node
/**
 * Statiske sjekker av app-skallet — Statistikkportalen.
 *
 * HVORFOR: repoet har bevisst ingen linter, ingen bundler og ingen byggesteg.
 * Det gjør fire feilklasser usynlige helt fram til appen åpnes i en nettleser:
 *
 *   1. Syntaksfeil i en js/*.js som ingen enhetstest tilfeldigvis laster.
 *      `npm test` laster bare de filene testene ber om via loadApp().
 *   2. En <script>/<link> i index.html som peker på en fil som ikke finnes.
 *   3. ?v=-strenger som har kommet ut av synk med VERSION i js/version.js.
 *      Dokumentert fotskudd i js/version.js selv: en blanding av cachede gamle
 *      og ferske scripts gir «X is not a function» hos brukeren.
 *   4. En ny relativt-referert asset i index.html som ikke er dekket av
 *      asset-path-rewriten i scripts/generate-seo-pages.mjs — da 404-er den
 *      på hver eneste forhåndsrendrede underside (de ligger 1–4 mapper dypt).
 *
 * Kjøres av `npm run check` og som første steg i `npm run verify`.
 * Ingen npm-avhengigheter, ingen nettleser, ingen nettverk. Krever Node 18+.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const errors = [];
const warnings = [];
const notes = [];

const rel = (p) => path.relative(REPO_ROOT, p) || p;

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, filter, out);
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Syntakssjekk
// ---------------------------------------------------------------------------

/**
 * Nettleser-scriptene lastes som klassiske <script> (ikke moduler), så de
 * kompileres i script-modus — nøyaktig slik nettleseren og tests/helpers/
 * app-env.js gjør det. vm.Script parser uten å kjøre koden, så dette er
 * trygt og raskt (ingen subprosess per fil).
 */
function checkClassicScripts() {
  const files = [
    ...walk(path.join(REPO_ROOT, 'js'), (n) => n.endsWith('.js')),
    ...walk(path.join(REPO_ROOT, 'data', 'sources'), (n) => n.endsWith('.js'))
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    try {
      new vm.Script(source, { filename: file });
    } catch (err) {
      errors.push(`Syntaksfeil i ${rel(file)}: ${err.message}`);
    }
  }
  notes.push(`${files.length} nettleser-scripts syntakssjekket`);
}

/** ESM-verktøyene må sjekkes av Node selv (vm.Script kan ikke parse moduler). */
function checkEsmScripts() {
  const files = [
    ...walk(path.join(REPO_ROOT, 'scripts'), (n) => n.endsWith('.mjs')),
    ...walk(path.join(REPO_ROOT, 'tests'), (n) => n.endsWith('.mjs'))
  ];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      const detail = (err.stderr?.toString() || err.message).trim().split('\n').slice(0, 3).join(' ');
      errors.push(`Syntaksfeil i ${rel(file)}: ${detail}`);
    }
  }

  // tests/**/*.test.js er CommonJS — de kjøres av node --test, men en
  // syntaksfeil der skal fanges her og ikke først når suiten kjører.
  const cjsTests = walk(path.join(REPO_ROOT, 'tests'), (n) => n.endsWith('.js'));
  for (const file of cjsTests) {
    const source = fs.readFileSync(file, 'utf8');
    try {
      new vm.Script(`(function(exports,require,module,__filename,__dirname){${source}\n})`, { filename: file });
    } catch (err) {
      errors.push(`Syntaksfeil i ${rel(file)}: ${err.message}`);
    }
  }

  notes.push(`${files.length} ESM-verktøy + ${cjsTests.length} testfiler syntakssjekket`);
}

// ---------------------------------------------------------------------------
// 2–4. index.html: assets, versjonssynk, SEO-rewrite
// ---------------------------------------------------------------------------

/** Alle relative <script src> / <link href> i index.html, med linjenummer. */
function collectAssetRefs(html) {
  const refs = [];
  const lines = html.split('\n');
  lines.forEach((line, i) => {
    const re = /<(script|link)\b[^>]*?\b(src|href)="([^"]+)"/gi;
    let m;
    while ((m = re.exec(line)) !== null) {
      const [, tag, attr, value] = m;
      if (/^(https?:)?\/\//.test(value) || value.startsWith('#') || value.startsWith('data:')) continue;
      refs.push({ tag: tag.toLowerCase(), attr: attr.toLowerCase(), value, line: i + 1 });
    }
  });
  return refs;
}

/**
 * VERSION er 'v1.9.4', mens ?v=-strengene skrives uten v-prefiks ('1.9.4').
 * Begge konvensjonene er i bruk i repoet, så sammenlign på tallet.
 */
function normalizeVersion(value) {
  return String(value).replace(/^v/i, '');
}

function readVersion() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'js', 'version.js'), 'utf8');
  const m = source.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) {
    errors.push('Fant ikke VERSION i js/version.js');
    return null;
  }
  return m[1];
}

function checkIndexHtml(html, version) {
  const refs = collectAssetRefs(html);

  for (const ref of refs) {
    const [filePath, query] = ref.value.split('?');
    const onDisk = path.join(REPO_ROOT, filePath);

    // (2) filen må finnes
    if (!fs.existsSync(onDisk)) {
      errors.push(`index.html:${ref.line} refererer ${filePath}, som ikke finnes på disk`);
      continue;
    }

    // (3) ?v= må matche VERSION. js/version.js selv lastes uten ?v= — den
    // definerer versjonen og må aldri caches bort bak sin egen gamle verdi.
    if (!version) continue;
    if (filePath === 'js/version.js') {
      if (query) warnings.push(`index.html:${ref.line} js/version.js bør lastes uten ?v=`);
      continue;
    }
    const found = query && new URLSearchParams(query).get('v');
    if (!found) {
      warnings.push(`index.html:${ref.line} ${filePath} mangler ?v= (cache-busting)`);
    } else if (normalizeVersion(found) !== normalizeVersion(version)) {
      errors.push(`index.html:${ref.line} ${filePath} har ?v=${found}, men VERSION er ${version}`);
    }
  }

  notes.push(`${refs.length} asset-referanser i index.html sjekket mot VERSION ${version}`);
  return refs;
}

/**
 * (4) SEO-generatoren gjør relative asset-stier absolutte fordi de genererte
 * sidene ligger 1–4 mapper dypt. Rewriten er en fast liste med prefikser;
 * en ny toppmappe i index.html må legges til der, ellers 404-er den overalt.
 */
function checkSeoRewriteCoverage(refs) {
  const generator = path.join(REPO_ROOT, 'scripts', 'generate-seo-pages.mjs');
  if (!fs.existsSync(generator)) return;
  const source = fs.readFileSync(generator, 'utf8');

  const covered = new Set();
  const re = /\.replace\(\/(src|href)="([a-z0-9_-]+)\\\//gi;
  let m;
  while ((m = re.exec(source)) !== null) covered.add(`${m[1].toLowerCase()}:${m[2]}`);

  const needed = new Set();
  for (const ref of refs) {
    const dir = ref.value.split('/')[0];
    if (!ref.value.includes('/')) continue;
    needed.add(`${ref.attr}:${dir}`);
  }

  for (const key of needed) {
    if (!covered.has(key)) {
      const [attr, dir] = key.split(':');
      errors.push(
        `index.html laster ${attr}="${dir}/…", men scripts/generate-seo-pages.mjs ` +
        `absoluttiserer ikke ${attr}="${dir}/" — hver forhåndsrendret underside vil 404-e på den`
      );
    }
  }

  notes.push(`SEO-rewrite dekker: ${[...covered].sort().join(', ') || '(ingen)'}`);
}

/** Duplikate id-er gir uforutsigbar getElementById — appen bruker den overalt. */
function checkDuplicateIds(html) {
  const seen = new Map();
  const lines = html.split('\n');
  lines.forEach((line, i) => {
    // Flere id= på SAMME element: bare den første teller i DOM-en.
    const tagRe = /<[a-z][^>]*>/gi;
    let tag;
    while ((tag = tagRe.exec(line)) !== null) {
      const ids = [...tag[0].matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      if (ids.length > 1) {
        errors.push(
          `index.html:${i + 1} ett element har ${ids.length} id-attributter (${ids.join(', ')}) — ` +
          `nettleseren bruker kun «${ids[0]}», resten er død kode`
        );
      }
      for (const id of ids) {
        if (seen.has(id)) {
          errors.push(`index.html:${i + 1} id="${id}" er allerede brukt på linje ${seen.get(id)}`);
        } else {
          seen.set(id, i + 1);
        }
      }
    }
  });
  notes.push(`${seen.size} unike id-er i index.html`);
}

// ---------------------------------------------------------------------------

function main() {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  const version = readVersion();

  checkClassicScripts();
  checkEsmScripts();
  const refs = checkIndexHtml(html, version);
  checkSeoRewriteCoverage(refs);
  checkDuplicateIds(html);

  for (const note of notes) console.log(`  ✓ ${note}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} feil:`);
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }

  console.log(`\nStatiske sjekker OK${warnings.length ? ` (${warnings.length} advarsler)` : ''}.`);
}

main();
