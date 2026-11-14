// FM capture by a stray interferer on the same channel. Pure module (no DOM).
//
// FM receivers show the capture effect: the stronger of two co-channel carriers suppresses the weaker one. Within about the
// capture ratio of each other (1.5 to 6 dB, typically 3) neither wins and the audio is a garbled beat of both. A carrier-level
// squelch only sees the total carrier (about the stronger one), so it opens for an interferer even when the wanted audio is
// gone. A pilotless interferer additionally takes the stereo pilot away (see mpxState).
// Parameters: INTERFERER_PARAMS and captureSuppressionDb in mpx-params.js.

import { INTERFERER_PARAMS, captureSuppressionDb } from './mpx-params.js';

export const DEFAULT_CAPTURE_RATIO_DB = INTERFERER_PARAMS.captureRatioDb.typical;
// Audio suppression of the weaker signal (dB) below which the audio is garbled and above which it is clean (approx).
export const GARBLED_BELOW_SUPPRESSION_DB = 10;
export const CLEAN_ABOVE_SUPPRESSION_DB = INTERFERER_PARAMS.suppressionAtCaptureDb; // 30 dB: defines the capture ratio

const smooth = (t) => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); };

/**
 * captureState(wantedDbm, interfererDbm, { captureRatioDb })
 *   -> { captured: 'wanted' | 'interferer' | 'none', cirDb, suppressionDb, audioQuality, carrierLevelDbm }
 * captureRatioDb defaults to INTERFERER_PARAMS.captureRatioDb.typical (3 dB); pass the receiver preset's value.
 * cirDb = wanted - interferer. captured: 'wanted' when cirDb >= captureRatioDb, 'interferer' when cirDb <= -captureRatioDb,
 * else 'none' (garbled beat).
 * suppressionDb = captureSuppressionDb(cirDb, captureRatioDb): the wanted-to-interferer AUDIO ratio, odd symmetric, 0 at equal
 * level and 30 dB at the capture ratio by definition. audioQuality (0..1, of the WANTED audio) = smoothstep of
 * (suppression - 10) / (30 - 10): 0 when the interferer is as loud or louder in the audio, garbled below 10 dB, clean from 30 dB,
 * so quality is 1 right at the capture ratio. carrierLevelDbm = max(wanted, interferer): what a carrier squelch sees.
 * A missing interferer (non-finite level) gives captured 'wanted', quality 1.
 */
export function captureState(wantedDbm, interfererDbm, { captureRatioDb = DEFAULT_CAPTURE_RATIO_DB } = {}) {
  if (!Number.isFinite(interfererDbm)) {
    return { captured: 'wanted', cirDb: Infinity, suppressionDb: Infinity, audioQuality: 1, carrierLevelDbm: wantedDbm };
  }
  const w = Number.isFinite(wantedDbm) ? wantedDbm : -Infinity;
  const cir = w - interfererDbm;
  const captured = cir >= captureRatioDb ? 'wanted' : cir <= -captureRatioDb ? 'interferer' : 'none';
  const suppressionDb = Number.isFinite(cir) ? captureSuppressionDb(cir, captureRatioDb) : cir;
  const audioQuality = smooth((suppressionDb - GARBLED_BELOW_SUPPRESSION_DB) / (CLEAN_ABOVE_SUPPRESSION_DB - GARBLED_BELOW_SUPPRESSION_DB));
  return { captured, cirDb: cir, suppressionDb, audioQuality, carrierLevelDbm: Math.max(w, interfererDbm) };
}
