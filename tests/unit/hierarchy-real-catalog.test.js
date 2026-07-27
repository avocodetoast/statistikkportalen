/**
 * Emnetreet og de kuraterte tabellnavnene — mot de EKTE, innsjekkede katalogene.
 *
 * HVORFOR MOT EKTE DATA: menu-hierarchy.test.js bygger treet av sju syntetiske
 * tabeller, og nb-/fhi-adapter-paths.test.js overskriver konfigradene med sine
 * egne. De tester mekanikken, men ingen av dem ville merket at koblingen mellom
 * data/sources/fhi-curation.json og katalogen ryker, at en plassering i
 * source-topology.js forsvinner, eller at en sortCode endrer seg. Her lastes
 * data/sources/fhi-catalog.js og nb-periods.js — de samme globalene nettleseren
 * får — så alle 401 radene er de ekte.
 *
 * KURATERTE NAVN er hele poenget med FHI-katalogen: API-et returnerer interne
 * kodenavn («D14c_demens», «KPR_3»), og 363 av de 370 tabellene har en
 * håndskrevet tittel som overstyrer dem. Ryker den koblingen, viser portalen
 * kodenavn i emnetreet og søket — uten at noe annet blir rødt.
 *
 * Standard-`fetch` i harnessen kaster. At denne fila i det hele tatt kjører er
 * derfor beviset på at begge katalogene bygges uten ett eneste nettverkskall,
 * slik CLAUDE.md krever av kaldstart.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

// Rekkefølgen speiler index.html: datafilene før adapterne som leser dem.
const app = loadApp([
  ...SCRIPTS.core,
  'data/sources/fhi-catalog.js',
  'data/sources/nb-periods.js',
  'js/sources/sdmx-to-jsonstat.js',
  'js/sources/source-common.js',
  'js/sources/norges-bank-adapter.js',
  'js/sources/fhi-adapter.js',
  'js/sources/ssb-adapter.js',
  'js/sources/source-registry.js',
  'js/utils.js',
  'js/router.js',
  'js/subjects.js',
  'js/menu-hierarchy.js',
  'js/browser-state.js'
]);

const OFFOGJELD = ['os', 'os07', 'offogjeld'];
const HELSETJKO = ['he', 'he04', 'helsetjko'];

/**
 * SSBs egne stier er dybde 4 — tabellene ligger i mellomnoder som «Kvartalsvise
 * tall», ikke rett på løvnoden. Uten disse ville treet fått en helt annen form
 * enn i produksjon, og sorteringstestene under ville testet ingenting.
 * Id-er, etiketter og sortCode-er er hentet fra SSBs live /tables.
 */
const SSB_TABLES = [
  ssbTable('11560', 'Offentlig forvaltnings fordringer og gjeld. Kvartalsvis', OFFOGJELD,
    { id: 'SBMENU5262', label: 'Kvartalsvise tall', sortCode: '0000000005' }),
  ssbTable('05830', 'Statsgjelden. Kvartalsvise tall (mill. kr)', OFFOGJELD,
    { id: 'SBMENU5262', label: 'Kvartalsvise tall', sortCode: '0000000005' }),
  ssbTable('07511', 'Offentlig forvaltnings fordringer og gjeld. Årlige tall', OFFOGJELD,
    { id: 'SBMENU5263', label: 'Årlige tall', sortCode: '0000000100' }),
  ssbTable('04423', 'Offentlig forvaltning med undersektorer. Finansiell balanse', OFFOGJELD,
    { id: 'FRA_GAMMEL_00478', label: 'Avslutta tidsserier', sortCode: '0000900010' }, true),
  ssbTable('07456', 'Fastleger, etter kjønn, innvandringskategori og alder', HELSETJKO,
    { id: 'SBMENU4034', label: 'Fastleger', sortCode: '0000000400' }),
  ssbTable('12362', 'Utgifter til tjenesteområdene, kommunekonsern', HELSETJKO,
    { id: 'SBMENU9004', label: 'KOSTRA – Økonomi', sortCode: '0000000700' })
];

