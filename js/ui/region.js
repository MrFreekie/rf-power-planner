// Regulatory presentation helpers (pure, no DOM): licence class text, verification warnings, power lines, the region the user is
// working in (shared between the coordination panel and the inspector), and the Tx power limit hint.
// Figures come from js/model/bands.js and are planning estimates; nothing here asserts a regulator's current rules.
import { powerLimitDetailFor, rangeAt, REGIONS, BAND_SOURCES } from '../model/bands.js';

export const LICENCE_TEXT = Object.freeze({
  exempt: { label: 'Licence-exempt', meaning: 'No licence needed if the technical limits are met.' },
  shared: { label: 'Shared licence', meaning: 'UK shared microphone licence: non-protected, so others may use the same spectrum.' },
  coordinated: { label: 'Coordinated', meaning: 'Site-specific licence with protection: frequencies are coordinated for your event.' },
  'high-power': { label: 'High power', meaning: 'Coordinated use at up to 1 W.' },
});

export const licenceInfo = (cls) => LICENCE_TEXT[cls] || { label: 'Licence not recorded', meaning: 'Check the regulator for the licence this band needs.' };

const mw = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
const dateText = (d) => (d ? ` (as of ${d})` : '');

/** { level: 'verified'|'draft'|'unverified', label, warn, sourceText } from a powerLimitDetailFor result. */
export function verificationInfo(detail) {
  if (!detail) return { level: 'unverified', label: 'Unverified', warn: true, sourceText: '' };
  const src = detail.sourceTitle ? `${detail.sourceTitle}${dateText(detail.asOf)}` : '';
  if (detail.verified === true) return { level: 'verified', label: 'Verified against the source', warn: false, sourceText: src };
  if (detail.verified === 'draft') return { level: 'draft', label: 'Draft IR 2030: not final, check the as-made rules', warn: true, sourceText: src };
  return { level: 'unverified', label: 'Unverified: planner estimate, not read from a regulator source', warn: true, sourceText: src };
}

/** 'handheld 10 mW / body-worn 50 mW ERP' (one figure when both are equal). */
export function powerLine(detail) {
  if (!detail) return '';
  const h = detail.handheldMw, b = detail.bodyWornMw;
  return h === b ? `${mw(h)} mW ${detail.unit}` : `handheld ${mw(h)} mW / body-worn ${mw(b)} mW ${detail.unit}`;
}

/** Detail for a whole range (looked up at its centre). */
export function rangeDetail(regionId, range) {
  return range ? powerLimitDetailFor(regionId, (range.fromMHz + range.toMHz) / 2) : null;
}

/** Limit text for one channel in the result table, using the body-worn column when asked (mic transmitters only). */
export function limitText(regionId, freqMHz, { bodyWorn = false, kind = 'mic' } = {}) {
  if (!Number.isFinite(freqMHz)) return '-';
  const d = powerLimitDetailFor(regionId, freqMHz);
  if (!d) return '-';
  const v = bodyWorn && kind === 'mic' ? d.bodyWornMw : d.handheldMw;
  const tag = d.verified === true ? '' : d.verified === 'draft' ? ' (draft)' : ' (unverified)';
  return `${mw(v)} mW ${d.unit}${tag}`;
}

// The region shared by the panels (UK by default). The coordination panel sets it; the inspector reads it.
let current = 'uk';
const listeners = new Set();
export const getCoordRegion = () => current;
export function setCoordRegion(id) {
  if (!REGIONS[id] || id === current) return;
  current = id;
  for (const f of [...listeners]) f(id);
}
export const onCoordRegion = (f) => { listeners.add(f); return () => listeners.delete(f); };

/** ERP is referenced to a half-wave dipole, EIRP to an isotropic radiator: EIRP = ERP + 2.15 dB. */
export const ERP_TO_EIRP_DB = 2.15;

/**
 * txLimitHint(regionId, freqMHz, txPowerDbm, antennaGainDbi) -> { text, over: boolean, level } | null
 * null when the frequency is outside every range of the region. Radiated power = Tx power + antenna gain (EIRP), minus 2.15 dB for an ERP limit.
 */
export function txLimitHint(regionId, freqMHz, txPowerDbm, antennaGainDbi = 0) {
  const d = Number.isFinite(freqMHz) ? powerLimitDetailFor(regionId, freqMHz) : null;
  if (!d) return null;
  const v = verificationInfo(d);
  const name = (REGIONS[regionId] && REGIONS[regionId].name || regionId).replace(/ \(approx\)/, '');
  const status = v.level === 'verified' ? 'verified' : v.level === 'draft' ? 'draft IR 2030' : 'unverified';
  const lim = d.handheldMw === d.bodyWornMw ? `${mw(d.handheldMw)} mW` : `${mw(d.handheldMw)} mW handheld / ${mw(d.bodyWornMw)} mW body-worn`;
  let text = `${name} limit for this band: ${lim} ${d.unit}, ${status}.`;
  let over = false;
  if (Number.isFinite(txPowerDbm)) {
    const eirp = txPowerDbm + (Number.isFinite(antennaGainDbi) ? antennaGainDbi : 0);
    const rad = d.unit === 'ERP' ? eirp - ERP_TO_EIRP_DB : eirp;
    const radMw = Math.pow(10, rad / 10);
    const top = Math.max(d.handheldMw, d.bodyWornMw);
    if (radMw > top * 1.0001) { over = true; text += ` Tx power plus antenna gain is about ${mw(radMw)} mW ${d.unit}, above that limit.`; }
    else if (radMw > d.handheldMw * 1.0001) text += ` About ${mw(radMw)} mW ${d.unit} radiated: above the handheld figure, so only for a body-worn transmitter.`;
  }
  return { text, over, level: v.level };
}

export { rangeAt, BAND_SOURCES };
