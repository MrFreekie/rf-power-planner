// Side view: vertical slice through the Tx-Rx line of the active link, true scale.
// Horizontal axis s = metres along the line from Tx (s = 0); vertical = z (up). Viewport world = (s, -z).
// Shows floor, reflectors crossing the slice, direct / floor-bounce rays, and draggable height handles.
import { createViewport } from './viewport.js';
import {
  createCanvasHost, activeLink, findItem, selectableIds, solveCached, fmtLen, fmtDb, statusColor,
  drawGrid, drawScaleBar, haloText, strokeHatchRect, clamp, round2, DEG, readTheme,
} from './util.js';
import { attachInteraction } from './interact.js';
import { tracePaths } from '../model/rf.js';
import { SURFACES } from '../model/library.js';
import * as icons from './icons.js';
import { squelch } from '../squelchTracker.js';
import { gateOf, drawSquelchLed, rxInfo, drawActiveRing, drawOverloadHalo } from './squelchUi.js';
import { rxState } from '../rxTracker.js';
import { getRipples } from './ripples.js';
import { effectiveAntennaB } from '../model/diversity.js';
import { isWalking } from '../walk.js';
import { floorHeightAt, platformBoxes } from '../model/floor.js';
import { registerSnapshot, makeSnapshotCanvas } from './snapshots.js';
import { announce } from './a11y.js';

