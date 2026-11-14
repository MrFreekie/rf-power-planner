// Mono baseband view for the bottom-bar MPX spectrum: microphone links and mono in-ear monitors.
// Pure helpers (isStereoMpx, monoInputs, monoSummary) plus drawMonoMpx; the model is monoBasebandSpectrum in
// js/model/spectrum-views.js. The stereo view (drawMpx in spectra.js) is unchanged.
import { setFont, haloText } from './util.js';
import { SPEC_DB } from './mpx.js';
import { dataConfig } from '../telemetryTracker.js';
import { drawBasebandLines } from './toneLines.js';
import { drawDistortionBadge, drawProductMarker } from './distortionDraw.js';
import { resolveAudioBandwidthHz, audioBandLabel, monoCaption, besselJ } from '../model/spectrum-views.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);


/** True when the MPX view shows the stereo multiplex (an IEM with MPX stereo on); every other link shows the mono baseband. */
export function isStereoMpx(link) { return !!link && link.kind === 'iem' && !!(link.mpx && link.mpx.enabled); }

/** Arguments for monoBasebandSpectrum. cnrDb: from the MPX tracker when it has one, else received level above the planner noise floor. */
export function monoInputs(link, mst, r, t, nBins = 240, dcOverride = null) {
  if (!link) return null;
  const dataOn = !!(link.telemetry && link.telemetry.enabled);
  const dc = dataOn ? (dcOverride || dataConfig(link)) : null;
  let cnrDb = mst && fin(mst.cnrDb) ? mst.cnrDb : null;
  if (cnrDb === null && r && fin(r.inputPowerDbm)) {
    const nf = r.cascade && fin(r.cascade.noiseFloorDbm) ? r.cascade.noiseFloorDbm : -110;
    cnrDb = r.inputPowerDbm - nf;
  }
  if (cnrDb === null) cnrDb = 40;
  cnrDb = Math.min(70, Math.max(0, cnrDb));
  const khz = dc && fin(dc.subcarrierKHz) ? dc.subcarrierKHz : 57;
  const abw = resolveAudioBandwidthHz({ link, kind: link.kind === 'iem' ? 'iem' : 'mic', stereo: false });
  return {
    audioBandwidthHz: abw && fin(abw.hz) ? abw.hz : undefined,
    kind: link.kind === 'iem' ? 'iem' : 'mic', stereo: false, pilotLocked: true,
    dataConfig: dataOn ? { enabled: true, subcarrierKHz: khz, injectionFrac: dc && fin(dc.injectionFrac) ? dc.injectionFrac : undefined } : { enabled: false },
    cnrDb, nBins, fMaxKhz: Math.max(60, dataOn ? khz + 8 : 60), t, preEmphasisTauUs: 50,
  };
}

/**
 * Subcarriers for the small RF view: each present marker of monoBasebandSpectrum (tone key, data subcarrier, stereo pilot) rides on
 * the carrier as FM sidebands at +-freq. Level = rx level + 20 log10 |J1(beta)|, beta = injection x deviation / freq (injection from the
 * marker's dB relative to full deviation). Illustrative, like the baseband view. Pure; returns [] without a model result.
 */
export function rfSubcarriers(m, devKhz, rxLevelDbm) {
  if (!m || !Array.isArray(m.markers) || !fin(devKhz) || !fin(rxLevelDbm)) return [];
  const out = [];
  for (const k of m.markers) {
    if (!k.present || !fin(k.freqKhz) || k.freqKhz <= 0 || !fin(k.levelDb)) continue;
    const beta = (10 ** (k.levelDb / 20)) * devKhz / k.freqKhz;
    const j1 = Math.abs(besselJ(1, beta));
    if (!(j1 > 0)) continue;
    out.push({ name: k.name === 'Data subcarrier' ? 'data' : k.name === 'Tone key' ? 'tone key' : 'pilot', offsetKhz: k.freqKhz, levelDbm: rxLevelDbm + 20 * Math.log10(j1), status: k.status });
  }
  return out;
}

