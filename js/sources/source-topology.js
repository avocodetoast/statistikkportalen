/**
 * Emnetre-topologi for fremmede kilder: syntetiske emnetre-noder (sourceNodes)
 * for Norges Bank + FHI, og FHIs registerliste + emnetre-plasseringer. Skilt ut
 * fra js/config.js fordi dette er ren presentasjons-/plasseringsdata (labels +
 * sorteringskoder + kryssplasseringer), ikke app-innstillinger.
 *
 * Setter `window.SourceTopology = { sourceNodes, fhi: { sourceIds, paths } }`.
 * Konsumeres av:
 *   - js/config.js — eksponerer sourceNodes/fhi.sourceIds/fhi.paths på AppConfig
 *     (så adaptere og øvrig kode leser dem på samme sted som før).
 *   - js/sources/norges-bank-adapter.js + js/sources/fhi-adapter.js — leser
 *     AppConfig.sourceNodes for node-labels og AppConfig.sources.fhi.{sourceIds,
 *     paths} for plassering.
 *   - scripts/lib/seo-sources.mjs (via node:vm) — samme oppslag på appConfig.
 *
 * NB-tabellenes egne emnetre-plasseringer (paths) ligger per dataflow-rad i
 * js/sources/nb-catalog.js; her ligger bare NODENE de peker på.
 *
 * LASTEREKKEFØLGE: må lastes FØR js/config.js (config refererer
 * window.SourceTopology). scripts/generate-seo-pages.mjs kjører denne filen i
 * samme vm-sandkasse før config.js — hold den som en ren browser-global uten
 * avhengigheter.
 */
