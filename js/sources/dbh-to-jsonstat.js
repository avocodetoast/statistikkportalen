/** Ren konvertering fra DBHs flate JSON-rader til JSON-Stat2. */
(function () {
  'use strict';

  function valuesInOrder(rows, dim) {
    const seen = Object.create(null);
    const values = [];
    rows.forEach(function (row) {
      const raw = row[dim.code];
      if (raw === undefined || raw === null) return;
      const code = String(raw);
      if (!Object.prototype.hasOwnProperty.call(seen, code)) {
        seen[code] = true;
        values.push(code);
      }
    });
    return values;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function convert(response, options) {
    const opts = options || {};
    const dimensions = opts.dimensions || [];
    const measures = opts.measures || [];
    if (!Array.isArray(response)) throw new Error('[DbhToJsonStat] Svaret må være et array');
    if (!measures.length) throw new Error('[DbhToJsonStat] Tabellen mangler måltall');
    const statusLine = response[0] && response[0].status ? response[0].status : null;
    const rows = (statusLine ? response.slice(1) : response).filter(function (r) { return r && !r.status; });
    const multi = measures.length > 1;
    const metricId = 'dbh-måltall';
    const id = dimensions.map(function (d) { return d.code; });
    if (multi) id.push(metricId);
    const codesByDim = dimensions.map(function (d) { return valuesInOrder(rows, d); });
    const size = codesByDim.map(function (codes) { return codes.length; });
    if (multi) size.push(measures.length);
    const dimension = {};
    const indexMaps = [];
    dimensions.forEach(function (dim, dimPos) {
      const index = {};
      const label = {};
      codesByDim[dimPos].forEach(function (code, i) {
        index[code] = i;
        // Etikettprioritet: byggetidsmetadata (labelMap) → navnekolonne i
        // dataresponsen (nameColumn) → koden selv.
        const mapped = dim.labelMap && dim.labelMap[code] != null ? String(dim.labelMap[code]) : null;
        const matching = mapped === null
          ? rows.find(function (row) { return String(row[dim.code]) === code; }) : null;
        label[code] = mapped !== null ? mapped
          : (matching && dim.nameColumn && matching[dim.nameColumn] != null
            ? String(matching[dim.nameColumn]) : code);
      });
      indexMaps.push(index);
      dimension[dim.code] = { label: dim.label || dim.code, category: { index: index, label: label } };
    });
    if (multi) {
      const metricIndex = {};
      const metricLabel = {};
      measures.forEach(function (measure, i) { metricIndex[measure] = i; metricLabel[measure] = measure; });
      dimension[metricId] = { label: 'Måltall', category: { index: metricIndex, label: metricLabel } };
    }
    const total = size.length && size.every(function (n) { return n > 0; })
      ? size.reduce(function (a, b) { return a * b; }, 1) : 0;
    const value = new Array(total).fill(null);
    const strides = size.map(function (_, i) {
      return size.slice(i + 1).reduce(function (a, b) { return a * b; }, 1);
    });
    rows.forEach(function (row) {
      let base = 0;
      for (let i = 0; i < dimensions.length; i++) {
        const pos = indexMaps[i][String(row[dimensions[i].code])];
        if (pos === undefined) return;
        base += pos * strides[i];
      }
      measures.forEach(function (measure, measurePos) {
        value[base + (multi ? measurePos : 0)] = numberOrNull(row[measure]);
      });
    });
    const role = { time: dimensions.some(function (d) { return d.code === 'Årstall'; }) ? ['Årstall'] : [] };
    if (multi) role.metric = [metricId];
    return {
      class: 'dataset', id: id, size: size, dimension: dimension, value: value,
      role: role, source: opts.source || '', label: opts.label || '',
      updated: statusLine && statusLine.leveringstid || null,
      extension: { dbhStatus: statusLine || null }
    };
  }

  window.DbhToJsonStat = { convert: convert, numberOrNull: numberOrNull };
})();
