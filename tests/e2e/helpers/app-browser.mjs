/**
 * Nettleseroppsett for E2E — Statistikkportalen.
 *
 * HVORFOR SYSTEMETS CHROME: Playwrights egen Chromium må lastes ned (~150 MB)
 * og pinnes til en eksakt build-revisjon. Den revisjonen driver fra hverandre
 * hver gang Playwright oppgraderes, og da feiler launch() med «Executable
 * doesn't exist» — nøyaktig den tilstanden dette repoet sto i før E2E-laget
 * fantes. `channel: 'chrome'` bruker Google Chrome som allerede er installert,
 * så det finnes ingen revisjon å drive fra.
 *
 * Derfor er avhengigheten `playwright-core` (13 MB, ingen postinstall som
 * laster ned nettlesere), ikke `playwright`.
 *
 * KONSOLLFEIL ER TESTFEIL: appen fanger mye internt og rendrer en degradert
 * visning i stedet for å kræsje. Uten at konsollen sjekkes ville en røyktest
 * som «passerer» kunne skjule en TypeError i hver eneste view-render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { installRoutes } from './stub-routes.mjs';

// playwright-core importeres bevisst IKKE statisk. Repoet skal kunne sjekkes
// ut og testes uten `npm install` — en statisk import ville krasjet hele
// testfila før skip-sjekken under rakk å kjøre.

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPER_DIR, '..', '..', '..');

/** Skjermbilder havner i scratchpad, ikke i repoet. */
const SHOT_DIR =
  process.env.E2E_SHOT_DIR ||
  path.join(process.env.TMPDIR || '/tmp', 'statistikkportalen-e2e-shots');

export const MODE_FILE = 'file';
export const MODE_HTTP = 'http';

/**
 * Konsollstøy som ikke er appens feil og aldri skal felle en test.
 * Holdes bevisst kort — alt annet skal opp i lyset.
 */
const IGNORED_CONSOLE = [
  /net::ERR_FAILED/,           // rutene våre aborter analytics/blokkerte verter
  /net::ERR_BLOCKED_BY_CLIENT/,
  /Failed to load resource/,
  /favicon/i
];

/**
 * Kjøres i nettleseren FØR appens egne scripts.
 *
 * HVORFOR: `AppConfig.debug` er `false` i produksjon, og hele appen logger
 * gjennom `logger.*` (config.js), som er no-ops når debug er av. Uten dette
 * ser E2E-testene INGEN av appens egne feil — en tabell som stille feiler å
 * laste ville sett ut som en bestått test. Det var nøyaktig slik nb-IR-feilen
 * klarte å gjemme seg.
 *
 * `logger` og `AppConfig` legges begge på window av config.js. Vi setter en
 * setter-felle på window.logger og muterer objektet i stedet for å bytte det
 * ut — appkoden holder på sin egen referanse til det samme objektet, så en
 * erstatning ville ikke hatt effekt.
 */
function enableAppLogging() {
  let stored;
  Object.defineProperty(window, 'logger', {
    configurable: true,
    get: () => stored,
    set: (value) => {
      stored = value;
      if (window.AppConfig) window.AppConfig.debug = true;
      for (const level of ['error', 'warn']) {
        value[level] = (...args) => console[level]('[app]', ...args);
      }
    }
  });
}

/**
 * Er miljøet i stand til å kjøre E2E? Brukes til å skippe rent i stedet for
 * å feile på en maskin uten Chrome eller uten `npm install`.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function e2eAvailable() {
  try {
    import.meta.resolve('playwright-core');
  } catch {
    return { ok: false, reason: 'playwright-core er ikke installert — kjør `npm install`' };
  }

  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];
  if (!chromePaths.some((p) => fs.existsSync(p))) {
    return { ok: false, reason: 'Fant ingen installert Chrome/Chromium (channel: chrome)' };
  }
  return { ok: true };
}

/**
 * Starter nettleser + (ved behov) statisk server, og åpner appen.
 *
 * @param {object} [options]
 * @param {'file'|'http'} [options.mode]     hvordan appen lastes
 * @param {'replay'|'record'} [options.network]
 * @param {string[]} [options.keepTables]    tabell-ID-er som må med i fixturen
 * @param {string[]} [options.blockHosts]    API-verter som skal feile
 * @param {boolean} [options.shots]          lagre skjermbilder
 * @param {string} [options.shotPrefix]
 * @param {string} [options.hash]            rute å åpne (f.eks. '#table/07459')
 */
export async function launchApp(options = {}) {
  const {
    mode = MODE_HTTP,
    network = 'replay',
    keepTables = [],
    blockHosts = [],
    shots = Boolean(process.env.E2E_SHOTS),
    shotPrefix = 'app',
    hash = ''
  } = options;

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.addInitScript(enableAppLogging);

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const routes = await installRoutes(page, { mode: network, keepTables, blockHosts });

  let server = null;
  let baseUrl;
  if (mode === MODE_HTTP) {
    server = await serve();
    baseUrl = `${server.url}/index.html`;
  } else {
    baseUrl = `file://${REPO_ROOT}/index.html`;
  }

  await page.goto(baseUrl + hash, { waitUntil: 'domcontentloaded' });

  let shotIndex = 0;
  async function shot(name) {
    if (!shots) return null;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, `${shotPrefix}-${String(++shotIndex).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  }

  /**
   * Alt som har gått galt, som én lesbar streng — eller null.
   *
   * Tømmer listene som standard: testene deler én nettleser, og uten dette
   * ville den FØRSTE feilen felt hvert eneste senere steg også, slik at
   * feilmeldingen pekte på feil sted. Send { drain: false } for en
   * oppsummering til slutt.
   */
  function problems({ drain = true } = {}) {
    const parts = [];
    if (pageErrors.length) parts.push(`Uncaught exceptions:\n  - ${pageErrors.join('\n  - ')}`);
    if (consoleErrors.length) parts.push(`Konsollfeil:\n  - ${consoleErrors.join('\n  - ')}`);
    if (routes.missing.length) parts.push(`Ustubbede kall:\n  - ${routes.missing.join('\n  - ')}`);

    if (drain) {
      pageErrors.length = 0;
      consoleErrors.length = 0;
      routes.missing.length = 0;
    }
    return parts.length ? parts.join('\n') : null;
  }

  async function close() {
    await browser.close();
    if (server) await server.close();
  }

  return {
    page,
    shot,
    shotDir: SHOT_DIR,
    problems,
    consoleErrors,
    pageErrors,
    routes,
    baseUrl,
    close
  };
}

/** Venter til forsiden faktisk har rendret emnetreet (ikke bare «Initialiserer…»). */
export async function waitForFrontPage(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('content');
      return el && !el.textContent.includes('Initialiserer') && el.textContent.trim().length > 50;
    },
    { timeout: 20000 }
  );
}
