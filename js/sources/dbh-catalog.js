/** Kuratert, nettverksfri katalog for DBH. Lastes før config.js. */
(function () {
  'use strict';
  function row(id, title, path, dimensions, measures, gdpr, extra) {
    return Object.assign({
      id: 'dbh-' + id, rawId: id, title: title, paths: [['ud', path]],
      timeUnit: 'year', dimensions: dimensions.map(function (d) {
        return typeof d === 'string' ? { code: d, label: d } : d;
      }), measures: measures, gdpr: gdpr,
      aboutUrl: 'https://dbh.hkdir.no/datainnhold/tabell-dokumentasjon/' + id
    }, extra || {});
  }
  const I = { code: 'Institusjonskode', label: 'Institusjon', nameColumn: 'Institusjonsnavn' };
  const tables = [
    row(379, 'Søkertall og møtte', 'dbh-studenter', ['Årstall','Semester',I,'Kjønn','Nivåkode','Opptakstype'], ['Søknadsalternativer','Tilbud om opptak','Akseptert tilbud','Møtt til studiestart'], true),
    row(571, 'Gjennomsnittlige opptakspoeng', 'dbh-studenter', ['Årstall','Semester',I,'Kjønnkode','Nivåkode','Opptakstype'], ['Opptakspoeng totalt','Karakterpoeng','Søkere totalt'], true, { noteKey: 'dbh.nonAdditiveNote' }),
    row(124, 'Registrerte studenter per campus', 'dbh-studenter', ['Årstall',I,'Stedkode campus'], ['Antall'], true),
    row(900, 'Studiepoeng', 'dbh-studenter', ['Årstall','Semester',I,'Finansieringskilde','Studentkategori'], ['Ny produksjon totalt','Ny produksjon totalt kv','Ny produksjon egentfin','Ny produksjon egentfin kv','Ny produksjon ekstern','Ny produksjon ekstern kv'], false),
    row(905, 'Eksamensdata', 'dbh-studenter', ['Årstall','Semester',I,'Avdelingskode'], ['Oppmeldt totalt','Møtt til eksamen','Bestått','Beståtte gjentak','Antall kandidater stryk','Eksamensprod med gjentak','Eksamensprod uten gjentak'], true),
    row(704, 'Gjennomføring og frafall (institusjonsnivå)', 'dbh-studenter', ['Årstall',I,'Kjønnkode','Nivåkode'], ['Startkull','Fullført normert','Fullført normert1','Fullført normert2','Studerer','Studerer1','Studerer2','Frafalt','Frafalt1','Frafalt2'], true),
    row(560, 'Uteksaminerte grunnskolelærere', 'dbh-studenter', ['Årstall',I,'GLU-type','Type fordypning'], ['Antall 30-studiepoengsenheter','Antall 60-studiepoengsenheter','Antall fullført GLU mastergrad'], true),
    row(370, 'Studieplasser', 'dbh-studietilbud', ['Årstall','Semester',I,'Studietypekode','Opptakstype'], ['Antall studieplasser','Antall studieplasser Y-vei'], false),
    row(373, 'Vitenskapelig publisering', 'dbh-forskning', ['Årstall',I,'Kode for publikasjonsform','Kode for type publiseringskanal'], ['Antall publikasjoner','Antall internasjonale publikasjoner','Forfatterandeler','Forfatterandeler kvinner','Forfatterandeler menn','Publiseringspoeng','Publiseringspoeng kvinner','Publiseringspoeng menn'], false),
    row(222, 'Alle tilsatte (hodetelling)', 'dbh-personale', ['Årstall',I,'Avdelingskode'], ['Antall totalt','Antall kvinner','Antall menn'], true),
    row(226, 'Areal', 'dbh-annet', ['Årstall',I,'Leieforhold'], ['Brutto m2'], false),
    row(390, 'Mottatte forretningsideer', 'dbh-annet', ['Årstall',I,'Type'], ['Antall totalt'], false),
    row(555, 'Søknader (fagskoler)', 'dbh-fagskoler', ['Årstall','Semester','Fagskolenummer'], ['Antall søknader','Antall søknader fra kvinnelige søkere','Antall søknader fra menn'], true),
    row(947, 'Fagskolestudenter – aktive', 'dbh-fagskoler', ['Årstall','Semesternavn','Fagskolens navn'], ['Antall menn','Antall kvinner','Antall studenter'], true)
  ];
  window.DbhCatalog = { tables: tables };
})();
