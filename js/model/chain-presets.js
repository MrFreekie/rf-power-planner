// Chain item presets (passive splitters/combiners, couplers, pads, filters, bias tee, DC block, active distribution, boosters) and
// the DC bias checks. Pure data and functions, no imports. EVERY figure carries a confidence flag: S = stated in a source seen,
// I = inferred or generic engineering value, U = unverified. All are generic classes of device (no product numbers): check the
// manufacturer datasheet before relying on one, and treat the values as planning defaults.

export const DC_MODES = ['pass', 'block', 'short'];
export const FILTER_TYPES = ['bandpass', 'notch'];

/** Chain kinds added by this module (the older ones are cable, booster, filter, connector, attenuator, splitter, combiner). */
export const EXTRA_CHAIN_KINDS = ['coupler', 'biastee', 'dcblock', 'activesplitter', 'activecombiner', 'rof'];
/** Kinds with gain (active): they use gainDb / nfDb / iip3Dbm like a booster. */
export const ACTIVE_CHAIN_KINDS = ['booster', 'activesplitter', 'activecombiner'];

/**
 * CHAIN_PRESETS: id -> { label, kind, item: {fields copied into the chain item}, flags: { field: 'S'|'I'|'U' }, note }.
 * Item fields (all optional, numeric unless noted): lossDb, insertionLossDb, ports, gainDb, nfDb, iip3Dbm, couplingDb,
 * excessLossDb, isolationDb (port to port), rejectionDb, maxInputDbm (damage/overload rating), dcMode ('pass'|'block'|'short'),
 * noDc (true: the port is not rated for DC), dcSupplyV/dcSupplyMa (bias injected or supplied), dcNeedV/dcNeedMa (bias the item
 * needs over the coax), powerV/powerMa (own supply, information only), filterType.
 */
