/**
 * index-refresh.js — IndexRefresh.shouldCheck(): den rene avgjørelsen om en
 * bakgrunnssjekk av katalogindeksen skal kjøres akkurat nå.
 *
 * Grunnen til at dette er en ren funksjon og ikke inline i maybeRun(): den er
 * hele policyen (strupe, synlighet, nett, visning), og den skal kunne
 * verifiseres uten DOM, uten timere og uten å røre nettverket.
 *
 * Kontrakten som testes:
 *   - alle utløsere deler ETT minsteintervall (så antall kall er uavhengig av
 *     hvor mye brukeren klikker)
 *   - skjult fane, offline og allerede pågående sjekk gir aldri et kall
 *   - kun bla-visningene (home/search/topic) sjekker — står brukeren i
 *     variables/table er katalogen ikke på skjermen
 *   - manglende/ukjente signaler skal ikke blokkere (nettleseren trenger ikke
 *     støtte navigator.onLine for at appen skal oppdatere seg)
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, SCRIPTS } = require('../helpers/app-env.js');

const app = loadApp([...SCRIPTS.core, 'js/index-refresh.js']);

const { IndexRefresh } = app;

const HALF_HOUR = 30 * 60 * 1000;

/** Et grunntilfelle som SKAL passere; hver test overstyrer én ting. */
function state(overrides) {
  return Object.assign({
    now: 10_000_000,
    lastCheckAt: 10_000_000 - HALF_HOUR - 1,
    running: false,
    visible: true,
    online: true,
    browsing: true,
    intervalMs: HALF_HOUR
  }, overrides);
}

describe('IndexRefresh.shouldCheck', () => {
  it('sjekker når intervallet har løpt ut i en bla-visning', () => {
    assert.equal(IndexRefresh.shouldCheck(state()), true);
  });

  it('struper når det er kortere siden forrige forsøk enn intervallet', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ lastCheckAt: 10_000_000 - 60_000 })), false);
  });

  it('slipper gjennom nøyaktig på intervallgrensen', () => {
    assert.equal(
      IndexRefresh.shouldCheck(state({ lastCheckAt: 10_000_000 - HALF_HOUR })), true);
  });

  it('sjekker aldri når en sjekk allerede er i gang', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ running: true })), false);
  });

  it('sjekker aldri i en skjult fane', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ visible: false })), false);
  });

  it('sjekker aldri når nettleseren rapporterer offline', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ online: false })), false);
  });

  it('sjekker ikke utenfor bla-visningene (variables/table)', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ browsing: false })), false);
  });

  it('behandler ukjent online-status som online (ikke alle nettlesere svarer)', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ online: undefined })), true);
  });

  it('behandler første gang (lastCheckAt = 0) som forfalt', () => {
    assert.equal(IndexRefresh.shouldCheck(state({ lastCheckAt: 0 })), true);
  });

  it('faller tilbake på standardintervallet når intervalMs mangler', () => {
    // Uten fallback ville `now - lastCheckAt < undefined` blitt false og
    // sluppet ALLE kall gjennom — verste feilretning for en bakgrunnssjekk.
    assert.equal(
      IndexRefresh.shouldCheck(state({ intervalMs: undefined, lastCheckAt: 10_000_000 - 1000 })),
      false);
  });

  it('slår av strupingen på et bevisst intervalMs: 0 (feilsøking)', () => {
    // Skillet mot linja over er hele grunnen til at koden ikke bruker `||`.
    assert.equal(
      IndexRefresh.shouldCheck(state({ intervalMs: 0, lastCheckAt: 10_000_000 })), true);
  });
});
