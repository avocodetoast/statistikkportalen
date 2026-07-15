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

    const seriesDims = (dims && Array.isArray(dims.series)) ? dims.series : [];
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

      const index = {};
      const label = {};
      ((cl && cl.codes) || []).forEach((code, i) => {
        index[code.id] = i;
        label[code.id] = pickName(code, lang) || code.id;
      });

      // Foretrekk friendly dim-navn fra data-probe; ellers kodelistenavn; ellers id.
      const dimLabel = dimLabels[dimId] || (cl ? pickName(cl, lang) : '') || dimId;

      dimension[dimId] = {
        label: dimLabel,
        category: { index: index, label: label },
        extension: { elimination: false, show: 'value' }
      };
      id.push(dimId);
      size.push(Object.keys(index).length);
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

  window.SdmxToJsonStat = {
    dataToJsonStat: dataToJsonStat,
    structureToMetadata: structureToMetadata,
    // Eksponert for gjenbruk/testing.
    _pickName: pickName,
    _codelistIdFromUrn: codelistIdFromUrn
  };
})();