export function createSideView(canvas, store) {
  const vp = createViewport({ pxPerM: 40, origin: { x: 60, y: 200 } });
  let handles = [], hoverKey = null, userView = false, sig = '', dragCounter = 0, lastDesc = '';
  const rip = getRipples(store);
  const host = createCanvasHost(canvas, draw, (w, h) => { if (!userView) fit(w, h); });
  const detachRip = rip.attach('side', canvas, () => host.invalidate());
  const unregSnap = registerSnapshot('side', (w, h) => {
    const link = activeLink(store.getScene(), store.getSelection());
    if (!link) return null;
    const save = { px: vp.pxPerM, ox: vp.origin.x, oy: vp.origin.y, user: userView, sig, hs: handles };
    layout(w, h, link, niceRange(geom(link).D + 1));
    userView = true; sig = fitSig(link); // keep draw() from refitting to the live canvas size
    const { c, ctx } = makeSnapshotCanvas(w, h);
    const ripOn = rip.settings.on; rip.settings.on = false; // clean sheet: no animated rings in the print
    try { draw(ctx, w, h, readTheme(canvas)); } finally { rip.settings.on = ripOn; vp.pxPerM = save.px; vp.origin.x = save.ox; vp.origin.y = save.oy; userView = save.user; sig = save.sig; handles = save.hs; }
    return c;
  });

  // The slice axis s is the distance from the STATIONARY antenna: the receive antenna for a mic link (the mic walks),
  // the transmit antenna for an IEM link (the bodypack walks). It points from the static antenna toward the walker.
  function geom(link) {
    const iem = link.kind === 'iem';
    const S = iem ? link.tx.pos : link.rx.pos, W = iem ? link.rx.pos : link.tx.pos;
    const dx = W.x - S.x, dy = W.y - S.y, D = Math.hypot(dx, dy);
    const u = D > 1e-6 ? { x: dx / D, y: dy / D } : { x: 0, y: 1 };
    return { u, D, S, iem, sTx: iem ? 0 : D, sRx: iem ? D : 0, sOf: (p) => (p.x - S.x) * u.x + (p.y - S.y) * u.y };
  }
  const NICE_STEPS = [2, 3, 5, 8, 10, 15, 20, 30, 50, 80, 100, 150, 200, 300, 500, 800, 1000, 2000, 5000];
  /** Smallest 1-2-5 style range (metres) that covers v. */
  function niceRange(v) {
    for (const n of NICE_STEPS) if (n >= v) return n;
    return Math.ceil(v / 1000) * 1000;
  }
  let rangeM = 0;
  /** Visible slice length: current distance rounded up to a nice step; while walking it only grows, with some lookahead. */
  function wantRange(link) {
    const { D } = geom(link);
    if (isWalking()) return Math.max(rangeM, niceRange(D * 1.25 + 1));
    return niceRange(D + 1);
  }
  /** Place the viewport: static antenna at a fixed pixel column, scale set by the visible range. */
  function layout(w, h, link, range) {
    const zt = zTop(link);
    const left = w < 520 ? 56 : 70, right = 24;
    const px = Math.min(Math.max((w - left - right) / Math.max(range, 1), 4), 600);
    const pxY = (h - 88) / (zt + 0.9);
    vp.pxPerM = Math.min(px, Math.max(pxY, 4), 600);
    vp.origin.x = left;
    vp.origin.y = h / 2 - ((-zt + 0.9) / 2) * vp.pxPerM;
  }
  const flAt = (pos) => floorHeightAt(store.getScene(), pos.x, pos.y);
  const zTop = (link) => Math.max(3.2, Math.ceil(Math.max(link.tx.pos.z + flAt(link.tx.pos), link.rx.pos.z + flAt(link.rx.pos)) + 0.3)) + 0.3;

  function fit(w = host.width, h = host.height) {
    const link = activeLink(store.getScene(), store.getSelection());
    if (!link) return;
    rangeM = wantRange(link);
    layout(w, h, link, rangeM);
    sig = fitSig(link);
    userView = false;
    host.invalidate();
  }
  const fitSig = (link) => `${link.id}|${wantRange(link)}|${zTop(link)}`;

  function draw(ctx, w, h, th) {
    const scene = store.getScene(), sel = store.getSelection(), link = activeLink(scene, sel);
    handles = [];
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    if (!link) { haloText(ctx, th, 'No link in scene', w / 2, h / 2, { align: 'center', color: th.inkSoft }); return; }
    if (!userView && fitSig(link) !== sig) fit();

    const { u, D, sOf, S, sTx, sRx, iem } = geom(link), res = solveCached(scene, link);
    drawGrid(ctx, vp, w, h, th, { yLabel: (v) => -v, xName: iem ? 'distance from transmit antenna (m)' : 'distance from receive antenna (m)', yName: 'z (m)' });

    // floor
    const fy = vp.worldToScreen(0, 0).y;
    ctx.fillStyle = th.paper2; ctx.fillRect(0, fy, w, h - fy);
    strokeHatchRect(ctx, 0, fy, w, Math.max(0, h - fy), th.hatch, 9);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke();
    const fname = SURFACES?.[scene.environment.floor]?.name || scene.environment.floor;
    if (w >= 520) haloText(ctx, th, `FLOOR (${fname})`, w - 8, Math.min(h - 8, fy + 16), { align: 'right', color: th.inkSoft });

    // deck and platforms as raised blocks where the slice crosses them
    for (const bx of platformBoxes(scene)) {
      let t0 = -Infinity, t1 = Infinity, ok = true;
      for (const [o, d, lo, hi] of [[S.x, u.x, bx.x0, bx.x1], [S.y, u.y, bx.y0, bx.y1]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ok = false; continue; }
        const a = (lo - o) / d, b = (hi - o) / d;
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
      }
      if (!ok || !(t1 > t0)) continue;
      const a = vp.worldToScreen(t0, -bx.zTop), b = vp.worldToScreen(t1, 0);
      ctx.fillStyle = th.paper2; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      strokeHatchRect(ctx, a.x, a.y, b.x - a.x, b.y - a.y, th.hatch, 7);
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y); ctx.stroke(); // the local floor (top surface)
      const pl = bx.kind === 'deck' ? 'stage deck' : ((scene.platforms || []).find((q) => q.id === bx.id) || {}).name || 'platform';
      if (b.x - a.x > 50) haloText(ctx, th, `${pl} ${fmtLen(bx.zTop, scene.units)}`, (a.x + b.x) / 2, a.y + 14, { align: 'center', px: 11, color: th.inkSoft });
    }

    // ripples (wavefronts) under the walls, rays and icons
    rip.drawSide(ctx, th, vp, scene, link, { u, D, sTx, sRx }, w, h);

    // reflectors crossing the slice
    for (const r of scene.reflectors || []) {
      const e = { x: r.p2.x - r.p1.x, y: r.p2.y - r.p1.y }, wv = { x: r.p1.x - S.x, y: r.p1.y - S.y };
      const den = u.x * e.y - u.y * e.x;
      if (Math.abs(den) < 1e-9) continue;
      const s = (wv.x * e.y - wv.y * e.x) / den, q = (wv.x * u.y - wv.y * u.x) / den;
      if (q < 0 || q > 1) continue;
      const a = vp.worldToScreen(s, -(r.zMin ?? 0)), b = vp.worldToScreen(s, -(r.zMax ?? 3));
      const selected = sel === r.id;
      ctx.fillStyle = th.paper2; ctx.fillRect(a.x - 4, b.y, 8, a.y - b.y);
      strokeHatchRect(ctx, a.x - 4, b.y, 8, a.y - b.y, th.inkSoft, 4);
      ctx.strokeStyle = th.ink; ctx.lineWidth = selected ? 2.5 : 1.4; ctx.strokeRect(a.x - 4, b.y, 8, a.y - b.y);
      haloText(ctx, th, `${r.name} @ s=${s.toFixed(1)} m`, a.x - 8, b.y + 14, { align: 'right', color: th.inkSoft });
      handles.push({ kind: 'refBar', itemId: r.id, sx: a.x, sy: (a.y + b.y) / 2, r: 10, bar: [b.y, a.y] });
    }

    // rays
    let paths = res?.paths;
    if (!paths) { try { paths = tracePaths(scene, link); } catch { paths = []; } }
    const col = statusColor(th, res?.status);
    const muted = gateOf(link.id) && !gateOf(link.id).open;
    const proj = (p) => vp.worldToScreen(sOf(p), -p.z);
    const order = { 'floor-wall': 0, wall: 1, floor: 2, direct: 3 };
    for (const p of [...paths].sort((a, b) => order[a.kind] - order[b.kind])) {
      ctx.save();
      ctx.lineWidth = p.kind === 'direct' ? 2.4 : 1.4;
      ctx.strokeStyle = p.kind === 'direct' ? col : th.ink;
      ctx.setLineDash(p.kind === 'direct' ? (muted ? [8, 6] : []) : p.kind === 'floor' ? [7, 4] : [2, 4]);
      ctx.globalAlpha = p.kind === 'direct' || p.kind === 'floor' ? 1 : 0.5;
      ctx.beginPath(); p.points.forEach((q, i) => { const s = proj(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke();
      ctx.restore();
      const mid = proj(midPoint(p.points));
      const rel = p.relDb;
      if (p.kind === 'direct') haloText(ctx, th, `direct ${fmtLen(p.lengthM, scene.units)}`, mid.x, mid.y - 8, { align: 'center', weight: '600' });
      else if (p.kind === 'floor') {
        const bounce = p.points.find((q, i) => i > 0 && i < p.points.length - 1) || midPoint(p.points);
        const bs = proj(bounce);
        ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(bs.x, bs.y, 3, 0, Math.PI * 2); ctx.fill();
        const run = Math.hypot(bounce.x - link.tx.pos.x, bounce.y - link.tx.pos.y), graze = Math.atan2(link.tx.pos.z, Math.max(run, 1e-6)) / DEG;
        haloText(ctx, th, `floor${rel != null ? ' ' + fmtDb(rel) : ''}  ∠${graze.toFixed(0)}°`, bs.x, bs.y + 18, { align: 'center', color: th.inkSoft });
      }
    }

    // antenna B (diversity): ray and icon
    const inf = rxInfo(link);
    if (inf.B) {
      const bAbs = { ...inf.B.pos, z: inf.B.pos.z + flAt(inf.B.pos) }, tAbs = { ...link.tx.pos, z: link.tx.pos.z + flAt(link.tx.pos) };
      const bp = proj(bAbs), tp = proj(tAbs);
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = inf.active === 'B' ? 2.4 : 1; ctx.globalAlpha = inf.active === 'B' ? 1 : 0.4;
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(bp.x, bp.y); ctx.stroke(); ctx.restore();
      {
        const eff = effectiveAntennaB(link), o = eff.orientation;
        const dS = Math.cos(o.el * DEG) * (Math.sin(o.az * DEG) * u.x + Math.cos(o.az * DEG) * u.y), dZ = Math.sin(o.el * DEG);
        icons.drawAntenna(ctx, vp, sOf(inf.B.pos), -bAbs.z, { view: 'side', ink: th.ink, fill: th.paper, type: eff.type, angleDeg: Math.atan2(dS, dZ) / DEG });
      }
      haloText(ctx, th, 'B', bp.x + 10, bp.y - 8, { px: 12, weight: '600' });
      if (inf.active === 'B') drawActiveRing(ctx, th, bp.x, bp.y, 12);
    }
    {
      const rp = vp.worldToScreen(sRx, -(link.rx.pos.z + flAt(link.rx.pos)));
      drawOverloadHalo(ctx, th, rp.x, rp.y, inf.overload, 22);
      if (inf.B) { haloText(ctx, th, 'A', rp.x - 10, rp.y - 8, { align: 'right', px: 12, weight: '600' }); if (inf.active === 'A') drawActiveRing(ctx, th, rp.x, rp.y, 12); }
    }

    // ends
    for (const role of ['tx', 'rx']) drawEnd(ctx, th, link, role, role === 'tx' ? sTx : sRx, u, sel, w, sTx > sRx);

    drawScaleBar(ctx, vp, h, th);
    const brg = ((Math.atan2(iem ? u.x : -u.x, iem ? u.y : -u.y) / DEG) + 360) % 360;
    if (w >= 520) haloText(ctx, th, `${link.name}: Tx → Rx bearing ${brg.toFixed(0)}°, horizontal ${fmtLen(D, scene.units)}`, w - 8, h - 10, { align: 'right', color: th.inkSoft });

    const desc = `Side view of ${link.name}. Tx height ${link.tx.pos.z.toFixed(2)} m, Rx height ${link.rx.pos.z.toFixed(2)} m, horizontal distance ${D.toFixed(2)} m. Up and down arrow keys change the height of the selected end, Alt plus up or down tilts its antenna.`;
    if (desc !== lastDesc) { lastDesc = desc; canvas.setAttribute('aria-description', desc); canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-roledescription', 'interactive side diagram'); }
  }

  function midPoint(pts) {
    // point halfway along the polyline's length
    let tot = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); seg.push(l); tot += l; }
    let t = tot / 2;
    for (let i = 0; i < seg.length; i++) {
      if (t <= seg[i] || i === seg.length - 1) {
        const f = seg[i] ? t / seg[i] : 0, a = pts[i], b = pts[i + 1];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      }
      t -= seg[i];
    }
    return pts[0];
  }

  function drawEnd(ctx, th, link, role, s, u, sel, w, txOnRight = false) {
    const leftEnd = (role === 'tx') !== txOnRight; // the end at the left margin keeps its dimension line on the outside
    const e = link[role], z = e.pos.z, fl = flAt(e.pos), p = vp.worldToScreen(s, -(z + fl)), selected = sel === e.id;
    const hasPerson = (role === 'tx') === (link.kind !== 'iem');
    const ink = th.ink, fill = th.paper;
    const az = e.antenna.orientation?.az ?? 0, el = e.antenna.orientation?.el ?? 0;
    const dirS = Math.cos(el * DEG) * (Math.sin(az * DEG) * u.x + Math.cos(az * DEG) * u.y), dirZ = Math.sin(el * DEG);
    const angle = Math.atan2(dirS, dirZ) / DEG;
    if (hasPerson) {
      icons.drawPerson(ctx, vp, s, -fl, { view: 'side', ink, fill });
      if (link.kind === 'mic') icons.drawMic(ctx, vp, s, -(z + fl), { view: 'side', ink, fill });
      else icons.drawBodypack(ctx, vp, s, -(z + fl), { view: 'side', ink, fill });
    } else {
      icons.drawStand(ctx, vp, s, -fl, { view: 'side', ink, fill, heightM: z });
      icons.drawAntenna(ctx, vp, s, -(z + fl), { view: 'side', ink, fill, type: e.antenna.type, angleDeg: angle });
    }
    // height dimension line beside the item
    const dx = p.x + (leftEnd ? -26 : 26), f0 = vp.worldToScreen(s, -fl).y;
    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx, f0); ctx.lineTo(dx, p.y); ctx.moveTo(dx - 4, f0); ctx.lineTo(dx + 4, f0); ctx.moveTo(dx - 4, p.y); ctx.lineTo(dx + 4, p.y); ctx.stroke();
    haloText(ctx, th, `${z.toFixed(2)} m${fl > 0 ? ` above floor (+${fl.toFixed(2)})` : ''}`, dx + (leftEnd ? -4 : 4), (f0 + p.y) / 2 + 4, { align: leftEnd ? 'right' : 'left', weight: selected ? '600' : '' });
    if (w >= 520 || selected) haloText(ctx, th, e.name, p.x, p.y - Math.max(18, 0.4 * vp.pxPerM), { align: 'center', color: selected ? th.ink : th.inkSoft, weight: selected ? '600' : '' });
    if (role === 'rx') drawSquelchLed(ctx, th, p.x + 16, p.y - 14, gateOf(link.id), { label: w >= 520 || selected });
    // height handle
    const hot = hoverKey === role + ':' + e.id;
    ctx.fillStyle = selected || hot ? th.ink : th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (selected) { ctx.save(); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    handles.push({ kind: role, itemId: e.id, linkId: link.id, sx: p.x, sy: p.y, r: 16, wx: s, wy: -(z + fl), fl });
  }

  // ---- interaction -----------------------------------------------------------------------
  function hitTest(sx, sy, isTouch) {
    const k = isTouch ? 1.7 : 1; let best = null, bd = Infinity;
    for (const hd of handles) {
      const d = hd.bar ? (Math.abs(sx - hd.sx) <= 8 * k && sy >= hd.bar[0] && sy <= hd.bar[1] ? 12 : Infinity) : Math.hypot(sx - hd.sx, sy - hd.sy);
      if (d <= (hd.bar ? 12 : hd.r) * k && d < bd) { best = hd; bd = d; }
    }
    return best;
  }
  function dragMove(hd, ptr, target, state) {
    if (hd.kind !== 'tx' && hd.kind !== 'rx') return;
    const z = round2(clamp(-target.y - (hd.fl || 0), 0, 5));
    store.update((s) => { const l = s.links.find((q) => q.id === hd.linkId); if (l) l[hd.kind].pos.z = z; }, { coalesce: state.key });
  }
  function nudge(dx, dy, big) {
    const id = store.getSelection(), f = findItem(store.getScene(), id);
    if (!f) { cycle(1); return; }
    if ((f.type !== 'tx' && f.type !== 'rx') || !dy) return;
    store.update((s) => { const g = findItem(s, id); g.item.pos.z = round2(clamp(g.item.pos.z - dy * (big ? 0.5 : 0.05), 0, 5)); }, { coalesce: `side-nudge-${id}` });
    const g = findItem(store.getScene(), id);
    announce(`${g.item.name} height ${g.item.pos.z.toFixed(2)} m`, { key: 'move', delay: 350 });
  }
  function rotate(dAz, dEl, big) {
    const id = store.getSelection(), f = findItem(store.getScene(), id);
    if (!f) { cycle(1); return; }
    if ((f.type !== 'tx' && f.type !== 'rx') || !dEl) return;
    const d = -dEl; // arrow up = tilt up
    store.update((sc) => { const g = findItem(sc, id); if (g) { const o = g.item.antenna.orientation || (g.item.antenna.orientation = { az: 0, el: 0 }); o.el = Math.round(clamp((o.el || 0) + d * (big ? 15 : 5), -90, 90)); } }, { coalesce: `side-rot-${id}` });
    const g = findItem(store.getScene(), id);
    announce(`${g.item.name} elevation ${g.item.antenna.orientation.el} degrees`, { key: 'rot', delay: 350 });
  }
  function cycle(dir) {
    const ids = selectableIds(store.getScene()); if (!ids.length) return;
    store.select(ids[(ids.indexOf(store.getSelection()) + dir + ids.length) % ids.length]);
  }

  const detach = attachInteraction(canvas, vp, {
    hitTest, dragStart: () => ({ key: `side-drag-${++dragCounter}` }), dragMove,
    select: (id) => store.select(id),
    hover: (hd) => { hoverKey = hd ? hd.kind + ':' + hd.itemId : null; host.invalidate(); },
    onView: () => { userView = true; host.invalidate(); },
    fit, nudge, rotate, cycle, escape: () => store.select(null),
  });
  const unsubSq = squelch.subscribe(() => host.invalidate());
  const unsubRx = rxState.subscribe(() => host.invalidate());
  const unsub = store.subscribe(() => host.invalidate());
  return { viewport: vp, fit, invalidate: host.invalidate, destroy() { unregSnap(); detachRip(); detach(); unsub?.(); unsubSq?.(); unsubRx?.(); host.destroy(); } };
}
