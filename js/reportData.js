// Report data: everything a printable link-budget report needs, as plain data. Pure (no DOM).
//   buildReportData(scene, linkId, results = {}) -> {
//     title, date, scenario: [{label, value}], platforms: [{name, x, y, width, depth, topM, material, text}], assumptions: [string], waterfall: [{label, valueDbm, deltaDb, valueText, deltaText}],
//     margin: {marginDb, status, rxPowerDbm, inputPowerDbm, sensitivityDbm, text}, warnings: [{kind, severity, text}],
//     zones: [{name, passFraction, pass, minDbm, requiredDbm, text}], intermod: [{product, channel, offsetKHz, ciDb, severity, text}],
//     disclaimer }
// `results` is optional; pass what the trackers already hold to avoid recomputing:
//   { link: LinkResult, squelch: squelch.get(id), rx: rxState.get(id), digital: digital.get(id), telemetry: telemetry.get(id),
//     coverage: coverage.get(id), imd: imd.get(), now: Date | ISO string }
import { solveLink } from './model/rf.js';
import { formatPower, formatLength, formatDb } from './model/units.js';

export const DISCLAIMER = 'Planning estimates only. The models are simplified and the parameters are generic; real propagation, hardware and local regulations vary. Verify critical coverage and frequency coordination with measurements on site.';

const fin = Number.isFinite;

