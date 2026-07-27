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
 * Øvre grense for antall verdier per dimensjon (og per kodeliste) i en fixture.
 *
 * HVORFOR: 08801s metadata er 2,3 MB pent formatert, og kodelista
 * vs_VareKoderKN8Siff — som preloadCodelistOrdering() henter automatisk når
 * tabellen åpnes — er 3,0 MB. Fixture-katalogen slettes og skrives på nytt ved
 * hver innspilling, så utrimmet ville hver kjøring lagt ~5 MB i git-historikken.
 *
 * Grensen ligger BEVISST over AppConfig.ui.selectAllStarThreshold (500), slik at
 * en trimmet dimensjon fortsatt er «for stor» og Ctrl+A fortsatt bytter til
 * stjernevalg. Egenskapen som testes bevares; det eksakte tallet gjør det ikke.
 * Derfor skal ingen test hardkode 13 429 — E2E-testen leser terskelen fra
 * AppConfig og antallet fra metadataen i nettleseren, og asserterer forholdet
 * mellom dem. Da kan verken en hevet terskel eller en senket grense få
 * stjernestien til å slutte å bli testet uten at noe blir rødt.
 *
 * Ikke dekket av dette laget: at 13 429 DOM-rader faktisk rendrer uten å henge.
 * Det er en ytelsesegenskap uten assertion — kjør E2E_LIVE=1 for den.
 */
export const MAX_DIM_VALUES = 700;

/** Objekter under category/extension som er nøklet på verdikode, ikke arrays. */
function isCodeKeyedMap(value, codes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every(k => codes.has(k));
}

/** Behold bare nøklene i `keep`, i `keep`s rekkefølge. */
function pickKeys(map, keep) {
  const out = {};
  for (const code of keep) {
    if (Object.prototype.hasOwnProperty.call(map, code)) out[code] = map[code];
  }
  return out;
}

/**
 * Kapper store dimensjoner i et JSON-Stat2-metadatasvar til `maxValues` verdier.
 *
 * Beholder de N første kodene i category.index-rekkefølge og renummererer
 * indeksen til 0..N-1. Alle kodenøklede sidemapper beskjæres i samme slengen
 * (category.label/unit/note og extension.refperiod/measuringType/priceType/
 * adjustment/alternativeText) — og `size[]` holdes i synk med `id[]`, ellers
 * ville fixturen vært internt inkonsistent på en måte appen ikke oppdager.
 *
 * extension.codelists røres ikke: den er liten, og det er den testene
 * asserterer på.
 *
 * @param {object} body - Parset metadatasvar
 * @param {object} [options]
 * @param {number} [options.maxValues]
 * @param {Set<string>} [options.keptCodes] - fylles med kodene som overlevde,
 *   slik at trimCodelist() kan holde kodelistene konsistente med metadataen
 * @returns {object} - Nytt body-objekt (input muteres ikke)
 */
export function trimMetadata(body, { maxValues = MAX_DIM_VALUES, keptCodes = null } = {}) {
  if (!body || !Array.isArray(body.id) || !body.dimension) return body;

  const dimension = { ...body.dimension };
  const size = Array.isArray(body.size) ? [...body.size] : null;
  let changed = false;

  body.id.forEach((dimCode, dimIndex) => {
    const dim = body.dimension[dimCode];
    if (!dim || !dim.category || !dim.category.index) return;

    const index = dim.category.index;
    const allCodes = Object.keys(index).sort((a, b) => index[a] - index[b]);
    if (allCodes.length <= maxValues) return;

    const keep = allCodes.slice(0, maxValues);
    if (keptCodes) for (const code of keep) keptCodes.add(code);

    const newIndex = {};
    keep.forEach((code, i) => { newIndex[code] = i; });

    const allCodeSet = new Set(allCodes);

    const category = { ...dim.category, index: newIndex };
    for (const [key, value] of Object.entries(dim.category)) {
      if (key !== 'index' && isCodeKeyedMap(value, allCodeSet)) {
        category[key] = pickKeys(value, keep);
      }
    }

    const extension = dim.extension ? { ...dim.extension } : undefined;
    if (extension) {
      for (const [key, value] of Object.entries(dim.extension)) {
        if (isCodeKeyedMap(value, allCodeSet)) {
          extension[key] = pickKeys(value, keep);
        }
      }
    }

    dimension[dimCode] = extension
      ? { ...dim, category, extension }
      : { ...dim, category };
    if (size) size[dimIndex] = keep.length;
    changed = true;
  });

  if (!changed) return body;
  return size ? { ...body, size, dimension } : { ...body, dimension };
}