export function monoSummary(m, inp) {
  if (!m) return 'MPX baseband spectrum not available.';
  const who = inp.kind === 'iem' ? 'mono in-ear monitor' : 'microphone';
  const parts = [`Baseband spectrum of a ${who} link, 0 to ${Math.round(inp.fMaxKhz)} kilohertz, simulated. Audio fills 0 to ${+((m.audioBandwidthHz || inp.audioBandwidthHz || 15000) / 1000).toFixed(1)} kilohertz and the noise rises with frequency.`];
  for (const k of m.markers) {
    const f = `${+k.freqKhz.toFixed(3)} kilohertz`;
    if (k.name === 'Stereo pilot') parts.push(k.present ? `Stereo pilot present at ${f}.` : `The ${f} stereo pilot position is empty: a mono link carries no pilot.`);
    else if (k.name === 'Tone key') parts.push(`Tone key at about ${f}, assumed and illustrative.`);
    else parts.push(`Data subcarrier at ${f}.`);
  }
  if (!m.markers.some((k) => k.name === 'Data subcarrier')) parts.push('No data subcarrier.');
  return parts.join(' ');
}

export function monoNotes(m) {
  return [monoCaption(m && m.audioBandwidthHz ? m.audioBandwidthHz : 15000), 'Standard: the 19 kHz pilot of FM stereo. Assumed: a microphone tone-key subcarrier near 32.768 kHz, whose real frequency is not published. Programme audio and levels are simulated and illustrative.', ...(m ? m.notes : [])];
}

function nearestIdx(xs, v) { let k = -1, d = Infinity; for (let i = 0; i < xs.length; i++) { const e = Math.abs(xs[i] - v); if (e < d) { d = e; k = i; } } return k; }