export const CHAIN_PRESETS = Object.freeze({
  'splitter-2': {
    label: 'Passive splitter/combiner 2-way (50:50)', kind: 'splitter',
    item: { ports: 2, insertionLossDb: 0.5, isolationDb: 25, dcMode: 'block', noDc: true },
    flags: { ports: 'S', insertionLossDb: 'I', isolationDb: 'I', dcMode: 'U' },
    note: '3 dB split plus excess loss, about 3.5 dB in all (the planner passive-hybrid class). DC behaviour differs by model: block assumed.',
  },
  'splitter-4': {
    label: 'Passive splitter/combiner 4-way', kind: 'splitter',
    item: { ports: 4, insertionLossDb: 1, isolationDb: 20, dcMode: 'block', noDc: true },
    flags: { ports: 'S', insertionLossDb: 'U', isolationDb: 'U', dcMode: 'U' },
    note: '6 dB split plus excess loss.',
  },
  'splitter-8': {
    label: 'Passive splitter/combiner 8-way', kind: 'splitter',
    item: { ports: 8, insertionLossDb: 1.5, isolationDb: 20, dcMode: 'block', noDc: true },
    flags: { ports: 'S', insertionLossDb: 'U', isolationDb: 'U', dcMode: 'U' },
    note: '9 dB split plus excess loss.',
  },
  'coupler-10': {
    label: 'Directional coupler 10 dB (about 90:10 tap)', kind: 'coupler',
    item: { couplingDb: 10, excessLossDb: 0.1, isolationDb: 25, dcMode: 'block', noDc: true },
    flags: { couplingDb: 'S', excessLossDb: 'U', isolationDb: 'U', dcMode: 'U' },
    note: 'Main line loses -10log10(0.9) = 0.46 dB plus excess; the tap port is 10 dB down.',
  },
  'coupler-20': {
    label: 'Directional coupler 20 dB (about 99:1 monitor tap)', kind: 'coupler',
    item: { couplingDb: 20, excessLossDb: 0.1, isolationDb: 25, dcMode: 'block', noDc: true },
    flags: { couplingDb: 'S', excessLossDb: 'U', isolationDb: 'U', dcMode: 'U' },
    note: 'Main line loses 0.04 dB plus excess; the tap port is 20 dB down. Never connect a bias-powered line to an analyser through it.',
  },
  'pad-3': { label: 'Fixed attenuator 3 dB', kind: 'attenuator', item: { lossDb: 3, dcMode: 'pass' }, flags: { lossDb: 'S' }, note: 'Generic fixed pad.' },
  'pad-6': { label: 'Fixed attenuator 6 dB', kind: 'attenuator', item: { lossDb: 6, dcMode: 'pass' }, flags: { lossDb: 'S' }, note: 'Generic fixed pad.' },
  'pad-10': { label: 'Fixed attenuator 10 dB', kind: 'attenuator', item: { lossDb: 10, dcMode: 'pass' }, flags: { lossDb: 'S' }, note: 'Generic fixed pad.' },
  'pad-20': { label: 'Fixed attenuator 20 dB', kind: 'attenuator', item: { lossDb: 20, dcMode: 'pass' }, flags: { lossDb: 'S' }, note: 'Generic fixed pad.' },
  'filter-bandpass': {
    label: 'Bandpass filter (generic band)', kind: 'filter',
    item: { filterType: 'bandpass', lossDb: 1.5, rejectionDb: 30, dcMode: 'short', noDc: true },
    flags: { lossDb: 'U', rejectionDb: 'U', dcMode: 'U' },
    note: 'Passband loss 1 to 3 dB and 20 to 50 dB stopband rejection are typical. Many cavity and interdigital filters short DC: shorted assumed.',
  },
  'filter-notch': {
    label: 'Notch filter (generic)', kind: 'filter',
    item: { filterType: 'notch', lossDb: 0.5, rejectionDb: 30, dcMode: 'short', noDc: true },
    flags: { lossDb: 'U', rejectionDb: 'U', dcMode: 'U' },
    note: 'Passband loss is small; the notch depth applies only at its frequency.',
  },
  'biastee': {
    label: 'Bias tee (DC injector, 12 V)', kind: 'biastee',
    item: { lossDb: 0.6, isolationDb: 40, dcMode: 'pass', dcSupplyV: 12, dcSupplyMa: 350 },
    flags: { lossDb: 'S', isolationDb: 'S', dcSupplyV: 'S', dcSupplyMa: 'S' },
    note: 'Puts DC on the coax to power a remote booster or LNA. Insertion loss about 0.6 dB. 12 V at 350 mA is a value seen on distribution outputs; set the supply to your device.',
  },
  'dcblock': {
    label: 'DC block', kind: 'dcblock',
    item: { lossDb: 0.3, dcMode: 'block' },
    flags: { lossDb: 'U', dcMode: 'S' },
    note: 'Passes RF, blocks DC: put one before an analyser or any input that does not expect bias.',
  },
  'active-splitter-4': {
    label: 'Active antenna splitter 1:4', kind: 'activesplitter',
    item: { ports: 4, gainDb: 0, nfDb: 8, iip3Dbm: 20, isolationDb: 25, dcMode: 'pass', dcSupplyV: 12, dcSupplyMa: 350, powerV: 13.8, powerMa: 245 },
    flags: { ports: 'S', gainDb: 'S', nfDb: 'U', iip3Dbm: 'U', isolationDb: 'U', dcSupplyV: 'S', dcSupplyMa: 'S', powerV: 'S', powerMa: 'S' },
    note: 'Net distribution gain about 0 dB (+/-1 dB) per output; it powers the antenna amplifiers on its antenna side. Own supply 13.8 V / 245 mA.',
  },
  'active-splitter-8': {
    label: 'Active antenna splitter 1:8', kind: 'activesplitter',
    item: { ports: 8, gainDb: 0, nfDb: 9, iip3Dbm: 20, isolationDb: 25, dcMode: 'pass', dcSupplyV: 12, dcSupplyMa: 350, powerV: 13.8, powerMa: 245 },
    flags: { ports: 'S', gainDb: 'S', nfDb: 'U', iip3Dbm: 'U', isolationDb: 'U', dcSupplyV: 'S', dcSupplyMa: 'S', powerV: 'S', powerMa: 'S' },
    note: 'Same class as the 1:4 with eight outputs.',
  },
  'active-combiner-8': {
    label: 'Active IEM combiner 8:1', kind: 'activecombiner',
    item: { ports: 8, gainDb: 0, nfDb: 10, iip3Dbm: 25, isolationDb: 30, maxInputDbm: 24, dcMode: 'block', noDc: true },
    flags: { ports: 'S', gainDb: 'S', nfDb: 'U', iip3Dbm: 'U', isolationDb: 'U', maxInputDbm: 'S', dcMode: 'U' },
    note: 'Distribution gain about 0 dB (+/-1 dB); inputs rated for 100 mW (20 dBm) and protected to 250 mW (24 dBm). Isolation between inputs is not published in the figures seen: 30 dB is a planning guess.',
  },
  'active-combiner-4': {
    label: 'Active IEM combiner 4:1', kind: 'activecombiner',
    item: { ports: 4, gainDb: 0, nfDb: 10, iip3Dbm: 25, isolationDb: 30, maxInputDbm: 20, dcMode: 'block', noDc: true },
    flags: { ports: 'S', gainDb: 'I', nfDb: 'U', iip3Dbm: 'U', isolationDb: 'U', maxInputDbm: 'S', dcMode: 'U' },
    note: 'Inputs rated about 100 mW (20 dBm).',
  },
  // RF over fibre: all figures ASSUMED placeholders, UNVERIFIED (no product named; ask for datasheets). gainDb/nfDb are back to back.
  'rof-passive-1km': {
    label: 'RF over fibre, passive direct-detect, 1 km (assumed)', kind: 'rof',
    item: { gainDb: -25, nfDb: 30, sfdrDbHz23: 100, fibreKm: 1, fibreLossDbPerKm: 0.35, connectorLossDb: 1, bwMinMHz: 400, bwMaxMHz: 1000, powerV: 12, powerMa: 200 },
    flags: { gainDb: 'U', nfDb: 'U', sfdrDbHz23: 'U', fibreKm: 'S', fibreLossDbPerKm: 'I', connectorLossDb: 'U', bwMinMHz: 'U', bwMaxMHz: 'U', powerV: 'U', powerMa: 'U' },
    note: 'Passive intensity-modulated direct-detect module: negative RF gain (about -15 to -30 dB), noise figure 20 to 40 dB, SFDR about 95 to 110 dB Hz^(2/3). Placeholder numbers: use the datasheet of the module you have.',
  },
  'rof-active-lna': {
    label: 'RF over fibre with built-in amplifiers, 1 km (assumed)', kind: 'rof',
    item: { gainDb: 10, nfDb: 10, sfdrDbHz23: 95, fibreKm: 1, fibreLossDbPerKm: 0.35, connectorLossDb: 1, bwMinMHz: 400, bwMaxMHz: 1000, powerV: 12, powerMa: 300 },
    flags: { gainDb: 'U', nfDb: 'U', sfdrDbHz23: 'U', fibreKm: 'S', fibreLossDbPerKm: 'I', connectorLossDb: 'U', bwMinMHz: 'U', bwMaxMHz: 'U', powerV: 'U', powerMa: 'U' },
    note: 'Module with an LNA ahead of the laser: gain about 0 to +20 dB, noise figure 5 to 15 dB, a lower SFDR. Placeholder numbers, UNVERIFIED.',
  },
  // Protection and out-of-band filters. All figures generic classes, loss and rejection UNVERIFIED (datasheet before relying).
  'surge-arrestor-dcpass': {
    label: 'Surge / lightning arrestor, gas-tube, DC pass (antenna feed)', kind: 'connector',
    item: { lossDb: 0.15, dcMode: 'pass' },
    flags: { lossDb: 'U', dcMode: 'U' },
    note: 'Gas discharge tube in a bulkhead body, about 0.1 to 0.2 dB insertion loss through UHF. Needs a ground bond to the entry panel to work. The DC-pass type lets antenna bias through; some types do not, so DC behaviour is unverified.',
  },
  'surge-arrestor-dcblock': {
    label: 'Surge / lightning arrestor, gas-tube, DC block (antenna feed)', kind: 'dcblock',
    item: { lossDb: 0.2, dcMode: 'block' },
    flags: { lossDb: 'U', dcMode: 'U' },
    note: 'Quarter-wave or capacitive-coupled arrestor: blocks DC, so it cannot pass antenna bias. About 0.1 to 0.3 dB, narrower band than the gas-tube DC-pass type. Ground bond required.',
  },
  'filter-highpass': {
    label: 'High-pass filter (blocks VHF / FM / TV below the band)', kind: 'filter',
    item: { filterType: 'bandpass', passLoMHz: 450, passHiMHz: 6000, lossDb: 0.5, rejectionDb: 40, dcMode: 'pass' },
    flags: { passLoMHz: 'U', passHiMHz: 'U', lossDb: 'U', rejectionDb: 'U', dcMode: 'U' },
    note: 'Generic high-pass, modelled as a pass band from 450 MHz up with 40 dB rejection below it; set the corner for your filter. Most high-pass types pass DC, check yours.',
  },
  'filter-lte-block': {
    label: 'LTE / cellular filter (rejects 700-860 MHz)', kind: 'filter',
    item: { filterType: 'notch', passLoMHz: 703, passHiMHz: 862, lossDb: 0.5, rejectionDb: 40, dcMode: 'pass' },
    flags: { passLoMHz: 'U', passHiMHz: 'U', lossDb: 'U', rejectionDb: 'U', dcMode: 'U' },
    note: 'Rejects the European 700 and 800 MHz LTE blocks (703-862 MHz, assumed edges): it also removes any mic or IEM channel inside that range, so use it only below 703 MHz. US 600 / 700 MHz blocks differ: set the edges yourself.',
  },
  'booster-12': {
    label: 'Antenna booster 12 dB (rack or antenna)', kind: 'booster',
    item: { gainDb: 12, nfDb: 3, iip3Dbm: 8, dcMode: 'pass', dcNeedV: 12, dcNeedMa: 130 },
    flags: { gainDb: 'I', nfDb: 'I', iip3Dbm: 'U', dcNeedV: 'S', dcNeedMa: 'S' },
    note: 'Generic pro-audio class booster. 12 V / 130 mA is the antenna-amplifier supply seen on an antenna distribution input.',
  },
  'lna-20': {
    label: 'Low-noise amplifier 20 dB (needs a bandpass filter ahead)', kind: 'booster',
    item: { gainDb: 20, nfDb: 1, iip3Dbm: 14, dcMode: 'pass', dcNeedV: 5, dcNeedMa: 80 },
    flags: { gainDb: 'I', nfDb: 'I', iip3Dbm: 'U', dcNeedV: 'U', dcNeedMa: 'U' },
    note: 'Low NF, but the dynamic range is limited by IIP3 and out-of-band signals: filter before it.',
  },
});
export const CHAIN_PRESET_IDS = Object.freeze(Object.keys(CHAIN_PRESETS));

