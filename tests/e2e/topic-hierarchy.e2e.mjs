/**
 * E2E — emnehierarkiet: navigasjon, plassering og kuraterte navn i ekte Chrome.
 *
 * Røyktestens runTopicFlow() klikker seg GRÅDIG nedover på første kort den
 * finner til tabell-lenker dukker opp. Den beviser at nedboring virker, men
 * asserterer aldri en bestemt sti eller at en bestemt tabell er der. Denne fila
 * dekker det: to ruter der SSB og en fremmedkilde deler samme node.
 *
 *   #topic/os/os07/offogjeld — SSB-tabeller + Norges Banks statsgjeldsserier
 *   #topic/he/he04/helsetjko — SSB-tabeller + FHIs KPR-register
 *
 * Begge er dybde 3 mens SSBs stier er dybde 4, så tabellene ligger i
 * BARNESEKSJONER, ikke på løvnoden. Det er nettopp derfor rutene er
 * interessante: fremmedkilden må havne som en egen seksjon ved siden av SSBs,
 * og sortere sist.
 *
 * ARBEIDSDELING MOT ENHETSTESTENE: totaler og trestruktur asserteres mot den
 * ekte, fulle katalogen i tests/unit/hierarchy-real-catalog.test.js.
 * /tables-fixturen her er trimmet til ~70 SSB-rader pluss de pinnede, så denne
 * fila asserterer «disse id-ene ligger i denne seksjonen», aldri totaler for
 * SSB. NB- og FHI-tallene er derimot ekte: de bygges av innsjekkede filer.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { launchApp, waitForFrontPage, e2eAvailable, MODE_HTTP } from './helpers/app-browser.mjs';
import {
  runTopicRouteFlow, TOPIC_ROUTES, TOPIC_KEEP_TABLES,
  BUILDER_TABLES, DEFAULT_TABLE
} from './helpers/flows.mjs';

const availability = e2eAvailable();
const NETWORK = process.env.E2E_LIVE ? 'live' : 'replay';
const skip = availability.ok ? false : availability.reason;

function assertClean(app, step) {
  const problems = app.problems();
  assert.equal(problems, null, `${step} ga feil i nettleseren:\n${problems}`);
}

/** Seksjonen med en gitt overskrift, eller null. */
function section(leaf, label) {
  return leaf.sections.find(s => s.label === label) || null;
}

let app;

before(async () => {
  if (!availability.ok) return;
  app = await launchApp({
    mode: MODE_HTTP,
    network: NETWORK,
    keepTables: [DEFAULT_TABLE, ...BUILDER_TABLES, ...TOPIC_KEEP_TABLES],
    shotPrefix: 'emnetre'
  });
  await waitForFrontPage(app.page);
});

after(async () => {
  if (app) await app.close();
});

