// Plan view: top-down, true scale. x right, y down on screen (y = toward the audience).
// Draws metre grid, stage (hatched floor), reflectors, links (coloured by status), antenna pattern
// lobes, icons at real size, and scale bar. Drag Tx / Rx / reflector ends / reflector body / lobe tip.
import { createViewport } from './viewport.js';
import {
  createCanvasHost, activeLink, findItem, selectableIds, solveCached, fmtLen, fmtDb, fmtDbm, statusColor,
  drawGrid, drawScaleBar, haloText, setFont, readTheme, inkAlpha, strokeHatchRect, clamp, round2, DEG,
} from './util.js';
import { attachInteraction } from './interact.js';
import { antennaGainDb, wallTransmissionInfo } from '../model/rf.js';
import * as icons from './icons.js';
import { squelch } from '../squelchTracker.js';
import { gateOf, drawSquelchLed, rxInfo, drawActiveRing, drawOverloadHalo } from './squelchUi.js';
import { rxState } from '../rxTracker.js';
import { coverage } from '../coverageTracker.js';
import { createHeatmap, drawHeatLegend, drawZones, drawBranches, drawImd, drawRxCableTags, drawPlatforms, drawElevationLegend, createLabelPlacer } from './planOverlay.js';
import { covView, subscribeCovView } from './coverageUi.js';
import { imd } from '../imdTracker.js';
import { getRipples } from './ripples.js';
import { registerSnapshot, makeSnapshotCanvas } from './snapshots.js';
import { updatePlatform, movePoint, moveBranch, moveImdTransmitter, setAntennaBOrientation } from '../actions.js';
import { effectiveAntennaB } from '../model/diversity.js';
import { initA11y, announce } from './a11y.js';
import { resizeFromCorner, rotationFromPointer } from './platformGeom.js';
import { dispX, dispY, describePos } from '../ui/coords.js';
import { drawVenue } from './venueDraw.js';
import { planExtent, farBounds } from './planExtent.js';

const LOBE_STEP = 6; // degrees