/** Loss (dB, positive) of a directional coupler main line: -10 log10(1 - 10^(-C/10)) + excess. */
export function couplerThroughLossDb(item) {
  const c = Number.isFinite(item.couplingDb) ? item.couplingDb : 10;
  return -10 * Math.log10(1 - Math.pow(10, -c / 10)) + (Number.isFinite(item.excessLossDb) ? item.excessLossDb : 0);
}
/** Level at the tap (coupled) port of a coupler given the input level (dBm): input - coupling - excess. */
export function couplerTapDbm(item, inputDbm) {
  return inputDbm - (Number.isFinite(item.couplingDb) ? item.couplingDb : 10) - (Number.isFinite(item.excessLossDb) ? item.excessLossDb : 0);
}

const labelOf = (it, i) => (it.presetId && CHAIN_PRESETS[it.presetId] ? CHAIN_PRESETS[it.presetId].label : `${it.kind} ${i + 1}`);

/**
 * chainDcWarnings(chain, { endSupplyV, endSupplyMa }) -> string[]
 * DC bias walk along a chain in signal-flow order. The chain is cut into DC segments at every item with dcMode 'block'
 * (default 'pass'). In each segment:
 *  - a consumer (dcNeedV > 0) with no supplier (dcSupplyV > 0 on a bias tee or active item, or the receiver end supply
 *    endSupplyV for the last segment) gets "needs bias but none reaches it";
 *  - supply below the need voltage, or the consumers' total current above the supply current, are flagged;
 *  - a supplier with a 'short' item (dcMode 'short') in the same segment is flagged (the supply is pulled down);
 *  - a supplier with an item marked noDc in the same segment is flagged (a port that does not expect bias).
 * Warns only; it does not change the RF numbers.
 */
