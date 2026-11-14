// Extra link-budget rows: polarisation, antenna mismatch (VSWR) and point-to-point geometry. Pure: result -> [{label, value, severity}].
// severity 'ok' | 'info' | 'warning' is always paired with words in the value, never colour alone.
const fin = Number.isFinite;
const POL_NAME = { vertical: 'vertical', horizontal: 'horizontal', slant45: 'slant 45', rhcp: 'right-hand circular', lhcp: 'left-hand circular' };

export function vswrText(m) {
  if (!m || !fin(m.vswr)) return null;
  const v = m.vswr > 99 ? '>99' : m.vswr.toFixed(m.vswr < 10 ? 2 : 1);
  return `VSWR ${v}:1, return loss ${fin(m.returnLossDb) ? m.returnLossDb.toFixed(1) : '-'} dB, mismatch ${fin(m.mismatchDb) ? m.mismatchDb.toFixed(1) : '-'} dB${m.inBand === false ? ' (out of band)' : ''}`;
}

export function budgetExtras(r) {
  const rows = [];
  if (!r) return rows;
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
  return rows;
}