/** SSB-lignende katalograd. Segmentetikettene er SSBs egne. */
function ssbTable(id, label, parentPath, leafSeg, discontinued = false) {
  const SEGMENTS = {
    os: { id: 'os', label: 'Offentlig sektor', sortCode: '0000076' },
    os07: { id: 'os07', label: 'Statlige finanser', sortCode: '0000081' },
    offogjeld: { id: 'offogjeld', label: 'Offentlig forvaltnings fordringer og gjeld', sortCode: '0000082' },
    he: { id: 'he', label: 'Helse', sortCode: '0000034' },
    he04: { id: 'he04', label: 'Helsetjenester', sortCode: '0000037' },
    helsetjko: { id: 'helsetjko', label: 'Kommunehelsetenesta', sortCode: '0000038' }
  };
  return {
    id,
    label: id + ': ' + label,
    updated: '2026-01-01T00:00:00Z',
    timeUnit: 'Annual',
    discontinued,
    source: 'SSB',
    subjectCode: parentPath[0],
    paths: [[...parentPath.map(s => SEGMENTS[s]), leafSeg]]
  };
}

let nbTables;
let fhiTables;
let foreignTables;
let allTables;
let mh;
let hierarchy;

before(async () => {
  const nb = app.SourceAdapters.find(a => a.sourceId === 'nb');
  const fhi = app.SourceAdapters.find(a => a.sourceId === 'fhi');

  nbTables = (await nb.getTables({})).tables;
  fhiTables = (await fhi.getTables({})).tables;
  foreignTables = [...nbTables, ...fhiTables];
  allTables = [...SSB_TABLES, ...foreignTables];

  mh = new app.MenuHierarchy();
  hierarchy = mh.buildHierarchy(allTables);
});

/** Finn en katalograd på id. */
function row(id) {
  const found = foreignTables.find(t => t.id === id);
  assert.ok(found, `fant ingen katalograd med id ${id}`);
  return found;
}

describe('De innsjekkede katalogene bygges uten nettverk', () => {
  it('Norges Bank gir 31 tabeller', () => {
    // Harnessens fetch kaster; kom vi hit, gikk det null kall ut.
    assert.equal(nbTables.length, 31);
  });

  it('FHI gir 370 tabeller fordelt på 13 registre', () => {
    assert.equal(fhiTables.length, 370);
    assert.equal(Object.keys(app.FhiCatalog.sources).length, 13);
  });
});

describe('Kuraterte visningsnavn', () => {
  it('FHI viser den kuraterte tittelen, ikke API-ets interne kodenavn', () => {
    assert.equal(row('fhi-daar-871').label,
      'Dødsfall av demens (inkl. Alzheimers sykdom), etter kjønn (aldersstandardiserte rater)');
    assert.equal(row('fhi-nokkel-369').label,
      'Personer i kontakt med fastlege, legevakt, fysioterapeut eller kiropraktor (KPR), treårige tall');
    assert.equal(row('fhi-kpr-634').label,
      'Helse- og omsorgstjenester: antall brukere per tjeneste');
  });

  it('kuratering fjerner både kodeprefiks og metadatahale fra råtittelen', () => {
    // Rå: 'F0: Fødte og fødsler per år og måned'
    assert.equal(row('fhi-mfr-411').label, 'Fødte og fødsler per år og måned');
    // Rå: 'Legemiddelgruppe – ADHD-midler. 2004-2025. [Oppdatert 16.02.2026] '
    assert.equal(row('fhi-lmr-819').label, 'Legemiddelbruk: ADHD-midler');
  });

  it('Norges Bank viser label fra dataflyt-katalogen', () => {
    assert.equal(row('nb-GOVT_KEYFIGURES').label, 'Nøkkeltall for statsgjelden');
    assert.equal(row('nb-SEC').label, 'Statspapirer – kurser og renter');
    assert.equal(row('nb-REGNET-ARSLONN').label, 'Regionalt nettverk, årslønnsvekst, etter næring');
  });

  it('kuratering er koblet på for så godt som hele FHI-katalogen', () => {
    // Faller dette til ~0, er koblingen i applyCuration/fhi-adapter røket, og
    // portalen viser interne kodenavn. Terskelen tåler at kuratering endrer seg
    // noe over tid (363 av 370 i dag), men ikke at den forsvinner.
    let differing = 0;
    let total = 0;
    for (const source of Object.values(app.FhiCatalog.sources)) {
      for (const t of source.tables) {
        total++;
        if (t.title !== t.internalName) differing++;
      }
    }
    assert.equal(total, 370);
    assert.ok(differing >= 360, `bare ${differing} av ${total} tabeller er kuratert`);
  });

  it('ingen fremmedtabell mangler navn eller viser bare id-en sin', () => {
    for (const t of foreignTables) {
      assert.equal(typeof t.label, 'string', `${t.id} har ingen label`);
      assert.ok(t.label.trim().length > 0, `${t.id} har tom label`);
      assert.notEqual(t.label, t.id, `${t.id} viser id-en som navn`);
    }
  });

  it('renderen slipper alle 401 kuraterte navn gjennom uendret', () => {
    // cleanTableLabel stripper ledende «12345: » og etterfølgende periodesuffiks
    // for SSB-titler. Heuristikken skal ALDRI spise et kuratert navn — blir den
    // grådigere, er dette testen som fanger det.
    const mangled = foreignTables
      .filter(t => app.BrowserState.cleanTableLabel(t.label, t.firstPeriod, t.lastPeriod) !== t.label)
      .map(t => t.id);
    assert.deepEqual(mangled, []);
  });
});