export function chainDcWarnings(chain, { endSupplyV = 0, endSupplyMa = Infinity } = {}) {
  const out = [];
  const items = Array.isArray(chain) ? chain : [];
  const segments = [[]];
  items.forEach((it, i) => {
    if (it && it.dcMode === 'block') segments.push([]);
    else segments[segments.length - 1].push({ it, i });
  });
  segments.forEach((seg, si) => {
    const last = si === segments.length - 1;
    const sup = seg.filter((x) => x.it.dcSupplyV > 0);
    let supV = sup.length ? Math.max(...sup.map((x) => x.it.dcSupplyV)) : 0;
    let supMa = sup.length ? Math.max(...sup.map((x) => (Number.isFinite(x.it.dcSupplyMa) ? x.it.dcSupplyMa : Infinity))) : 0;
    if (last && endSupplyV > 0) { supV = Math.max(supV, endSupplyV); supMa = Math.max(supMa, endSupplyMa); }
    const cons = seg.filter((x) => x.it.dcNeedV > 0);
    for (const c of cons) {
      const name = labelOf(c.it, c.i);
      if (!(supV > 0)) out.push(`${name} needs ${c.it.dcNeedV} V bias over the cable but no bias reaches it (no bias tee or supply on its side, or a DC block in between).`);
      else if (supV < c.it.dcNeedV) out.push(`${name} needs ${c.it.dcNeedV} V bias but the supply gives ${supV} V.`);
    }
    if (supV > 0 && cons.length) {
      const need = cons.reduce((s, x) => s + (Number.isFinite(x.it.dcNeedMa) ? x.it.dcNeedMa : 0), 0);
      if (need > supMa) out.push(`Bias current needed (${need} mA) is above the supply (${supMa} mA).`);
    }
    if (supV > 0) {
      for (const x of seg) {
        if (x.it.dcMode === 'short') out.push(`${labelOf(x.it, x.i)} shorts DC while bias is on the line: the supply is pulled down. Put a DC block or bias-aware path around it.`);
        else if (x.it.noDc && !(x.it.dcSupplyV > 0)) out.push(`${labelOf(x.it, x.i)} is not rated for DC bias but bias reaches it: add a DC block before it (analysers, passive splitters and filters can be damaged).`);
      }
    }
  });
  return out;
}
