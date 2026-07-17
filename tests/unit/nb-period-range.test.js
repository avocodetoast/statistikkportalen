/**
 * SdmxToJsonStat period helpers — pure logic behind the interval-based time
 * picker for Norges Bank tables: range(from,to) token grammar, SDMX period
 * granularity, cross-granularity conversion, clamping, and period-count
 * estimation for the cell-count guard.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/app-env.js');

const app = loadApp(['js/sources/sdmx-to-jsonstat.js']);
const P = app.SdmxToJsonStat;

describe('periodGranularity (FREQ code → granularity)', () => {
  it('maps SDMX frequency codes', () => {
    assert.equal(P.periodGranularity('B'), 'day');
    assert.equal(P.periodGranularity('D'), 'day');
    assert.equal(P.periodGranularity('M'), 'month');
    assert.equal(P.periodGranularity('Q'), 'quarter');
    assert.equal(P.periodGranularity('A'), 'year');
  });

  it('defaults unknown/missing codes to day', () => {
    assert.equal(P.periodGranularity('X'), 'day');
    assert.equal(P.periodGranularity(''), 'day');
    assert.equal(P.periodGranularity(undefined), 'day');
  });
});

describe('periodCodeGranularity (period code shape → granularity)', () => {
  it('recognizes the four SDMX period shapes', () => {
    assert.equal(P.periodCodeGranularity('2025'), 'year');
    assert.equal(P.periodCodeGranularity('2025-07'), 'month');
    assert.equal(P.periodCodeGranularity('2025-Q3'), 'quarter');
    assert.equal(P.periodCodeGranularity('2025-07-15'), 'day');
  });

  it('returns null for unrecognized codes', () => {
    assert.equal(P.periodCodeGranularity('2022/23'), null);
    assert.equal(P.periodCodeGranularity(''), null);
    assert.equal(P.periodCodeGranularity(null), null);
  });
});

describe('parsePeriodRange / formatPeriodRange (range token grammar)', () => {
  it('parses a full range', () => {
    assert.deepEqual(P.parsePeriodRange('range(2020-01,2024-06)'), { from: '2020-01', to: '2024-06' });
  });

  it('parses open-ended ranges (empty side allowed)', () => {
    assert.deepEqual(P.parsePeriodRange('range(2020,)'), { from: '2020', to: '' });
    assert.deepEqual(P.parsePeriodRange('range(,2024)'), { from: '', to: '2024' });
  });

  it('returns null for non-range tokens', () => {
    assert.equal(P.parsePeriodRange('top(10)'), null);
    assert.equal(P.parsePeriodRange('*'), null);
    assert.equal(P.parsePeriodRange('range(a,b,c)'), null);
    assert.equal(P.parsePeriodRange(['2020']), null);
  });

  it('formats and round-trips, trimming whitespace', () => {
    assert.equal(P.formatPeriodRange('2020-01-02', '2024-12-31'), 'range(2020-01-02,2024-12-31)');
    assert.equal(P.formatPeriodRange(' 2020 ', ''), 'range(2020,)');
    assert.deepEqual(P.parsePeriodRange(P.formatPeriodRange('2020', '2024')), { from: '2020', to: '2024' });
  });
});

describe('convertPeriod (granularity conversion — coarsen OK, refine → null)', () => {
  it('coarsens day → month → year', () => {
    assert.equal(P.convertPeriod('2024-03-15', 'month'), '2024-03');
    assert.equal(P.convertPeriod('2024-03-15', 'year'), '2024');
    assert.equal(P.convertPeriod('2024-03', 'year'), '2024');
  });

  it('coarsens day/month → quarter', () => {
    assert.equal(P.convertPeriod('2024-03-15', 'quarter'), '2024-Q1');
    assert.equal(P.convertPeriod('2024-05', 'quarter'), '2024-Q2');
    assert.equal(P.convertPeriod('2024-Q2', 'year'), '2024');
  });

  it('is identity for same granularity', () => {
    assert.equal(P.convertPeriod('2024-Q2', 'quarter'), '2024-Q2');
    assert.equal(P.convertPeriod('2024', 'year'), '2024');
  });

  it('refuses to refine (coarse → fine) and unparseable codes', () => {
    assert.equal(P.convertPeriod('2024', 'month'), null);
    assert.equal(P.convertPeriod('2024-Q2', 'month'), null);
    assert.equal(P.convertPeriod('2024', 'day'), null);
    assert.equal(P.convertPeriod('garbage', 'year'), null);
  });
});

describe('clampPeriod', () => {
  it('clamps below min and above max (lexicographic within one granularity)', () => {
    assert.equal(P.clampPeriod('1999', '2000', '2026'), '2000');
    assert.equal(P.clampPeriod('2030', '2000', '2026'), '2026');
    assert.equal(P.clampPeriod('2024-01', '2020-06', '2026-07'), '2024-01');
    assert.equal(P.clampPeriod('2019-Q4', '2020-Q1', '2026-Q2'), '2020-Q1');
  });

  it('ignores missing bounds', () => {
    assert.equal(P.clampPeriod('1999', '', '2026'), '1999');
    assert.equal(P.clampPeriod('2030', '2000', null), '2030');
  });
});

describe('estimatePeriodCount', () => {
  it('counts years, quarters and months inclusively', () => {
    assert.equal(P.estimatePeriodCount('2020', '2024', 'year'), 5);
    assert.equal(P.estimatePeriodCount('2020-Q1', '2021-Q1', 'quarter'), 5);
    assert.equal(P.estimatePeriodCount('2020-01', '2020-12', 'month'), 12);
  });

  it('counts business days (weekdays) for day granularity', () => {
    // Mon 2026-07-13 .. Fri 2026-07-17 = 5 weekdays
    assert.equal(P.estimatePeriodCount('2026-07-13', '2026-07-17', 'day'), 5);
    // Sat 2026-07-11 .. Sun 2026-07-12 = 0 weekdays
    assert.equal(P.estimatePeriodCount('2026-07-11', '2026-07-12', 'day'), 0);
    // A full year ≈ 260-262 business days
    const y = P.estimatePeriodCount('2025-01-01', '2025-12-31', 'day');
    assert.ok(y >= 250 && y <= 262, 'got ' + y);
  });

  it('returns 0 for inverted or unparseable ranges', () => {
    assert.equal(P.estimatePeriodCount('2024', '2020', 'year'), 0);
    assert.equal(P.estimatePeriodCount('2020-Q3', '2020-Q1', 'quarter'), 0);
    assert.equal(P.estimatePeriodCount('x', '2020', 'year'), 0);
  });
});

describe('periodBoundsForYear (input min/max attributes from a year)', () => {
  it('builds earliest and latest codes per granularity', () => {
    assert.deepEqual(P.periodBoundsForYear('1980', 'year'), { min: '1980', max: '1980' });
    assert.deepEqual(P.periodBoundsForYear('1980', 'quarter'), { min: '1980-Q1', max: '1980-Q4' });
    assert.deepEqual(P.periodBoundsForYear('1980', 'month'), { min: '1980-01', max: '1980-12' });
    assert.deepEqual(P.periodBoundsForYear('1980', 'day'), { min: '1980-01-01', max: '1980-12-31' });
  });

  it('returns null for a non-year input', () => {
    assert.equal(P.periodBoundsForYear('', 'day'), null);
    assert.equal(P.periodBoundsForYear('19xx', 'day'), null);
  });
});