/** m = monoBasebandSpectrum result, inp = monoInputs result, hoverX = pointer x in canvas pixels or null. */
export function drawMonoMpx(ctx, w, h, th, { m, inp, hoverX, toneProducts: tp = null }) {
  if (!m) return;
  const L = 34, R = 8, T = 22, B = 22, pw = w - L - R, ph = h - T - B, span = inp.fMaxKhz;
  const X = (k) => L + (k / span) * pw;
  const Y = (db) => T + ph - ((Math.min(Math.max(db, SPEC_DB.min), SPEC_DB.max) - SPEC_DB.min) / (SPEC_DB.max - SPEC_DB.min)) * ph;
  ctx.fillStyle = th.paper2; ctx.fillRect(L, T, pw, ph);
  ctx.fillStyle = th.mono; ctx.globalAlpha = 0.18; ctx.fillRect(X(0.03), T, X(15) - X(0.03), ph); ctx.globalAlpha = 1;
  setFont(ctx, th, 11); ctx.textBaseline = 'alphabetic';
  for (let db = SPEC_DB.min; db <= SPEC_DB.max; db += 30) {
    const y = Math.round(Y(db)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillStyle = th.inkSoft; ctx.textAlign = 'right'; ctx.fillText(String(db), L - 4, y + 4);
  }
  const ticks = new Set(w < 380 ? [0, 15, Math.round(span)] : [0, 15, 30, 45, Math.round(span)]);
  for (const k of m.markers) ticks.add(Math.round(k.freqKhz));
  ctx.textAlign = 'center';
  let lastX = -99;
  for (const k of [...ticks].sort((a, b) => a - b)) {
    const x = Math.round(X(k)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
    const lx = Math.min(Math.max(x, L + 6), w - R - 14);
    if (lx - lastX < 26) continue;
    lastX = lx;
    ctx.fillStyle = th.inkSoft; ctx.fillText(k === Math.round(span) ? `${k} kHz` : String(k), lx, h - 6);
  }
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
  const n = m.freqKhz.length;
  ctx.beginPath(); ctx.moveTo(X(m.freqKhz[0]), Y(SPEC_DB.min));
  for (let i = 0; i < n; i++) ctx.lineTo(X(m.freqKhz[i]), Y(m.levelDb[i]));
  ctx.lineTo(X(span), Y(SPEC_DB.min)); ctx.closePath();
  ctx.fillStyle = th.ink; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = th.ink; ctx.lineWidth = 1.4; ctx.beginPath();
  for (let i = 0; i < n; i++) { if (i) ctx.lineTo(X(m.freqKhz[i]), Y(m.levelDb[i])); else ctx.moveTo(X(m.freqKhz[i]), Y(m.levelDb[i])); }
  ctx.stroke();
  ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = th.fail; ctx.lineWidth = 1.4; ctx.beginPath();
  for (let i = 0; i < n; i++) { if (i) ctx.lineTo(X(m.freqKhz[i]), Y(m.noiseDb[i])); else ctx.moveTo(X(m.freqKhz[i]), Y(m.noiseDb[i])); }
  ctx.stroke(); ctx.restore();
  const dd = inp.distortion && inp.distortion.active ? inp.distortion : null;
  const prods = dd && Array.isArray(m.products) ? m.products : [];
  for (const pr of prods) { const x = X(pr.freqKhz); if (x >= L && x <= L + pw) drawProductMarker(ctx, th, x, Y(pr.levelDb), `IM${pr.order}`); }
  if (tp) drawBasebandLines(ctx, th, { X, Y, L, T, pw, ph, span, floorDb: SPEC_DB.min }, tp);
  drawDistortionBadge(ctx, th, { L, T, pw, ph }, dd, prods.length ? '\u25B2 intermodulation products' : null);
  const ceil = m.bands && m.bands.programme ? m.bands.programme[1] : 15;
  if (m.bands && m.bands.gap) { // unused band between the audio ceiling and the control tone
    const [g0, g1] = m.bands.gap, gx0 = X(g0), gx1 = X(g1);
    if (gx1 - gx0 > 3) {
      ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = th.inkSoft; ctx.lineWidth = 1; ctx.strokeRect(gx0 + 0.5, T + 0.5, gx1 - gx0 - 1, ph - 1); ctx.restore();
      if (gx1 - gx0 > 46) haloText(ctx, th, 'gap', (gx0 + gx1) / 2, T + ph - 6, { align: 'center', px: 11, color: th.inkSoft });
    }
  }
  haloText(ctx, th, w < 380 ? 'AUDIO' : audioBandLabel(m.audioBandwidthHz || ceil * 1000), (X(0.03) + X(ceil)) / 2, T - 6, { align: 'center', px: 11, weight: '600', color: th.ink });
  // markers: present = solid, absent or assumed = dashed, always named
  for (const k of m.markers) {
    const x = X(k.freqKhz), absent = !k.present, assumed = k.status === 'assumed' || k.status === 'illustrative';
    const col = k.name === 'Data subcarrier' ? th.warnText : absent ? th.inkSoft : th.pass;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; if (absent || assumed) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, T + 14); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.restore();
    const word = k.name === 'Stereo pilot' ? (absent ? (w < 380 ? 'no pilot' : '19 kHz pilot: absent') : 'PILOT') : k.name === 'Tone key' ? (w < 380 ? 'tone key*' : 'TONE KEY (assumed)') : 'DATA';
    haloText(ctx, th, word, Math.min(Math.max(x, L + 40), L + pw - 40), T - 6, { align: 'center', px: 11, weight: '600', color: col });
  }
  if (w >= 420 && h >= 150) { // legend: audio / control tone / data / noise
    const items = [['audio', th.ink, 0.35, false], ['noise', th.fail, 1, true], ['control tone', th.pass, 1, false]];
    if (m.markers.some((k) => k.name === 'Data subcarrier')) items.push(['data', th.warnText, 1, false]);
    let y = T + 16; const x0 = L + pw - 96;
    for (const [name, col, a, dash] of items) {
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; if (dash) ctx.setLineDash([4, 3]);
      if (name === 'audio') ctx.fillRect(x0, y - 8, 16, 8); else { ctx.beginPath(); ctx.moveTo(x0, y - 4); ctx.lineTo(x0 + 16, y - 4); ctx.stroke(); }
      ctx.restore();
      haloText(ctx, th, name, x0 + 21, y, { align: 'left', px: 11, color: th.ink }); y += 14;
    }
  }
  if (hoverX != null && hoverX >= L && hoverX <= L + pw) {
    const k = ((hoverX - L) / pw) * span;
    let mk = null, md = Infinity;
    for (const q of m.markers) { const d = Math.abs(q.freqKhz - k); if (d < md) { md = d; mk = q; } }
    const dash = () => { ctx.save(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); };
    if (mk && (md * pw) / span <= 14) {
      const x = X(mk.freqKhz);
      dash(); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.restore();
      haloText(ctx, th, `${mk.name} ${+mk.freqKhz.toFixed(2)} kHz${mk.present ? '' : ' (absent)'}${mk.status === 'assumed' ? ', assumed' : ''}`, Math.min(Math.max(x, L + 80), L + pw - 80), T + ph - 8, { align: 'center', px: 12, weight: '600' });
    } else {
      const i = nearestIdx(m.freqKhz, k);
      if (i >= 0) {
        const x = X(m.freqKhz[i]);
        dash(); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.restore();
        haloText(ctx, th, `${m.freqKhz[i].toFixed(1)} kHz: ${m.levelDb[i].toFixed(0)} dB`, Math.min(Math.max(x, L + 60), L + pw - 60), T + 12, { align: 'center', px: 12, weight: '600' });
      }
    }
  }
}