describe('Katalogkontrakten mot menu-hierarchy', () => {
  it('hvert stisegment har både label og sortCode', () => {
    // _collectAllTables og groupTables sorterer med localeCompare uten
    // null-vakt; et segment uten sortCode kaster ved første rendring.
    for (const t of foreignTables) {
      for (const path of t.paths) {
        for (const seg of path) {
          assert.equal(typeof seg.label, 'string', `${t.id}: segment ${seg.id} mangler label`);
          assert.ok(seg.label.length > 0, `${t.id}: segment ${seg.id} har tom label`);
          assert.equal(typeof seg.sortCode, 'string', `${t.id}: segment ${seg.id} mangler sortCode`);
          assert.ok(seg.sortCode.length > 0, `${t.id}: segment ${seg.id} har tom sortCode`);
        }
      }
    }
  });

  it('updated er alltid en streng', () => {
    for (const t of foreignTables) {
      assert.equal(typeof t.updated, 'string', `${t.id}.updated er ${typeof t.updated}`);
    }
  });

  it('første segment i hver sti er tabellens subjectCode', () => {
    for (const t of foreignTables) {
      assert.equal(t.paths[0][0].id, t.subjectCode, `${t.id}`);
    }
  });
});

describe('#topic/os/os07/offogjeld — SSB og Norges Bank side om side', () => {
  it('løvnoden har ingen egne tabeller; alt ligger i barneseksjoner', () => {
    const node = mh.getNodeForPath(OFFOGJELD);
    assert.ok(node, 'fant ikke noden');
    assert.equal(node.tables.length, 0);
  });

  it('Norges Bank-noden ligger der med alle statsgjeldstabellene', () => {
    const node = mh.getNodeForPath(OFFOGJELD);
    const nbNode = node.children['nb-statsgjeld'];
    assert.ok(nbNode, `barnenoder: ${Object.keys(node.children).join(', ')}`);
    assert.equal(nbNode.label, 'Statsgjeld og statspapirer');
    assert.equal(nbNode.tables.length, 14);
    assert.ok(nbNode.tables.some(t => t.id === 'nb-GOVT_KEYFIGURES'));
  });

  it('SSB-tabellene ligger i sine egne seksjoner', () => {
    const node = mh.getNodeForPath(OFFOGJELD);
    assert.deepEqual(node.children['SBMENU5262'].tables.map(t => t.id), ['11560', '05830']);
    assert.deepEqual(node.children['SBMENU5263'].tables.map(t => t.id), ['07511']);
  });

  it('Norges Bank-seksjonen sorterer SIST', () => {
    // sortCode sammenlignes som STRENG. Derfor er '912' større enn SSBs
    // '0000900010'. Byttes dette til numerisk sortering, havner fremmedkildene
    // øverst i emnetreet — synlig for hver eneste bruker.
    const node = mh.getNodeForPath(OFFOGJELD);
    const order = Object.values(node.children)
      .sort((a, b) => a.sortCode.localeCompare(b.sortCode))
      .map(c => c.id);
    assert.deepEqual(order, ['SBMENU5262', 'SBMENU5263', 'FRA_GAMMEL_00478', 'nb-statsgjeld']);
  });

  it('getChildrenForPath rapporterer riktig antall per seksjon', () => {
    const children = mh.getChildrenForPath(OFFOGJELD);
    const byId = Object.fromEntries(children.map(c => [c.id, c]));
    assert.equal(byId['nb-statsgjeld'].tableCount, 14);
    assert.equal(byId['nb-statsgjeld'].hasChildren, false);
    assert.equal(byId['SBMENU5262'].tableCount, 2);
    assert.equal(byId['SBMENU5262'].label, 'Kvartalsvise tall');
  });
});

