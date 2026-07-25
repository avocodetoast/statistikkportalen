#!/usr/bin/env node
/**
 * Dekningsport — Statistikkportalen.
 *
 * HVORFOR: `npm test` og E2E sjekker at EKSISTERENDE tester passerer. Ingen av
 * dem oppdager at det mangler nye. Legger man til en ren-logikk-funksjon uten
 * test, er hele suiten fortsatt grønn — verifisert. Denne porten lukker det
 * hullet: den sammenligner funksjonsdekning per fil mot en innsjekket
 * basislinje og feiler når dekningen synker.
 *
 * HVORFOR IKKE `node --test --experimental-test-coverage`: den rapporterer
 * ingenting for js/*.js. Testharnessen laster appfilene med
 * vm.runInThisContext() (se tests/helpers/app-env.js), og Nodes egen
 * dekningsrapport tar bare med filer den selv har lastet som moduler. Rå
 * V8-dekning via NODE_V8_COVERAGE ser dem derimot, med den relative stien fra
 * `filename`-opsjonen som script-URL. Derfor gjør vi det selv.
 *
 * METRIKK: andel navngitte funksjoner som kalles minst én gang. Ikke linje-
 * eller branch-dekning — spørsmålet porten skal svare på er «ble denne nye
 * funksjonen noen gang kjørt av en test?», og da er funksjonsnivå det direkte
 * svaret. Anonyme funksjoner (callbacks) telles ikke; de er sjelden det man
 * glemmer å teste, og de ville gjort tallene ustabile.
 *
 * PER FIL, IKKE GLOBALT: de DOM-tunge view-modulene er bevisst ikke
 * enhetstestet (tests/README.md). En global terskel ville enten vært så lav at
 * den ikke fanget noe, eller tvunget fram nettopp de utbroderte DOM-mockene
 * repoet unngår. Hver fil holder sitt eget nivå.
 *
 *   node scripts/check-coverage.mjs              # sjekk mot basislinje
 *   node scripts/check-coverage.mjs --update     # skriv ny basislinje
 *   node scripts/check-coverage.mjs --report     # vis dekning, ingen porting
 *
 * Ingen npm-avhengigheter. Krever Node 20+.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_FILE = path.join(REPO_ROOT, 'tests', 'coverage-baseline.json');

/** Bare appkoden. scripts/ og tests/ har sine egne tester og er ikke poenget her. */
const INCLUDE_PREFIX = 'js/';

function parseArgs(argv) {
  return {
    update: argv.includes('--update'),
    report: argv.includes('--report')
  };
}

/**
 * Kjører enhetssuiten med rå V8-dekning påslått og samler resultatet.
 * @returns {Map<string, {covered: number, total: number, uncovered: string[]}>}
 */
