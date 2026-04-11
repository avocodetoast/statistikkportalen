/**
 * Søkesynonymer for enhanced søk
 *
 * Hver gruppe er et sett av ekvivalente termer (normalisert: lowercase, uten diakritika).
 * Hvis et søkeord treffer én term i en gruppe, utvides søket til alle andre termer i gruppen.
 * Legg til/fjern grupper eller termer fritt — rekkefølge innad i gruppen er uten betydning.
 *
 * Normalisering: å→a, ø→o, æ→ae (se SearchEnhanced.normalizeText)
 */
const SearchSynonyms = [
  ['aku', 'arbeidskraftundersokelsen', 'arbeidskraftmaling'],
  ['bnp', 'bruttonasjonalprodukt', 'bruttoprodukt'],
  ['kpi', 'konsumprisindeks', 'prisvekst', 'inflasjon'],
  ['knr', 'nasjonalregnskap'],
  ['fob', 'folke og boligtellingen', 'folke boligtellingen'],
  ['ssb', 'statistisk sentralbyra'],
  ['nav', 'arbeids og velferdsetaten'],
  ['nho', 'naeringslivets hovedorganisasjon'],
  ['sfo', 'skolefritidsordning'],
  ['vgs', 'videregaende skole', 'videregaende opplaering'],
  ['gsi', 'grunnskolens informasjonssystem'],
  ['kostra', 'kommune stat rapportering'],
  ['fhi', 'folkehelseinstituttet'],
  ['mva', 'merverdiavgift', 'merverdi'],
  ['helse', 'helseforetak', 'sykehus'],
  ['bolig', 'eiendom', 'boliger'],
  ['sysselsetting', 'sysselsatte', 'arbeidsforhold'],
  ['arbeidsledig', 'arbeidsledighet', 'ledige', 'ledighetsprosent'],
];

window.SearchSynonyms = SearchSynonyms;
