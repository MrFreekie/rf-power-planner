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

/** Antenna, local up = boresight. opts.type picks the glyph. Centred on (x, y). */
export function drawAntenna(ctx, vp, x, y, opts = {}) {
  const type = opts.type || 'dipole';
  place(ctx, vp, x, y, opts, (k) => {
    const L = mn(size(type, 0.30) * k, 8);
    switch (type) {
      case 'paddle': { // flat panel seen edge-on: wide thin box + mounting stub behind
        const w = mn(size('paddle', 0.3) * k, 9), d = mn(0.04 * k, 3.2);
        rrect(ctx, -w / 2, -d / 2, w, d, 1.5); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, d / 2); ctx.lineTo(0, d / 2 + mn(0.05 * k, 3)); ctx.stroke(); break;
      }
      case 'helical': { // zig-zag coil along boresight
        const len = mn(size('helical', 0.15) * k, 8), a = mn(0.03 * k, 2.5);
        ctx.beginPath(); ctx.moveTo(0, len / 2);
        for (let i = 0; i < 6; i++) ctx.lineTo(i % 2 ? -a : a, len / 2 - ((i + 0.5) / 6) * len);
        ctx.lineTo(0, -len / 2); ctx.stroke(); break;
      }
      case 'logperiodic': { // boom with tapering elements
        const len = mn(0.5 * k, 12);
        ctx.beginPath(); ctx.moveTo(0, len / 2); ctx.lineTo(0, -len / 2);
        for (let i = 0; i < 5; i++) { const yy = len / 2 - (i / 4) * len, hw = (0.5 - i * 0.09) * L * 0.5 + 1; ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); }
        ctx.stroke(); break;
      }
      case 'cardioid': { // small D-shaped capsule
        const r = mn(0.06 * k, 4);
        ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); ctx.lineTo(r, r * 0.8); ctx.lineTo(-r, r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      }
      case 'omni': { const r = mn(0.05 * k, 3.5); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke(); break; }
      case 'body': case 'custom': { const r = mn(0.05 * k, 3.5); ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); break; }
      default: { // dipole: two rods across the boresight with a feed gap
        const g = mn(0.012 * k, 1);
        ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(-g, 0); ctx.moveTo(g, 0); ctx.lineTo(L / 2, 0); ctx.lineWidth = (opts.lw || 1.25) + 0.8; ctx.stroke();
        ctx.lineWidth = opts.lw || 1.25; ctx.beginPath(); ctx.arc(0, 0, mn(0.012 * k, 1.6), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
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
