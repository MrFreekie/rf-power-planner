// Typed angles wrap round the circle: -90 means 270, 450 means 90. A value already inside the field's range is left alone (so 360 stays 360).
/** wrapAngle(v, period, lo, hi): v unchanged when period is falsy, not finite, or lo <= v <= hi; else v folded into [lo, lo + period). */
export function wrapAngle(v, period, lo, hi) {
  if (!period || !Number.isFinite(v) || (v >= lo && v <= hi)) return v;
  const r = lo + ((((v - lo) % period) + period) % period);
  return Math.round(r * 1e6) / 1e6;
}
