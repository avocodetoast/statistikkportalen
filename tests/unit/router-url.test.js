/**
 * router.js — URLRouter: encode/decode, parseHash/buildHash, navigateTo
 *
 * HVORFOR: js/router.js sto på 0 av 15 dekkede funksjoner. router-utils.test.js
 * tester `detectSavedQueryId` (utils.js) og `SSBURLMapper` — ikke URLRouter selv.
 * Dermed var hele URL-laget udekket, og det er laget alt av delbare lenker går
 * gjennom: et variabelutvalg base64-kodes inn i ?v=, aktive grupperinger i ?c=,
 * og emnefiltre i ?disc=/?freq=/?upd=/?src=.
 *
 * Det som gjør dette verdt egne tester er at kodingen er TAPSFRI-kritisk: en
 * lenke en bruker har delt eller bokmerket må dekode til nøyaktig samme utvalg
 * senere. Går encode og decode ut av synk — f.eks. ved at bare den ene av dem
 * lærer et nytt tegn — blir symptomet en lenke som stille åpner feil utvalg.
 *
 * Kodingen er URL-trygg base64 med tre substitusjoner (+ → -, / → _, = → ~) og
 * en UTF-8-runde via encodeURIComponent/unescape. Norske tegn og '/' i
 * regionkoder treffer begge de mekanismene.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/utils.js', 'js/router.js']);
const R = app.URLRouter;

describe('URLRouter.encode / decode', () => {
  it('tur-retur bevarer alle utvalgsformene fra variabelvalget', () => {
    // Nøyaktig formene getVariableSelection() kan produsere.
    const selection = {
      Varekoder: '*',
      Tid: 'top(12)',
      Periode: 'range(2020,2024)',
      ContentsCode: ['DEP', 'BIF', 'KAPN'],
      Region: []
    };
    assert.deepEqual(R.decode(R.encode(selection)), selection);
  });

  it('tur-retur bevarer et kodelistekart', () => {
    const codelists = { Region: 'agg_KommFylker', NACE: 'vs_NRNaeringPubAgg' };
    assert.deepEqual(R.decode(R.encode(codelists)), codelists);
  });

  it('resultatet inneholder ingen URL-utrygge tegn', () => {
    // +, / og = ville blitt omtolket i en query-streng. Substitusjonen er hele
    // grunnen til at ?v= kan stå ukodet i hashen.
    const encoded = R.encode({ Region: ['0301', '1103', '4601'], Tid: ['2024', '2025'] });
    assert.doesNotMatch(encoded, /[+/=]/);
  });

  it('tur-retur tåler norske tegn', () => {
    const obj = { Region: ['Ø-1', 'Æ-2', 'Å-3'], label: 'Sysselsatte i Nord-Trøndelag' };
    assert.deepEqual(R.decode(R.encode(obj)), obj);
  });

  it('tur-retur tåler skråstrek og pluss i kodene', () => {
    // '/' og '+' er nettopp de tegnene substitusjonen bytter ut i base64-en;
    // de må også overleve når de finnes i selve DATAEN.
    const obj = { Kode: ['A/B', 'C+D', 'E=F'] };
    assert.deepEqual(R.decode(R.encode(obj)), obj);
  });

  it('nøkkelrekkefølgen bevares', () => {
    const obj = { Zulu: ['1'], Alfa: ['2'], Midt: ['3'] };
    assert.deepEqual(Object.keys(R.decode(R.encode(obj))), ['Zulu', 'Alfa', 'Midt']);
  });

  it('tomme objekter kodes til null, ikke til en tom parameter', () => {
    // debouncedURLUpdate hopper over parameteren når encode gir noe falsy.
    assert.equal(R.encode({}), null);
    assert.equal(R.encode(null), null);
    assert.equal(R.encode(undefined), null);
  });

  it('decode av søppel gir null i stedet for å kaste', () => {
    // Hashen kommer utenfra — en avkuttet eller redigert lenke må ikke krasje appen.
    for (const bad of ['', null, undefined, 'ikke-base64!!', 'YWJj', '~~~~']) {
      assert.equal(R.decode(bad), null, `decode(${JSON.stringify(bad)})`);
    }
  });

  it('decode av gyldig base64 som ikke er et objekt gir null', () => {
    const encodedNumber = btoa('42').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '~');
    assert.equal(R.decode(encodedNumber), null);
  });
});

describe('URLRouter.decodeLayout', () => {
  it('bevarer et gyldig layout med array på begge akser', () => {
    const layout = { rows: ['Tid'], columns: ['Region'] };
    assert.deepEqual(R.decodeLayout(R.encode(layout)), layout);
  });

  it('faller tilbake til tomt layout for håndredigerte objekter', () => {
    for (const invalid of [{}, { rows: [], columns: 'Region' }, { rows: null, columns: [] }]) {
      assert.deepEqual(R.decodeLayout(R.encode(invalid)), { rows: [], columns: [] });
    }
    // e30 er upaddet base64url for "{}" og er eksempelet som tidligere krasjet.
    assert.deepEqual(R.decodeLayout('e30'), { rows: [], columns: [] });
  });
});

describe('URLRouter.buildHash', () => {
  it('rute uten parametre gir bare hashen', () => {
    assert.equal(R.buildHash('topic/os/os07/offogjeld'), '#topic/os/os07/offogjeld');
    assert.equal(R.buildHash('home', {}), '#home');
  });

  it('parametre legges på i rekkefølge', () => {
    assert.equal(
      R.buildHash('topic/os/os07/offogjeld', { disc: '1', src: 'nb' }),
      '#topic/os/os07/offogjeld?disc=1&src=nb'
    );
  });

  it('tomme, null og undefined parametre utelates', () => {
    assert.equal(
      R.buildHash('search', { q: 'renter', freq: '', upd: null, src: undefined }),
      '#search?q=renter'
    );
  });

  it('parameterverdier URL-kodes', () => {
    assert.equal(R.buildHash('search', { q: 'offentlig gjeld' }), '#search?q=offentlig%20gjeld');
    assert.equal(R.buildHash('search', { q: 'a&b=c' }), '#search?q=a%26b%3Dc');
  });

  it('0 er en gyldig verdi og skal ikke falle bort', () => {
    assert.equal(R.buildHash('topic/os', { disc: 0 }), '#topic/os?disc=0');
  });
});

describe('URLRouter.parseHash', () => {
  it('emnerute med filtre', () => {
    assert.deepEqual(R.parseHash('#topic/os/os07/offogjeld?disc=1&src=nb'), {
      route: 'topic/os/os07/offogjeld',
      params: { disc: '1', src: 'nb' }
    });
  });

  it('rute uten parametre gir tomt params-objekt', () => {
    assert.deepEqual(R.parseHash('#topic/he/he04/helsetjko'), {
      route: 'topic/he/he04/helsetjko',
      params: {}
    });
  });

  it('tom eller manglende hash gir tom rute', () => {
    assert.deepEqual(R.parseHash(''), { route: '', params: {} });
    assert.deepEqual(R.parseHash('#'), { route: '', params: {} });
  });

  it('parameterverdier dekodes', () => {
    assert.deepEqual(R.parseHash('#search?q=offentlig%20gjeld').params, { q: 'offentlig gjeld' });
  });
});

describe('buildHash + parseHash tur-retur', () => {
  const CASES = [
    ['topic/os/os07/offogjeld', { disc: '1', freq: 'Annual', upd: '30', src: 'nb' }],
    ['topic/he/he04/helsetjko', {}],
    ['search', { q: 'statsgjeld' }],
    ['variables/13472', { v: 'eyJSZWdpb24iOlsiMzAiXX0~', c: 'eyJSZWdpb24iOiJhZ2dfS29tbUZ5bGtlciJ9' }],
    ['table/08801', {}]
  ];

  for (const [route, params] of CASES) {
    it(`«${route}» overlever tur-retur`, () => {
      const parsed = R.parseHash(R.buildHash(route, params));
      assert.equal(parsed.route, route);
      assert.deepEqual(parsed.params, params);
    });
  }

  it('et ekte variabelutvalg overlever hele veien gjennom hashen', () => {
    // Dette er hele delbare-lenker-kontrakten i ett steg: utvalg → ?v= → hash
    // → tilbake til samme utvalg.
    const selection = { Varekoder: '*', Tid: 'top(5)', ContentsCode: ['Verdi'] };
    const codelists = { Region: 'agg_KommFylker' };

    const hash = R.buildHash('variables/08801', {
      v: R.encode(selection),
      c: R.encode(codelists)
    });
    const parsed = R.parseHash(hash);

    assert.equal(parsed.route, 'variables/08801');
    assert.deepEqual(R.decode(parsed.params.v), selection);
    assert.deepEqual(R.decode(parsed.params.c), codelists);
  });
});

describe('URLRouter.navigateTo', () => {
  let pushed;
  let replaced;

  beforeEach(() => {
    pushed = [];
    replaced = [];
    app.history.pushState = (_s, _t, url) => pushed.push(url);
    app.history.replaceState = (_s, _t, url) => replaced.push(url);
    app.location.hash = '#home';
  });

  it('pusher en ny historikkoppføring som standard', () => {
    R.navigateTo('topic/os/os07/offogjeld');
    assert.deepEqual(pushed, ['#topic/os/os07/offogjeld']);
    assert.deepEqual(replaced, []);
  });

  it('erstatter i stedet når shouldPush er false', () => {
    R.navigateTo('topic/os', { disc: '1' }, false);
    assert.deepEqual(replaced, ['#topic/os?disc=1']);
    assert.deepEqual(pushed, []);
  });

  it('gjør INGENTING når hashen allerede er den samme', () => {
    // Fella: en test (eller appen) som «navigerer» til ruta den alt står på,
    // får verken ny historikkoppføring eller noen hendelse — og venter man på at
    // noe skal skje, venter man for alltid.
    app.location.hash = '#topic/os/os07/offogjeld';
    R.navigateTo('topic/os/os07/offogjeld');
    assert.deepEqual(pushed, []);
    assert.deepEqual(replaced, []);
  });

  it('samme rute med andre parametre teller som en ny hash', () => {
    app.location.hash = '#topic/os?disc=1';
    R.navigateTo('topic/os', { disc: '0' });
    assert.deepEqual(pushed, ['#topic/os?disc=0']);
  });
});
