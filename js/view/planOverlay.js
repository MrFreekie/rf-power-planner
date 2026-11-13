// Plan-view overlays for multi-antenna zones: coverage heat map (offscreen, re-blitted), zone polygons,
// branch antenna icons with cable tags, legend and label collision avoidance.
import { haloText, setFont } from './util.js';
import { classify, parseColor, covView } from './coverageUi.js';
import { chainLossDb } from '../model/rf.js';
import * as icons from './icons.js';
import { couplingLossDb } from '../model/imd.js';
import { COMBINER_PRESETS } from '../model/imd-params.js';

const TINTS = [[74, 120, 181], [201, 120, 40], [120, 90, 170], [40, 150, 150]]; // dominant-antenna palette (optional view)
const ALPHA = 105;

/** Heat map for one grid: paints into a reusable ImageData (one pixel per cell) and blits it scaled. */
export function createHeatmap() {
  let off = null, octx = null, img = null, data = null;
  let lastGrid = null, lastKey = '';
  return function drawHeat(ctx, vp, grid, th, { thresholdDbm, marginDb, tint }) {
    if (!grid || !grid.levelDbm) return;
    const { nx, ny } = grid;
    const key = `${grid.cursor}|${thresholdDbm}|${marginDb}|${tint}|${th.pass}|${th.marginal}|${th.fail}|${th.ink}`;
    if (!off || off.width !== nx || off.height !== ny) {
      off = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(nx, ny) : Object.assign(document.createElement('canvas'), { width: nx, height: ny });
      octx = off.getContext('2d');
      img = octx.createImageData(nx, ny);
      data = img.data;
      lastKey = '';
    }
    if (grid !== lastGrid || key !== lastKey) {
      lastGrid = grid; lastKey = key;
      const green = parseColor(th.pass, [46, 139, 87]), amber = parseColor(th.marginal, [217, 154, 0]), red = parseColor(th.fail, [192, 57, 43]), ink = parseColor(th.ink, [29, 39, 51]);
      const lv = grid.levelDbm, dom = grid.dominantBranch;
      const isDead = (k) => Number.isFinite(lv[k]) && lv[k] < thresholdDbm;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i, o = k * 4;
          const cls = classify(lv[k], thresholdDbm, marginDb);
          let c = null, a = ALPHA;
          if (cls === 'none') { data[o + 3] = 0; continue; }
          if (cls === 'dead') {
            // outline the edge of dead regions
            const edge = (i > 0 && !isDead(k - 1)) || (i < nx - 1 && !isDead(k + 1)) || (j > 0 && !isDead(k - nx)) || (j < ny - 1 && !isDead(k + nx));
            if (edge) { c = ink; a = 190; } else { c = red; }
          } else if (tint) c = TINTS[(dom[k] || 0) % TINTS.length];
          else c = cls === 'good' ? green : amber;
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = a;
        }
      }
      octx.putImageData(img, 0, 0);
    }
    const a = vp.worldToScreen(grid.x0, grid.y0), b = vp.worldToScreen(grid.x0 + nx * grid.cellM, grid.y0 + ny * grid.cellM);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  };
}

