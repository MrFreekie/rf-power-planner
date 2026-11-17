// Powering budget: for each DC source on a link's coax (a receiver's antenna bias output, a bias tee, an active splitter output)
// the current drawn by the powered gear on its antenna side, against what the source can supply. Pure, no DOM.
// Chain order is antenna -> receiver. A DC block (dcMode 'block') cuts the line into segments; a load is fed by the nearest
// supplier on its receiver side in the same segment, or by the receiver bias output in the last segment. No cable DC
// resistance data exists in the library, so there is no voltage-drop term: only supply voltage against need voltage.
// Confidence: 'S' the figure is set on the item/receiver, 'U' the default below is assumed.

export const DEFAULT_RX_BIAS_MA = 100; // assumed receiver antenna-bias limit when antennaBiasMa is not set
export const DEFAULT_ITEM_SUPPLY_MA = 350; // assumed bias tee / active splitter output when dcSupplyMa is not set

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
      s.loads.push({ name: nameOf(x.it, x.i), needV: x.it.dcNeedV, needMa: need });
      s.drawMa += need;
    });
  });
  const out = [];
  for (const s of sources.values()) {
    const tag = s.supplyConf === 'U' ? ' (assumed limit)' : '';
    if (s.drawMa > s.supplyMa) s.warnings.push(`${s.source}: ${s.drawMa} mA drawn but only ${s.supplyMa} mA available${tag}.`);
    for (const l of s.loads) if (s.supplyV < l.needV) s.warnings.push(`${s.source}: ${l.name} needs ${l.needV} V but gets ${s.supplyV} V.`);
    s.ok = s.warnings.length === 0;
    out.push(s);
  }
  return out;
}

/** poweringLine(entry) -> "N mA of M mA" (marked assumed when the limit is a default). */
export function poweringLine(e) { return `${e.drawMa} mA of ${e.supplyMa} mA${e.supplyConf === 'U' ? ' (assumed limit)' : ''}`; }
