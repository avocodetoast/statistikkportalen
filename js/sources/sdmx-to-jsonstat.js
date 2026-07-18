/**
 * SDMX-JSON → JSON-Stat2 converter (Statistikkportalen 2.0)
 * =========================================================
 *
 * Rene funksjoner som mapper Norges Banks SDMX-JSON (SDMX REST v2.1) til det
 * interne JSON-Stat2-formatet appen bruker overalt ellers. Ingen sideeffekter,
 * ingen nettverk — kun deterministisk mapping. Eksponeres som
 * `window.SdmxToJsonStat` med to funksjoner:
 *
 *   dataToJsonStat(sdmxDataJson, opts)      → JSON-Stat2 dataset (id/size/dimension/value/status/role)
 *   structureToMetadata(sdmxDsdJson, flowConfig, opts) → JSON-Stat2-lignende tabellmetadata
 *
 * SDMX-JSON-DATAMELDING (dataToJsonStat)
 * --------------------------------------
 *   data.structure.dimensions.series[]      — seriedimensjoner {id,name,values:[{id,name}]}
 *   data.structure.dimensions.observation[] — TIME_PERIOD {id,name,values:[{id,name}]}
 *   data.dataSets[0].series                 — nøkkel "i:j:k" → {attributes, observations:{obsIdx:[value,...]}}
 *   Serienøkkel-indeksene refererer posisjoner i structure.dimensions.series[].values;
 *   obs-indeksen peker inn i observation[0].values. TIME_PERIOD er alltid siste
 *   (raskeste) dimensjon i den flate value-arrayen (row-major).
 *
 * SDMX-JSON-STRUKTURMELDING (structureToMetadata)
 * -----------------------------------------------
 *   data.dataStructures[0].dataStructureComponents.dimensionList.dimensions[]
 *     — hver dim {id, position, localRepresentation.enumeration: <codelist-urn>}
 *   data.dataStructures[0].dataStructureComponents.dimensionList.timeDimensions[]
 *     — TIME_PERIOD
 *   data.codelists[]  — {id, names:{no,en}, codes:[{id, names:{no,en}}]}
 *   TIME_PERIOD-kategorien fylles av adapteren fra en data-probe (opts.timeValues),
 *   ikke fra DSD-en.
 *
 * SPRÅK: `name` opptrer både som ren streng (datamelding, allerede lokalisert av
 * locale-parameteren) og som objekt `names:{no,en}` (strukturmelding). pickName()
 * håndterer begge, med nb/no-fallback.
 */
