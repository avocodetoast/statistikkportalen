/**
 * Nettverkslaget for E2E — record/replay på Playwrights page.route().
 *
 * HVORFOR IKKE MSW: appen har ingen npm-avhengigheter, ingen byggesteg og
 * ingen modulsystem. MSW ville krevd en ekte avhengighet, en innsjekket
 * service worker-fil OG oppkobling i index.html. Til gjengjeld for hva? Målt
 * ved kaldstart gjør appen tre eksterne kall:
 *
 *     stats.statistikkportalen.no/script.js   (analytics)
 *     data.ssb.no/api/pxwebapi/v2/config
 *     data.ssb.no/api/pxwebapi/v2/tables?...
 *
 * Norges Bank og FHI gjør NULL — katalogene deres er bakt inn i
 * data/sources/*.js ved byggetid. page.route() dekker dette helt.
 *
 * TRE MODI:
 *   replay (standard) — svarer fra tests/e2e/fixtures/. Deterministisk.
 *   record            — slipper kallet gjennom til ekte API og lagrer svaret.
 *   live              — slipper gjennom uten å lagre (verifisering mot ekte API).
 *
 * record og replay bruker SAMME nøkkelfunksjon (requestKey), så en innspilt
 * fixture treffer garantert i replay. Det er hele poenget med å ikke skrive
 * fixture-filene for hånd: de kan ikke komme ut av synk med hva appen ber om.
 *
 * FAIL-LOUD: i replay feiler et ukjent eksternt kall testen i stedet for å
 * gi 404 eller henge. Et stille tomt svar ville sett ut som «appen virker».
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(HELPER_DIR, '..', 'fixtures');

/** Verter appen har lov til å snakke med i det hele tatt. */
const API_HOSTS = ['data.ssb.no', 'data.norges-bank.no', 'statistikk-data.fhi.no'];

/** Telemetri o.l. som aldri skal treffe nett i en test, og aldri feile den. */
const IGNORED_HOSTS = ['stats.statistikkportalen.no'];

/**
 * Stabil nøkkel for et request. Query-parametre sorteres (rekkefølgen kan
 * variere mellom kodestier), og POST-body hashes inn — dataspørringer skiller
 * seg bare på body.
 */
export function requestKey(method, url, postData) {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');

  const host = u.hostname.replace(/\./g, '-');
  const slug = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

  const variant = crypto
    .createHash('sha1')
    .update(`${method}\n${query}\n${postData || ''}`)
    .digest('hex')
    .slice(0, 8);

  return `${host}__${slug}__${variant}`;
}

function fixturePath(key) {
  return path.join(FIXTURE_DIR, `${key}.json`);
}

/**
 * /tables gir ~10 000 rader. Hele lista som fixture ville vært titalls MB og
 * umulig å lese i en diff. Vi beholder et representativt utvalg som fortsatt
 * bygger et ekte emnetre, pluss tabellene testene faktisk åpner.
 */
export function trimTableList(body, { keep = [], perSubject = 3 } = {}) {
  if (!body || !Array.isArray(body.tables)) return body;

  const keepSet = new Set(keep);
  const picked = [];
  const bySubject = new Map();

  for (const table of body.tables) {
    if (keepSet.has(table.id)) {
      picked.push(table);
      continue;
    }
    // Tabeller uten sti havner ikke i emnetreet — de gir ingen dekning.
    const subject = table.paths?.[0]?.[0]?.id ?? table.subjectCode ?? 'ukjent';
    const count = bySubject.get(subject) ?? 0;
    if (count >= perSubject) continue;
    bySubject.set(subject, count + 1);
    picked.push(table);
  }

  return { ...body, tables: picked };
}

/**
 * Monterer rutene på en Playwright-side.
 *
 * @param {import('playwright-core').Page} page
 * @param {object} [options]
 * @param {'replay'|'record'} [options.mode]
 * @param {string[]} [options.keepTables] tabell-ID-er som må overleve trimmingen
 * @param {string[]} [options.blockHosts] API-verter som skal feile (degradert modus)
 * @returns {{ missing: string[], recorded: string[], blocked: string[] }}
 */
export async function installRoutes(page, options = {}) {
  const { mode = 'replay', keepTables = [], blockHosts = [] } = options;

  const missing = [];
  const recorded = [];
  const blocked = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();

    // Lokale filer (file:// og vår egen node:http-server) går rett gjennom.
    if (url.startsWith('file://') || url.includes('127.0.0.1') || url.includes('localhost')) {
      return route.continue();
    }

    const host = new URL(url).hostname;

    if (IGNORED_HOSTS.includes(host)) return route.abort();

    // Bevisst nedetid — brukes til å teste resilience-laget.
    if (blockHosts.includes(host)) {
      blocked.push(url);
      return route.abort('failed');
    }

    if (!API_HOSTS.includes(host)) {
      missing.push(`Uventet vert: ${host} (${url})`);
      return route.abort('failed');
    }

    if (mode === 'live') return route.continue();

    const key = requestKey(request.method(), url, request.postData());
    const file = fixturePath(key);

    if (mode === 'record') {
      const response = await route.fetch();
      let body = await response.text();
      try {
        let parsed = JSON.parse(body);
        if (new URL(url).pathname.endsWith('/tables')) {
          parsed = trimTableList(parsed, { keep: keepTables });
        }
        body = JSON.stringify(parsed, null, 2);
      } catch {
        // Ikke JSON — lagres som det er.
      }
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(file, body);
      recorded.push(`${key}  ←  ${request.method()} ${url}`);
      return route.fulfill({ response, body });
    }

    if (!fs.existsSync(file)) {
      missing.push(`${request.method()} ${url}\n      mangler fixture: ${path.basename(file)}`);
      return route.abort('failed');
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: fs.readFileSync(file, 'utf8')
    });
  });

  return { missing, recorded, blocked };
}
