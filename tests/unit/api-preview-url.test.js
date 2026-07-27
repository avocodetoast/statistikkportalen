/**
 * variable-select-api.js — buildSsbPreviewUrls
 *
 * API-byggerens GET/POST-URL er en matrise: utvalgstype (eksplisitt liste /
 * '*' / 'top(N)') × kodelistetype (ingen / vs_ / agg_) × utdataformat (params
 * støttes bare av csv/html/xlsx) × pivot. Den lå tidligere inne i
 * updateQueryPreview() sammen med DOM-lesingen og kunne bare dekkes grovt av
 * E2E. Nå er strengbyggingen ren, og hele matrisen testes her.
 *
 * URL-en er brukersynlig — brukeren kopierer den og limer den inn et annet
 * sted — så parameterREKKEFØLGEN er observerbar oppførsel, ikke en
 * implementasjonsdetalj. Derfor asserteres hele strengen noen steder, ikke
 * bare at delstrenger finnes.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/variable-select-api.js']);

const BASE = 'https://data.ssb.no/api/pxwebapi/v2';

/** Standardargumentene; hver test overstyrer bare det den handler om. */
function build(overrides) {
  return app.buildSsbPreviewUrls(Object.assign({
    apiBaseUrl: BASE,
    tableId: '13472',
    selection: {},
    codelistIds: {},
    lang: 'no',
    format: 'json-stat2',
    displayFormat: '',
    includeTitle: false,
    separator: '',
    pivot: false
  }, overrides));
}

/** Dekoder URL-en så assertions slipper å skrive %5B/%5D. */
function decoded(url) {
  return decodeURIComponent(url);
}

describe('buildSsbPreviewUrls — valueCodes', () => {
  it('skriver stjerne og top(N) verbatim, ikke som array', () => {
    // 08801: Ctrl+A over terskelen gir '*' på Varekoder.
    const { getUrl } = build({
      tableId: '08801',
      selection: { Varekoder: '*', Tid: 'top(5)' }
    });
    assert.match(decoded(getUrl), /valueCodes\[Varekoder\]=\*/);
    assert.match(decoded(getUrl), /valueCodes\[Tid\]=top\(5\)/);
  });

  it('kommaskiller eksplisitte kodelister', () => {
    const { getUrl } = build({
      selection: { ContentsCode: ['DEP', 'BIF', 'KAPN'] }
    });
    assert.match(decoded(getUrl), /valueCodes\[ContentsCode\]=DEP,BIF,KAPN/);
  });

  it('beholder rekkefølgen fra utvalget', () => {
    const { getUrl } = build({
      tableId: '11189',
      selection: { Investeringsart: ['1'], NACE: ['A'], ContentsCode: ['DEP'], Tid: ['2023'] }
    });
    assert.equal(
      decoded(getUrl),
      BASE + '/tables/11189/data?lang=no&outputFormat=json-stat2' +
      '&valueCodes[Investeringsart]=1&valueCodes[NACE]=A' +
      '&valueCodes[ContentsCode]=DEP&valueCodes[Tid]=2023'
    );
  });

  it('tomt utvalg gir en URL uten valueCodes i det hele tatt', () => {
    const { getUrl } = build({ selection: {} });
    assert.equal(getUrl.includes('valueCodes'), false);
  });

  it('valgfrie dimensjoner som er utelatt fra utvalget dukker ikke opp', () => {
    // 13472: Region/NACE2007/Sektor er valgfrie. Utelates de av
    // getVariableSelection(), skal API-et aggregere over dem — og da må de
    // heller ikke stå i URL-en med tom verdi.
    const { getUrl } = build({
      selection: { ContentsCode: ['SysselEtterBoste'], Tid: ['2025K4'] }
    });
    assert.equal(decoded(getUrl).includes('valueCodes[Region]'), false);
    assert.equal(decoded(getUrl).includes('valueCodes[Sektor]'), false);
  });
});

describe('buildSsbPreviewUrls — kodelister', () => {
  it('aggregeringskodeliste gir både codelist og outputValues=aggregated', () => {
    const { getUrl } = build({
      selection: { Region: ['30', '03'] },
      codelistIds: { Region: 'agg_Fylker2024' }
    });
    assert.match(decoded(getUrl), /codelist\[Region\]=agg_Fylker2024/);
    assert.match(decoded(getUrl), /outputValues\[Region\]=aggregated/);
  });

  it('valueset-kodeliste gir codelist uten outputValues', () => {
    const { getUrl } = build({
      selection: { Region: ['0301'] },
      codelistIds: { Region: 'vs_Kommun' }
    });
    assert.match(decoded(getUrl), /codelist\[Region\]=vs_Kommun/);
    assert.equal(decoded(getUrl).includes('outputValues['), false);
  });

  it('to samtidige kodelister holdes fra hverandre', () => {
    // 11189: både Investeringsart og NACE har egne vs_-grupperinger.
    const { getUrl } = build({
      tableId: '11189',
      selection: { Investeringsart: ['A'], NACE: ['B'] },
      codelistIds: { Investeringsart: 'vs_NRInvArtAgg3', NACE: 'vs_NRNaeringPubAgg' }
    });
    assert.match(decoded(getUrl), /codelist\[Investeringsart\]=vs_NRInvArtAgg3/);
    assert.match(decoded(getUrl), /codelist\[NACE\]=vs_NRNaeringPubAgg/);
  });

  it('tom kodeliste-id hoppes over (dimensjonen er tilbakestilt til «Velg fritt»)', () => {
    const { getUrl } = build({
      selection: { Region: ['0301'] },
      codelistIds: { Region: '', NACE2007: null }
    });
    assert.equal(getUrl.includes('codelist'), false);
  });
});