describe('#topic/he/he04/helsetjko — SSB og FHI side om side', () => {
  it('FHI-registeret ligger der med sine tabeller', () => {
    const node = mh.getNodeForPath(HELSETJKO);
    const kpr = node.children['fhi-kpr'];
    assert.ok(kpr, `barnenoder: ${Object.keys(node.children).join(', ')}`);
    assert.equal(kpr.label, 'Kommunalt pasient- og brukerregister');
    assert.equal(kpr.tables.length, 3);
  });

  it('de kuraterte FHI-navnene er på plass i treet, ikke bare i katalogen', () => {
    const kpr = mh.getNodeForPath(HELSETJKO).children['fhi-kpr'];
    assert.ok(kpr.tables.some(t => t.label === 'Helse- og omsorgstjenester: antall brukere per tjeneste'),
      `fikk: ${kpr.tables.map(t => t.label).join(' | ')}`);
  });

  it('FHI-seksjonen sorterer sist, etter SSB-seksjonene', () => {
    const node = mh.getNodeForPath(HELSETJKO);
    const order = Object.values(node.children)
      .sort((a, b) => a.sortCode.localeCompare(b.sortCode))
      .map(c => c.id);
    assert.equal(order.at(-1), 'fhi-kpr');
  });
});

describe('Flerstiplassering: samme tabell to steder i treet', () => {
  it('KPR ligger både under pasientregisteret og under kommunehelsetenesta', () => {
    const viaRegister = mh.getNodeForPath(['he', 'he04', 'fhi-pasientregister', 'fhi-kpr']);
    const viaKommune = mh.getNodeForPath([...HELSETJKO, 'fhi-kpr']);
    assert.ok(viaRegister, 'mangler plassering under fhi-pasientregister');
    assert.ok(viaKommune, 'mangler plassering under helsetjko');
    assert.deepEqual(
      viaRegister.tables.map(t => t.id).sort(),
      viaKommune.tables.map(t => t.id).sort()
    );
  });

  it('det er samme tabellOBJEKT begge steder, ikke en kopi', () => {
    // Konsekvens: syncTablePeriodsFromMetadata kan mutere ett sted og treffe
    // begge visningene. Blir dette to kopier, oppdateres bare den ene.
    const a = mh.getNodeForPath(['he', 'he04', 'fhi-pasientregister', 'fhi-kpr']).tables;
    const b = mh.getNodeForPath([...HELSETJKO, 'fhi-kpr']).tables;
    const byId = id => [a.find(t => t.id === id), b.find(t => t.id === id)];
    const [x, y] = byId('fhi-kpr-634');
    assert.ok(x && y);
    assert.equal(x, y);
  });

  it('he04 teller de tre KPR-tabellene én gang, ikke to', () => {
    const he04 = mh.getNodeForPath(['he', 'he04']);
    const ids = mh._collectAllTables(he04).map(t => t.id);
    const kprIds = ids.filter(id => id.startsWith('fhi-kpr-'));
    assert.equal(kprIds.length, new Set(kprIds).size, `duplikater: ${kprIds.join(', ')}`);
    assert.equal(kprIds.length, 3);
  });
});

describe('getNodeForPath på ukjente stier', () => {
  it('returnerer null i stedet for å kaste', () => {
    assert.equal(mh.getNodeForPath(['os', 'finnesikke']), null);
    assert.equal(mh.getNodeForPath([...OFFOGJELD, 'finnesikke']), null);
    assert.equal(mh.getNodeForPath([]), null);
  });
});

describe('Emnenivået over rutene', () => {
  it('os og he finnes som toppnoder med undernoder', () => {
    assert.ok(hierarchy.os, `toppnoder: ${Object.keys(hierarchy).join(', ')}`);
    assert.ok(hierarchy.he);
    assert.ok(mh.getSubtopicsForSubject('os').some(s => s.id === 'os07'));
    assert.ok(mh.getSubtopicsForSubject('he').some(s => s.id === 'he04'));
  });

  it('brødsmulene for begge rutene har fire ledd, med emnegruppa først', () => {
    const crumbs = mh.getBreadcrumbs(OFFOGJELD);
    assert.deepEqual(crumbs.map(c => c.path.join('/')),
      ['okonomi', 'os', 'os/os07', 'os/os07/offogjeld']);

    const helse = mh.getBreadcrumbs(HELSETJKO);
    assert.deepEqual(helse.map(c => c.path.join('/')),
      ['helse', 'he', 'he/he04', 'he/he04/helsetjko']);
  });
});