(function () {
  'use strict';

  /**
   * Emnetre-noder for fremmede kilder (nivå ≥ 2 under en SSB-subjektkode).
   *
   * Fremmede tabeller får syntetiske `paths[]` på formen
   * `[{ id: <subjektkode>, ... }, { id: <node-id>, label, sortCode }, ...]`, slik
   * at de glir inn i det eksisterende emnehierarkiet (menu-hierarchy.js) uten
   * viewendringer. En path kan ha vilkårlig dybde (subjekt + én eller flere
   * noder). `9xx`-noder plasserer NB-leaf-nodene sist blant SSB-undertemaene.
   *
   * SSB-PASSTHROUGH-NODER (bf02/bf03/renter/bf04/verdipapirer/nk02/os04/os07/
   * offogjeld/ei02): disse speiler SSBs egne mappe-id-er slik at NB-tabeller
   * MERGES inn i SSBs mapper (menu-hierarchy.js keyer tre-noder på `id`) i
   * stedet for å lage dublett-mapper. Label/sortCode her er kun fallback —
   * SSBs egne tabeller oppretter nodene først («først-sett vinner» i
   * _addPathToHierarchy), så SSBs faktiske (og språk-lokaliserte) verdier
   * brukes i praksis. Id-ene er verifisert mot data.ssb.no/api/pxwebapi/v2.
   *
   * NB: Passthrough-/FHI-labelene er kun norske (`nb`). Adaptere/UI som slår
   * opp en label for et annet språk MÅ falle tilbake til `nb` når `en` mangler
   * (for passthrough-nodene leverer SSBs egne data uansett `en`-labelen).
   */
  const sourceNodes = {
    // Norges Bank – tematiske leaf-noder (kryssplasseres under flere SSB-mapper).
    'nb-finansmarkeder':    { sortCode: '905', label: { nb: 'Finansmarkeder', en: 'Financial markets' } },
    'nb-pengepolitikk':     { sortCode: '910', label: { nb: 'Pengepolitikk og pengemarked', en: 'Monetary policy and money market' } },
    'nb-valuta':            { sortCode: '911', label: { nb: 'Valuta', en: 'Currency' } },
    'nb-statsgjeld':        { sortCode: '912', label: { nb: 'Statsgjeld og statspapirer', en: 'Government debt and securities' } },
    'nb-fin-indikatorer':   { sortCode: '913', label: { nb: 'Norges Banks finansielle indikatorer', en: "Norges Bank's financial indicators" } },
    'nb-regionalt-nettverk':{ sortCode: '914', label: { nb: 'Regionalt nettverk', en: 'Regional network' } },
    // SSB-passthrough for NB (speiler SSBs egne folder-id-er — se blokk-
    // kommentaren over). nb+en; en-labelene er SSBs egne engelske mappenavn.
    'bf02':        { sortCode: '0000007', label: { nb: 'Finansielle indikatorer', en: 'Financial indicators' } },
    'bf03':        { sortCode: '0000008', label: { nb: 'Finansinstitusjoner og andre finansielle foretak', en: 'Financial institutions and other financial corporations' } },
    'renter':      { sortCode: '0000009', label: { nb: 'Renter i banker og kredittforetak', en: 'Interest rates in banks and mortgage companies' } },
    'bf04':        { sortCode: '0000009', label: { nb: 'Verdipapirmarkeder', en: 'Securities markets' } },
    'verdipapirer':{ sortCode: '0000010', label: { nb: 'Verdipapirer', en: 'Securities' } },
    'nk02':        { sortCode: '0000068', label: { nb: 'Konjunkturer', en: 'Business cycles' } },
    'os04':        { sortCode: '0000079', label: { nb: 'Offentlig forvaltning', en: 'General government' } },
    'os07':        { sortCode: '0000081', label: { nb: 'Statlige finanser', en: 'Central government finances' } },
    // 'offogjeld' finnes hos SSB under både os04 (0000080) og os07 (0000082) med
    // samme id; distinkte tre-noder (ulik forelder) + SSB-tabeller begge steder →
    // vår ene sortCode-verdi brukes ikke i praksis.
    'offogjeld':   { sortCode: '0000080', label: { nb: 'Offentlig forvaltnings fordringer og gjeld', en: 'General government, financial assets and liabilities' } },
    'ei02':        { sortCode: '0000032', label: { nb: 'Industri og bergverksdrift', en: 'Manufacturing, mining and quarrying' } },
    // SSB-passthrough for FHI: helse-/befolkningsmapper (samme merge-mønster).
    'he03':        { sortCode: '0000036', label: { nb: 'Helseforhold og levevaner', en: 'Health conditions and living habits' } },
    'he04':        { sortCode: '0000037', label: { nb: 'Helsetjenester', en: 'Health services' } },
    'helsetjko':   { sortCode: '0000038', label: { nb: 'Kommunehelsetenesta', en: 'Municipal health care service' } },
    'be01':        { sortCode: '0000017', label: { nb: 'Barn, familier og husholdninger', en: 'Children, families and households' } },
    'be06':        { sortCode: '0000021', label: { nb: 'Fødte og døde', en: 'Births and deaths' } },
    // 'fodte' finnes hos SSB under be01 (0000018), be06 (0000022) og in03 (0000046)
    // med samme id; distinkte tre-noder (ulik forelder) → vår ene sortCode brukes
    // ikke i praksis (SSB-tabeller finnes alle tre steder).
    'fodte':       { sortCode: '0000018', label: { nb: 'Fødte', en: 'Births' } },
    'dode':        { sortCode: '0000022', label: { nb: 'Døde', en: 'Deaths' } },
    'in03':        { sortCode: '0000045', label: { nb: 'Befolkning', en: 'Population' } },
    // FHI-grupperingsnoder (FHI-eide mellomnivåer under SSB-mappene).
    'fhi-sykdommer':       { sortCode: '9970', label: { nb: 'Sykdommer', en: 'Diseases' } },
    'fhi-pasientregister': { sortCode: '9971', label: { nb: 'Pasientregister', en: 'Patient registries' } },
    'fhi-legemidler':      { sortCode: '9972', label: { nb: 'Legemidler', en: 'Pharmaceuticals' } },
    // FHI-registrene (leaf-noder): rene navn (kilde vises per tabell), nb+en.
    // '99xx'-koder ordner søsken innen samme forelder (jf. grupperingsnodene).
    'fhi-nokkel':      { sortCode: '9900', label: { nb: 'Folkehelse – nøkkeltall', en: 'Public health – key figures' } },
    'fhi-mfr':         { sortCode: '9905', label: { nb: 'Medisinsk fødselsregister', en: 'Medical Birth Registry' } },
    'fhi-daar':        { sortCode: '9910', label: { nb: 'Dødsårsaksregisteret', en: 'Cause of Death Registry' } },
    'fhi-msis':        { sortCode: '9915', label: { nb: 'Smittsomme sykdommer', en: 'Communicable diseases' } },
    'fhi-hkr':         { sortCode: '9916', label: { nb: 'Hjerte- og karregisteret', en: 'Cardiovascular Disease Registry' } },
    'fhi-ngs':         { sortCode: '9917', label: { nb: 'Mikrobiologisk genomovervåkning', en: 'Microbial genomic surveillance' } },
    'fhi-sysvak':      { sortCode: '9920', label: { nb: 'Vaksinasjonsregisteret', en: 'Vaccination Registry' } },
    'fhi-npr':         { sortCode: '9925', label: { nb: 'Norsk pasientregister', en: 'Norwegian Patient Registry' } },
    'fhi-kpr':         { sortCode: '9930', label: { nb: 'Kommunalt pasient- og brukerregister', en: 'Municipal Patient and User Registry' } },
    'fhi-lmr':         { sortCode: '9935', label: { nb: 'Legemiddelregisteret', en: 'Norwegian Prescription Registry' } },
    'fhi-gs':          { sortCode: '9940', label: { nb: 'Grossistbasert legemiddelstatistikk', en: 'Wholesale-based drug statistics' } },
    'fhi-abr':         { sortCode: '9950', label: { nb: 'Abortregisteret', en: 'Abortion Registry' } },
    'fhi-skast':       { sortCode: '9960', label: { nb: 'Skadedyrstatistikken', en: 'Pest control statistics' } }
  };

  // Folkehelseinstituttet (åpent statistikk-API, JSON-Stat2 native). Adapteren
  // er generisk over `sourceIds` — flere kilder aktiveres ved å legge til en id
  // her (se «Senere» i ROADMAP.md). `paths: { <sourceId>: [[subjekt, ...noder],
  // ...] }` overstyrer standardplasseringen (['he', 'fhi-<sourceId>']) med én
  // eller flere emnetre-plasseringer av vilkårlig dybde (subjekt + én eller
  // flere noder, inkl. SSB-passthrough-id-er som he03/be06/fodte). Kategori-
  // segmentet (register → kategori, fra fhi-catalog.json) legges automatisk på
  // ENDEN av hver plassering. Samme krav til sourceNodes/subjects.js som for NB.
  const fhi = {
    sourceIds: [
      'nokkel', 'mfr', 'daar',
      'msis', 'sysvak', 'npr', 'kpr', 'lmr',
      'gs', 'hkr', 'abr', 'ngs', 'skast'
    ],
    // Kryssplassering dypt inn i SSBs helse-/befolkningsmapper. Hver leaf-node
    // er registerets fhi-<sourceId>-node; grupperingsnodene (fhi-sykdommer/
    // fhi-pasientregister/fhi-legemidler) samler beslektede registre.
    paths: {
      nokkel: [['he', 'he03', 'fhi-nokkel']],
      mfr:    [['be', 'be01', 'fodte', 'fhi-mfr'], ['be', 'be06', 'fodte', 'fhi-mfr'], ['in', 'in03', 'fodte', 'fhi-mfr']],
      daar:   [['be', 'be06', 'dode', 'fhi-daar'], ['he', 'he03', 'fhi-daar']],
      msis:   [['he', 'he03', 'fhi-sykdommer', 'fhi-msis']],
      sysvak: [['he', 'he04', 'fhi-sysvak']],
      npr:    [['he', 'he04', 'fhi-pasientregister', 'fhi-npr']],
      kpr:    [['he', 'he04', 'fhi-pasientregister', 'fhi-kpr'], ['he', 'he04', 'helsetjko', 'fhi-kpr']],
      lmr:    [['he', 'he04', 'fhi-legemidler', 'fhi-lmr']],
      gs:     [['he', 'he04', 'fhi-legemidler', 'fhi-gs']],
      hkr:    [['he', 'he03', 'fhi-sykdommer', 'fhi-hkr']],
      abr:    [['he', 'he03', 'fhi-abr']],
      ngs:    [['he', 'he03', 'fhi-sykdommer', 'fhi-ngs']],
      skast:  [['he', 'he03', 'fhi-skast']]
    }
  };

  window.SourceTopology = { sourceNodes: sourceNodes, fhi: fhi };
})();
