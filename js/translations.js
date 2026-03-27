/**
 * Localization / i18n for the statistics browser.
 *
 * t(key)           — look up a UI string in the current language
 * tpl(key, ...args) — same, but replace {0}, {1}, … placeholders with args
 * setLanguage(code) — switch UI language and re-render; persisted in localStorage
 * getCurrentApiLang() — returns the API lang= parameter for the active language
 *
 * Language codes used here are UI codes ('nb', 'en', 'sv').
 * API language codes ('no', 'en', 'sv') are defined per-language in AppConfig.languages.
 *
 * NOTE: Instance-specific strings (source name, app name, URLs) live in AppConfig,
 * not here. Do not hard-code "SSB", "SCB", or any brand name in this file.
 */

// ---------------------------------------------------------------------------
// Translation dictionary
// ---------------------------------------------------------------------------

const translations = {

  // Norwegian Bokmål
  nb: {
    // Loading states
    'loading.app':       'Laster...',
    'loading.init':      'Initialiserer...',
    'loading.tables':    'Laster tabellliste...',
    'loading.metadata':  'Laster metadata...',
    'loading.data':      'Henter data...',
    'loading.file':      'Laster ned fil...',

    // Errors
    'error.prefix':           'Feil:',
    'error.details':          'Se tekniske detaljer',
    'error.loadData':         'Kunne ikke laste data',
    'error.loadMetadata':     'Kunne ikke laste metadata for tabell ',
    'error.fetchData':        'Kunne ikke hente data fra API. Prøv igjen eller endre variabelvalget.',
    'error.noData':           'Ingen data funnet for valgt kombinasjon. Prøv å endre variabelvalget.',
    'error.buildTable':       'Kunne ikke bygge tabell',
    'error.noTable':          'Ingen tabell valgt',
    'error.noTableOrSel':     'Mangler tabell eller variabelvalg',
    'error.noDataExport':     'Ingen data å eksportere',
    'error.noDataRotate':     'Ingen data å rotere',
    'error.downloadFailed':   'Nedlastingen feilet',
    'error.downloadFailed2':  'Kunne ikke laste ned filen',
    'error.loadCodelist':     'Kunne ikke laste kodeliste',
    'error.noTablesPath':     'Fant ingen tabeller for denne stien',
    'error.unknownView':      'Ukjent visning',
    'error.rateLimit':        'For mange forespørsler. Vennligst vent litt og prøv igjen.',
    'error.cellLimit':        'Spørringen ga for mange celler. Reduser utvalget og prøv igjen.',

    // Navigation
    'nav.home':          'Forsiden',
    'nav.subjects':      'Emner',
    'nav.search':        'Søk',
    'nav.back.tables':   '\u2190 Tilbake til tabelloversikt',
    'nav.back.variables': '\u2190 Endre variabelvalg',

    // Table units (singular / plural)
    'unit.table.one':   'tabell',
    'unit.table.many':  'tabeller',
    'unit.value.one':   'verdi',
    'unit.value.many':  'verdier',
    'unit.cell.one':    'celle',
    'unit.cell.many':   'celler',

    // Date / update periods (front page)
    'date.updatedToday':    'Oppdatert i dag',
    'date.yesterday':       'I går',
    'date.friday':          'Fredag',
    'date.noTablesUpdated': 'Ingen tabeller oppdatert',
    'date.earlier7Days':    'Tidligere siste 7 dager',

    // Search view
    'search.placeholder':   'Søk etter tabell (ID, tittel, variabler...)',
    'search.heading':       'Søk i statistikkbanken',
    'search.instructions':  'Skriv inn søkeord eller bruk filtrene for å finne tabeller',
    'search.results':       'Søkeresultater',
    'search.fuzzyFallback': 'Ingen eksakte treff \u2013 viser omtrentlige treff (fuzzy søk)',
    'search.noResults':     'Ingen tabeller funnet',
    'search.showingFirst':  'Viser de første 100 av {0} resultater i denne gruppen',
    'search.includeStopped': 'Inkluder avsluttede tabeller',
    'search.enhanced':      'Forbedret søk',
    'search.beta':          'beta',

    // Filters (shared between search and topic views)
    'filter.allSubjects':    'Alle emner',
    'filter.allFrequencies': 'Alle frekvenser',
    'filter.monthly':        'Månedlig',
    'filter.quarterly':      'Kvartalsvis',
    'filter.annual':         'Årlig',
    'filter.other':          'Annet',
    'filter.allPeriods':     'Alle perioder',
    'filter.lastDay':        'Oppdatert siste dag',
    'filter.lastWeek':       'Oppdatert siste uke',
    'filter.lastMonth':      'Oppdatert siste måned',
    'filter.lastYear':       'Oppdatert siste år',
    'filter.last2Years':     'Oppdatert siste to år',

    // Topic view
    'topic.unknownGroup': 'Ukjent emnegruppe',

    // Variable selector
    'variable.heading':         'Velg variabler',
    'variable.tablePrefix':     'Tabell',
    'variable.instructions':    'Velg verdier for hver variabel. Klikk for å velge, Shift+klikk for å velge et område, Ctrl/Cmd+klikk for å legge til enkelverdier, Ctrl+A for å velge alle synlige.',
    'variable.fetchData':       'Hent data',
    'variable.selectValues':    'Velg verdier for å se spørringen',
    'variable.selectValuesAll': 'Velg verdier for alle variabler',
    'variable.optional':        'Valgfri variabel',
    'variable.required':        'Må velges *',
    'variable.categorization':  'Gruppering:',
    'variable.freeChoice':      'Velg fritt blant alle verdier',
    'variable.filterPlaceholder': 'Filtrer verdier...',
    'variable.selected':        'Valgt',
    'variable.ofTotal':         'av totalt',
    'variable.withoutTitle':    'Uten tittel',
    'variable.withTitle':       'Med tittel',
    'variable.truncated':       'Viser {0} av {1} verdier. Bruk "Alle (*)" for å inkludere alle.',

    // Variable mode buttons
    'variable.btn.all':         'Alle (*)',
    'variable.btn.selectAll':   'Velg alle',
    'variable.btn.deselectAll': 'Opphev alle',
    'variable.btn.last':        'Siste',

    // Codelist dropdown
    'codelist.error':    'Kunne ikke laste kodeliste',
    'codelist.optional': 'Valgfri variabel',
    'codelist.required': 'Må velges *',

    // Selection status bar
    'status.all':          'alle',
    'status.last':         'siste ',
    'status.ready':        'Klar til å hente data',
    'status.selectRequired': 'Velg minst én verdi for alle obligatoriske variabler',
    'status.noValuesOpt':  'Ingen verdier valgt (variabelen utelates fra spørringen)',
    'status.noValues':     'Ingen verdier valgt',
    'status.allSelected':  'Alle verdier valgt',
    'status.topMode':      'siste {0}',
    'status.tooManyCells': 'For mange celler valgt \u2014 reduser utvalget',
    'status.cellsSelected': '{0} {1} valgt (av maks {2} mulige)',
    'status.exceedsLimit': '\u2014 overskrider API-grensen på 800\u202f000!',

    // API builder
    'api.builder':          '\u25B6 API-bygger',
    'api.method':           'Metode:',
    'api.format':           'Responsformat:',
    'api.display':          'Visning:',
    'api.displayText':      'Tekst',
    'api.displayCodes':     'Koder',
    'api.displayBoth':      'Koder og tekst',
    'api.tableTitle':       'Tabelltittel:',
    'api.separator':        'Skilletegn:',
    'api.separatorSemicolon': 'Semikolon',
    'api.separatorTab':     'Tabulator',
    'api.separatorSpace':   'Mellomrom',
    'api.layout':           'Tabellayout:',
    'api.layoutStandard':   'Standard',
    'api.layoutPivot':      'Pivotvennlig (alle i forspalte)',
    'api.dataUrl':          'Data-URL',
    'api.showPlaintext':    'Vis i klartekst',
    'api.decodedUrlTooltip': 'Vis URL med lesbare tegn i stedet for URL-koding',
    'api.copyUrl':          'Kopier URL',
    'api.copyCurl':         'Kopier som curl-kommando',
    'api.openBrowser':      'Åpne i nettleser',
    'api.openNewTab':       'Åpne i ny fane',
    'api.copied':           'Kopiert!',
    'api.postBody':         'POST-body (JSON)',
    'api.copyBody':         'Kopier body',
    'api.metadataUrl':      'Metadata-URL',
    'api.copyMetadataUrl':  'Kopier metadata-URL',
    'api.openMetadata':     'Åpne metadata i ny fane',
    'api.urlTooLong':       'URL-en er {0} tegn \u2014 overskrider grensen på {1} tegn. Bruk POST-modus for store utvalg.',
    'api.getOnlyFeature':   'Kun tilgjengelig i GET-modus',

    // Table display
    'table.rotate':       '\u21BB Roter tabell',
    'table.download':     '\u2B07 Last ned i Excel-format',
    'table.moreOptions':  'Flere alternativer',
    'table.getLink':      '\uD83D\uDD17 Få lenke',
    'table.notAvailable': 'Ikke tilgjengelig',
    'table.confidential': 'Konfidensielt',
    'table.notApplicable': 'Ikke aktuelt',
    'table.prefix':       'Tabell',
    'table.unnamed':      'Uten navn',

    // Table rotation dialog
    'rotation.title':        'Roter tabell',
    'rotation.instructions': 'Dra dimensjoner mellom rader og kolonner for å endre tabellens layout.',
    'rotation.rows':         'Rader',
    'rotation.columns':      'Kolonner',
    'rotation.presets':      'Hurtigvalg:',
    'rotation.standard':     'Standard',
    'rotation.transpose':    'Transponér',
    'rotation.allRows':      'Alle som rader',
    'rotation.allColumns':   'Alle som kolonner',
    'rotation.apply':        'Bruk layout',
    'rotation.cancel':       'Avbryt',
    'rotation.dropHere':     'Dra dimensjoner hit',
    'rotation.values':       'verdier',
    'rotation.allRequired':  'Alle dimensjoner må være enten i rader eller kolonner',
    'rotation.minOne':       'Tabellen må ha minst én dimensjon',

    // Export dialog
    'export.title':           'Last ned tabell',
    'export.format':          'Filformat:',
    'export.formatExcel':     'Excel (xlsx)',
    'export.formatCsv':       'CSV (semikolon-separert tekstfil)',
    'export.formatPx':        'PX (PC-Axis format)',
    'export.displayAs':       'Vis verdier som:',
    'export.displayStandard': 'Standard',
    'export.displayText':     'Tekst (f.eks. "Oslo")',
    'export.displayCodes':    'Koder (f.eks. "0301")',
    'export.displayBoth':     'Både koder og tekst (f.eks. "0301: Oslo")',
    'export.csvSeparator':    'CSV-separator:',
    'export.sepSemicolon':    'Semikolon (;) \u2013 Standard for norsk Excel',
    'export.sepTab':          'Tabulator',
    'export.sepSpace':        'Mellomrom',
    'export.layout':          'Tabelloppsett:',
    'export.layoutAsShown':   'Som vist på skjermen (heading: {0})',
    'export.layoutPivot':     'Pivotvennlig (alle variabler i stub, lettere å pivotere i Excel)',
    'export.includeTitle':    'Inkluder tabelltittel',
    'export.downloadInfo':    'Filen lastes ned direkte fra {0} sitt API.',
    'export.dataPoints':      'Tabellen inneholder {0} datapunkter.',
    'export.cancel':          'Avbryt',
    'export.download':        'Last ned',

    // Footer
    'footer.dataFrom':    'Data fra',

    // Cache
    'cache.clear':        'T\u00F8m hurtigbuffer',
    'cache.clearTooltip': 'T\u00F8m hurtigbuffer og last inn data p\u00E5 nytt',

    // Search
    'search.found': 'funnet',

    // Language selector
    'lang.label': 'Spr\u00E5k',

    // Subject group labels (SSB taxonomy — translatable)
    'subject.group.arbeid':     'Arbeid, l\u00F8nn og utdanning',
    'subject.group.befolkning': 'Befolkning og bolig',
    'subject.group.helse':      'Helse og samfunn',
    'subject.group.miljo':      'Milj\u00F8 og transport',
    'subject.group.naring':     'N\u00E6ringsliv og teknologi',
    'subject.group.okonomi':    '\u00D8konomi',

    // Subject names (SSB subject codes → display names)
    'subject.name.al': 'Arbeid og l\u00F8nn',
    'subject.name.if': 'Inntekt og forbruk',
    'subject.name.ud': 'Utdanning',
    'subject.name.be': 'Befolkning',
    'subject.name.bb': 'Bygg, bolig og eiendom',
    'subject.name.in': 'Innvandring og innvandrere',
    'subject.name.he': 'Helse',
    'subject.name.kf': 'Kultur og fritid',
    'subject.name.sk': 'Sosiale forhold og kriminalitet',
    'subject.name.sv': 'Svalbard',
    'subject.name.va': 'Valg',
    'subject.name.nm': 'Natur og milj\u00F8',
    'subject.name.tr': 'Transport og reiseliv',
    'subject.name.ei': 'Energi og industri',
    'subject.name.js': 'Jord, skog, jakt og fiskeri',
    'subject.name.ti': 'Teknologi og innovasjon',
    'subject.name.vt': 'Varehandel og tjenesteyting',
    'subject.name.vf': 'Bedrifter, foretak og regnskap',
    'subject.name.bf': 'Bank og finansmarked',
    'subject.name.nk': 'Nasjonalregnskap og konjunkturer',
    'subject.name.os': 'Offentlig sektor',
    'subject.name.pp': 'Priser og prisindekser',
    'subject.name.ut': 'Utenriks\u00F8konomi'
  },

  // -------------------------------------------------------------------------
  // English
  // -------------------------------------------------------------------------
  en: {
    'loading.app':       'Loading...',
    'loading.init':      'Initializing...',
    'loading.tables':    'Loading table list...',
    'loading.metadata':  'Loading metadata...',
    'loading.data':      'Fetching data...',
    'loading.file':      'Downloading file...',

    'error.prefix':           'Error:',
    'error.details':          'Show technical details',
    'error.loadData':         'Could not load data',
    'error.loadMetadata':     'Could not load metadata for table ',
    'error.fetchData':        'Could not fetch data from the API. Please try again or change your variable selection.',
    'error.noData':           'No data found for the selected combination. Try changing your variable selection.',
    'error.buildTable':       'Could not build table',
    'error.noTable':          'No table selected',
    'error.noTableOrSel':     'Missing table or variable selection',
    'error.noDataExport':     'No data to export',
    'error.noDataRotate':     'No data to rotate',
    'error.downloadFailed':   'Download failed',
    'error.downloadFailed2':  'Could not download the file',
    'error.loadCodelist':     'Could not load codelist',
    'error.noTablesPath':     'No tables found for this path',
    'error.unknownView':      'Unknown view',
    'error.rateLimit':        'Too many requests. Please wait a moment and try again.',
    'error.cellLimit':        'The query returned too many cells. Reduce your selection and try again.',

    'nav.home':           'Home',
    'nav.subjects':       'Subjects',
    'nav.search':         'Search',
    'nav.back.tables':    '\u2190 Back to table list',
    'nav.back.variables': '\u2190 Change variable selection',

    'unit.table.one':   'table',
    'unit.table.many':  'tables',
    'unit.value.one':   'value',
    'unit.value.many':  'values',
    'unit.cell.one':    'cell',
    'unit.cell.many':   'cells',

    'date.updatedToday':    'Updated today',
    'date.yesterday':       'Yesterday',
    'date.friday':          'Friday',
    'date.noTablesUpdated': 'No tables updated',
    'date.earlier7Days':    'Earlier this week',

    'search.placeholder':    'Search for table (ID, title, variables...)',
    'search.heading':        'Search the statistics database',
    'search.instructions':   'Enter search terms or use the filters to find tables',
    'search.results':        'Search results',
    'search.fuzzyFallback':  'No exact matches \u2013 showing approximate matches (fuzzy search)',
    'search.noResults':      'No tables found',
    'search.showingFirst':   'Showing first 100 of {0} results in this group',
    'search.includeStopped': 'Include discontinued tables',
    'search.enhanced':       'Enhanced search',
    'search.beta':           'beta',

    'filter.allSubjects':    'All subjects',
    'filter.allFrequencies': 'All frequencies',
    'filter.monthly':        'Monthly',
    'filter.quarterly':      'Quarterly',
    'filter.annual':         'Annual',
    'filter.other':          'Other',
    'filter.allPeriods':     'All periods',
    'filter.lastDay':        'Updated last day',
    'filter.lastWeek':       'Updated last week',
    'filter.lastMonth':      'Updated last month',
    'filter.lastYear':       'Updated last year',
    'filter.last2Years':     'Updated last 2 years',

    'topic.unknownGroup': 'Unknown subject group',

    'variable.heading':         'Select variables',
    'variable.tablePrefix':     'Table',
    'variable.instructions':    'Select values for each variable. Click to select, Shift+click to select a range, Ctrl/Cmd+click to add individual values, Ctrl+A to select all visible.',
    'variable.fetchData':       'Fetch data',
    'variable.selectValues':    'Select values to see the query',
    'variable.selectValuesAll': 'Select values for all variables',
    'variable.optional':        'Optional variable',
    'variable.required':        'Required *',
    'variable.categorization':  'Grouping:',
    'variable.freeChoice':      'Choose freely from all values',
    'variable.filterPlaceholder': 'Filter values...',
    'variable.selected':        'Selected',
    'variable.ofTotal':         'of total',
    'variable.withoutTitle':    'Without title',
    'variable.withTitle':       'With title',
    'variable.truncated':       'Showing {0} of {1} values. Use "All (*)" to include all.',

    'variable.btn.all':         'All (*)',
    'variable.btn.selectAll':   'Select all',
    'variable.btn.deselectAll': 'Deselect all',
    'variable.btn.last':        'Last',

    'codelist.error':    'Could not load codelist',
    'codelist.optional': 'Optional variable',
    'codelist.required': 'Required *',

    'status.all':          'all',
    'status.last':         'last ',
    'status.ready':        'Ready to fetch data',
    'status.selectRequired': 'Select at least one value for all required variables',
    'status.noValuesOpt':  'No values selected (variable will be excluded from query)',
    'status.noValues':     'No values selected',
    'status.allSelected':  'All values selected',
    'status.topMode':      'last {0}',
    'status.tooManyCells': 'Too many cells selected \u2014 reduce the selection',
    'status.cellsSelected': '{0} {1} selected (of max {2} possible)',
    'status.exceedsLimit': '\u2014 exceeds the API limit of 800,000!',

    'api.builder':          '\u25B6 API builder',
    'api.method':           'Method:',
    'api.format':           'Response format:',
    'api.display':          'Display:',
    'api.displayText':      'Text',
    'api.displayCodes':     'Codes',
    'api.displayBoth':      'Codes and text',
    'api.tableTitle':       'Table title:',
    'api.separator':        'Separator:',
    'api.separatorSemicolon': 'Semicolon',
    'api.separatorTab':     'Tab',
    'api.separatorSpace':   'Space',
    'api.layout':           'Table layout:',
    'api.layoutStandard':   'Standard',
    'api.layoutPivot':      'Pivot-friendly (all in stub)',
    'api.dataUrl':          'Data URL',
    'api.showPlaintext':    'Show plaintext',
    'api.decodedUrlTooltip': 'Show URL with readable characters instead of URL encoding',
    'api.copyUrl':          'Copy URL',
    'api.copyCurl':         'Copy as curl command',
    'api.openBrowser':      'Open in browser',
    'api.openNewTab':       'Open in new tab',
    'api.copied':           'Copied!',
    'api.postBody':         'POST body (JSON)',
    'api.copyBody':         'Copy body',
    'api.metadataUrl':      'Metadata URL',
    'api.copyMetadataUrl':  'Copy metadata URL',
    'api.openMetadata':     'Open metadata in new tab',
    'api.urlTooLong':       'The URL is {0} characters \u2014 exceeds the {1} character limit. Use POST mode for large selections.',
    'api.getOnlyFeature':   'Only available in GET mode',

    'table.rotate':        '\u21BB Rotate table',
    'table.download':      '\u2B07 Download in Excel format',
    'table.moreOptions':   'More options',
    'table.getLink':       '\uD83D\uDD17 Get link',
    'table.notAvailable':  'Not available',
    'table.confidential':  'Confidential',
    'table.notApplicable': 'Not applicable',
    'table.prefix':        'Table',
    'table.unnamed':       'Unnamed',

    'rotation.title':        'Rotate table',
    'rotation.instructions': 'Drag dimensions between rows and columns to change the table layout.',
    'rotation.rows':         'Rows',
    'rotation.columns':      'Columns',
    'rotation.presets':      'Quick select:',
    'rotation.standard':     'Standard',
    'rotation.transpose':    'Transpose',
    'rotation.allRows':      'All as rows',
    'rotation.allColumns':   'All as columns',
    'rotation.apply':        'Apply layout',
    'rotation.cancel':       'Cancel',
    'rotation.dropHere':     'Drag dimensions here',
    'rotation.values':       'values',
    'rotation.allRequired':  'All dimensions must be either in rows or columns',
    'rotation.minOne':       'The table must have at least one dimension',

    'export.title':           'Download table',
    'export.format':          'File format:',
    'export.formatExcel':     'Excel (xlsx)',
    'export.formatCsv':       'CSV (semicolon-separated text file)',
    'export.formatPx':        'PX (PC-Axis format)',
    'export.displayAs':       'Display values as:',
    'export.displayStandard': 'Standard',
    'export.displayText':     'Text (e.g. "Oslo")',
    'export.displayCodes':    'Codes (e.g. "0301")',
    'export.displayBoth':     'Both codes and text (e.g. "0301: Oslo")',
    'export.csvSeparator':    'CSV separator:',
    'export.sepSemicolon':    'Semicolon (;) \u2013 Standard for Nordic Excel',
    'export.sepTab':          'Tab',
    'export.sepSpace':        'Space',
    'export.layout':          'Table layout:',
    'export.layoutAsShown':   'As shown on screen (heading: {0})',
    'export.layoutPivot':     'Pivot-friendly (all variables in stub, easier to pivot in Excel)',
    'export.includeTitle':    'Include table title',
    'export.downloadInfo':    'The file is downloaded directly from the {0} API.',
    'export.dataPoints':      'The table contains {0} data points.',
    'export.cancel':          'Cancel',
    'export.download':        'Download',

    // Footer
    'footer.dataFrom':    'Data from',

    // Cache
    'cache.clear':        'Clear cache',
    'cache.clearTooltip': 'Clear cache and reload data',

    // Search
    'search.found': 'found',

    'lang.label': 'Language',

    'subject.group.arbeid':     'Work, wages and education',
    'subject.group.befolkning': 'Population and housing',
    'subject.group.helse':      'Health and society',
    'subject.group.miljo':      'Environment and transport',
    'subject.group.naring':     'Business and technology',
    'subject.group.okonomi':    'Economy',

    'subject.name.al': 'Work and wages',
    'subject.name.if': 'Income and consumption',
    'subject.name.ud': 'Education',
    'subject.name.be': 'Population',
    'subject.name.bb': 'Building, housing and real estate',
    'subject.name.in': 'Immigration and immigrants',
    'subject.name.he': 'Health',
    'subject.name.kf': 'Culture and leisure',
    'subject.name.sk': 'Social conditions and crime',
    'subject.name.sv': 'Svalbard',
    'subject.name.va': 'Elections',
    'subject.name.nm': 'Nature and environment',
    'subject.name.tr': 'Transport and tourism',
    'subject.name.ei': 'Energy and industry',
    'subject.name.js': 'Land, forest, hunting and fishing',
    'subject.name.ti': 'Technology and innovation',
    'subject.name.vt': 'Retail and services',
    'subject.name.vf': 'Enterprises, companies and accounting',
    'subject.name.bf': 'Banking and financial markets',
    'subject.name.nk': 'National accounts and business cycles',
    'subject.name.os': 'Public sector',
    'subject.name.pp': 'Prices and price indices',
    'subject.name.ut': 'External economy'
  },

  // -------------------------------------------------------------------------
  // Swedish
  // -------------------------------------------------------------------------
  sv: {
    'loading.app':       'Laddar...',
    'loading.init':      'Initierar...',
    'loading.tables':    'Laddar tabellista...',
    'loading.metadata':  'Laddar metadata...',
    'loading.data':      'H\u00E4mtar data...',
    'loading.file':      'Laddar ned fil...',

    'error.prefix':           'Fel:',
    'error.details':          'Visa tekniska detaljer',
    'error.loadData':         'Kunde inte ladda data',
    'error.loadMetadata':     'Kunde inte ladda metadata f\u00F6r tabell ',
    'error.fetchData':        'Kunde inte h\u00E4mta data fr\u00E5n API:t. F\u00F6rs\u00F6k igen eller \u00E4ndra variabelurvalet.',
    'error.noData':           'Inga data hittades f\u00F6r vald kombination. F\u00F6rs\u00F6k \u00E4ndra variabelurvalet.',
    'error.buildTable':       'Kunde inte bygga tabellen',
    'error.noTable':          'Ingen tabell vald',
    'error.noTableOrSel':     'Saknar tabell eller variabelurval',
    'error.noDataExport':     'Inga data att exportera',
    'error.noDataRotate':     'Inga data att rotera',
    'error.downloadFailed':   'Nedladdningen misslyckades',
    'error.downloadFailed2':  'Kunde inte ladda ned filen',
    'error.loadCodelist':     'Kunde inte ladda kodlista',
    'error.noTablesPath':     'Hittade inga tabeller f\u00F6r denna s\u00F6kv\u00E4g',
    'error.unknownView':      'Ok\u00E4nd vy',
    'error.rateLimit':        'F\u00F6r m\u00E5nga f\u00F6rfr\u00E5gningar. V\u00E4nta lite och f\u00F6rs\u00F6k igen.',
    'error.cellLimit':        'F\u00F6rfr\u00E5gan returnerade f\u00F6r m\u00E5nga celler. Minska urvalet och f\u00F6rs\u00F6k igen.',

    'nav.home':           'Startsidan',
    'nav.subjects':       '\u00C4mnen',
    'nav.search':         'S\u00F6k',
    'nav.back.tables':    '\u2190 Tillbaka till tabell\u00F6versikt',
    'nav.back.variables': '\u2190 \u00C4ndra variabelurval',

    'unit.table.one':   'tabell',
    'unit.table.many':  'tabeller',
    'unit.value.one':   'v\u00E4rde',
    'unit.value.many':  'v\u00E4rden',
    'unit.cell.one':    'cell',
    'unit.cell.many':   'celler',

    'date.updatedToday':    'Uppdaterad idag',
    'date.yesterday':       'Ig\u00E5r',
    'date.friday':          'Fredag',
    'date.noTablesUpdated': 'Inga tabeller uppdaterade',
    'date.earlier7Days':    'Tidigare senaste 7 dagarna',

    'search.placeholder':    'S\u00F6k efter tabell (ID, titel, variabler...)',
    'search.heading':        'S\u00F6k i statistikdatabasen',
    'search.instructions':   'Ange s\u00F6kord eller anv\u00E4nd filtren f\u00F6r att hitta tabeller',
    'search.results':        'S\u00F6kresultat',
    'search.fuzzyFallback':  'Inga exakta tr\u00E4ffar \u2013 visar ungef\u00E4rliga tr\u00E4ffar (fuzzy s\u00F6kning)',
    'search.noResults':      'Inga tabeller hittades',
    'search.showingFirst':   'Visar de f\u00F6rsta 100 av {0} resultat i denna grupp',
    'search.includeStopped': 'Inkludera avslutade tabeller',
    'search.enhanced':       'F\u00F6rb\u00E4ttrad s\u00F6kning',
    'search.beta':           'beta',

    'filter.allSubjects':    'Alla \u00E4mnen',
    'filter.allFrequencies': 'Alla frekvenser',
    'filter.monthly':        'M\u00E5nadsvis',
    'filter.quarterly':      'Kvartalsvis',
    'filter.annual':         '\u00C5rlig',
    'filter.other':          '\u00D6vrigt',
    'filter.allPeriods':     'Alla perioder',
    'filter.lastDay':        'Uppdaterad senaste dygnet',
    'filter.lastWeek':       'Uppdaterad senaste veckan',
    'filter.lastMonth':      'Uppdaterad senaste m\u00E5naden',
    'filter.lastYear':       'Uppdaterad senaste \u00E5ret',
    'filter.last2Years':     'Uppdaterad senaste tv\u00E5 \u00E5ren',

    'topic.unknownGroup': 'Ok\u00E4nd \u00E4mnesgrupp',

    'variable.heading':         'V\u00E4lj variabler',
    'variable.tablePrefix':     'Tabell',
    'variable.instructions':    'V\u00E4lj v\u00E4rden f\u00F6r varje variabel. Klicka f\u00F6r att v\u00E4lja, Shift+klicka f\u00F6r att v\u00E4lja ett intervall, Ctrl/Cmd+klicka f\u00F6r att l\u00E4gga till enstaka v\u00E4rden, Ctrl+A f\u00F6r att v\u00E4lja alla synliga.',
    'variable.fetchData':       'H\u00E4mta data',
    'variable.selectValues':    'V\u00E4lj v\u00E4rden f\u00F6r att se fr\u00E5gan',
    'variable.selectValuesAll': 'V\u00E4lj v\u00E4rden f\u00F6r alla variabler',
    'variable.optional':        'Valfri variabel',
    'variable.required':        'M\u00E5ste v\u00E4ljas *',
    'variable.categorization':  'Gruppering:',
    'variable.freeChoice':      'V\u00E4lj fritt bland alla v\u00E4rden',
    'variable.filterPlaceholder': 'Filtrera v\u00E4rden...',
    'variable.selected':        'Vald',
    'variable.ofTotal':         'av totalt',
    'variable.withoutTitle':    'Utan titel',
    'variable.withTitle':       'Med titel',
    'variable.truncated':       'Visar {0} av {1} v\u00E4rden. Anv\u00E4nd "Alla (*)" f\u00F6r att inkludera alla.',

    'variable.btn.all':         'Alla (*)',
    'variable.btn.selectAll':   'V\u00E4lj alla',
    'variable.btn.deselectAll': 'Avmarkera alla',
    'variable.btn.last':        'Senaste',

    'codelist.error':    'Kunde inte ladda kodlista',
    'codelist.optional': 'Valfri variabel',
    'codelist.required': 'M\u00E5ste v\u00E4ljas *',

    'status.all':          'alla',
    'status.last':         'senaste ',
    'status.ready':        'Redo att h\u00E4mta data',
    'status.selectRequired': 'V\u00E4lj minst ett v\u00E4rde f\u00F6r alla obligatoriska variabler',
    'status.noValuesOpt':  'Inga v\u00E4rden valda (variabeln utesluts fr\u00E5n fr\u00E5gan)',
    'status.noValues':     'Inga v\u00E4rden valda',
    'status.allSelected':  'Alla v\u00E4rden valda',
    'status.topMode':      'senaste {0}',
    'status.tooManyCells': 'F\u00F6r m\u00E5nga celler valda \u2014 minska urvalet',
    'status.cellsSelected': '{0} {1} valda (av max {2} m\u00F6jliga)',
    'status.exceedsLimit': '\u2014 \u00F6verskrider API-gr\u00E4nsen p\u00E5 800\u202F000!',

    'api.builder':          '\u25B6 API-byggare',
    'api.method':           'Metod:',
    'api.format':           'Svarsformat:',
    'api.display':          'Visning:',
    'api.displayText':      'Text',
    'api.displayCodes':     'Koder',
    'api.displayBoth':      'Koder och text',
    'api.tableTitle':       'Tabelltitel:',
    'api.separator':        'Avgr\u00E4nsare:',
    'api.separatorSemicolon': 'Semikolon',
    'api.separatorTab':     'Tabulator',
    'api.separatorSpace':   'Mellanslag',
    'api.layout':           'Tabelllayout:',
    'api.layoutStandard':   'Standard',
    'api.layoutPivot':      'Pivotvänlig (alla i stubb)',
    'api.dataUrl':          'Data-URL',
    'api.showPlaintext':    'Visa i klartext',
    'api.decodedUrlTooltip': 'Visa URL med l\u00E4sbara tecken ist\u00E4llet f\u00F6r URL-kodning',
    'api.copyUrl':          'Kopiera URL',
    'api.copyCurl':         'Kopiera som curl-kommando',
    'api.openBrowser':      '\u00D6ppna i webbl\u00E4sare',
    'api.openNewTab':       '\u00D6ppna i ny flik',
    'api.copied':           'Kopierat!',
    'api.postBody':         'POST-body (JSON)',
    'api.copyBody':         'Kopiera body',
    'api.metadataUrl':      'Metadata-URL',
    'api.copyMetadataUrl':  'Kopiera metadata-URL',
    'api.openMetadata':     '\u00D6ppna metadata i ny flik',
    'api.urlTooLong':       'URL:en \u00E4r {0} tecken \u2014 \u00F6verskrider gr\u00E4nsen p\u00E5 {1} tecken. Anv\u00E4nd POST-l\u00E4ge f\u00F6r stora urval.',
    'api.getOnlyFeature':   'Endast tillg\u00E4nglig i GET-l\u00E4ge',

    'table.rotate':        '\u21BB Rotera tabell',
    'table.download':      '\u2B07 Ladda ned i Excel-format',
    'table.moreOptions':   'Fler alternativ',
    'table.getLink':       '\uD83D\uDD17 F\u00E5 l\u00E4nk',
    'table.notAvailable':  'Inte tillg\u00E4nglig',
    'table.confidential':  'Konfidentiellt',
    'table.notApplicable': 'Inte till\u00E4mpligt',
    'table.prefix':        'Tabell',
    'table.unnamed':       'Utan namn',

    'rotation.title':        'Rotera tabell',
    'rotation.instructions': 'Dra dimensioner mellan rader och kolumner f\u00F6r att \u00E4ndra tabellens layout.',
    'rotation.rows':         'Rader',
    'rotation.columns':      'Kolumner',
    'rotation.presets':      'Snabbval:',
    'rotation.standard':     'Standard',
    'rotation.transpose':    'Transponera',
    'rotation.allRows':      'Alla som rader',
    'rotation.allColumns':   'Alla som kolumner',
    'rotation.apply':        'Till\u00E4mpa layout',
    'rotation.cancel':       'Avbryt',
    'rotation.dropHere':     'Dra dimensioner hit',
    'rotation.values':       'v\u00E4rden',
    'rotation.allRequired':  'Alla dimensioner m\u00E5ste vara antingen i rader eller kolumner',
    'rotation.minOne':       'Tabellen m\u00E5ste ha minst en dimension',

    'export.title':           'Ladda ned tabell',
    'export.format':          'Filformat:',
    'export.formatExcel':     'Excel (xlsx)',
    'export.formatCsv':       'CSV (semikolon-separerad textfil)',
    'export.formatPx':        'PX (PC-Axis format)',
    'export.displayAs':       'Visa v\u00E4rden som:',
    'export.displayStandard': 'Standard',
    'export.displayText':     'Text (t.ex. "Oslo")',
    'export.displayCodes':    'Koder (t.ex. "0301")',
    'export.displayBoth':     'B\u00E5de koder och text (t.ex. "0301: Oslo")',
    'export.csvSeparator':    'CSV-avgr\u00E4nsare:',
    'export.sepSemicolon':    'Semikolon (;) \u2013 Standard f\u00F6r nordisk Excel',
    'export.sepTab':          'Tabulator',
    'export.sepSpace':        'Mellanslag',
    'export.layout':          'Tabelloppsett:',
    'export.layoutAsShown':   'Som visat p\u00E5 sk\u00E4rmen (heading: {0})',
    'export.layoutPivot':     'Pivotvänlig (alla variabler i stub, lättare att pivotera i Excel)',
    'export.includeTitle':    'Inkludera tabelltitel',
    'export.downloadInfo':    'Filen laddas ned direkt fr\u00E5n {0}:s API.',
    'export.dataPoints':      'Tabellen inneh\u00E5ller {0} datapunkter.',
    'export.cancel':          'Avbryt',
    'export.download':        'Ladda ned',

    // Footer
    'footer.dataFrom':    'Data fr\u00E5n',

    // Cache
    'cache.clear':        'Rensa cache',
    'cache.clearTooltip': 'Rensa cache och ladda om data',

    // Search
    'search.found': 'hittade',

    'lang.label': 'Spr\u00E5k',

    'subject.group.arbeid':     'Arbete, l\u00F6n och utbildning',
    'subject.group.befolkning': 'Befolkning och bostad',
    'subject.group.helse':      'H\u00E4lsa och samh\u00E4lle',
    'subject.group.miljo':      'Milj\u00F6 och transport',
    'subject.group.naring':     'N\u00E4ringsliv och teknologi',
    'subject.group.okonomi':    'Ekonomi',

    'subject.name.al': 'Arbete och l\u00F6n',
    'subject.name.if': 'Inkomst och konsumtion',
    'subject.name.ud': 'Utbildning',
    'subject.name.be': 'Befolkning',
    'subject.name.bb': 'Bygg, bostad och fastighet',
    'subject.name.in': 'Invandring och invandrare',
    'subject.name.he': 'H\u00E4lsa',
    'subject.name.kf': 'Kultur och fritid',
    'subject.name.sk': 'Sociala f\u00F6rh\u00E5llanden och brottslighet',
    'subject.name.sv': 'Svalbard',
    'subject.name.va': 'Val',
    'subject.name.nm': 'Natur och milj\u00F6',
    'subject.name.tr': 'Transport och turism',
    'subject.name.ei': 'Energi och industri',
    'subject.name.js': 'Jord, skog, jakt och fiske',
    'subject.name.ti': 'Teknologi och innovation',
    'subject.name.vt': 'Varuhandel och tj\u00E4nster',
    'subject.name.vf': 'F\u00F6retag och bokf\u00F6ring',
    'subject.name.bf': 'Bank och finansmarknad',
    'subject.name.nk': 'Nationalr\u00E4kenskaper och konjunktur',
    'subject.name.os': 'Offentlig sektor',
    'subject.name.pp': 'Priser och prisindex',
    'subject.name.ut': 'Utrikeshandel'
  }
};

