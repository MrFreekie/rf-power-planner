// Powering budget: for each DC source on a link's coax (a receiver's antenna bias output, a bias tee, an active splitter output)
// the current drawn by the powered gear on its antenna side, against what the source can supply. Pure, no DOM.
// Chain order is antenna -> receiver. A DC block (dcMode 'block') cuts the line into segments; a load is fed by the nearest
// supplier on its receiver side in the same segment, or by the receiver bias output in the last segment. No cable DC
// resistance data exists in the cable library, so DC_LOOP_OHM_PER_100M below (assumed) gives the loop resistance of each cable
// between a load and its supply: far-end voltage = supply - I * R (Ohm's law, series cable), where I is the current of every load
// on the antenna side of that cable length.
// Confidence: 'S' the figure is set on the item/receiver, 'U' the default below is assumed.

export const DEFAULT_RX_BIAS_MA = 100; // assumed receiver antenna-bias limit when antennaBiasMa is not set
export const DEFAULT_ITEM_SUPPLY_MA = 350; // assumed bias tee / active splitter output when dcSupplyMa is not set

export const DROP_WARN_FRACTION = 0.1; // warn when the cable drop exceeds this fraction of the supply voltage (assumed rule of thumb)
export const DEFAULT_DC_LOOP_OHM_PER_100M = 3; // assumed for a cable type not in the table
// DC loop resistance (centre conductor plus braid, out and back) in ohm per 100 m. ASSUMED typical values from public datasheet
// class figures (copper-clad or stranded centre), rounded; not measured. Real cable varies with batch and temperature.
export const DC_LOOP_OHM_PER_100M = {
  rg58: 4.5, rg213: 1.4, rg174: 25, rg316: 25, 'lmr-195': 2.7, 'lmr-240': 1.7, 'lmr-400': 1.0, 'lmr-600': 0.5,
  'cfd-200': 2.7, 'cfd-400': 1.0, 'belden-9913': 0.8, 'belden-8214': 1.0, rg8x: 4, 'hardline-half': 0.3, rg6: 4,
};
/** Loop resistance in ohms of a chain cable item (0 for a non-cable or a cable without a usable length). */
export function cableLoopOhm(it) {
  if (!it || it.kind !== 'cable' || !(it.lengthM > 0)) return 0;
  const r = DC_LOOP_OHM_PER_100M[it.cableType];
  return (it.lengthM / 100) * (Number.isFinite(r) ? r : DEFAULT_DC_LOOP_OHM_PER_100M);
}

const nameOf = (it, i) => it.name || it.label || it.presetId || `${it.kind} ${i + 1}`;

/** poweringBudget(link) -> [{ source, supplyV, supplyMa, supplyConf, drawMa, loads:[{name,needV,needMa}], warnings, ok }], one per source that feeds at least one load. */
export function poweringBudget(link) {
  const chain = Array.isArray(link && link.chain) ? link.chain : [];
  const rx = (link && link.rx) || {};
  const sources = new Map();
  const get = (key, init) => { if (!sources.has(key)) sources.set(key, { ...init, loads: [], drawMa: 0, warnings: [] }); return sources.get(key); };
  const segs = [[]];
  chain.forEach((it, i) => { if (it && it.dcMode === 'block') segs.push([]); else if (it) segs[segs.length - 1].push({ it, i }); });
  segs.forEach((seg, si) => {
    const last = si === segs.length - 1;
    seg.forEach((x, p) => {
      if (!(x.it.dcNeedV > 0)) return;
      const src = seg.slice(p + 1).find((y) => y.it.dcSupplyV > 0);
      let s = null;
      if (src) {
        const stated = Number.isFinite(src.it.dcSupplyMa);
        s = get(`i${src.i}`, { source: nameOf(src.it, src.i), supplyV: src.it.dcSupplyV, supplyMa: stated ? src.it.dcSupplyMa : DEFAULT_ITEM_SUPPLY_MA, supplyConf: stated ? 'S' : 'U' });
      } else if (last && rx.antennaBiasV > 0) {
        const stated = Number.isFinite(rx.antennaBiasMa) && rx.antennaBiasMa > 0;
        s = get('rx', { source: 'Receiver antenna bias', supplyV: rx.antennaBiasV, supplyMa: stated ? rx.antennaBiasMa : DEFAULT_RX_BIAS_MA, supplyConf: stated ? 'S' : 'U' });
      }
      if (!s) return; // unpowered: chainDcWarnings already says so
      const need = Number.isFinite(x.it.dcNeedMa) ? x.it.dcNeedMa : 0;
      s.srcIdx = src ? src.i : chain.length;
      s.loads.push({ name: nameOf(x.it, x.i), idx: x.i, needV: x.it.dcNeedV, needMa: need });
      s.drawMa += need;
    });
  });
  const out = [];
  for (const s of sources.values()) {
    const tag = s.supplyConf === 'U' ? ' (assumed limit)' : '';
    if (s.drawMa > s.supplyMa) s.warnings.push(`${s.source}: ${s.drawMa} mA drawn but only ${s.supplyMa} mA available${tag}.`);
    s.dropV = 0;
    for (const l of s.loads) {
      // Series cable between this load and the source: each cable carries the current of every load on its antenna side.
      let drop = 0, ohm = 0;
      for (let k = l.idx + 1; k < s.srcIdx; k++) {
        const r = cableLoopOhm(chain[k]);
        if (!r) continue;
        const mA = s.loads.reduce((a, o) => a + (o.idx < k ? o.needMa : 0), 0);
        drop += (mA / 1000) * r; ohm += r;
      }
      l.loopOhm = ohm; l.dropV = drop; l.vFar = s.supplyV - drop;
      s.dropV = Math.max(s.dropV, drop);
      if (s.supplyV < l.needV) s.warnings.push(`${s.source}: ${l.name} needs ${l.needV} V but gets ${s.supplyV} V.`);
      else if (l.vFar < l.needV) s.warnings.push(`${s.source}: ${l.name} needs ${l.needV} V but only ${l.vFar.toFixed(2)} V arrives after ${drop.toFixed(2)} V of cable drop (${ohm.toFixed(2)} ohm loop, assumed).`);
      else if (drop > DROP_WARN_FRACTION * s.supplyV) s.warnings.push(`${s.source}: cable drop to ${l.name} is ${drop.toFixed(2)} V, over ${Math.round(DROP_WARN_FRACTION * 100)} percent of the ${s.supplyV} V supply (${ohm.toFixed(2)} ohm loop, assumed).`);
    }
    s.ok = s.warnings.length === 0;
    out.push(s);
  }
  return out;
}

/** poweringLine(entry) -> "N mA of M mA" (marked assumed when the limit is a default). */
export function poweringLine(e) { return `${e.drawMa} mA of ${e.supplyMa} mA${e.supplyConf === 'U' ? ' (assumed limit)' : ''}`; }