/**
 * Kapper et kodelistesvar og holder det konsistent med den trimmede metadataen.
 *
 * Kodelistens valueMap peker på ORIGINALKODER i dimensjonen. Har dimensjonen
 * blitt kappet, må valueMap kappes tilsvarende — ellers ville
 * extractCodelistCodes() gitt et originalCodes-sett med koder som ikke finnes i
 * metadataen, og getTrueDimensionValueCount() ville rapportert et antall
 * verdilista aldri kan vise.
 *
 * URL-en (/codeLists/{id}) sier ikke hvilken dimensjon kodelista hører til, så
 * `keptCodes` er unionen over alle trimmede dimensjoner. Vi filtrerer bare
 * kodelister som faktisk OVERLAPPER det settet — ellers ville en kodeliste for
 * en utrimmet dimensjon (f.eks. vs_LandKoderAlf1) blitt tømt helt.
 *
 * @param {object} body - Parset kodelistesvar
 * @param {object} [options]
 * @param {number} [options.maxValues]
 * @param {Set<string>} [options.keptCodes]
 * @returns {object} - Nytt body-objekt (input muteres ikke)
 */
export function trimCodelist(body, { maxValues = MAX_DIM_VALUES, keptCodes = null } = {}) {
  if (!body || !Array.isArray(body.values)) return body;

  let values = body.values;

  const overlaps = keptCodes && keptCodes.size > 0 && values.some(v =>
    Array.isArray(v.valueMap) && v.valueMap.some(c => keptCodes.has(String(c))));

  if (overlaps) {
    values = values
      .map(v => {
        if (!Array.isArray(v.valueMap)) return v;
        const valueMap = v.valueMap.filter(c => keptCodes.has(String(c)));
        return { ...v, valueMap };
      })
      .filter(v => !Array.isArray(v.valueMap) || v.valueMap.length > 0);
  }

  if (values.length > maxValues) values = values.slice(0, maxValues);
  if (values === body.values) return body;

  return { ...body, values };
}

/**
 * Monterer rutene på en Playwright-side.
 *
 * @param {import('playwright-core').Page} page
 * @param {object} [options]
 * @param {'replay'|'record'} [options.mode]
 * @param {string[]} [options.keepTables] tabell-ID-er som må overleve trimmingen
 * @param {string[]} [options.blockHosts] API-verter som skal feile (degradert modus)
 * @param {number} [options.recordDelayMs] pause før hvert ekte kall i record-modus
 * @returns {{ missing: string[], recorded: string[], blocked: string[] }}
 */
export async function installRoutes(page, options = {}) {
  const { mode = 'replay', keepTables = [], blockHosts = [] } = options;

  // SSB tåler 30 kall/minutt, og SSBApi._throttledFetch sperrer bare på 100 ms
  // (600/min). Under innspilling av fem tabeller går det ~40 kall, så uten en
  // brems her ville vi ligget rett på grensa. Gjelder KUN record-modus.
  //
  // Bremsen må SERIALISERE, ikke bare sove: appen sender flere kall parallelt,
  // og en «await sleep» i hver rute-handler ville bare fått dem til å sove
  // samtidig og så fyre av samlet. Løftekjeden under gir kall nummer N sin plass
  // ved N × recordDelayMs, altså ett kall per intervall uansett samtidighet.
  const recordDelayMs = options.recordDelayMs ?? Number(process.env.E2E_RECORD_DELAY_MS ?? 2200);
  let recordGate = Promise.resolve();
  const paceRecord = () => {
    recordGate = recordGate.then(() => new Promise(r => setTimeout(r, recordDelayMs)));
    return recordGate;
  };

  // Koder som overlevde metadatatrimmingen, delt mellom trimMetadata og
  // trimCodelist innenfor én innspilling.
  const keptCodes = new Set();

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
      if (recordDelayMs > 0) await paceRecord();
      const response = await route.fetch();

      // Et 429 eller 500 er også «et svar». Lagres det, blir feilkroppen en
      // permanent fixture som replay serverer med status 200 i all framtid —
      // testene ville vært grønne mot søppel. Fail-loud i stedet: ikke lagre,
      // og la appen se den ekte feilen så innspillingen rapporterer den.
      if (!response.ok()) {
        missing.push(
          `${request.method()} ${url}\n      HTTP ${response.status()} under innspilling — IKKE lagret`
        );
        return route.fulfill({ response });
      }

      let body = await response.text();
      try {
        let parsed = JSON.parse(body);
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/tables')) {
          parsed = trimTableList(parsed, { keep: keepTables });
        } else if (pathname.endsWith('/metadata')) {
          parsed = trimMetadata(parsed, { keptCodes });
        } else if (pathname.includes('/codeLists/')) {
          parsed = trimCodelist(parsed, { keptCodes });
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