describe('buildSsbPreviewUrls — utdataformat og params', () => {
  it('outputFormatParams settes bare for csv, html og xlsx', () => {
    for (const format of ['csv', 'html', 'xlsx']) {
      const { getUrl } = build({ format, displayFormat: 'UseCodes' });
      assert.match(decoded(getUrl), /outputFormatParams=UseCodes/, format);
    }
    for (const format of ['json-stat2', 'px', 'parquet']) {
      const { getUrl } = build({ format, displayFormat: 'UseCodes' });
      assert.equal(getUrl.includes('outputFormatParams'), false, format);
    }
  });

  it('IncludeTitle legges til etter visningsformatet', () => {
    const { fmtParams } = build({
      format: 'xlsx', displayFormat: 'UseTexts', includeTitle: true
    });
    assert.deepEqual(fmtParams, ['UseTexts', 'IncludeTitle']);
  });

  it('separator er med bare for csv', () => {
    const csv = build({ format: 'csv', separator: 'SeparatorSemicolon' });
    assert.deepEqual(csv.fmtParams, ['SeparatorSemicolon']);

    const xlsx = build({ format: 'xlsx', separator: 'SeparatorSemicolon' });
    assert.deepEqual(xlsx.fmtParams, []);
  });

  it('språket styres av lang-argumentet', () => {
    const { getUrl, postUrl } = build({ lang: 'en' });
    assert.match(getUrl, /[?&]lang=en/);
    assert.match(postUrl, /[?&]lang=en/);
  });

  it('tomt format utelater outputFormat', () => {
    const { getUrl } = build({ format: '' });
    assert.equal(getUrl.includes('outputFormat'), false);
  });
});

describe('buildSsbPreviewUrls — pivot', () => {
  it('pivot legger alle valgte dimensjoner i stub', () => {
    const { getUrl, stubDims } = build({
      format: 'csv',
      pivot: true,
      selection: { Region: ['30'], ContentsCode: ['X'], Tid: ['2025K4'] }
    });
    assert.deepEqual(stubDims, ['Region', 'ContentsCode', 'Tid']);
    assert.match(decoded(getUrl), /stub=Region,ContentsCode,Tid/);
  });

  it('pivot ignoreres for formater uten params', () => {
    const { stubDims, getUrl } = build({
      format: 'json-stat2', pivot: true, selection: { Tid: ['2025K4'] }
    });
    assert.equal(stubDims, undefined);
    assert.equal(getUrl.includes('stub='), false);
  });

  it('pivot med tomt utvalg setter ikke stub', () => {
    const { stubDims } = build({ format: 'csv', pivot: true, selection: {} });
    assert.equal(stubDims, undefined);
  });
});

describe('buildSsbPreviewUrls — POST-URL', () => {
  it('POST-URL inneholder aldri valueCodes eller codelist', () => {
    const { postUrl } = build({
      selection: { Region: ['30'], Tid: 'top(3)' },
      codelistIds: { Region: 'agg_Fylker2024' }
    });
    assert.equal(postUrl.includes('valueCodes'), false);
    assert.equal(postUrl.includes('codelist'), false);
  });

  it('POST-URL beholder lang, outputFormat, outputFormatParams og stub', () => {
    const { postUrl } = build({
      format: 'csv',
      displayFormat: 'UseCodes',
      separator: 'SeparatorSemicolon',
      pivot: true,
      selection: { Region: ['30'], Tid: ['2025K4'] }
    });
    assert.equal(
      decoded(postUrl),
      BASE + '/tables/13472/data?lang=no&outputFormat=csv' +
      '&outputFormatParams=UseCodes,SeparatorSemicolon&stub=Region,Tid'
    );
  });

  it('GET- og POST-URL peker på samme endepunkt', () => {
    const { getUrl, postUrl } = build({ tableId: '12850', selection: { Tid: ['2024'] } });
    const endpoint = BASE + '/tables/12850/data?';
    assert.ok(getUrl.startsWith(endpoint));
    assert.ok(postUrl.startsWith(endpoint));
  });
});

describe('buildSsbPreviewUrls — URL-lengde', () => {
  it('et eksplisitt utvalg på tusenvis av koder sprenger GET-grensen', () => {
    // 08801 Varekoder: dette er hele grunnen til at Ctrl+A bytter til '*' over
    // terskelen. Med eksplisitte koder blir GET-URL-en ubrukelig lang, og
    // updateQueryPreview() viser advarselen basert på nettopp denne lengden.
    const codes = Array.from({ length: 700 }, (_, i) => String(10000000 + i));
    const { getUrl } = build({ tableId: '08801', selection: { Varekoder: codes } });
    assert.ok(
      getUrl.length > app.AppConfig.limits.maxGetUrlLength,
      `URL-en var bare ${getUrl.length} tegn`
    );

    // Stjernevalget er alternativet — og det holder seg langt under grensen.
    const star = build({ tableId: '08801', selection: { Varekoder: '*' } });
    assert.ok(star.getUrl.length < app.AppConfig.limits.maxGetUrlLength);
  });
});
