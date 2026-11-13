// Squelch gate with hysteresis. Pure module (no DOM).
// Carrier squelch: opens when level >= threshold; once open, stays open until level < threshold - hysteresis.
// Optional pilot squelch: the gate additionally requires a locked stereo pilot.

export const DEFAULT_SQUELCH = { enabled: true, thresholdDbm: -90, hysteresisDb: 3 };

/**
 * squelchState(prevCarrierOpen, levelDbm, squelch, { pilotRequired, pilotLocked }) ->
 *   { open, carrierOpen, headroomDb, reason }
 * headroomDb = level - threshold (negative while below the threshold). A disabled squelch is always open
 * (the pilot is ignored too). A non-finite level is treated as closed. prevCarrierOpen is the previous
 * carrierOpen (not the final open) so hysteresis is unaffected by the pilot.
 * reason: null while open, 'carrier' when the level is too low, 'pilot' when the carrier is fine but the pilot is not locked.
 */
export function squelchState(prevCarrierOpen, levelDbm, squelch, { pilotRequired = false, pilotLocked = true } = {}) {
  const q = { ...DEFAULT_SQUELCH, ...(squelch || {}) };
  const level = Number.isFinite(levelDbm) ? levelDbm : -Infinity;
  const headroomDb = level - q.thresholdDbm;
  if (!q.enabled) return { open: true, carrierOpen: true, headroomDb, reason: null };
  const hyst = Math.max(0, q.hysteresisDb || 0);
  const carrierOpen = prevCarrierOpen ? level >= q.thresholdDbm - hyst : level >= q.thresholdDbm;
  const pilotOk = !pilotRequired || !!pilotLocked;
  const open = carrierOpen && pilotOk;
  return { open, carrierOpen, headroomDb, reason: open ? null : carrierOpen ? 'pilot' : 'carrier' };
}