function collectCoverage() {
  const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-coverage-'));

  const result = spawnSync(
    process.execPath,
    ['--test', 'tests/**/*.test.js'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_V8_COVERAGE: covDir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  if (result.status !== 0) {
    fs.rmSync(covDir, { recursive: true, force: true });
    console.error('Enhetstestene feiler — fiks dem før dekningen er meningsfull.');
    process.exit(1);
  }

  // Hver testprosess skriver sin egen fil; en funksjon regnes som dekket
  // hvis den ble kalt i MINST én av dem.
  const hits = new Map();

  for (const file of fs.readdirSync(covDir)) {
    if (!file.endsWith('.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(covDir, file), 'utf8'));
    } catch {
      continue;
    }

    for (const script of parsed.result || []) {
      const url = script.url || '';
      if (!url.startsWith(INCLUDE_PREFIX)) continue;

      let fns = hits.get(url);
      if (!fns) {
        fns = new Map();
        hits.set(url, fns);
      }

      for (const fn of script.functions || []) {
        // Den navnløse toppnivå-"funksjonen" er selve scriptet.
        if (!fn.functionName) continue;
        const called = (fn.ranges?.[0]?.count || 0) > 0;
        fns.set(fn.functionName, (fns.get(fn.functionName) || false) || called);
      }
    }
  }

  fs.rmSync(covDir, { recursive: true, force: true });

  const summary = new Map();
  for (const [url, fns] of hits) {
    const uncovered = [...fns.entries()].filter(([, hit]) => !hit).map(([name]) => name).sort();
    summary.set(url, { covered: fns.size - uncovered.length, total: fns.size, uncovered });
  }
  return summary;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

function writeBaseline(summary) {
  const files = {};
  for (const [url, { covered, total }] of [...summary].sort(([a], [b]) => a.localeCompare(b))) {
    files[url] = { covered, total };
  }
  const payload = {
    _comment:
      'Autogenerert av scripts/check-coverage.mjs. Funksjonsdekning per appfil. ' +
      'Porten feiler når en fil får FLERE udekkede funksjoner enn her. ' +
      'Oppdater bevisst med `npm run coverage:baseline` når du senker terskelen med vitende og vilje.',
    generatedAt: new Date().toISOString(),
    files
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
}

function formatRow(url, covered, total) {
  const pct = total ? Math.round((covered / total) * 100) : 100;
  return `${String(pct).padStart(4)}%  ${String(covered).padStart(3)}/${String(total).padEnd(4)} ${url}`;
}

function main() {
  const { update, report } = parseArgs(process.argv);
  const summary = collectCoverage();

  if (report || update) {
    const rows = [...summary.entries()].sort((a, b) => {
      const pa = a[1].total ? a[1].covered / a[1].total : 1;
      const pb = b[1].total ? b[1].covered / b[1].total : 1;
      return pa - pb;
    });
    for (const [url, { covered, total }] of rows) console.log(formatRow(url, covered, total));

    const totalFns = rows.reduce((a, [, r]) => a + r.total, 0);
    const coveredFns = rows.reduce((a, [, r]) => a + r.covered, 0);
    console.log(
      `\ntotalt: ${coveredFns}/${totalFns} funksjoner = ` +
        `${Math.round((coveredFns / totalFns) * 100)}%  (${rows.length} filer)`
    );
  }

  if (update) {
    writeBaseline(summary);
    console.log(`\nBasislinje skrevet til ${path.relative(REPO_ROOT, BASELINE_FILE)}`);
    return;
  }

  const baseline = readBaseline();
  if (!baseline) {
    console.error(
      `Fant ingen basislinje (${path.relative(REPO_ROOT, BASELINE_FILE)}).\n` +
        'Lag den med: npm run coverage:baseline'
    );
    process.exit(1);
  }

  const failures = [];

  for (const [url, current] of summary) {
    const before = baseline.files[url];

    // Ny fil uten basislinje: krev bare at den ikke er helt utestet hvis den
    // faktisk har navngitte funksjoner. Ellers ville enhver ny fil blokkert.
    if (!before) {
      if (current.total > 0 && current.covered === 0) {
        failures.push(
          `${url} er ny og har ingen dekkede funksjoner (0/${current.total}).\n` +
            `      Udekket: ${current.uncovered.slice(0, 8).join(', ')}` +
            (current.uncovered.length > 8 ? `, …(+${current.uncovered.length - 8})` : '')
        );
      }
      continue;
    }

    // Porten: antall UDEKKEDE funksjoner får ikke øke. Da kan man refaktorere
    // og slette kode fritt, men ikke legge til utestet logikk.
    const uncoveredBefore = before.total - before.covered;
    const uncoveredNow = current.total - current.covered;

    if (uncoveredNow > uncoveredBefore) {
      failures.push(
        `${url}: ${before.covered}/${before.total} → ${current.covered}/${current.total} ` +
          `(${uncoveredNow - uncoveredBefore} flere udekkede funksjoner)\n` +
          `      Udekket nå: ${current.uncovered.slice(0, 8).join(', ')}` +
          (current.uncovered.length > 8 ? `, …(+${current.uncovered.length - 8})` : '')
      );
    }
  }

  if (failures.length > 0) {
    console.error('\nDekningen har gått ned:\n');
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    console.error(
      'Skriv en test for den nye logikken (se TDD-reglene i CLAUDE.md).\n' +
        'Er nedgangen bevisst — f.eks. ny DOM-tung viewkode som ikke skal\n' +
        'enhetstestes — oppdater basislinjen eksplisitt: npm run coverage:baseline'
    );
    process.exit(1);
  }

  if (!report) {
    const files = summary.size;
    const totalFns = [...summary.values()].reduce((a, r) => a + r.total, 0);
    const coveredFns = [...summary.values()].reduce((a, r) => a + r.covered, 0);
    console.log(
      `Dekning OK: ${coveredFns}/${totalFns} funksjoner i ${files} appfiler, ingen nedgang.`
    );
  }
}

main();
