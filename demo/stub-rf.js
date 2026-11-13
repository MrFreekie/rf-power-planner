// Demo-only stub of js/model/rf.js: just enough geometry for the views (direct, floor, single-wall bounces).
const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function antennaGainDb(ant, b) {
  const d = Math.abs((((b.az - (ant.orientation?.az ?? 0)) % 360) + 540) % 360 - 180) * DEG;
  let rel = 0;
  if (ant.type === 'paddle' || ant.type === 'logperiodic') rel = 20 * Math.log10(Math.max(0.05, 0.5 * (1 + Math.cos(d))));
  else if (ant.type === 'helical') rel = 20 * Math.log10(Math.max(0.1, 0.5 * (1 + Math.cos(d)) ** 2));
  else if (ant.type === 'dipole') rel = 20 * Math.log10(Math.max(0.15, Math.abs(Math.cos(d + Math.PI / 2))));
  return ant.gainDbi + rel;
}

export function tracePaths(scene, link) {
  const t = link.tx.pos, r = link.rx.pos, out = [];
  const mk = (kind, pts, via) => ({ kind, via, points: pts, lengthM: pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0) });
  out.push(mk('direct', [t, r]));
  const f = t.z / (t.z + r.z);
  out.push(mk('floor', [t, { x: t.x + (r.x - t.x) * f, y: t.y + (r.y - t.y) * f, z: 0 }, r]));
  for (const w of scene.reflectors) {
    const ex = w.p2.x - w.p1.x, ey = w.p2.y - w.p1.y, l = Math.hypot(ex, ey), nx = -ey / l, ny = ex / l;
    const dt = (t.x - w.p1.x) * nx + (t.y - w.p1.y) * ny;
    const img = { x: t.x - 2 * dt * nx, y: t.y - 2 * dt * ny, z: t.z };
    const dr = (r.x - w.p1.x) * nx + (r.y - w.p1.y) * ny;
    if (dt * dr <= 0) continue; // same side required
    const k = (dt) / (dt + dr);
    const hit = { x: t.x + (r.x - t.x) * k, y: t.y + (r.y - t.y) * k };
    const q = ((hit.x - w.p1.x) * ex + (hit.y - w.p1.y) * ey) / (l * l);
    if (q < 0 || q > 1) continue;
    out.push(mk('wall', [t, { ...hit, z: t.z + (r.z - t.z) * k }, r], w.id));
  }
  return out;
}

export function solveLink(scene, link) {
  const lam = 299.792458 / link.freqMHz, d0 = dist(link.tx.pos, link.rx.pos);
  const paths = tracePaths(scene, link).map((p) => {
    const fspl = 20 * Math.log10((4 * Math.PI * p.lengthM) / lam);
    const refl = p.kind === 'direct' ? 0 : p.kind === 'floor' ? 6 : 4;
    return { ...p, gainDb: -fspl - refl, phaseRad: (2 * Math.PI * p.lengthM) / lam + (p.kind === 'direct' ? 0 : Math.PI), delayNs: p.lengthM / 0.2998 };
  });
  let re = 0, im = 0;
  const useAll = scene.environment.model === 'two-ray';
  for (const p of paths) { if (!useAll && p.kind !== 'direct') continue; const a = Math.pow(10, p.gainDb / 20); re += a * Math.cos(p.phaseRad); im += a * Math.sin(p.phaseRad); }
  const total = 20 * Math.log10(Math.hypot(re, im));
  paths.forEach((p) => { p.relDb = p.gainDb - paths[0].gainDb; });
  const brg = (a, b) => ({ az: Math.atan2(b.x - a.x, b.y - a.y) / DEG, el: Math.atan2(b.z - a.z, Math.hypot(b.x - a.x, b.y - a.y)) / DEG });
  const g = antennaGainDb(link.tx.antenna, brg(link.tx.pos, link.rx.pos)) + antennaGainDb(link.rx.antenna, brg(link.rx.pos, link.tx.pos));
  const rx = link.tx.powerDbm + g + total - link.rx.bodyLossDb - scene.environment.fadeMarginDb;
  const margin = rx - link.rx.sensitivityDbm;
  return {
    distanceM: d0, paths, pathLossDb: -total, fsplDb: -paths[0].gainDb, rxPowerDbm: rx, waterfall: [], inputPowerDbm: rx, marginDb: margin,
    status: margin < 0 ? 'fail' : margin < 6 ? 'marginal' : 'pass',
  };
}
