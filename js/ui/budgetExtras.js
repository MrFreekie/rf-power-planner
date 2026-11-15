// Extra link-budget rows: polarisation, antenna mismatch (VSWR) and point-to-point geometry. Pure: result -> [{label, value, severity}].
// severity 'ok' | 'info' | 'warning' is always paired with words in the value, never colour alone.
const fin = Number.isFinite;
const POL_NAME = { vertical: 'vertical', horizontal: 'horizontal', slant45: 'slant 45', rhcp: 'right-hand circular', lhcp: 'left-hand circular' };

export function vswrText(m) {
  if (!m || !fin(m.vswr)) return null;
  const v = m.vswr > 99 ? '>99' : m.vswr.toFixed(m.vswr < 10 ? 2 : 1);
  return `VSWR ${v}:1, return loss ${fin(m.returnLossDb) ? m.returnLossDb.toFixed(1) : '-'} dB, mismatch ${fin(m.mismatchDb) ? m.mismatchDb.toFixed(1) : '-'} dB${m.inBand === false ? ' (out of band)' : ''}`;
}

/** Rows for the Fresnel zone overlay: status in words, the worst category and up to two warnings (fr = fresnelClearance result). */
export function fresnelRows(fr) {
  if (!fr) return [];
  const word = { clear: 'CLEAR', marginal: 'MARGINAL', blocked: 'BLOCKED' }[fr.status] || String(fr.status);
  const pct = fin(fr.minFraction) ? `${Math.round(fr.minFraction * 100)} % of the first zone clear` : 'no obstacles near the path';
  const rows = [{ label: 'Fresnel zone', value: `${word}: ${pct}${fr.worst ? `, worst ${fr.worst.category}${fr.worst.name ? ` (${fr.worst.name})` : ''}` : ''}${fr.meets60 ? ' (60 % rule met)' : ' (60 % rule not met)'}`, severity: fr.status === 'clear' ? 'ok' : fr.status === 'marginal' ? 'info' : 'warning' }];
  for (const w of (fr.warnings || []).slice(0, 2)) rows.push({ label: 'Fresnel note', value: w, severity: fr.status === 'blocked' ? 'warning' : 'info' });
  return rows;
}

const sgn = (x, d = 1) => `${x >= 0 ? '+' : '-'}${Math.abs(x).toFixed(d)}`;
const LEVEL_WORD = { ok: 'OK', hot: 'HOT', compressed: 'COMPRESSED' };

/** Booster compression rows from result.compression: one summary row, then one row per active stage (input, OP1dB, compression, headroom, level in words). */
export function compressionRows(c) {
  if (!c || !Array.isArray(c.stages) || !c.stages.length) return [];
  const total = fin(c.totalDb) ? c.totalDb : 0;
  const rows = [{ label: 'Booster compression', value: total > 0.05 ? `${total.toFixed(1)} dB less gain for the wanted signal${c.strongest && c.strongest.name ? ` (driven by ${c.strongest.name})` : ''}${total >= 1 ? ' WARNING' : ''}` : 'none: every active stage has headroom', severity: total >= 1 ? 'warning' : total > 0.05 ? 'info' : 'ok' }];
  for (const st of c.stages) {
    if (!fin(st.op1dBDbm)) continue;
    rows.push({ label: `Stage ${st.label}`, value: `in ${fin(st.inputDbm) ? st.inputDbm.toFixed(1) : '-'} dBm, OP1dB ${st.op1dBDbm.toFixed(1)} dBm, compression ${(st.compressionDb || 0).toFixed(1)} dB, headroom ${fin(st.headroomDb) ? sgn(st.headroomDb) : '-'} dB: ${LEVEL_WORD[st.level] || st.level}`, severity: st.level === 'compressed' ? 'warning' : st.level === 'hot' ? 'info' : 'ok' });
  }
  return rows;
}