/** Legend and progress for the heat map, bottom-right above the axes legend. */
export function drawHeatLegend(ctx, th, w, h, cov, tint) {
  const items = tint ? [['dominant antenna 1', TINTS[0]], ['2', TINTS[1]], ['3', TINTS[2]], ['below squelch', parseColor(th.fail)]]
    : [['good (above threshold + margin)', parseColor(th.pass)], ['near threshold', parseColor(th.marginal)], ['dead (below squelch)', parseColor(th.fail)]];
  const small = w < 520;
  const x = 10, y0 = h - (small ? 150 : 140) - items.length * 0;
  ctx.save();
  setFont(ctx, th, 11);
  const rowH = 15;
  const bw = Math.max(...items.map(([t]) => ctx.measureText(small ? t.split(' ')[0] : t).width)) + 26;
  const top = y0 - items.length * rowH - 4;
  ctx.fillStyle = th.paper; ctx.globalAlpha = 0.85; ctx.fillRect(x - 4, top, bw + 4, items.length * rowH + (cov && cov.computing ? 18 : 6)); ctx.globalAlpha = 1;
  items.forEach(([t, c], i) => {
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.globalAlpha = 0.7; ctx.fillRect(x, top + 3 + i * rowH, 14, 11); ctx.globalAlpha = 1;
    ctx.strokeStyle = th.ink; ctx.lineWidth = 0.8; ctx.strokeRect(x + 0.5, top + 3.5 + i * rowH, 13, 10);
    ctx.fillStyle = th.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(small ? t.split(' ')[0] : t, x + 20, top + 12 + i * rowH);
  });
  if (cov && cov.computing) {
    ctx.fillStyle = th.inkSoft; ctx.fillText(`computing ${Math.round((cov.progress || 0) * 100)}%`, x, top + 12 + items.length * rowH + 2);
  }
  ctx.restore();
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

/** Zone polygons with a pass/fail chip and draggable vertex handles. */
export function drawZones(ctx, th, vp, scene, cov, sel, handles) {
  for (const z of scene.zones || []) {
    if (!z.polygon || z.polygon.length < 3) continue;
    const res = cov && cov.zones ? cov.zones.find((q) => q.zoneId === z.id) : null;
    const st = res && res.stats;
    const selected = sel === z.id;
    const pts = z.polygon.map((p) => vp.worldToScreen(p));
    ctx.save();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    if (st) { ctx.fillStyle = st.pass ? th.pass : th.fail; ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.setLineDash([7, 4]); ctx.strokeStyle = th.ink; ctx.lineWidth = selected ? 2.6 : 1.5; ctx.stroke();
    ctx.restore();
    const c = vp.worldToScreen(centroid(z.polygon));
    const label = st ? `${z.name}: ${st.pass ? 'PASS' : 'FAIL'} ${Math.round(st.passFraction * 100)}%` : z.name;
    haloText(ctx, th, label, c.x, c.y + 4, { align: 'center', px: 12, weight: '600', color: st ? (st.pass ? th.pass : th.fail) : th.ink });
    if (st && Number.isFinite(st.minDbm) && st.worstPoint && !st.pass) {
      const wp = vp.worldToScreen(st.worstPoint);
      ctx.strokeStyle = th.fail; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(wp.x - 5, wp.y - 5); ctx.lineTo(wp.x + 5, wp.y + 5); ctx.moveTo(wp.x + 5, wp.y - 5); ctx.lineTo(wp.x - 5, wp.y + 5); ctx.stroke();
    }
    z.polygon.forEach((p, i) => {
      const s = pts[i];
      ctx.fillStyle = selected ? th.ink : th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4;
      ctx.fillRect(s.x - 4, s.y - 4, 8, 8); ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
      handles.push({ kind: 'zoneP', itemId: z.id, zoneId: z.id, index: i, sx: s.x, sy: s.y, r: 12, pri: 1, wx: p.x, wy: p.y });
    });
  }
}

/** Extra branch antennas (1..N) with the cable-run tag and loss. Branch 0 is the normal Tx icon. */
export function drawBranches(ctx, th, vp, link, handles, tag = true) {
  const br = link.branches;
  if (!Array.isArray(br) || br.length < 2) return;
  const p0 = vp.worldToScreen(br[0].pos);
  br.forEach((b, i) => {
    const p = vp.worldToScreen(b.pos);
    if (i > 0) {
      ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.restore();
      const az = b.antenna?.orientation?.az ?? 0;
      icons.drawStand(ctx, vp, b.pos.x, b.pos.y, { view: 'plan', ink: th.ink, fill: th.paper });
      icons.drawAntenna(ctx, vp, b.pos.x, b.pos.y, { view: 'plan', ink: th.ink, fill: th.paper, type: b.antenna?.type, angleDeg: 180 - az });
      handles.push({ kind: 'branch', itemId: b.id, linkId: link.id, branchId: b.id, index: i, sx: p.x, sy: p.y, r: 15, wx: b.pos.x, wy: b.pos.y });
    }
    let loss = NaN;
    try { loss = chainLossDb(b.chain || [], link.freqMHz); } catch { /* unknown cable */ }
    ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(p.x - 13, p.y - 13, 8, 0, Math.PI * 2); ctx.fill();
    haloText(ctx, th, String(i + 1), p.x - 13, p.y - 9, { align: 'center', px: 11, weight: '700', color: th.paper });
    if (tag && Number.isFinite(loss)) haloText(ctx, th, `${loss < 0 ? '+' : '−'}${Math.abs(loss).toFixed(1)} dB`, p.x + 14, p.y - 12, { px: 11, color: th.inkSoft });
  });
}

/** Intermod demo overlay: transmitters as mic icons, receive antenna, coupling lines between close pairs, combiner box. */
export function drawImd(ctx, th, vp, scene, sel, handles, placer, w) {
  const m = scene.imd;
  if (!m || !m.enabled || !Array.isArray(m.transmitters)) return;
  const txs = m.transmitters;
  // coupling lines between close pairs
  for (let i = 0; i < txs.length; i++) {
    for (let j = i + 1; j < txs.length; j++) {
      const a = txs[i], b = txs[j];
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      if (d > 4) continue;
      const loss = couplingLossDb(a, b, (a.freqMHz + b.freqMHz) / 2);
      const pa = vp.worldToScreen(a.pos), pb = vp.worldToScreen(b.pos);
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.restore();
      const txt = `${loss.toFixed(0)} dB`;
      setFont(ctx, th, 11, '600');
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      haloText(ctx, th, txt, mx, placer.place(ctx.measureText(txt).width, mx, my - 4), { align: 'center', px: 11, weight: '600' });
    }
  }
  // receive antenna
  const r = m.rxAntennaPos;
  let rp = null;
  if (r) {
    rp = vp.worldToScreen(r);
    icons.drawStand(ctx, vp, r.x, r.y, { view: 'plan', ink: th.ink, fill: th.paper });
    icons.drawAntenna(ctx, vp, r.x, r.y, { view: 'plan', ink: th.ink, fill: th.paper, type: (m.rxAntenna && m.rxAntenna.type) || 'paddle', angleDeg: 180 });
    setFont(ctx, th, 11, '600');
    haloText(ctx, th, 'Rx antenna', rp.x, placer.place(ctx.measureText('Rx antenna').width, rp.x, rp.y + 26), { align: 'center', px: 11, weight: '600' });
  }
  // transmitters
  for (const t of txs) {
    const p = vp.worldToScreen(t.pos);
    icons.drawMic(ctx, vp, t.pos.x, t.pos.y, { view: 'plan', ink: th.ink, fill: th.paper, angleDeg: 180 });
    if (sel === t.id) { ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    const label = vp.pxPerM < 30 ? t.freqMHz.toFixed(1) : `${t.name} ${t.freqMHz.toFixed(1)}`; // short labels when zoomed out
    setFont(ctx, th, 11, '600');
    const ly = placer.place(ctx.measureText(label).width, p.x, p.y - 14);
    haloText(ctx, th, label, p.x, ly, { align: 'center', px: 11, weight: sel === t.id ? '700' : '600' });
    handles.push({ kind: 'imdTx', itemId: t.id, sx: p.x, sy: p.y, r: 15, pri: 1, wx: t.pos.x, wy: t.pos.y });
  }
  // combiner box with isolation
  const c = m.combiner || {};
  if (rp && c.type && c.type !== 'none') {
    const id = c.type === 'hybrid' ? 'passive-hybrid' : c.type === 'isolated' ? 'isolated-cavity' : c.type;
    const base = COMBINER_PRESETS[id] || {};
    const iso = Number.isFinite(c.isolationDb) ? c.isolationDb : base.isolationDb;
    const loss = Number.isFinite(c.lossDb) ? c.lossDb : base.insertionLossDb;
    const bw = 124, bh = 34;
    const bx = Math.min(Math.max(rp.x - bw - 20, 4), Math.max(4, w - bw - 4)), by = rp.y + 34;
    ctx.save(); ctx.fillStyle = th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.6;
    ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.beginPath(); ctx.moveTo(bx + bw, by + bh / 2); ctx.lineTo(rp.x, rp.y + 8); ctx.stroke(); ctx.restore();
    haloText(ctx, th, `Combiner (${c.type})`, bx + 5, by + 14, { px: 11, weight: '600' });
    haloText(ctx, th, `isolation ${Number.isFinite(iso) ? iso : '-'} dB, loss ${Number.isFinite(loss) ? loss : '-'} dB`, bx + 5, by + 28, { px: 10, color: th.inkSoft });
  }
}

/** Label collision avoidance: reserve rectangles, then find a free vertical offset for a new label. */
export function createLabelPlacer() {
  const rects = [];
  const hit = (r) => rects.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  return {
    reset() { rects.length = 0; },
    reserve(r) { rects.push(r); },
    /** Return a y (baseline) near `y` that does not overlap reserved rects; reserves it. Text is centred on x. */
    place(width, x, y, h = 15) {
      const offsets = [0, -16, 16, -32, 32, -48, 48];
      for (const o of offsets) {
        const r = { x: x - width / 2 - 2, y: y + o - h + 3, w: width + 4, h };
        if (!hit(r)) { rects.push(r); return y + o; }
      }
      return y;
    },
  };
}

export { covView };