function dateText(now) {
  const d = now instanceof Date ? now : now ? new Date(now) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/** Build the report for one link. Never throws: a link that cannot be solved yields a report with an error warning. */
export function buildReportData(scene, linkId, results = {}) {
  const link = (scene.links || []).find((l) => l.id === linkId) || (scene.links || [])[0];
  const u = scene.units || { power: 'dBm', length: 'm' };
  const out = {
    title: link ? `Link budget: ${link.name}` : 'Link budget', date: dateText(results.now), scenario: [], platforms: [], assumptions: [], waterfall: [],
    margin: null, warnings: [], zones: [], intermod: [], disclaimer: DISCLAIMER,
  };
  if (!link) {
    out.warnings.push({ kind: 'error', severity: 'critical', text: 'The scene has no link to report on.' });
    return out;
  }
  let res = results.link || null;
  if (!res) {
    try { res = solveLink(scene, link); } catch (e) { out.warnings.push({ kind: 'error', severity: 'critical', text: `The link could not be solved: ${e.message}` }); }
  }
  const env = scene.environment || {};
  const pw = (dbm) => formatPower(dbm, u.power);

  // scenario summary
  const S = out.scenario;
  S.push({ label: 'Link', value: `${link.name} (${link.kind === 'iem' ? 'in-ear monitor' : 'wireless microphone'})` });
  S.push({ label: 'Frequency', value: `${link.freqMHz} MHz` });
  S.push({ label: 'Transmitter', value: `${link.tx.name}, ${pw(link.tx.powerDbm)}, antenna ${link.tx.antenna.type}` });
  S.push({ label: 'Receiver', value: `${link.rx.name}, sensitivity ${pw(link.rx.sensitivityDbm)}, antenna ${link.rx.antenna.type}` });
  if (res) S.push({ label: 'Distance', value: formatLength(res.distanceM, u.length) });
  const deck = fin(scene.stage.heightM) ? scene.stage.heightM : 0;
  S.push({ label: 'Stage', value: `${formatLength(scene.stage.width, u.length)} by ${formatLength(scene.stage.depth, u.length)}${deck > 0 ? `, deck ${formatLength(deck, u.length)} above ground` : ''}` });
  S.push({ label: 'Chain', value: (link.chain || []).length ? link.chain.map((c) => (c.kind === 'cable' ? `${c.cableType} ${formatLength(c.lengthM, u.length)}` : c.kind)).join(', ') : 'none' });
  if (Array.isArray(link.branches) && link.branches.length > 1) S.push({ label: 'Transmit antennas', value: `${link.branches.length} branches through a splitter` });
  if (link.rx.diversity && link.rx.diversity.enabled) S.push({ label: 'Receive diversity', value: `${link.rx.diversity.mode}` });
  if (link.modulation) S.push({ label: 'Modulation', value: link.modulation.type === 'digital' ? `digital (${link.modulation.digital.preset})` : 'analog FM' });

  // assumptions
  const A = out.assumptions;
  A.push(env.model === 'free-space' ? 'Propagation: free space (no ground or wall reflections).' : `Propagation: two-ray with ${env.floor} floor, ${env.polarisation} polarisation, plus single-bounce reflections from ${(scene.reflectors || []).length} wall(s); paths are summed coherently.`);
  const plats = Array.isArray(scene.platforms) ? scene.platforms : [];
  A.push(`Item heights are measured above the local floor (${deck > 0 ? `the stage deck, ${formatLength(deck, u.length)} above ground, or ` : 'the stage floor or '}the top of the platform an item stands on); the ground is the reference for reflections.`);
  out.platforms = plats.map((p) => ({
    name: p.name, x: p.x, y: p.y, width: p.width, depth: p.depth, topM: p.topM, material: p.material,
    text: `${p.name}: ${formatLength(p.width, u.length)} by ${formatLength(p.depth, u.length)} at (${p.x}, ${p.y}), top ${formatLength(p.topM, u.length)} above ground, ${p.material}.`,
  }));
  if (plats.length) A.push(`${plats.length} raised platform(s) change the floor height and add reflecting surfaces; see the platform table.`);
  A.push(`Carrier frequency ${link.freqMHz} MHz; distances in metres internally, displayed in ${u.length}; powers displayed in ${u.power}.`);
  const bodyEnv = env.bodyLossDb || 0, bodyRx = link.rx.bodyLossDb || 0;
  A.push(`Body loss is added on top of the antenna pattern: ${bodyEnv} dB scene-wide plus ${bodyRx} dB at the receiver (${bodyEnv + bodyRx} dB total); fade margin ${env.fadeMarginDb || 0} dB.`);
  A.push('Antenna gains and patterns come from the built-in library, cable loss is interpolated from typical attenuation tables, and wall losses use generic material values.');
  if (link.rx.squelch && link.rx.squelch.enabled) A.push(`Squelch threshold ${pw(link.rx.squelch.thresholdDbm)} with ${link.rx.squelch.hysteresisDb} dB hysteresis.`);
  if (res && res.cascade) A.push(`Receiver noise: system noise figure ${formatDb(res.cascade.systemNfDb)} from the cascade of the chain and receiver.`);
  A.push('All model parameters are generic and illustrative, not product specifications.');

  if (res) {
    out.waterfall = (res.waterfall || []).map((w) => ({
      label: w.label, valueDbm: w.valueDbm, deltaDb: w.deltaDb, valueText: pw(w.valueDbm), deltaText: formatDb(w.deltaDb),
    }));
    out.margin = {
      marginDb: res.marginDb, status: res.status, rxPowerDbm: res.rxPowerDbm, inputPowerDbm: res.inputPowerDbm, sensitivityDbm: link.rx.sensitivityDbm,
      text: `Input ${pw(res.inputPowerDbm)} against sensitivity ${pw(link.rx.sensitivityDbm)}: margin ${formatDb(res.marginDb)} (${res.status}).`,
    };
    if (res.status === 'fail') out.warnings.push({ kind: 'margin', severity: 'critical', text: `The link fails: ${formatDb(res.marginDb)} below the receiver sensitivity.` });
    else if (res.status === 'marginal') out.warnings.push({ kind: 'margin', severity: 'warning', text: `Marginal link: only ${formatDb(res.marginDb)} of headroom (less than 6 dB).` });
  }

  const W = out.warnings;
  const sq = results.squelch;
  if (sq && !sq.open) W.push({ kind: 'squelch', severity: 'warning', text: `The squelch is closed (reason: ${sq.reason || 'carrier'}); the audio is muted in this position.` });
  const ov = results.rx && results.rx.overload;
  if (ov && ov.level === 'overload') W.push({ kind: 'overload', severity: 'critical', text: `Receiver overload: ${formatDb(ov.headroomDb)} of headroom, ${ov.compressionDb.toFixed(1)} dB compression, ${ov.distortionPct.toFixed(0)} % distortion.` });
  else if (ov && ov.level === 'hot') W.push({ kind: 'overload', severity: 'warning', text: `Receiver input is hot: only ${formatDb(ov.headroomDb)} below the overload point.` });
  const dg = results.digital;
  if (dg && (dg.state === 'down' || dg.state === 'concealing')) W.push({ kind: 'digital', severity: dg.state === 'down' ? 'critical' : 'warning', text: `Digital link ${dg.state} (CNR ${formatDb(dg.cnrDb)}).` });
  const tel = results.telemetry;
  if (tel && tel.battery && (tel.battery.lowWarning || tel.battery.dead)) W.push({ kind: 'battery', severity: tel.battery.dead ? 'critical' : 'warning', text: `Transmitter battery ${tel.battery.dead ? 'is flat' : 'is low'} (${tel.battery.percentReported} % reported).` });

  const cov = results.coverage;
  if (cov) {
    if (cov.undersampled) W.push({ kind: 'coverage', severity: 'info', text: 'The coverage grid is coarser than a quarter wavelength, so narrow fades between grid points are not shown.' });
    if (cov.fineCoverage === 'zones-only') W.push({ kind: 'coverage', severity: 'info', text: 'Fine coverage resolution was computed inside the zones only; the rest of the venue is shown at 1 m resolution.' });
    for (const z of cov.zones || []) {
      const zone = (scene.zones || []).find((x) => x.id === z.zoneId);
      const name = zone ? zone.name : z.zoneId;
      const st = z.stats;
      const req = z.requirement ? z.requirement.requiredDbm : NaN;
      const text = `${name}: ${(st.passFraction * 100).toFixed(0)} % of the area passes (weakest ${fin(st.minDbm) ? pw(st.minDbm) : 'n/a'}, required ${fin(req) ? pw(req) : 'n/a'}).`;
      out.zones.push({ name, passFraction: st.passFraction, pass: st.pass, minDbm: st.minDbm, requiredDbm: req, text });
      if (!st.pass) W.push({ kind: 'zone', severity: 'critical', text: `Zone check failed: ${text}` });
    }
  }

  const im = results.imd;
  if (im && im.enabled) {
    const names = new Map(((scene.imd && scene.imd.transmitters) || []).map((t) => [t.id, t.name]));
    for (const c of (im.coordination || []).slice(0, 12)) {
      const label = c.product && c.product.label ? c.product.label : 'product';
      const channel = names.get(c.channelId) || c.channelId;
      out.intermod.push({ product: label, channel, offsetKHz: c.offsetKHz, ciDb: c.ciDb, severity: c.severity, text: `${label} lands ${Math.abs(c.offsetKHz).toFixed(0)} kHz from ${channel} with a carrier-to-interference ratio of ${formatDb(c.ciDb)} (${c.severity}).` });
    }
    const bad = (im.coordination || []).filter((c) => c.severity === 'critical' || c.severity === 'warning');
    if (bad.length) W.push({ kind: 'intermod', severity: bad.some((c) => c.severity === 'critical') ? 'critical' : 'warning', text: `${bad.length} intermodulation product(s) fall on used channels; see the coordination table.` });
    if (im.noise && im.noise.riseDb > 3) W.push({ kind: 'intermod', severity: 'warning', text: `Intermodulation and transmitter noise raise the receiver noise floor by ${formatDb(im.noise.riseDb)} at the worst channel.` });
  }
  return out;
}
