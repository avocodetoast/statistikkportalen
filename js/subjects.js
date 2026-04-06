/**
 * Emnekonfigurasjon for SSBs statistikkbank
 *
 * subjectGroups: Toppnivågruppering av emner (vises som fliser på forsiden).
 *   Hver gruppe har en id, en label og en liste med emne-koder (subjects).
 *
 * subjectNames: Emne-kode til visningsnavn. Brukes som fallback hvis
 *   oversettelsesnøkkelen subject.name.{kode} mangler i translations.js.
 *
 * For en annen instans (f.eks. SCB): bytt ut denne filen med tilsvarende
 * struktur for den aktuelle statistikkbanken.
 */
const SubjectConfig = {
  subjectGroups: {
    'arbeid': {
      id: 'arbeid',
      label: 'Arbeid, lønn og utdanning',
      subjects: ['al', 'if', 'ud']
    },
    'befolkning': {
      id: 'befolkning',
      label: 'Befolkning og bolig',
      subjects: ['be', 'bb', 'in']
    },
    'helse': {
      id: 'helse',
      label: 'Helse og samfunn',
      subjects: ['he', 'kf', 'sk', 'sv', 'va']
    },
    'miljo': {
      id: 'miljo',
      label: 'Miljø og transport',
      subjects: ['nm', 'tr']
    },
    'naring': {
      id: 'naring',
      label: 'Næringsliv og teknologi',
      subjects: ['ei', 'js', 'ti', 'vt', 'vf']
    },
    'okonomi': {
      id: 'okonomi',
      label: 'Økonomi',
      subjects: ['bf', 'nk', 'os', 'pp', 'ut']
    }
  },

  subjectNames: {
    'al': 'Arbeid og lønn',
    'if': 'Inntekt og forbruk',
    'ud': 'Utdanning',
    'be': 'Befolkning',
    'bb': 'Bygg, bolig og eiendom',
    'in': 'Innvandring og innvandrere',
    'he': 'Helse',
    'kf': 'Kultur og fritid',
    'sk': 'Sosiale forhold og kriminalitet',
    'sv': 'Svalbard',
    'va': 'Valg',
    'nm': 'Natur og miljø',
    'tr': 'Transport og reiseliv',
    'ei': 'Energi og industri',
    'js': 'Jord, skog, jakt og fiskeri',
    'ti': 'Teknologi og innovasjon',
    'vt': 'Varehandel og tjenesteyting',
    'vf': 'Bedrifter, foretak og regnskap',
    'bf': 'Bank og finansmarked',
    'nk': 'Nasjonalregnskap og konjunkturer',
    'os': 'Offentlig sektor',
    'pp': 'Priser og prisindekser',
    'ut': 'Utenriksøkonomi'
  }
};

window.SubjectConfig = SubjectConfig;