for (const route of TOPIC_ROUTES) {
  const routeName = '#topic/' + route.path.join('/');

  describe(`${routeName} — ${route.key.toUpperCase()} og SSB i samme node`, { skip }, () => {
    let r;

    before(async () => { if (availability.ok) r = await runTopicRouteFlow(app.page, route); });

    it('brødsmulene bygger hele veien fra emnegruppa ned til løvnoden', () => {
      // data-path er komma-joinet, ikke skråstrek-joinet.
      assert.deepEqual(r.initial.breadcrumbs, [
        route.group,
        route.path[0],
        route.path.slice(0, 2).join(','),
        route.path.join(',')
      ]);
      assert.equal(r.initial.heading, route.leafLabel);
    });

    it('ingen tabeller ligger løse på løvnoden — alt er seksjonert', () => {
      // SSBs stier er dybde 4, så løvnoden selv skal være tom for tabeller.
      assert.equal(r.initial.looseRows, 0);
    });

    it('SSB-tabellene ligger i sine egne, navngitte seksjoner', () => {
      for (const [label, ids] of Object.entries(route.ssbSections)) {
        const sec = section(r.initial, label);
        assert.ok(sec, `manglet seksjonen «${label}». Fant: ${r.initial.sections.map(s => s.label).join(' | ')}`);
        for (const id of ids) {
          assert.ok(sec.rows.some(row => row.id === id),
            `${id} lå ikke i «${label}» (der lå: ${sec.rows.map(x => x.id).join(', ')})`);
        }
      }
    });

    it(`${route.key.toUpperCase()}-tabellene ligger i sin egen seksjon`, () => {
      const sec = section(r.initial, route.foreignNode);
      assert.ok(sec, `manglet «${route.foreignNode}». Fant: ${r.initial.sections.map(s => s.label).join(' | ')}`);
      for (const id of Object.keys(route.foreignTables)) {
        assert.ok(sec.rows.some(row => row.id === id),
          `${id} lå ikke i «${route.foreignNode}»`);
      }
    });

    it('fremmedkilden sorterer SIST blant seksjonene', () => {
      // sortCode sammenlignes som streng ('912' > '0000900010'). Byttes det til
      // numerisk sortering, hopper fremmedkildene til toppen av hvert emne.
      assert.equal(r.initial.sections.at(-1).label, route.foreignNode,
        `rekkefølge: ${r.initial.sections.map(s => s.label).join(' | ')}`);
    });

    it('de kuraterte navnene er det brukeren faktisk ser i lenketeksten', () => {
      // Den eneste testen som ser navnet gjennom hele kjeden: kuratert fil →
      // katalog → adapter → hierarki → renderens cleanTableLabel → <a>-teksten.
      const sec = section(r.initial, route.foreignNode);
      for (const [id, expectedTitle] of Object.entries(route.foreignTables)) {
        const row = sec.rows.find(x => x.id === id);
        assert.ok(row, `fant ikke ${id}`);
        assert.equal(row.title, expectedTitle);
      }
    });

    it('kildeprefikset strippes i id-kolonnen, men beholdes i data-table-id', () => {
      const sec = section(r.initial, route.foreignNode);
      for (const id of Object.keys(route.foreignTables)) {
        const row = sec.rows.find(x => x.id === id);
        assert.equal(row.shownId, id.replace(/^(nb|fhi)-/, ''));
      }
    });

    it('fremmedrader har kildebadge, SSB-rader har ingen', () => {
      const foreign = section(r.initial, route.foreignNode);
      for (const row of foreign.rows) {
        assert.equal(row.badge, route.badge, `${row.id} manglet ${route.badge}`);
      }
      for (const label of Object.keys(route.ssbSections)) {
        for (const row of section(r.initial, label).rows) {
          assert.equal(row.badge, null, `SSB-raden ${row.id} fikk badgen ${row.badge}`);
        }
      }
    });

    it('avsluttede tabeller er skjult som standard', () => {
      // AppConfig.ui.showDiscontinuedByDefault === false.
      assert.equal(section(r.initial, route.discontinuedSection), null,
        `«${route.discontinuedSection}» skulle vært skjult`);
      const allIds = r.initial.sections.flatMap(s => s.rows.map(x => x.id));
      assert.equal(allIds.includes(route.discontinuedTable), false);
    });

    it('haken viser dem, med egen seksjon og eget merke på raden', () => {
      const sec = section(r.withDiscontinued, route.discontinuedSection);
      assert.ok(sec, `«${route.discontinuedSection}» dukket ikke opp. Fant: ${r.withDiscontinued.sections.map(s => s.label).join(' | ')}`);
      const row = sec.rows.find(x => x.id === route.discontinuedTable);
      assert.ok(row, `${route.discontinuedTable} manglet`);
      assert.equal(row.discontinued, true);
    });

    it('filteret gjelder også fremmedkilden, ikke bare SSB', () => {
      // Norges Bank har én avsluttet serie (nb-GOVT_IRS); FHI har ingen. Testen
      // krever derfor bare at antallet ikke KRYMPER når filteret slås på.
      const before = section(r.initial, route.foreignNode).rows.length;
      const after = section(r.withDiscontinued, route.foreignNode).rows.length;
      assert.ok(after >= before, `${before} → ${after}`);
      if (route.key === 'nb') {
        assert.equal(after, before + 1, 'nb-GOVT_IRS skulle kommet til');
      }
    });

    it('klikkveien fra forsiden ender samme sted som deeplenken', () => {
      // Kortene er <div>-er med click-handlere, ikke lenker, så dette er den
      // eneste måten å bevise at emne → underemne → kategori faktisk virker.
      assert.deepEqual(r.drilled.visited, [
        `#topic/${route.path[0]}`,
        `#topic/${route.path.slice(0, 2).join('/')}`,
        `#topic/${route.path.join('/')}`
      ]);
      assert.deepEqual(
        r.drilled.leaf.sections.map(s => s.label),
        r.initial.sections.map(s => s.label),
        'klikkveien og deeplenken viste ulike seksjoner'
      );
    });

    it('ingen feil i nettleseren', () => assertClean(app, `${routeName}-flyten`));
  });
}
