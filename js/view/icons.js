// Icons drawn at true scale: sizes come from REAL_SIZES (metres) x viewport.pxPerM.
// Signature for all: (ctx, viewport, x, y, opts) where (x, y) is a WORLD position of the viewport
// (plan: metres on stage; side: (s, -z)).
// opts: { view: 'plan'|'side' (default 'plan'), angleDeg: clockwise screen rotation of the icon's "up",
//         ink, fill, lw, type (antenna type), heightM (stand/person) }
// A hairline minimum size (a few px) keeps tiny items such as the 10 cm bodypack visible when zoomed out.
import { REAL_SIZES } from '../model/library.js';

const size = (key, dflt) => (REAL_SIZES && REAL_SIZES[key]) || dflt;
const DEG = Math.PI / 180;

function place(ctx, vp, x, y, opts, fn) {
  const p = vp.worldToScreen(x, y), k = vp.pxPerM;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (opts.angleDeg) ctx.rotate(opts.angleDeg * DEG);
  ctx.strokeStyle = opts.ink || '#1d2733';
  ctx.fillStyle = opts.fill || '#ffffff';
  ctx.lineWidth = opts.lw || 1.25;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  fn(k, opts.view === 'side');
  ctx.restore();
}
const mn = (v, m) => Math.max(v, m);
function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Handheld mic, long axis along local up, capsule at the top. Centred on (x, y). */
export function drawMic(ctx, vp, x, y, opts = {}) {
  place(ctx, vp, x, y, opts, (k) => {
    const L = mn(size('handheldMicLength', 0.25) * k, 9), w = mn(0.045 * k, 3.2), r = mn(0.03 * k, 2.6);
    rrect(ctx, -w / 2, -L / 2 + r, w, L - r, w / 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -L / 2 + r, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
}

/** Person. Plan: top-down shoulders + head centred on (x, y). Side: standing figure, (x, y) = feet. */
export function drawPerson(ctx, vp, x, y, opts = {}) {
  place(ctx, vp, x, y, opts, (k, side) => {
    const H = opts.heightM || size('person', 1.75);
    if (side) {
      const head = mn(0.11 * k, 3), top = -H * k;
      ctx.beginPath(); ctx.arc(0, top + head, head, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const sh = top + head * 2 + 0.03 * k, hip = -0.9 * k, bw = mn(0.2 * k, 3);
      ctx.beginPath(); // torso
      ctx.moveTo(-bw, sh + 0.05 * k); ctx.quadraticCurveTo(-bw, sh, -bw * 0.5, sh); ctx.lineTo(bw * 0.5, sh);
      ctx.quadraticCurveTo(bw, sh, bw, sh + 0.05 * k); ctx.lineTo(bw * 0.8, hip); ctx.lineTo(-bw * 0.8, hip); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-bw * 0.45, hip); ctx.lineTo(-bw * 0.45, 0); ctx.moveTo(bw * 0.45, hip); ctx.lineTo(bw * 0.45, 0); ctx.stroke();
    } else {
      const sw = mn(0.46 * k, 8), sd = mn(0.24 * k, 5);
      ctx.beginPath(); ctx.ellipse(0, 0, sw / 2, sd / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, mn(0.1 * k, 2.5), 0, Math.PI * 2); ctx.stroke();
    }
  });
}

// ---- antenna symbols --------------------------------------------------------------------------------------------------
// One distinct shape per library type, drawn at true scale (REAL_SIZES where it has the size, else a typical size) with a minimum pixel size.
// Local frame: up = boresight. Element lines show the polarisation (see ANTENNA_LEGEND_TEXT): vertical = element seen end-on in the plan (ring with a dot)
// and a vertical line in the side view; horizontal = a line across the boresight in the plan and end-on in the side view; slant 45 = a diagonal line in both.
// Roll (rollDeg) turns the element line; circular polarisation adds a circular-arrow badge with R or L. Shapes carry the meaning, not colour.
export const ANTENNA_SYMBOLS = Object.freeze({
  dipole: { name: 'Dipole', glyph: 'two collinear rods with a feed gap and a dot at the feed', directional: false },
  quarterwave: { name: 'Quarter-wave whip', glyph: 'one rod standing on a ground plate or radial star', directional: false },
  whip: { name: 'Whip', glyph: 'one rod standing on a ground plate or radial star', directional: false },
  omni: { name: 'Omni reference', glyph: 'a circle with a cross', directional: false },
  paddle: { name: 'Paddle', glyph: 'a flat plate seen edge-on with a mount stub behind and an arrow at the front', directional: true },
  panel: { name: 'Panel', glyph: 'a flat plate seen edge-on with a grid of ticks, a mount stub behind and an arrow at the front', directional: true },
  patch: { name: 'Patch', glyph: 'a small plate in front of a larger ground plate with a feed dot', directional: true },
  logperiodic: { name: 'Log-periodic', glyph: 'a boom with elements that shorten toward the front, joined by a dashed triangle outline', directional: true },
  'log-periodic': { name: 'Log-periodic', glyph: 'a boom with elements that shorten toward the front, joined by a dashed triangle outline', directional: true },
  yagi: { name: 'Yagi', glyph: 'a boom with a long reflector, a feed dot on the driven element and shorter directors', directional: true },
  helical: { name: 'Helical', glyph: 'a coil along the boresight on a small reflector disc', directional: true },
  'helical-cp': { name: 'Circular helical', glyph: 'a coil on a large reflector disc with a circular-arrow badge', directional: true },
  cardioid: { name: 'Cardioid', glyph: 'a D-shaped capsule with its flat side to the back', directional: true },
  body: { name: 'Body-worn', glyph: 'a diamond (lossy body-worn element)', directional: false },
  custom: { name: 'Custom', glyph: 'a dashed square (user-defined gain, omni)', directional: false },
});
const POL_WORD = { vertical: 'vertical', horizontal: 'horizontal', slant45: 'slant 45 degree', rhcp: 'right-hand circular', lhcp: 'left-hand circular' };
export const ANTENNA_LEGEND_TEXT = 'Antenna symbols: the arrow at the front is the boresight. Element lines show the polarisation: in the plan a ring with a dot is a vertical element seen end-on, a line across the boresight is horizontal, a diagonal is slant 45; the side view swaps vertical and horizontal. Roll turns the line. A circular arrow with R or L is right or left-hand circular polarisation. A plate or radial star under a whip is its ground plane; a short stub behind an antenna is its mount.';
/** Accessible name of an antenna symbol, e.g. "Yagi antenna symbol, vertical polarisation, arrow marks the boresight". */
export function antennaIconName(type, pol, rollDeg) {
  const sym = ANTENNA_SYMBOLS[type] || ANTENNA_SYMBOLS.dipole;
  const p = POL_WORD[pol] || (type === 'helical-cp' ? POL_WORD.rhcp : 'vertical');
  return `${sym.name} antenna symbol, ${p} polarisation${rollDeg ? `, rolled ${Math.round(rollDeg)} degrees` : ''}${sym.directional ? ', arrow marks the boresight' : ''}`;
}
/** Polarisation of the symbol: { circular, hand } or a linear element angle psi (degrees from vertical, roll added). */
export function polarisationOf(type, pol, rollDeg = 0) {
  const p = pol || (type === 'helical-cp' ? 'rhcp' : 'vertical');
  if (p === 'rhcp' || p === 'lhcp') return { circular: true, hand: p === 'rhcp' ? 'R' : 'L' };
  const psi = (p === 'horizontal' ? 90 : p === 'slant45' ? 45 : 0) + (Number.isFinite(rollDeg) ? rollDeg : 0);
  return { circular: false, psi };
}
/** Element direction in the icon's local frame for a view: { end: true } when seen end-on, else { dx, dy } unit vector. angleDeg = the icon rotation. */
export function elementDirection(view, psiDeg, angleDeg = 0) {
  const psi = ((psiDeg % 180) + 180) % 180; // 0..180 from vertical
  const off = Math.min(psi, 180 - psi); // distance from vertical
  if (view === 'side') {
    if (off > 75) return { end: true };
    const sx = Math.sin(psiDeg * DEG), sy = Math.cos(psiDeg * DEG), a = -angleDeg * DEG; // screen direction, counter-rotated by the icon rotation
    return { dx: sx * Math.cos(a) - sy * Math.sin(a), dy: sx * Math.sin(a) + sy * Math.cos(a) };
  }
  if (off < 15) return { end: true };
  const th = (90 - psiDeg) * DEG; // 90 = across the boresight (local x axis)
  return { dx: Math.cos(th), dy: -Math.sin(th) };
}

/** Antenna, local up = boresight. opts.type picks the glyph; opts.pol / rollDeg the element lines; opts.groundPlane the plate under a whip. Centred on (x, y). */
export function drawAntenna(ctx, vp, x, y, opts = {}) {
  const type = ANTENNA_SYMBOLS[opts.type] ? opts.type : 'dipole';
  const lw0 = opts.lw || 1.25;
  place(ctx, vp, x, y, opts, (k) => {
    const S = (m, minPx) => Math.max(m * k, minPx);
    const pol = polarisationOf(type, opts.pol, opts.rollDeg);
    const dir = pol.circular ? { dx: 1, dy: 0 } : elementDirection(opts.view, pol.psi, opts.angleDeg || 0);
    const paper = opts.fill || '#ffffff';
    const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    const dot = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.fillStyle = paper; };
    // one element of half length h centred on (cx, cy): a line along the polarisation direction, or a ring with a dot when seen end-on
    const elem = (cx, cy, h, feed = false) => {
      if (dir.end) { const r = Math.max(1.8, Math.min(h * 0.4, 4)); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); dot(cx, cy, 0.8); return; }
      ctx.lineWidth = lw0 + 0.7; line(cx - dir.dx * h, cy - dir.dy * h, cx + dir.dx * h, cy + dir.dy * h); ctx.lineWidth = lw0;
      if (feed) dot(cx, cy, 1.6);
    };
    const arrow = (yFront) => { const a = 3.6; ctx.beginPath(); ctx.moveTo(-a, yFront - a * 0.4); ctx.lineTo(0, yFront - a * 1.5); ctx.lineTo(a, yFront - a * 0.4); ctx.stroke(); line(0, yFront - a * 1.5, 0, yFront + 1); };
    const plate = (w, d) => { rrect(ctx, -w / 2, -d / 2, w, d, 1.2); ctx.fill(); ctx.stroke(); };
    let front = 0, back = 0; // extents along the boresight, for the arrow and the mount
    switch (type) {
      case 'paddle': case 'panel': {
        const w = S(size('paddle', 0.3), 9), d = S(0.04, 3.2); plate(w, d); front = -d / 2; back = d / 2;
        if (type === 'panel') for (let i = -1; i <= 1; i++) line(i * w * 0.28, -d / 2 + 0.6, i * w * 0.28, d / 2 - 0.6);
        elem(0, -d / 2 - 3.5, S(0.06, 3)); front -= 7; break;
      }
      case 'patch': {
        const g = S(0.14, 10), w = S(0.08, 6), gd = S(0.012, 1.6);
        ctx.beginPath(); ctx.rect(-g / 2, 1, g, gd); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.rect(-w / 2, -2.2, w, 2.4); ctx.fill(); ctx.stroke();
        dot(0, 1 + gd / 2, 1.3); front = -2.2; back = 1 + gd; break;
      }
      case 'helical': case 'helical-cp': {
        const len = S(size('helical', 0.15), 10), r = type === 'helical-cp' ? S(0.05, 4.5) : S(0.03, 3.2), disc = type === 'helical-cp' ? S(0.2, 12) : S(0.1, 8), turns = 4;
        ctx.lineWidth = lw0 + 1; line(-disc / 2, len / 2, disc / 2, len / 2); ctx.lineWidth = lw0;
        ctx.beginPath(); ctx.moveTo(0, len / 2);
        for (let i = 0; i < turns * 2; i++) ctx.lineTo(i % 2 ? -r : r, len / 2 - ((i + 0.5) / (turns * 2)) * len);
        ctx.lineTo(0, -len / 2); ctx.stroke(); front = -len / 2; back = len / 2 + 1; break;
      }
      case 'logperiodic': case 'log-periodic': {
        const len = S(0.5, 14), hb = S(0.22, 8), hf = S(0.07, 2.6), n = 6, sx = dir.end ? 1 : (Math.abs(dir.dx) > 0.2 ? Math.sign(dir.dx) * Math.abs(dir.dx) : 1);
        line(0, len / 2, 0, -len / 2);
        for (let i = 0; i < n; i++) { const t = i / (n - 1); elem(0, len / 2 - t * len, hb + (hf - hb) * t); }
        ctx.save(); ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(-hb * sx, len / 2); ctx.lineTo(-hf * sx, -len / 2); ctx.moveTo(hb * sx, len / 2); ctx.lineTo(hf * sx, -len / 2); ctx.stroke(); ctx.restore();
        front = -len / 2; back = len / 2; break;
      }
      case 'yagi': {
        const len = S(0.6, 16), hr = S(0.26, 8), hd = S(0.22, 7), hdd = S(0.19, 6);
        line(0, len / 2, 0, -len / 2);
        elem(0, len / 2 - 1, hr); // reflector (longest, at the back)
        elem(0, len / 2 - len * 0.2, hd, true); // driven element with the feed dot
        for (let i = 0; i < 3; i++) elem(0, len / 2 - len * (0.42 + i * 0.22), hdd * (1 - i * 0.07)); // directors
        front = -len / 2; back = len / 2; break;
      }
      case 'cardioid': {
        const r = S(0.06, 4.5);
        ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); ctx.lineTo(r, r * 0.8); ctx.lineTo(-r, r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
        elem(0, -r * 0.15, r * 0.7); front = -r; back = r * 0.8; break;
      }
      case 'omni': { const r = S(0.05, 4); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); line(-r, 0, r, 0); line(0, -r, 0, r); break; }
      case 'body': { const r = S(0.05, 4); ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); break; }
      case 'custom': { const r = S(0.05, 4); ctx.save(); ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.rect(-r, -r, 2 * r, 2 * r); ctx.fill(); ctx.stroke(); ctx.restore(); break; }
      case 'quarterwave': case 'whip': {
        const h = S(type === 'whip' ? 0.2 : 0.125, 6), gp = opts.groundPlane || (type === 'quarterwave' ? 'body' : 'none'), gr = { none: 0, body: S(0.08, 5), rack: S(0.14, 8), large: S(0.25, 12) }[gp] ?? 0;
        if (dir.end) { // element end-on: ring with a dot, radials in the ground plane
          if (gr) { ctx.save(); ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(0, 0, gr, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); for (let i = 0; i < 4; i++) { const a = (45 + i * 90) * DEG; line(Math.cos(a) * 2.5, Math.sin(a) * 2.5, Math.cos(a) * gr, Math.sin(a) * gr); } }
          elem(0, 0, h);
        } else { // rod from its base, the plate crosses it at the base
          const bx = -dir.dx * h * 0.5, by = -dir.dy * h * 0.5;
          if (gr) { ctx.lineWidth = lw0 + 1.2; line(bx - dir.dy * gr, by + dir.dx * gr, bx + dir.dy * gr, by - dir.dx * gr); ctx.lineWidth = lw0; }
          ctx.lineWidth = lw0 + 0.7; line(bx, by, bx + dir.dx * h, by + dir.dy * h); ctx.lineWidth = lw0;
        }
        break;
      }
      default: { // dipole: two collinear rods with a feed gap
        const h = S(size('dipole', 0.3), 8) / 2;
        if (dir.end) elem(0, 0, h);
        else { const g = Math.max(1, 0.012 * k); ctx.lineWidth = lw0 + 0.8; line(-dir.dx * h, -dir.dy * h, -dir.dx * g, -dir.dy * g); line(dir.dx * g, dir.dy * g, dir.dx * h, dir.dy * h); ctx.lineWidth = lw0; ctx.beginPath(); ctx.arc(0, 0, Math.max(1.6, 0.012 * k), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      }
    }
    if (ANTENNA_SYMBOLS[type].directional) { // boresight arrow in front, mount stub with a clamp behind
      arrow(front - 2);
      const m = S(0.05, 3); line(0, back, 0, back + m); ctx.strokeRect(-1.6, back + m, 3.2, 2.6);
    }
    if (pol.circular) { // circular-arrow badge, kept upright whatever the icon rotation
      ctx.save(); ctx.rotate(-(opts.angleDeg || 0) * DEG);
      const bx = 13, by = -13, r = 5.5, cw = pol.hand === 'R', a0 = cw ? -2.4 : -0.74, a1 = cw ? 1.4 : -4.54;
      ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(bx, by, r, a0, a1, !cw); ctx.stroke();
      const ax = bx + r * Math.cos(a1), ay = by + r * Math.sin(a1), d = cw ? -1 : 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + d * 3.5, ay - 2.6); ctx.moveTo(ax, ay); ctx.lineTo(ax + d * 3.5, ay + 2.6); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pol.hand, bx, by + 0.5);
      ctx.restore();
    }
  });
}

