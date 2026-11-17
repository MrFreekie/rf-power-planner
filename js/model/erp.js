// ERP / EIRP check of a transmit path against the regional limit (pure, no DOM).
//   radiated = Tx power - chain loss (IEM: the chain between transmitter and antenna) + Tx antenna gain; ERP limits are referenced
//   to a half-wave dipole (EIRP = ERP + 2.15 dB); 'conducted' limits (US Part 74 style) count the power at the antenna terminals only.
// A mic link's chain belongs to the receiver, so a mic is checked on Tx power plus antenna gain alone.
import { powerLimitDetailFor, ERP_TO_EIRP_DB, mwToDbm } from './bands.js';
import { chainLossDb, nominalGainDbi } from './rf.js';

/**
 * erpCheck(link, regionId) -> null | { eirpDbm, radiatedDbm, limitDbm, unit, chainLossDb, gainDbi, over, level, text }
 * null when the frequency or power is unusable or no range of the region covers the frequency. level: 'warn' above every limit figure,
 * 'info' above only the handheld figure of a mic (fine for a body-worn pack), else null. IEM transmitters are stationary, so the
 * handheld / other figure applies. Figures flagged draft or unverified in the text. Planning estimate.
 */
export function erpCheck(link, regionId) {
  if (!link || !link.tx || !Number.isFinite(link.freqMHz) || !Number.isFinite(link.tx.powerDbm)) return null;
  const d = powerLimitDetailFor(regionId, link.freqMHz);
  if (!d) return null;
  const iem = link.kind === 'iem';
  const loss = iem ? chainLossDb(link.chain, link.freqMHz) : 0;
  const g = link.tx.antenna ? nominalGainDbi(link.tx.antenna) : 0; // the library gain and the ground-plane table count, not just a typed gainDbi
  const atAnt = link.tx.powerDbm - loss, eirp = atAnt + g;
  const radiated = d.unit === 'conducted' ? atAnt : d.unit === 'ERP' ? eirp - ERP_TO_EIRP_DB : eirp;
  const hand = mwToDbm(d.handheldMw), top = mwToDbm(Math.max(d.handheldMw, d.bodyWornMw));
  const status = d.verified === true ? '' : d.verified === 'draft' ? ' (draft figure)' : ' (unverified figure)';
  const f1 = (x) => x.toFixed(1);
  const parts = `Tx ${f1(link.tx.powerDbm)} dBm${iem && loss ? ` ${loss >= 0 ? '-' : '+'} ${f1(Math.abs(loss))} dB chain` : ''}${d.unit === 'conducted' ? '' : ` + ${f1(g)} dBi antenna`}`;
  let level = null, text = `${parts} = ${f1(radiated)} dBm ${d.unit} (limit ${f1(top)} dBm ${d.unit}${status}).`;
  if (radiated > top + 0.05) { level = 'warn'; text = `Radiated power is above the limit: ${text}`; }
  else if (!iem && radiated > hand + 0.05) { level = 'info'; text = `Above the handheld figure (${f1(hand)} dBm ${d.unit}), so only for a body-worn pack: ${text}`; }
  return { eirpDbm: eirp, radiatedDbm: radiated, limitDbm: top, unit: d.unit, chainLossDb: loss, gainDbi: g, over: level === 'warn', level, text };
}