(function () {
  'use strict';

  /** Normaliser UI-/API-språk til NB-locale-nøkler ('nb'→'no'). */
  function normLang(lang) {
    if (!lang) return 'no';
    const l = String(lang).toLowerCase();
    return l === 'nb' ? 'no' : l;
  }

  /**
   * Plukk et visningsnavn fra en SDMX-node. Håndterer både `names:{no,en}`
   * (strukturmelding) og ren `name`-streng (datamelding), med nb/no-fallback.
   */
  function pickName(node, lang) {
    if (!node) return '';
    const l = normLang(lang);
    if (node.names && typeof node.names === 'object') {
      return node.names[l] || node.names.no || node.names.nb ||
             node.names.en || node.name || node.id || '';
    }
    if (typeof node.name === 'string') return node.name;
    return node.id || '';
  }

  /** Parse codelist-id ut av en SDMX-urn, f.eks. «...Codelist=NB:CL_FREQ(1.0)» → «CL_FREQ». */
  function codelistIdFromUrn(urn) {
    if (typeof urn !== 'string') return null;
    const m = urn.match(/Codelist=[^:]+:([^()]+)\(/);
    return m ? m[1] : null;
  }

  /** Radmajor-strides for en size-array: strides[i] = produkt(size[i+1..]). */
  function computeStrides(size) {
    const strides = new Array(size.length);
    let acc = 1;
    for (let i = size.length - 1; i >= 0; i--) {
      strides[i] = acc;
      acc *= size[i];
    }
    return strides;
  }

  /**
   * SDMX-JSON-datamelding → JSON-Stat2 dataset.
   *
   * @param {object} sdmx  — parsed SDMX-JSON-datasvar
   * @param {object} [opts]
   * @param {string} [opts.lang]        — 'no'|'en' (kun for fallback; navn er alt lokalisert)
   * @param {string} [opts.source]      — proveniens ('Norges Bank')
   * @param {string} [opts.label]       — tabelltittel
   * @param {string} [opts.updated]     — ISO-dato
   * @param {string[]} [opts.metricDims]— dim-id-er som skal få role.metric
   * @returns {object} JSON-Stat2 dataset. Tomt (value:[]) hvis meldingen ikke har serier.
   */
  function dataToJsonStat(sdmx, opts) {
    opts = opts || {};
    const lang = normLang(opts.lang);
    const data = sdmx && sdmx.data;
    const structure = data && data.structure;
    const dims = structure && structure.dimensions;
    const dataSet = data && Array.isArray(data.dataSets) ? data.dataSets[0] : null;

    // Sorter seriedimensjonene på keyPosition slik at array-indeks == posisjon i
    // serienøkkelen "i:j:k". SDMX kan i prinsippet levere series[] i en annen
    // rekkefølge enn keyPosition; da ville verdiene ellers havne i feil celler.
    // structureToMetadata sorterer tilsvarende på `position`. Sorteringen er
    // stabil, så et svar uten keyPosition (eller allerede i riktig rekkefølge)
    // gir identisk resultat som før.
    const rawSeriesDims = (dims && Array.isArray(dims.series)) ? dims.series : [];
    const seriesDims = rawSeriesDims.slice().sort((a, b) =>
      ((a && a.keyPosition != null ? a.keyPosition : 0) -
       (b && b.keyPosition != null ? b.keyPosition : 0)));
    const obsDims = (dims && Array.isArray(dims.observation)) ? dims.observation : [];
    const timeDim = obsDims[0] || null;
    const seriesObj = (dataSet && dataSet.series) || {};
    const seriesKeys = Object.keys(seriesObj);

    // Ingen serier → tomt, men gyldig JSON-Stat2 (UI viser «ingen data»).
    if (!timeDim || seriesKeys.length === 0) {
      return buildEmptyDataset(seriesDims, timeDim, lang, opts);
    }

    // id/size: seriedimensjoner (i keyPosition-rekkefølge) + TIME_PERIOD sist.
    const id = seriesDims.map(d => d.id).concat([timeDim.id]);
    const size = seriesDims.map(d => (d.values || []).length).concat([(timeDim.values || []).length]);

    // JSON-Stat2 er et TETT kryssprodukt — for svært sparsomme flows (f.eks.
    // GOVT_PRIMARY_MARKET, ISIN-nøklede serier) kan et åpent uttak gi et
    // produkt langt over det en JS-array kan romme («Invalid array length»).
    // UI-et blokkerer slike uttak via celletaket (AppConfig.limits.maxCells,
    // variable-select-status.validateSelection) — dette er en defensiv skranke
    // for kall utenom UI-et, med en lesbar feil i stedet for RangeError.
    const MAX_DENSE_CELLS = 20000000;
    const totalCells = size.reduce((a, b) => a * b, 1);
    if (totalCells > MAX_DENSE_CELLS) {
      throw new Error('[SdmxToJsonStat] Resultatet gir ' + totalCells +
        ' celler i tett JSON-Stat2-form (maks ' + MAX_DENSE_CELLS +
        ') — begrens utvalget per dimensjon.');
    }
    const strides = computeStrides(size);
    const timeStride = strides[strides.length - 1]; // = 1

    // dimension-objektet.
    const dimension = {};
    seriesDims.forEach(d => { dimension[d.id] = buildDimObject(d, lang); });
    dimension[timeDim.id] = buildDimObject(timeDim, lang);

    const total = size.reduce((a, b) => a * b, 1);
    const value = new Array(total).fill(null);
    const status = {};
    let hasStatus = false;

    // OBS_STATUS-posisjon blant obs-attributter (hvis noen).
    const obsAttrs = (structure.attributes && Array.isArray(structure.attributes.observation))
      ? structure.attributes.observation : [];
    const obsStatusPos = obsAttrs.findIndex(a => a.id === 'OBS_STATUS');
    const obsStatusValues = obsStatusPos >= 0 ? (obsAttrs[obsStatusPos].values || []) : [];

    seriesKeys.forEach(key => {
      const idxParts = key.split(':').map(Number);
      let base = 0;
      for (let d = 0; d < idxParts.length; d++) {
        base += (idxParts[d] || 0) * strides[d];
      }
      const observations = seriesObj[key].observations || {};
      Object.keys(observations).forEach(obsIdx => {
        const arr = observations[obsIdx];
        const flat = base + Number(obsIdx) * timeStride;
        const raw = Array.isArray(arr) ? arr[0] : arr;
        value[flat] = (raw === null || raw === undefined || raw === '') ? null : Number(raw);
        if (obsStatusPos >= 0 && Array.isArray(arr) && arr.length > 1 + obsStatusPos) {
          const sIdx = arr[1 + obsStatusPos];
          if (sIdx !== null && sIdx !== undefined && obsStatusValues[sIdx]) {
            status[String(flat)] = obsStatusValues[sIdx].id;
            hasStatus = true;
          }
        }
      });
    });

    const role = { time: [timeDim.id] };
    const metric = (opts.metricDims || []).filter(m => id.includes(m));
    if (metric.length) role.metric = metric;

    const out = {
      class: 'dataset',
      id: id,
      size: size,
      dimension: dimension,
      value: value,
      role: role,
      source: opts.source || 'Norges Bank',
      label: opts.label || pickName(structure, lang) || '',
      updated: opts.updated || (sdmx.meta && sdmx.meta.prepared) || null
    };
    if (hasStatus) out.status = status;
    return out;
  }

  /** Bygg et JSON-Stat2 dimension-objekt fra en SDMX-datameldingsdimensjon. */
  function buildDimObject(d, lang) {
    const index = {};
    const label = {};
    (d.values || []).forEach((v, i) => {
      index[v.id] = i;
      label[v.id] = pickName(v, lang) || v.id;
    });
    return {
      label: pickName(d, lang) || d.id,
      category: { index: index, label: label }
    };
  }

  /** Tomt, men gyldig JSON-Stat2 dataset (ingen observasjoner). */
  function buildEmptyDataset(seriesDims, timeDim, lang, opts) {
    const dimension = {};
    const id = [];
    const size = [];
    seriesDims.forEach(d => {
      dimension[d.id] = buildDimObject(d, lang);
      id.push(d.id);
      size.push((d.values || []).length);
    });
    if (timeDim) {
      dimension[timeDim.id] = buildDimObject(timeDim, lang);
      id.push(timeDim.id);
      size.push(0);
    }
    const role = timeDim ? { time: [timeDim.id] } : {};
    return {
      class: 'dataset',
      id: id,
      size: size,
      dimension: dimension,
      value: [],
      role: role,
      source: (opts && opts.source) || 'Norges Bank',
      label: (opts && opts.label) || '',
      updated: (opts && opts.updated) || null
    };
  }

  /**
   * SDMX-JSON-strukturmelding (DSD + kodelister) → JSON-Stat2-lignende metadata.
   *
   * @param {object} dsdJson — parsed strukturmelding fra /datastructure/NB/DSD_{FLOW}?references=codelist
   * @param {object} flowConfig — raden fra AppConfig.sources.nb.dataflows
   * @param {object} [opts]
   * @param {string}  [opts.lang]        — 'no'|'en'
   * @param {string}  [opts.source]      — 'Norges Bank'
   * @param {string}  [opts.updated]     — ISO-dato
   * @param {Object.<string,string>} [opts.dimLabels] — {dimId: visningsnavn} fra data-probe (foretrekkes)
   * @param {Array}   [opts.timeValues]  — [{id,name}] eller [id] for TIME_PERIOD-kategorien (fra data-probe)
   * @param {string}  [opts.timeLabel]   — visningsnavn for TIME_PERIOD
   * @returns {object} metadata { id, size, label, source, updated, dimension, role, extension }
   */
  function structureToMetadata(dsdJson, flowConfig, opts) {
    opts = opts || {};
    const lang = normLang(opts.lang);
    const dimLabels = opts.dimLabels || {};
    // {dimId: [koder]} som faktisk forekommer i ekte serier (serieskeysonly).
    // Når satt, begrenses hver seriedims kategori til disse kodene.
    const seriesValues = opts.seriesValues || null;

    const dsd = dsdJson && dsdJson.data && Array.isArray(dsdJson.data.dataStructures)
      ? dsdJson.data.dataStructures[0] : null;
    if (!dsd) {
      throw new Error('[SdmxToJsonStat] Strukturmelding mangler dataStructures[0]');
    }
    const comp = dsd.dataStructureComponents || {};
    const dimList = comp.dimensionList || {};
    const rawDims = (dimList.dimensions || []).slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const timeDims = dimList.timeDimensions || [];
    const timeId = (timeDims[0] && timeDims[0].id) || 'TIME_PERIOD';

    // Indekser kodelister på id.
    const codelists = {};
    ((dsdJson.data && dsdJson.data.codelists) || []).forEach(cl => { codelists[cl.id] = cl; });

    const id = [];
    const size = [];
    const dimension = {};
    const metric = [];
    const heading = [];

    rawDims.forEach(dim => {
      const dimId = dim.id;
      const clId = codelistIdFromUrn(
        dim.localRepresentation && dim.localRepresentation.enumeration
      );
      const cl = clId ? codelists[clId] : null;

      // Etiketter + rekkefølge fra DSD-kodelista.
      const clLabels = {};
      const clOrder = [];
      ((cl && cl.codes) || []).forEach(code => {
        clLabels[code.id] = pickName(code, lang) || code.id;
        clOrder.push(code.id);
      });

      // Begrens til faktiske serieverdier når serieskeysonly-proben er tilgjengelig.
      // Behold DSD-kodelistas rekkefølge; legg til evt. faktiske koder som mangler i DSD.
      let codes;
      if (seriesValues && Array.isArray(seriesValues[dimId])) {
        const allowed = new Set(seriesValues[dimId]);
        codes = clOrder.filter(c => allowed.has(c));
        const have = new Set(codes);
        seriesValues[dimId].forEach(c => { if (!have.has(c)) { codes.push(c); have.add(c); } });
      } else {
        codes = clOrder.slice();
      }

      const index = {};
      const label = {};
      codes.forEach((c, i) => {
        index[c] = i;
        label[c] = clLabels[c] || c;
      });

      // Foretrekk friendly dim-navn fra data-probe; ellers kodelistenavn; ellers id.
      const dimLabel = dimLabels[dimId] || (cl ? pickName(cl, lang) : '') || dimId;

      dimension[dimId] = {
        label: dimLabel,
        category: { index: index, label: label },
        extension: { elimination: false, show: 'value' }
      };
      id.push(dimId);
      size.push(codes.length);
      heading.push(dimId);

      // Heuristikk: måleenhet-dimensjoner spiller metrisk rolle.
      if (/UNIT_MEASURE|MEASURE/.test(dimId)) metric.push(dimId);
    });

    // TIME_PERIOD-kategorien fylles fra data-proben (opts.timeValues), sortert stigende.
    const timeIndex = {};
    const timeLabelMap = {};
    const tvals = (opts.timeValues || []).map(v => (typeof v === 'string' ? { id: v, name: v } : v));
    const sorted = tvals.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    sorted.forEach((v, i) => {
      timeIndex[v.id] = i;
      timeLabelMap[v.id] = pickName(v, lang) || v.id;
    });
    dimension[timeId] = {
      label: opts.timeLabel || (dimLabels[timeId] || 'Tidsperiode'),
      category: { index: timeIndex, label: timeLabelMap },
      extension: { elimination: false, show: 'value' }
    };
    id.push(timeId);
    size.push(sorted.length);

    const role = { time: [timeId] };
    if (metric.length) role.metric = metric;

    const label = pickName(dsd, lang) ||
      (flowConfig && flowConfig.label && (flowConfig.label[lang === 'no' ? 'nb' : lang] || flowConfig.label.nb)) ||
      (flowConfig && flowConfig.tableId) || '';

    return {
      id: id,
      size: size,
      label: label,
      source: opts.source || 'Norges Bank',
      updated: opts.updated || null,
      dimension: dimension,
      role: role,
      extension: {
        px: { heading: heading, stub: [timeId] }
      }
    };
  }

  // ============================================================
  // Periodehjelpere for intervallbasert tidsvelger (variable-select)
  // ============================================================
  //
  // SDMX-tidskoder er frekvensspesifikke og leksikografisk sorterbare innen én
  // granularitet: A → '2025', Q → '2025-Q3', M → '2025-07', B/D → '2025-07-15'.
  // Utvalgs-tokenet `range(from,to)` (tomme sider tillatt = åpen ende) bæres
  // som streng gjennom AppState/URL og oversettes av norges-bank-adapterens
  // buildKeyAndParams til startPeriod/endPeriod. Alt her er rent og DOM-fritt
  // (testes i tests/unit/nb-period-range.test.js).

  const GRAN_BY_FREQ = { A: 'year', Q: 'quarter', M: 'month', B: 'day', D: 'day' };
  // Grovhetsrang: konvertering er kun lov mot grovere (høyere rang).
  const GRAN_RANK = { day: 0, month: 1, quarter: 2, year: 3 };

  /** SDMX-frekvenskode → inputgranularitet. Ukjent/tom → 'day' (fineste). */
  function periodGranularity(freqCode) {
    return GRAN_BY_FREQ[String(freqCode || '').toUpperCase()] || 'day';
  }

  /** Granularitet utledet av en periodekodes form, eller null (f.eks. FHI-skoleår). */
  function periodCodeGranularity(code) {
    const c = String(code || '');
    if (/^\d{4}$/.test(c)) return 'year';
    if (/^\d{4}-Q[1-4]$/i.test(c)) return 'quarter';
    if (/^\d{4}-\d{2}$/.test(c)) return 'month';
    if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return 'day';
    return null;
  }

  /** 'range(from,to)' → {from, to} (trimmet; tom side = åpen ende), ellers null. */
  function parsePeriodRange(token) {
    if (typeof token !== 'string') return null;
    const m = token.match(/^range\(([^,()]*),([^,()]*)\)$/);
    if (!m) return null;
    return { from: m[1].trim(), to: m[2].trim() };
  }

  /** Bygg 'range(from,to)'-tokenet (trimmer; tomme sider tillatt). */
  function formatPeriodRange(from, to) {
    return 'range(' + String(from || '').trim() + ',' + String(to || '').trim() + ')';
  }

  /**
   * Konverter en periodekode til en annen granularitet. Kun mot grovere er
   * deterministisk ('2024-03-15' → '2024-03' → '2024'; måned/dag → 'YYYY-QN');
   * mot finere (eller uparserbar kode) → null, så kalleren kan tømme feltet.
   */
  function convertPeriod(code, toGran) {
    const c = String(code || '').trim();
    const fromGran = periodCodeGranularity(c);
    if (!fromGran || !(toGran in GRAN_RANK)) return null;
    if (fromGran === toGran) return c;
    if (GRAN_RANK[toGran] < GRAN_RANK[fromGran]) return null; // finere → udefinert

    const year = c.slice(0, 4);
    if (toGran === 'year') return year;
    if (toGran === 'month') {
      // Kun dag → måned er mulig (kvartal/år er grovere og fanget over).
      return fromGran === 'day' ? c.slice(0, 7) : null;
    }
    if (toGran === 'quarter') {
      // Dag/måned har månedsdel i posisjon 5-6.
      const month = parseInt(c.slice(5, 7), 10);
      if (!month || month < 1 || month > 12) return null;
      return year + '-Q' + Math.ceil(month / 3);
    }
    return null;
  }

  /**
   * Klem en kode innenfor [min, max] (leksikografisk — gyldig innen én
   * granularitet). Tomme/manglende grenser ignoreres.
   */
  function clampPeriod(code, minCode, maxCode) {
    let c = String(code || '');
    if (minCode && c < minCode) c = minCode;
    if (maxCode && c > maxCode) c = maxCode;
    return c;
  }

  /** Antall virkedager (man-fre) i [d1, d2], begge ISO-datoer, inklusiv. */
  function businessDayCount(d1, d2) {
    const start = new Date(d1 + 'T00:00:00Z');
    const end = new Date(d2 + 'T00:00:00Z');
    if (isNaN(start) || isNaN(end) || end < start) return 0;
    const days = Math.round((end - start) / 86400000) + 1;
    let count = Math.floor(days / 7) * 5;
    const startDow = start.getUTCDay();
    for (let i = 0; i < days % 7; i++) {
      const dow = (startDow + i) % 7;
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }

  /**
   * Estimer antall perioder i [from, to] for en granularitet (inklusiv).
   * Dag-granularitet teller virkedager (NB-frekvens B). Invertert eller
   * uparserbar range → 0. Brukes kun til celletall-estimatet i UI-en.
   */
  function estimatePeriodCount(from, to, gran) {
    const f = String(from || '').trim();
    const t = String(to || '').trim();
    if (periodCodeGranularity(f) !== gran || periodCodeGranularity(t) !== gran) return 0;
    if (t < f) return 0;

    const fy = parseInt(f.slice(0, 4), 10);
    const ty = parseInt(t.slice(0, 4), 10);
    if (gran === 'year') return ty - fy + 1;
    if (gran === 'quarter') {
      return (ty * 4 + parseInt(t.slice(6), 10)) - (fy * 4 + parseInt(f.slice(6), 10)) + 1;
    }
    if (gran === 'month') {
      return (ty * 12 + parseInt(t.slice(5, 7), 10)) - (fy * 12 + parseInt(f.slice(5, 7), 10)) + 1;
    }
    return businessDayCount(f, t);
  }

  /**
   * Tidligste/seneste periodekode i et årstall for en granularitet — brukes som
   * min/max-attributter på fra/til-inputene (årstall fra katalogens
   * firstPeriod/lastPeriod). Ikke-årstall → null (ingen grense).
   */
  function periodBoundsForYear(year, gran) {
    const y = String(year || '').trim();
    if (!/^\d{4}$/.test(y)) return null;
    if (gran === 'year') return { min: y, max: y };
    if (gran === 'quarter') return { min: y + '-Q1', max: y + '-Q4' };
    if (gran === 'month') return { min: y + '-01', max: y + '-12' };
    return { min: y + '-01-01', max: y + '-12-31' };
  }

  window.SdmxToJsonStat = {
    dataToJsonStat: dataToJsonStat,
    structureToMetadata: structureToMetadata,
    // Periodehjelpere for intervallvelgeren (delt mellom UI og NB-adapteren).
    periodGranularity: periodGranularity,
    periodCodeGranularity: periodCodeGranularity,
    parsePeriodRange: parsePeriodRange,
    formatPeriodRange: formatPeriodRange,
    convertPeriod: convertPeriod,
    clampPeriod: clampPeriod,
    estimatePeriodCount: estimatePeriodCount,
    periodBoundsForYear: periodBoundsForYear,
    // Eksponert for gjenbruk/testing.
    _pickName: pickName,
    _codelistIdFromUrn: codelistIdFromUrn
  };
})();