/** Belt-pack transmitter / IEM receiver with a short whip. Centred on (x, y). */
export function drawBodypack(ctx, vp, x, y, opts = {}) {
  place(ctx, vp, x, y, opts, (k) => {
    const L = mn(size('bodypack', 0.10) * k, 6), w = L * 0.65;
    rrect(ctx, -w / 2, -L / 2, w, L, 1.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.25, -L / 2); ctx.lineTo(w * 0.25, -L / 2 - mn(0.08 * k, 4)); ctx.stroke();
  });
}

/** Half-rack receiver/transmitter. Plan: footprint 0.48 x 0.25; side: 0.48 x 0.044 front panel. */
export function drawReceiver(ctx, vp, x, y, opts = {}) {
  place(ctx, vp, x, y, opts, (k, side) => {
    const w = mn(size('receiver', 0.48) * k, 12), d = mn((side ? 0.044 : 0.25) * k, 4);
    ctx.fillRect(-w / 2, -d / 2, w, d); ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -d / 2); ctx.lineTo(-w * 0.3 - 3, -d / 2 - mn(0.1 * k, 5));
    ctx.moveTo(w * 0.3, -d / 2); ctx.lineTo(w * 0.3 + 3, -d / 2 - mn(0.1 * k, 5)); ctx.stroke();
  });
}

/** Mic / antenna stand. Plan: tripod footprint. Side: pole from the floor (x, y = foot) to opts.heightM. */
export function drawStand(ctx, vp, x, y, opts = {}) {
  place(ctx, vp, x, y, opts, (k, side) => {
    if (side) {
      const H = (opts.heightM || size('stand', 2.0)) * k, base = mn(0.3 * k, 8);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -H);
      ctx.moveTo(0, -0.25 * k); ctx.lineTo(-base, 0); ctx.moveTo(0, -0.25 * k); ctx.lineTo(base, 0); ctx.stroke();
    } else {
      const r = mn(0.3 * k, 7);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = (i * 120 + 90) * DEG; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, mn(0.03 * k, 2), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  });
}