// ---------------------------------------------------------------------------
// Language management
// ---------------------------------------------------------------------------

function _initLanguage() {
  const stored = localStorage.getItem('lang');
  const available = (AppConfig.languages || []).map(l => l.code);
  if (stored && available.includes(stored)) return stored;
  return AppConfig.defaultLanguage || 'nb';
}

let currentLanguage = _initLanguage();

/**
 * Look up a UI string by key. Falls back to 'nb' then the key itself.
 */
function t(key) {
  return translations[currentLanguage]?.[key]
    ?? translations['nb']?.[key]
    ?? key;
}

/**
 * Look up a UI string and replace {0}, {1}, … placeholders with args.
 */
function tpl(key, ...args) {
  let s = t(key);
  args.forEach((arg, i) => { s = s.replace(`{${i}}`, arg); });
  return s;
}

/**
 * Returns the API lang= parameter for the current UI language.
 */
function getCurrentApiLang() {
  return (AppConfig.languages || []).find(l => l.code === currentLanguage)?.apiLang ?? 'no';
}

/**
 * Switch the UI language, persist to localStorage, clear language-sensitive
 * metadata cache, and re-render the current view.
 */
function setLanguage(code) {
  const lang = (AppConfig.languages || []).find(l => l.code === code);
  if (!lang) return;
  currentLanguage = code;
  window.currentLanguage = code;
  localStorage.setItem('lang', code);
  // All cached data (table list, metadata, codelists) is language-sensitive.
  // Clear the entire cache so everything is re-fetched in the new language.
  if (typeof api !== 'undefined' && typeof api.clearCache === 'function') {
    api.clearCache();
  }
  // Reset BrowserState so the table list is re-fetched
  if (typeof BrowserState !== 'undefined' && typeof BrowserState.reset === 'function') {
    BrowserState.reset();
  }
  if (typeof renderCurrentView === 'function') renderCurrentView();
}

window.t = t;
window.tpl = tpl;
window.getCurrentApiLang = getCurrentApiLang;
window.setLanguage = setLanguage;
window.currentLanguage = currentLanguage;