export function createPlanView(canvas, store) {
  const vp = createViewport({ pxPerM: 40, origin: { x: 40, y: 40 } });
  let handles = [];
  let hoverKey = null;
  let userView = false;
  let dragCounter = 0;
  const heatCoarse = createHeatmap(), heatFine = createHeatmap();
  const placer = createLabelPlacer();
  let lastDesc = '';

  let shiftDown = false;
  const onKey = (e) => { shiftDown = e.shiftKey; };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
  initA11y(store);
  const rip = getRipples(store);
  const host = createCanvasHost(canvas, draw, (w, h) => { if (!userView) fit(w, h); });
  const detachRip = rip.attach('plan', canvas, () => host.invalidate());
  // report snapshot: fit the stage into w x h and draw synchronously, without touching the live view
  const unregSnap = registerSnapshot('plan', (w, h) => {
    const save = { px: vp.pxPerM, ox: vp.origin.x, oy: vp.origin.y, user: userView, hs: handles };
    const ex = planExtent(store.getScene());
    vp.fitRect(ex.x0, ex.y0, ex.x1, ex.y1, w, h, 6);
    const { c, ctx } = makeSnapshotCanvas(w, h);
    const ripOn = rip.settings.on; rip.settings.on = false; // clean sheet: no animated rings in the print
    isSnap = true;
    try { draw(ctx, w, h, readTheme(canvas)); } finally { isSnap = false; rip.settings.on = ripOn; vp.pxPerM = save.px; vp.origin.x = save.ox; vp.origin.y = save.oy; userView = save.user; handles = save.hs; }
    return c;
  });

  function fit(w = host.width, h = host.height) {
    const ex = planExtent(store.getScene());
    vp.fitRect(ex.x0, ex.y0, ex.x1, ex.y1, w, h, 6);
    userView = false;
    host.invalidate();
  }

  // ---- drawing ---------------------------------------------------------------------------
  function lobePoints(ant, origin, R) {
    let gmax = -Infinity; const g = [];
    for (let a = 0; a < 360; a += LOBE_STEP) {
      let v = 0;
      try { v = antennaGainDb(ant, { az: a, el: 0 }); } catch { v = 0; }
      g.push(v); if (v > gmax) gmax = v;
    }
    return g.map((v, i) => {
      const r = R * Math.max(0.04, Math.pow(10, (v - gmax) / 20)), a = i * LOBE_STEP * DEG;
      return { x: origin.x + Math.sin(a) * r, y: origin.y + Math.cos(a) * r };
    });
  }

  let isSnap = false;
  function draw(ctx, w, h, th) {
    const scene = store.getScene(), sel = store.getSelection();
    const st = scene.stage, link0 = activeLink(scene, sel);
    handles = [];
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, w, h);
    // stage coordinates: x = 0 on the centre line, y = 0 on the front (audience-side) edge, y up the screen
    drawGrid(ctx, vp, w, h, th, { xName: 'x (m, 0 = centre line)', yName: 'y (m, 0 = front edge)', xOrigin: st.width / 2, yOrigin: st.depth, yFlip: true });

    // stage floor
    const a = vp.worldToScreen(0, 0), b = vp.worldToScreen(st.width, st.depth);
    ctx.fillStyle = th.paper2; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    strokeHatchRect(ctx, a.x, a.y, b.x - a.x, b.y - a.y, th.hatch, 9);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.6; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    haloText(ctx, th, `STAGE ${fmtLen(st.width, scene.units)} × ${fmtLen(st.depth, scene.units)}${st.heightM > 0 ? `, deck ${fmtLen(st.heightM, scene.units)}` : ''}`, (a.x + b.x) / 2, a.y - 7, { align: 'center', color: th.inkSoft });
    haloText(ctx, th, '▼ AUDIENCE (y < 0)', (a.x + b.x) / 2, b.y + 32, { align: 'center', color: th.inkSoft });
    // origin markers: dashed centre line (x = 0) with a CL tag, and the front edge (y = 0) tag
    { const cx = (a.x + b.x) / 2;
      ctx.save(); ctx.setLineDash([8, 4, 2, 4]); ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, a.y - 2); ctx.lineTo(cx, b.y + 7); ctx.stroke(); ctx.restore();
      haloText(ctx, th, 'CL x=0', cx, b.y + 19, { align: 'center', color: th.ink, px: 11, weight: '600' });
      if (w >= 420) haloText(ctx, th, 'FRONT EDGE y=0', a.x, b.y + 19, { align: 'left', color: th.ink, px: 11, weight: '600' });
      else haloText(ctx, th, 'y=0', a.x, b.y + 19, { align: 'left', color: th.ink, px: 11, weight: '600' }); }

    // optional venue underlay (SU4SV): grey hairlines under all content; never affects scale or extent
    drawVenue(ctx, th, vp, scene, w, h, { hairline: isSnap ? 1 : undefined });

    // raised platforms above the stage fill, under everything else
    drawPlatforms(ctx, th, vp, scene, sel, handles, scene.units.length);

    // coverage heat map under everything else
    const cov = link0 ? coverage.get(link0.id) : null;
    if (cov && cov.grid && covView.show) {
      const rq = cov.zones && cov.zones[0] && cov.zones[0].requirement;
      const opts = { thresholdDbm: cov.thresholdDbm, marginDb: rq ? rq.appliedMarginDb : 10, tint: covView.tint };
      heatCoarse(ctx, vp, cov.grid, th, opts);
      if (cov.fineGrid) heatFine(ctx, vp, cov.fineGrid, th, opts);
    }

    // ripples (wavefronts) under the walls and icons
    rip.drawPlan(ctx, th, vp, scene, w, h, link0);

    // reserve name labels so link labels can avoid them
    placer.reset();
    setFont(ctx, th, 12);
    for (const link of scene.links) for (const role of ['tx', 'rx']) {
      const e = link[role], p = vp.worldToScreen(e.pos), tw = ctx.measureText(e.name).width;
      placer.reserve({ x: p.x - tw / 2 - 2, y: p.y + Math.max(22, 0.35 * vp.pxPerM + 12) - 12, w: tw + 4, h: 16 });
    }

    // reflectors
    for (const r of scene.reflectors || []) drawReflector(ctx, th, r, sel === r.id);


    // links: lines first, then lobes and icons on top
    for (const link of scene.links) drawLinkLine(ctx, th, scene, link, link === link0, w);
    for (const link of scene.links) drawLinkEnds(ctx, th, scene, link, sel, w);
    for (const link of scene.links) drawAntennaB(ctx, th, link, sel);
    for (const link of scene.links) drawBranches(ctx, th, vp, link, handles);
    for (const link of scene.links) drawRxCableTags(ctx, th, vp, link, placer, scene.units.length, w);
    if (covView.zones) drawZones(ctx, th, vp, scene, cov, sel, handles);
    drawImd(ctx, th, vp, scene, sel, handles, placer, w);
    drawElevationLegend(ctx, th, w, scene, scene.units.length);
    if (cov && cov.grid && covView.show) drawHeatLegend(ctx, th, w, h, cov, covView.tint);

    // legend + scale
    drawScaleBar(ctx, vp, h, th);
    drawAxesLegend(ctx, th, w, h);
    if (cursor && !isSnap) { const wp = vp.screenToWorld(cursor.x, cursor.y); haloText(ctx, th, `cursor  x ${fmtLen(dispX(scene, wp.x), scene.units)}  y ${fmtLen(dispY(scene, wp.y), scene.units)}`, w >= 520 ? w - 8 : w / 2, w >= 520 ? h - 8 : 30, { align: w >= 520 ? 'right' : 'center', color: th.ink, px: 12 }); }

    const rl = link0 ? solveCached(scene, link0) : null, selF = findItem(scene, sel);
    const desc = `Plan view of a ${fmtLen(st.width, scene.units)} by ${fmtLen(st.depth, scene.units)} stage. Coordinates: x is 0 at the centre line and grows to the right, y is 0 at the front edge and grows upstage, so the audience side is negative. The plan has ${scene.links.length} link(s) and ${(scene.reflectors || []).length} reflector(s). ${link0 && rl ? `${link0.name}: ${fmtLen(rl.distanceM, scene.units)}, ${rl.status.toUpperCase()}, margin ${fmtDb(rl.marginDb)}. ` : ''}Selected: ${selF ? `${selF.item.name}${selF.item.pos ? ` at ${describePos(scene, selF.item.pos)}` : ''}` : 'none'}. Arrow keys move the selection, Shift for big steps, Alt+arrows or R rotate an antenna, [ and ] change the selection, plus and minus zoom, 0 fits the stage.`;
    if (desc !== lastDesc) { lastDesc = desc; canvas.setAttribute('aria-description', desc); canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-roledescription', 'interactive plan diagram'); }
  }

  function drawAxesLegend(ctx, th, w, h) {
    const x = w - 60, y = h - 22; // x to the right, y UP the screen (upstage, away from the audience)
    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.moveTo(x, y); ctx.lineTo(x, y - 26); ctx.stroke();
    haloText(ctx, th, 'x', x + 31, y + 4, { color: th.inkSoft, px: 11 });
    haloText(ctx, th, 'y', x - 3, y - 30, { color: th.inkSoft, px: 11, align: 'right' });
  }

  function wallLabel(r) {
    let info = null;
    try { info = wallTransmissionInfo(r, (store.getScene().links[0] && store.getScene().links[0].freqMHz) || 600); } catch { /* unknown material */ }
    if (!info || !Number.isFinite(info.lossDb)) return `${r.name} (${r.material})`;
    const th2 = Number.isFinite(info.thicknessM) ? `${(info.thicknessM * 100).toFixed(0)} cm, ` : '';
    return `${r.name} (${r.material}): ${th2}${info.lossDb.toFixed(1)} dB through`;
  }

  function drawReflector(ctx, th, r, selected) {
    const p1 = vp.worldToScreen(r.p1), p2 = vp.worldToScreen(r.p2);
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    ctx.strokeStyle = th.ink; ctx.lineWidth = 3.5; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 6; t < len; t += 8) { const x = p1.x + (dx * t) / len, y = p1.y + (dy * t) / len; ctx.moveTo(x, y); ctx.lineTo(x + nx * 7 - (dx / len) * 5, y + ny * 7 - (dy / len) * 5); }
    ctx.stroke();
    const wl = wallLabel(r);
    setFont(ctx, th, 12);
    const wx = (p1.x + p2.x) / 2 + nx * -14, wy0 = (p1.y + p2.y) / 2 + ny * -14 + 4;
    haloText(ctx, th, wl, wx, placer.place(ctx.measureText(wl).width, wx, wy0), { align: 'center', color: th.inkSoft });
    for (const [kind, p, wp] of [['refP1', p1, r.p1], ['refP2', p2, r.p2]]) {
      handles.push({ kind, itemId: r.id, sx: p.x, sy: p.y, r: 11, wx: wp.x, wy: wp.y });
      ctx.fillStyle = th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = selected ? 2 : 1.2;
      ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
    }
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const m = vp.screenToWorld(mid.x, mid.y);
    handles.push({ kind: 'refBody', itemId: r.id, seg: [p1, p2], r: 8, wx: m.x, wy: m.y, sx: mid.x, sy: mid.y });
    if (selected) ringAt(ctx, th, mid.x, mid.y, 9);
  }

  function ringAt(ctx, th, x, y, r) {
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  function drawLinkLine(ctx, th, scene, link, isActive, w) {
    const res = solveCached(scene, link);
    const t = vp.worldToScreen(link.tx.pos), r = vp.worldToScreen(link.rx.pos);
    const col = statusColor(th, res?.status);
    if (isActive && res?.paths) { // off-axis bounce paths, ground-truth geometry
      ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1;
      for (const p of res.paths) {
        if (p.kind !== 'wall' && p.kind !== 'floor-wall') continue;
        ctx.beginPath(); p.points.forEach((q, i) => { const s = vp.worldToScreen(q.x, q.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke();
      }
      ctx.restore();
    }
    const muted = gateOf(link.id) && !gateOf(link.id).open;
    const info = rxInfo(link);
    const rayTo = (pt, on) => {
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = on ? (isActive ? 2.4 : 1.6) : 1; ctx.lineCap = 'round'; ctx.globalAlpha = on ? 1 : 0.4;
      if (muted && on) ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(pt.x, pt.y); ctx.stroke(); ctx.restore();
    };
    rayTo(r, !info.B || info.active === 'A');
    if (info.B) rayTo(vp.worldToScreen(info.B.pos), info.active === 'B');
    const d = res?.distanceM ?? Math.hypot(link.tx.pos.x - link.rx.pos.x, link.tx.pos.y - link.rx.pos.y, link.tx.pos.z - link.rx.pos.z);
    let txt = fmtLen(d, scene.units);
    if (isActive && res) txt = `${res.status === 'pass' ? '✓ PASS' : res.status === 'marginal' ? '! MARGINAL' : '✗ FAIL'}  ${txt}`;
    if (isActive && res) txt += w < 520 ? `  ${fmtDb(res.marginDb)}` : `  ·  ${fmtDbm(res.inputPowerDbm ?? res.rxPowerDbm)}  ·  ${fmtDb(res.marginDb)} margin`;
    const mx = (t.x + r.x) / 2, my = (t.y + r.y) / 2;
    setFont(ctx, th, 12, isActive ? '600' : '');
    const ly = placer.place(ctx.measureText(txt).width, mx, my - 8);
    haloText(ctx, th, txt, mx, ly, { align: 'center', color: th.ink, weight: isActive ? '600' : '' });
  }

  function drawAntennaB(ctx, th, link, sel) {
    const inf = rxInfo(link); if (!inf.B) return;
    const p = vp.worldToScreen(inf.B.pos);
    const eff = effectiveAntennaB(link), az = eff.orientation.az;
    const antRef = { type: eff.type, gainDbi: eff.gainDbi, orientation: eff.orientation };
    const selected = sel === link.rx.id;
    // pattern lobe, same style as antenna A
    const R = clamp(0.9 * vp.pxPerM, 26, 80);
    const pts = lobePoints(antRef, p, R);
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
    ctx.fillStyle = inkAlpha(th, 0.07); ctx.fill();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 0.9; ctx.stroke(); ctx.setLineDash([]);
    icons.drawStand(ctx, vp, inf.B.pos.x, inf.B.pos.y, { view: 'plan', ink: th.ink, fill: th.paper });
    icons.drawAntenna(ctx, vp, inf.B.pos.x, inf.B.pos.y, { view: 'plan', ink: th.ink, fill: th.paper, type: eff.type, angleDeg: 180 - az });
    // rotation handle at the lobe tip
    const tip = { x: p.x + Math.sin(az * DEG) * (R + 24), y: p.y + Math.cos(az * DEG) * (R + 24) }; // a little further out than A's handle so they do not overlap
    handles.push({ kind: 'rxBRot', itemId: link.rx.id, linkId: link.id, sx: tip.x, sy: tip.y, r: 10, pri: 1 });
    ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.fillStyle = selected || hoverKey === 'rxBRot:' + link.rx.id ? th.ink : th.paper; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    haloText(ctx, th, 'B', p.x + 12, p.y - 10, { px: 12, weight: '600' });
    if (inf.active === 'B') drawActiveRing(ctx, th, p.x, p.y, 14);
    if (inf.overload !== 'ok' && inf.div && inf.div.bDbm >= inf.div.aDbm) drawOverloadHalo(ctx, th, p.x, p.y, inf.overload, 20);
    handles.push({ kind: 'rxB', itemId: link.rx.id, linkId: link.id, sx: p.x, sy: p.y, r: 14, wx: inf.B.pos.x, wy: inf.B.pos.y });
  }

  function drawLinkEnds(ctx, th, scene, link, sel, w) {
    const personIsTx = link.kind !== 'iem';
    for (const role of ['tx', 'rx']) {
      const e = link[role], p = vp.worldToScreen(e.pos);
      const selected = sel === e.id;
      const hasPerson = (role === 'tx') === personIsTx;
      const ant = e.antenna, az = ant.orientation?.az ?? 0;
      const R = clamp(0.9 * vp.pxPerM, 26, 80);
      // pattern lobe
      const pts = lobePoints(ant, p, R);
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
      ctx.fillStyle = inkAlpha(th, 0.07); ctx.fill();
      ctx.strokeStyle = th.inkSoft; ctx.lineWidth = selected ? 1.4 : 0.9; ctx.stroke();
      // icons
      const ink = th.ink, fill = th.paper;
      if (hasPerson) {
        icons.drawPerson(ctx, vp, e.pos.x, e.pos.y, { view: 'plan', ink, fill });
        if (link.kind === 'mic') icons.drawMic(ctx, vp, e.pos.x, e.pos.y, { view: 'plan', ink, fill, angleDeg: 180 - az });
        else icons.drawBodypack(ctx, vp, e.pos.x, e.pos.y, { view: 'plan', ink, fill });
      } else {
        icons.drawStand(ctx, vp, e.pos.x, e.pos.y, { view: 'plan', ink, fill });
        icons.drawAntenna(ctx, vp, e.pos.x, e.pos.y, { view: 'plan', ink, fill, type: ant.type, angleDeg: 180 - az });
      }
      if (selected) ringAt(ctx, th, p.x, p.y, 17);
      if (w >= 520 || selected) haloText(ctx, th, e.name, p.x, p.y + Math.max(22, 0.35 * vp.pxPerM + 12), { align: 'center', color: selected ? th.ink : th.inkSoft, weight: selected ? '600' : '' });
      if (role === 'rx') {
        const inf = rxInfo(link);
        drawOverloadHalo(ctx, th, p.x, p.y, inf.overload);
        if (inf.B) { haloText(ctx, th, 'A', p.x - 14, p.y - 10, { align: 'right', px: 12, weight: '600' }); if (inf.active === 'A') drawActiveRing(ctx, th, p.x, p.y, 14); }
      }
      if (role === 'rx') drawSquelchLed(ctx, th, p.x + 16, p.y - 16, gateOf(link.id), { label: w >= 520 || selected });
      // handles: body then rotation tip
      handles.push({ kind: role, itemId: e.id, linkId: link.id, sx: p.x, sy: p.y, r: 15, wx: e.pos.x, wy: e.pos.y });
      const tip = { x: p.x + Math.sin(az * DEG) * (R + 9), y: p.y + Math.cos(az * DEG) * (R + 9) };
      handles.push({ kind: role + 'Rot', itemId: e.id, linkId: link.id, sx: tip.x, sy: tip.y, r: 10, pri: 1 });
      ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      ctx.fillStyle = selected || hoverKey === role + 'Rot:' + e.id ? th.ink : th.paper; ctx.strokeStyle = th.ink;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  // ---- interaction -----------------------------------------------------------------------
  function hitTest(sx, sy, isTouch) {
    const k = isTouch ? 1.7 : 1;
    let best = null, bd = Infinity;
    for (const hd of handles) {
      let d;
      if (hd.seg) { // distance to the reflector segment
        const [a, b] = hd.seg, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
        const t = clamp(((sx - a.x) * dx + (sy - a.y) * dy) / l2, 0, 1);
        d = Math.hypot(sx - (a.x + t * dx), sy - (a.y + t * dy)) + 3; // slightly lower priority than point handles
      } else if (hd.poly) { // platform body: inside the (rotated) polygon, lowest priority
        d = inPoly(hd.poly, sx, sy) ? 30 : Infinity;
      } else d = Math.hypot(sx - hd.sx, sy - hd.sy);
      const lim = (hd.poly ? 30 : hd.seg ? 9 : hd.r) * k;
      if (d <= lim && d - (hd.pri ? 4 : 0) < bd) { best = hd; bd = d - (hd.pri ? 4 : 0); }
    }
    return best;
  }

  function inPoly(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  const bounds = (st) => farBounds(st);
  function dragStart(hd, w0) {
    const key = `plan-drag-${++dragCounter}`;
    if (hd.kind === 'platBody' || hd.kind === 'platCorner' || hd.kind === 'platRot') {
      const pl = (store.getScene().platforms || []).find((q) => q.id === hd.itemId);
      return { key, plat: pl && { ...pl }, startPtr: w0 ? { x: w0.x, y: w0.y } : { x: hd.wx, y: hd.wy } };
    }
    const r = (store.getScene().reflectors || []).find((q) => q.id === hd.itemId);
    return { key, p1: r && { ...r.p1 }, p2: r && { ...r.p2 }, startW: { x: hd.wx, y: hd.wy } };
  }
  // while dragging near the canvas edge, zoom out about the centre so items can be placed beyond the current view
  function edgeGrow(ptr) {
    const w = host.width, h = host.height; if (!w || !h) return;
    const s = vp.worldToScreen(ptr.x, ptr.y), m = 28;
    if (s.x < m || s.y < m || s.x > w - m || s.y > h - m) { vp.zoomAt(w / 2, h / 2, 0.97); userView = true; }
  }
  function dragMove(hd, ptr, target, state) { dragMoveInner(hd, ptr, target, state); edgeGrow(ptr); }
  function dragMoveInner(hd, ptr, target, state) {
    if (hd.kind === 'platRot' && state.plat) {
      const deg = rotationFromPointer(state.plat, ptr, shiftDown ? 15 : 1);
      updatePlatform(store, hd.itemId, { rotationDeg: deg }, { coalesce: state.key });
      return;
    }
    if ((hd.kind === 'platBody' || hd.kind === 'platCorner') && state.plat) {
      const snap = (v) => (shiftDown ? round2(v) : Math.round(v * 10) / 10);
      const P0 = state.plat;
      if (hd.kind === 'platBody') {
        updatePlatform(store, hd.itemId, { x: snap(P0.x + ptr.x - state.startPtr.x), y: snap(P0.y + ptr.y - state.startPtr.y) }, { coalesce: state.key });
      } else {
        const r = resizeFromCorner(P0, hd.corner, { x: snap(ptr.x), y: snap(ptr.y) }, { minSize: 0.2 });
        updatePlatform(store, hd.itemId, { x: round2(r.x), y: round2(r.y), width: round2(r.width), depth: round2(r.depth) }, { coalesce: state.key });
      }
      return;
    }
    if (hd.kind === 'rxBRot') {
      const l = store.getScene().links.find((q) => q.id === hd.linkId); const b = l && l.rx.diversity && l.rx.diversity.antennaB;
      if (!b || !b.pos) return;
      const az = Math.round((Math.atan2(ptr.x - b.pos.x, ptr.y - b.pos.y) / DEG + 360) % 360);
      setAntennaBOrientation(store, hd.linkId, { az }, { coalesce: state.key });
      return;
    }
    if (hd.kind === 'zoneP' || hd.kind === 'branch' || hd.kind === 'imdTx') {
      const bd = bounds(store.getScene().stage);
      const pt = { x: round2(clamp(target.x, bd.x0, bd.x1)), y: round2(clamp(target.y, bd.y0, bd.y1)) };
      if (hd.kind === 'zoneP') movePoint(store, hd.zoneId, hd.index, pt, { coalesce: state.key });
      else if (hd.kind === 'imdTx') moveImdTransmitter(store, hd.itemId, pt, { coalesce: state.key });
      else moveBranch(store, hd.linkId, hd.branchId, pt, { coalesce: state.key });
      return;
    }
    store.update((s) => {
      const bd = bounds(s.stage);
      const cx = (v) => round2(clamp(v, bd.x0, bd.x1)), cy = (v) => round2(clamp(v, bd.y0, bd.y1));
      if (hd.kind === 'tx' || hd.kind === 'rx') {
        const l = s.links.find((q) => q.id === hd.linkId); if (!l) return;
        l[hd.kind].pos.x = cx(target.x); l[hd.kind].pos.y = cy(target.y);
      } else if (hd.kind === 'rxB') {
        const l = s.links.find((q) => q.id === hd.linkId); const b = l?.rx.diversity?.antennaB; if (!b) return;
        b.pos = { ...b.pos, x: cx(target.x), y: cy(target.y) };
      } else if (hd.kind === 'txRot' || hd.kind === 'rxRot') {
        const l = s.links.find((q) => q.id === hd.linkId); if (!l) return;
        const e = l[hd.kind.slice(0, 2)];
        const az = Math.atan2(ptr.x - e.pos.x, ptr.y - e.pos.y) / DEG;
        e.antenna.orientation.az = Math.round((az + 360) % 360);
      } else {
        const r = (s.reflectors || []).find((q) => q.id === hd.itemId); if (!r) return;
        if (hd.kind === 'refP1') { r.p1.x = cx(target.x); r.p1.y = cy(target.y); }
        else if (hd.kind === 'refP2') { r.p2.x = cx(target.x); r.p2.y = cy(target.y); }
        else {
          const dx = target.x - state.startW.x, dy = target.y - state.startW.y;
          r.p1 = { x: cx(state.p1.x + dx), y: cy(state.p1.y + dy) }; r.p2 = { x: cx(state.p2.x + dx), y: cy(state.p2.y + dy) };
        }
      }
    }, { coalesce: state.key });
  }

  function nudge(dx, dy, big) {
    const id = store.getSelection(); const f = findItem(store.getScene(), id);
    if (!f) { cycle(1); return; } // nothing selected yet: the first arrow press selects the first item
    const step = big ? 0.5 : 0.05;
    store.update((s) => {
      const g = findItem(s, id), bd = bounds(s.stage);
      if (!g) return;
      if (g.type === 'tx' || g.type === 'rx') { g.item.pos.x = round2(clamp(g.item.pos.x + dx * step, bd.x0, bd.x1)); g.item.pos.y = round2(clamp(g.item.pos.y + dy * step, bd.y0, bd.y1)); }
      else if (g.type === 'reflector') for (const p of [g.item.p1, g.item.p2]) { p.x = round2(p.x + dx * step); p.y = round2(p.y + dy * step); }
      else if (g.type === 'platform') { g.item.x = round2(g.item.x + dx * step); g.item.y = round2(g.item.y + dy * step); }
    }, { coalesce: `plan-nudge-${id}` });
    const g = findItem(store.getScene(), id);
    if (g && g.item.pos) announce(`${g.item.name} at ${describePos(store.getScene(), g.item.pos)}`, { key: 'move', delay: 350 });
  }
  function rotate(dAz, dEl, big) {
    const id = store.getSelection(); const f = findItem(store.getScene(), id);
    if (!f) { cycle(1); return; }
    if (f.type === 'platform') {
      if (!dAz) return;
      const cur = Number.isFinite(f.item.rotationDeg) ? f.item.rotationDeg : 0;
      updatePlatform(store, id, { rotationDeg: cur + dAz * (big ? 15 : 5) }, { coalesce: `plan-rot-${id}` });
      const g2 = findItem(store.getScene(), id), r2 = Number.isFinite(g2.item.rotationDeg) ? g2.item.rotationDeg : 0;
      announce(`${g2.item.name} rotated to ${Math.round(((r2 % 360) + 360) % 360)} degrees`, { key: 'rot', delay: 350 });
      return;
    }
    if (f.type !== 'tx' && f.type !== 'rx') return;
    if (!dAz) return;
    const step = big ? 15 : 5;
    store.update((s) => { const g = findItem(s, id); if (g) { const o = g.item.antenna.orientation || (g.item.antenna.orientation = { az: 0, el: 0 }); o.az = Math.round(((o.az + dAz * step) % 360 + 360) % 360); } }, { coalesce: `plan-rot-${id}` });
    const g = findItem(store.getScene(), id);
    announce(`${g.item.name} aimed at azimuth ${g.item.antenna.orientation.az} degrees`, { key: 'rot', delay: 350 });
  }
  function cycle(dir) {
    const ids = selectableIds(store.getScene()); if (!ids.length) return;
    const i = ids.indexOf(store.getSelection());
    store.select(ids[(i + dir + ids.length) % ids.length]);
  }

  const detach = attachInteraction(canvas, vp, {
    hitTest, dragStart, dragMove,
    select: (id) => store.select(id),
    hover: (hd) => { hoverKey = hd ? hd.kind + ':' + hd.itemId : null; host.invalidate(); },
    onView: () => { userView = true; host.invalidate(); },
    fit, nudge, rotate, cycle, escape: () => store.select(null),
  });
  // pointer readout in stage coordinates (hover and drag)
  let cursor = null;
  const onCurMove = (e) => { const r = canvas.getBoundingClientRect(); cursor = { x: e.clientX - r.left, y: e.clientY - r.top }; host.invalidate(); };
  const onCurLeave = () => { cursor = null; host.invalidate(); };
  canvas.addEventListener('pointermove', onCurMove); canvas.addEventListener('pointerleave', onCurLeave); canvas.addEventListener('pointercancel', onCurLeave);
  const unsubSq = squelch.subscribe(() => host.invalidate());
  const unsubRx = rxState.subscribe(() => host.invalidate());
  const unsubCov = coverage.subscribe(() => host.invalidate());
  const unsubImd = imd.subscribe(() => host.invalidate());
  const unsubView = subscribeCovView(() => host.invalidate());
  let stageSig = (() => { const st = store.getScene().stage; return st.width + 'x' + st.depth; })();
  const unsub = store.subscribe(() => {
    const st = store.getScene().stage, sg = st.width + 'x' + st.depth;
    if (sg !== stageSig) { stageSig = sg; if (!userView) { fit(); return; } }
    host.invalidate();
  });

  const fitBtn = typeof document !== 'undefined' ? document.getElementById('btn-plan-fit') : null;
  const onFitBtn = () => fit();
  if (fitBtn) fitBtn.addEventListener('click', onFitBtn);

  return {
    viewport: vp, fit, invalidate: host.invalidate,
    destroy() { if (fitBtn) fitBtn.removeEventListener('click', onFitBtn); canvas.removeEventListener('pointermove', onCurMove); canvas.removeEventListener('pointerleave', onCurLeave); canvas.removeEventListener('pointercancel', onCurLeave); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); unregSnap(); detachRip(); detach(); unsub?.(); unsubSq?.(); unsubRx?.(); unsubCov?.(); unsubImd?.(); unsubView?.(); host.destroy(); },
  };
}
