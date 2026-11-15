// Booster (active stage) gain compression. Pure module, no DOM.
//
// A real amplifier has a linear gain up to a point and then compresses: the output stops following the input. The 1 dB compression point
// (output referred, OP1dB) is the output power at which the gain has fallen by 1 dB. Datasheets of pro-audio boosters rarely give it, so it is derived
// from the output third-order intercept with the usual rule of thumb  OP1dB = OIP3 - 9.6 dB (the 1 dB point sits about 9.6 dB under the intercept for a
// memoryless third-order amplifier; flag I) and the OIP3 itself is the assumed +20 dBm unless the item or preset carries one (flag U).
//
// Model (a soft clipper, deliberately simple):
//   X = total linear output power of the stage (all signals summed, gain applied as if there were no compression), dBm
//   compression c(X) = 0                                   X <= OP1dB + 1 - kneeDb
//                    = 1 dB x ((X - (OP1dB + 1 - knee)) / knee)^2    up to X = OP1dB + 1  (exactly 1 dB at the 1 dB point, quadratic knee)
//                    = 1 + (X - OP1dB - 1)                 beyond (the output is pinned at OP1dB: 1 dB more compression per dB more drive)
// Every signal through the stage loses the same c dB (a strong signal desensitises the wanted one: gain compression of a weak signal by a strong one).
// Known simplifications: the compression is memoryless (no recovery time, no AM-to-PM), the knee width (10 dB) is assumed, and a signal outside the
// amplifier's passband is treated like an in-band one unless the chain has a filter (the chain gain at the interferer's frequency is used).

export const OP1DB_BELOW_OIP3_DB = 9.6; // rule of thumb, flag I
export const DEFAULT_OIP3_DBM = 20;     // assumed, flag U (the same default as cascadeChainIip3Dbm)
export const COMPRESSION_KNEE_DB = 10;  // assumed, flag U

/** compressionDb(linearOutDbm, op1dBDbm, kneeDb) -> gain reduction in dB (>= 0) of one stage for a total linear output level (dBm). */
export function compressionDb(linearOutDbm, op1dBDbm, kneeDb = COMPRESSION_KNEE_DB) {
  if (!Number.isFinite(linearOutDbm) || !Number.isFinite(op1dBDbm)) return 0;
  const one = op1dBDbm + 1, start = one - kneeDb;
  if (linearOutDbm <= start) return 0;
  if (linearOutDbm <= one) { const u = (linearOutDbm - start) / kneeDb; return u * u; }
  return 1 + (linearOutDbm - one);
}

/**
 * stageOp1dBDbm(item, gainDb) -> output P1dB (dBm) of an active chain item: item.op1dBDbm, else OIP3 - 9.6 with OIP3 = item.oip3Dbm, else item.iip3Dbm + gain, else 20.
 * Same order of precedence as cascadeChainIip3Dbm (iip3Dbm first), so the intercept and the compression point always belong together.
 */
export function stageOp1dBDbm(item, gainDb) {
  if (Number.isFinite(item && item.op1dBDbm)) return item.op1dBDbm;
  const g = Number.isFinite(gainDb) ? gainDb : (item && item.gainDb) || 0;
  const oip3 = Number.isFinite(item && item.iip3Dbm) ? item.iip3Dbm + g : Number.isFinite(item && item.oip3Dbm) ? item.oip3Dbm : DEFAULT_OIP3_DBM;
  return oip3 - OP1DB_BELOW_OIP3_DB;
}

/**
 * chainCompression(stages, signals, { kneeDb }) -> { stages: [...], totalDb, wantedIn, wantedOut, worst }
 *   stages  [{ label, gainDbs: number[] (the stage gain at each signal's frequency, one per signal, dB), op1dBDbm: number | null }]  (null: passive or linear)
 *   signals [{ id, levelDbm (at the chain input), freqMHz, wanted?: boolean }]
 * Returns per stage { label, inputDbm (total), linearOutDbm, op1dBDbm, compressionDb, headroomDb (OP1dB + 1 - linear output; negative once past the 1 dB point),
 * level 'ok' | 'hot' (inside the knee, under 1 dB) | 'compressed' (1 dB or more) } and totalDb = the compression summed over the stages, which is what the wanted
 * signal loses. wantedOut is the wanted level after the chain with the compression applied, dBm.
 */
export function chainCompression(stages, signals, { kneeDb = COMPRESSION_KNEE_DB } = {}) {
  const sig = (signals || []).map((s) => ({ ...s, level: s.levelDbm }));
  const out = [];
  let total = 0;
  const pw = (d) => Math.pow(10, d / 10);
  for (const st of stages || []) {
    const inPw = sig.reduce((a, s) => a + pw(s.level), 0);
    sig.forEach((s, i) => { s.level += Number.isFinite(st.gainDbs && st.gainDbs[i]) ? st.gainDbs[i] : 0; });
    const linPw = sig.reduce((a, s) => a + pw(s.level), 0);
    const inputDbm = inPw > 0 ? 10 * Math.log10(inPw) : -Infinity, linearOutDbm = linPw > 0 ? 10 * Math.log10(linPw) : -Infinity;
    let c = 0, headroomDb = null, level = 'ok';
    if (Number.isFinite(st.op1dBDbm)) {
      c = compressionDb(linearOutDbm, st.op1dBDbm, kneeDb);
      headroomDb = st.op1dBDbm + 1 - linearOutDbm;
      level = c >= 1 - 1e-9 ? 'compressed' : c > 0.05 ? 'hot' : 'ok';
      sig.forEach((s) => { s.level -= c; });
      total += c;
    }
    out.push({ label: st.label, inputDbm, linearOutDbm, op1dBDbm: Number.isFinite(st.op1dBDbm) ? st.op1dBDbm : null, compressionDb: c, headroomDb, level });
  }
  const w = sig.find((s) => s.wanted);
  const worst = out.reduce((a, s) => (!a || s.compressionDb > a.compressionDb ? s : a), null);
  return { stages: out, totalDb: total, wantedOut: w ? w.level : null, worst: worst && worst.compressionDb > 0 ? worst : null };
}