/** Analogue versus digital rows from modeReport(): [{ label, value, severity }] and a plain-language line. Pure. */
export function modeContrast(m) {
  if (!m || !m.analog || !m.digital) return null;
  const a = m.analog, d = m.digital, cl = d.cliff || {};
  const rows = [
    { label: 'Receiver input', value: `${m.inputDbm.toFixed(1)} dBm, CNR ${m.cnrDb.toFixed(1)} dB`, severity: 'ok' },
    { label: 'Analogue FM', value: `${Math.round(a.occupiedBwKHz)} kHz wide, threshold CNR ${a.thresholdCnrDb.toFixed(0)} dB (${sgn(a.thresholdMarginDb)} dB), audio SNR ${a.audioSnrDb.toFixed(1)} dB, quality ${Math.round(a.quality)} %: ${a.usable ? 'USABLE' : 'NOISY'}`, severity: a.usable ? 'ok' : a.quality > 20 ? 'info' : 'warning' },
    { label: 'Digital', value: `${Math.round(d.occupiedBwKHz)} kHz wide, ${String(d.state).toUpperCase()}${d.order ? `, ${d.order}-point` : ''}, frame errors ${(d.frameErrorRate * 100).toFixed(d.frameErrorRate < 0.1 ? 2 : 0)} %, quality ${Math.round(d.quality)} %, ${sgn(d.concealMarginDb)} dB from the conceal point`, severity: /down|mute/i.test(d.state) ? 'warning' : /degrad|conceal/i.test(d.state) ? 'info' : 'ok' },
    { label: 'Digital cliff', value: `${fin(cl.cliffWidthDb) ? cl.cliffWidthDb.toFixed(1) : '-'} dB wide, from degraded to down`, severity: 'ok' },
  ];
  const w = fin(cl.cliffWidthDb) ? cl.cliffWidthDb : 0;
  const line = `Analogue FM fades gradually: audio SNR falls about 1 dB for each dB of signal, so a weak link gets hissy long before it fails. Digital stays clean until the cliff, then drops from good to muted within about ${w.toFixed(1)} dB. ${d.quality < 50 && a.quality > 5 ? 'At this level the digital link has already fallen off the cliff while analogue is still audible.' : d.quality >= 90 ? 'At this level digital is clean.' : ''}`.trim();
  return { rows, line };
}

export function budgetExtras(r, fr = null, more = []) {
  const rows = [];
  if (!r) return rows;
  const extra = fresnelRows(fr);
  const p = r.polarisation;
  if (p && fin(p.lossDb)) rows.push({ label: 'Polarisation', value: `${p.lossDb.toFixed(1)} dB (${POL_NAME[p.txPolarisation] || p.txPolarisation || 'tx'})${p.severity === 'warning' ? ' WARNING' : p.severity === 'info' ? ' note' : ''}`, severity: p.severity || 'ok' });
  const am = r.antennaMismatch;
  if (am) for (const [k, name] of [['tx', 'Tx antenna'], ['rx', 'Rx antenna']]) {
    const t = vswrText(am[k]);
    if (t) rows.push({ label: `${name} match`, value: t, severity: am[k].vswr >= 3 ? 'warning' : am[k].vswr >= 2 ? 'info' : 'ok' });
  }
  const q = r.p2p;
  if (q) {
    const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
    if (fin(q.minClearanceFraction)) rows.push({ label: 'Fresnel clearance', value: `${Math.round(q.minClearanceFraction * 100)} % of first zone at ${km(q.worstXM || 0)}${q.meetsSixtyPercent ? ' (60 % rule met)' : ' (below the 60 % rule)'}`, severity: q.meetsSixtyPercent ? 'ok' : 'warning' });
    if (fin(q.horizonM)) rows.push({ label: 'Radio horizon', value: `${km(q.horizonM)}${q.beyondHorizon ? ' BEYOND HORIZON' : ''}`, severity: q.beyondHorizon ? 'warning' : 'ok' });
    rows.push({ label: 'Edge loss', value: q.edge === 'none' ? 'none (clear path)' : `${fin(q.diffractionLossDb) ? q.diffractionLossDb.toFixed(1) : '-'} dB, ${q.edge === 'earth' ? 'earth curvature' : 'obstacle'}`, severity: q.edge === 'none' ? 'ok' : 'warning' });
  }
  const wn = r.wallNoise;
  if (wn && fin(wn.dbm)) {
    const rise = fin(wn.riseDb) ? wn.riseDb : 0, ch = fin(wn.marginChangeDb) ? wn.marginChangeDb : 0;
    rows.push({ label: 'Video wall noise', value: `${wn.dbm.toFixed(1)} dBm in ${fin(wn.bandwidthKHz) ? Math.round(wn.bandwidthKHz) : '-'} kHz, noise floor +${rise.toFixed(1)} dB, margin ${ch >= 0 ? '+' : ''}${ch.toFixed(1)} dB${rise >= 3 ? ' WARNING' : ''}`, severity: rise >= 3 ? 'warning' : rise >= 0.5 ? 'info' : 'ok' });
  }
  rows.push(...compressionRows(r.compression), ...extra, ...more);
  return rows;
}
