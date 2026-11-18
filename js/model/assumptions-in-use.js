// Assumptions in use: which assumed (U) or inferred (I) figures actually influenced the results of THIS scene, in plain language. Pure module, no DOM.
//
//   assumptionsInUse(scene, results?) -> [{ id, label, value, flag: 'U' | 'I', effect, sensitivityDb | null, fix, linkIds: [..] }]
//   assumptionsForLink(items, linkId) -> the items that touch one link
//   marginIsProven(link, result, items?) -> { proven, marginDb, bodyWorn, sumSensitivityDb, reasons: [..] }
//   confidenceSummary(scene, results?) -> [{ linkId, name, marginDb, proven, reasons, assumptionIds }]
//
// `results` = the solveLink results: an array in scene.links order, a Map or an object keyed by link id; a link without one is solved here.
// An assumption is listed only when it changed a figure of that link (a body loss of 0 is not listed, an unused booster is not listed, a link with no
// noise source lists none of the noise assumptions). Flag: U = assumed with no source behind it, I = inferred from a rule of thumb or a published range.
// sensitivityDb = a plausible size of the error this figure could add to or take off the margin, dB (a stated rule of thumb for each item, not a bound),
// or null when it cannot be put as a single number. marginIsProven() combines them with combineSensitivity(): root sum of squares between independent mechanisms, a linear sum inside one mechanism.
import { CROWD_CAVEAT } from './crowd.js';
import { solveLink, bodyCouplingLossDb, externalNoiseNfDb, DEFAULT_XPD_DB } from './rf.js';
import { digitalConfigOf, digitalProfile } from './digital-link.js';
import { COMPRESSION_KNEE_DB, OP1DB_BELOW_OIP3_DB, DEFAULT_OIP3_DBM } from './compression.js';

/** A margin under this on a body-worn link is not called proven (dB). */
export const PROVEN_BODY_WORN_MARGIN_DB = 10;

const r1 = (x) => Math.round(x * 10) / 10;
const fmt = (x) => r1(x).toFixed(1);

// Items for one link and its result. Each is a plain object; linkIds is filled by the caller.
function itemsForLink(scene, link, res) {
  const out = [];
  const env = scene.environment || {};
  const add = (o) => out.push({ sensitivityDb: null, ...o });
  const isP2p = link.kind === 'p2p';

  // Body, contact and dampness loss
  if (!isP2p) {
    const c = bodyCouplingLossDb(env, link.tx.antenna, link.rx);
    if (c.totalDb > 0) {
      add({
        id: 'body-loss', label: 'Body and antenna-contact loss', value: `${fmt(c.totalDb)} dB`, flag: 'U', sensitivityDb: r1(Math.min(c.totalDb, Math.max(3, 0.5 * c.totalDb))), effectDb: r1(c.totalDb),
        effect: `${fmt(c.totalDb)} dB is taken off this link for the performer's body (scene setting, antenna contact or dampness). Real body-worn loss changes with posture, antenna type and frequency, so the margin could be several dB better or worse.`,
        fix: 'A walk test with the actual pack and antenna at the show frequency, or a published on-body range measurement for that antenna.',
      });
    }
  }

  // Cross-polar floor: only when the polarisation loss is large enough to be set by it
  if (res.polarisation && res.polarisation.lossDb >= 10) {
    add({
      id: 'cross-polar-floor', label: 'Cross-polar discrimination floor', value: `${DEFAULT_XPD_DB} dB`, flag: 'U', sensitivityDb: r1(Math.min(5, res.polarisation.lossDb)), effectDb: r1(res.polarisation.lossDb),
      effect: `The antennas are close to cross-polarised (${fmt(res.polarisation.lossDb)} dB of polarisation loss). The model never lets a mismatch cost more than an assumed ${DEFAULT_XPD_DB} dB because indoor reflections depolarise the signal; a real pair could be 5 dB either side.`,
      fix: 'The cross-polar discrimination figure on the antenna datasheet, and a measured depolarisation figure for the venue.',
    });
  }

  // Booster compression and its output intercept
  const comp = res.compression;
  if (comp && comp.totalDb > 0.05) {
    const w = comp.worst;
    add({
      id: 'booster-compression', label: 'Booster output intercept and compression', value: `output 1 dB point ${w && Number.isFinite(w.op1dBDbm) ? fmt(w.op1dBDbm) : fmt(DEFAULT_OIP3_DBM - OP1DB_BELOW_OIP3_DB)} dBm`, flag: 'U', sensitivityDb: r1(comp.totalDb), effectDb: r1(comp.totalDb),
      effect: `A strong signal at the antenna (${fmt(comp.strongest.rawDbm)} dBm) drives a booster into compression and costs the wanted signal ${fmt(comp.totalDb)} dB. The booster's output intercept is an assumed figure (the 1 dB point is taken ${OP1DB_BELOW_OIP3_DB} dB below it, with a ${COMPRESSION_KNEE_DB} dB soft knee), so the loss moves about 1 dB for each dB the real point differs.`,
      fix: 'The booster datasheet output P1dB or OIP3 at the working gain (enter it as the output 1 dB point on the chain item).',
    });
  }

  // Noise sources: levels, selectivity, TV block level, wall emission
  const ns = res.noiseSources;
  if (ns && ns.riseDb > 0.1) {
    add({
      id: 'noise-source-levels', label: 'Noise-source levels and duty', value: `${fmt(ns.averageDbm)} dBm average in the channel`, flag: 'U', sensitivityDb: r1(Math.min(ns.riseDb, 6)), group: 'noise-floor', effectDb: r1(ns.riseDb),
      effect: `The listed noise sources raise the receiver noise floor by ${fmt(ns.riseDb)} dB. Their powers and duty cycles are catalogue figures, not measurements of the equipment at this site.`,
      fix: 'A spectrum-analyser scan at the receive antenna during a show, or the type-approval power and the real duty of each emitter.',
    });
    const offChannel = (ns.sources || []).filter((x) => !x.inChannel && Number.isFinite(x.averageDbm) && x.averageDbm > ns.floorBeforeDbm - 6);
    if (offChannel.length) {
      add({
        id: 'selectivity', label: 'Receiver off-channel selectivity', value: 'assumed rolloff, 20 dB plus 20 log10(offset / half bandwidth), capped at 90 dB', flag: 'U', sensitivityDb: r1(Math.min(ns.riseDb, 10)), group: 'noise-floor', effectDb: r1(ns.riseDb),
        effect: `${offChannel.length} source${offChannel.length > 1 ? 's' : ''} outside the channel count only after an assumed filter rejection. A real receiver rejects far-off carriers more (good preselector) and near ones less, so the noise-floor rise could differ by several dB.`,
        fix: 'The receiver adjacent-channel and blocking figures (dB at 1, 2 and 5 MHz offset) from its datasheet, or its tuning-range filter response.',
      });
    }
    if ((ns.sources || []).some((x) => x.kind === 'dtv-broadcast' && Number.isFinite(x.averageDbm) && x.averageDbm > ns.floorBeforeDbm - 6)) {
      add({
        id: 'tv-block-level', label: 'Digital TV block level (illustration)', value: 'placeholder level', flag: 'U', sensitivityDb: r1(Math.min(ns.riseDb, 10)), group: 'noise-floor', effectDb: r1(ns.riseDb),
        effect: 'A digital TV block is modelled as noise across its whole channel at a level you set, not a measured field strength. Occupancy and level change with place and time, so this is an illustration of the effect.',
        fix: 'A measured TV field strength at the site, or the coverage prediction and licence data for the transmitters.',
      });
    }
  }
  if (res.wallNoise && res.wallNoise.riseDb > 0.1) {
    add({
      id: 'wall-emission', label: 'Video-wall emission', value: `floor +${fmt(res.wallNoise.riseDb)} dB`, flag: 'I', sensitivityDb: r1(Math.min(res.wallNoise.riseDb, 6)), group: 'noise-floor', effectDb: r1(res.wallNoise.riseDb),
      effect: `The video wall raises the noise floor by ${fmt(res.wallNoise.riseDb)} dB using a class limit as its emission, not a test of this product. A wall that meets the limit comfortably is quieter; a damaged or cheap one is louder.`,
      fix: 'The emission test report for the wall product at the stated distance, and a scan at the receive antenna with the wall on.',
    });
  }

  // External noise (new scenes default to an urban figure)
  const f = link.freqMHz;
  if (!isP2p && typeof env.externalNoise === 'string' && Number.isFinite(f)) {
    const ext = externalNoiseNfDb(env, f);
    if (ext > 0.5) {
      add({
        id: 'external-noise', label: 'External noise preset', value: `${env.externalNoise}, ${fmt(ext)} dB above thermal`, flag: 'I', sensitivityDb: r1(Math.min(ext, 6)),
        effect: `The "${env.externalNoise}" noise preset puts the background at ${fmt(ext)} dB above the receiver's thermal noise. It is a typical value for that kind of site, not a measurement of this one.`,
        fix: 'A noise-floor measurement at the receive antenna with the transmitters off (spectrum analyser, in the band of use).',
      });
    }
  }

  // Wall and audience loss on the direct path
  const maxOf = (k) => (res.paths || []).reduce((a, p) => Math.max(a, Number.isFinite(p[k]) ? p[k] : 0), 0);
  const wallDb = Math.max(0, maxOf('wallLossDb') - maxOf('platformLossDb') - maxOf('crowdLossDb'));
  if (wallDb > 0.05) {
    add({
      id: 'wall-loss', label: 'Wall transmission loss', value: `${fmt(wallDb)} dB`, flag: 'I', sensitivityDb: r1(Math.min(wallDb, Math.max(2, 0.3 * wallDb))), effectDb: r1(wallDb),
      effect: `The path goes through a wall that costs ${fmt(wallDb)} dB from a library of typical building-material figures. Real walls with the same name differ by several dB (moisture, rebar, thickness).`,
      fix: 'A transmit-and-receive test across the actual wall at the show frequency.',
    });
  }
  const audDb = maxOf('crowdLossDb');
  if (audDb > 0.05) {
    add({
      id: 'audience-loss', label: 'Audience absorption', value: `${fmt(audDb)} dB`, flag: 'U', sensitivityDb: r1(Math.min(audDb, Math.max(2, 0.5 * audDb))), effectDb: r1(audDb),
      effect: `A crowd on the path is assumed to absorb ${fmt(audDb)} dB (a fixed figure per metre of crowd, capped). Real absorption depends on crowd density, clothing and height of the antennas.`,
      fix: 'A measured crowd-loss trial at the venue, or a published crowd-attenuation survey at the carrier frequency.',
    });
  }

  const crowdDb = maxOf('crowdLossDb');
  if (crowdDb > 0.05) {
    add({
      id: 'crowd-loss', label: 'Crowd absorption', value: `${fmt(crowdDb)} dB`, flag: 'U', sensitivityDb: r1(Math.min(crowdDb, Math.max(3, 0.5 * crowdDb))), effectDb: r1(crowdDb),
      effect: `The path runs through a crowd zone that is assumed to absorb ${fmt(crowdDb)} dB. ${CROWD_CAVEAT}`,
      fix: 'An on-site scan with a beacon transmitter through the audience (seated and standing), and antennas raised clear of the heads.',
    });
  }

  // Digital mode thresholds
  if (link.modulation && link.modulation.type === 'digital') {
    const p = digitalProfile(digitalConfigOf(link));
    add({
      id: 'digital-cliff', label: 'Digital mode threshold (cliff)', value: `drops out near ${fmt(p.concealInputDbm)} dBm at the receiver`, flag: 'U', sensitivityDb: 2,
      effect: `The digital link is modelled with an assumed constellation and error-correcting code, so it is clean until about ${fmt(p.concealInputDbm)} dBm and then fails within about ${fmt(p.cliffWidthDb)} dB. A real product's cliff is at a different level.`,
      fix: "The maker's stated receive threshold (sensitivity at a stated frame-error rate) for the mode in use.",
    });
  }

  return out;
}

/** resultAt(results, scene, i) -> the given solveLink result for scene.links[i] (array in link order, Map or object keyed by link id), or undefined. Shared with plan-export.js. */
export const resultAt = (results, scene, i) => {
  const l = scene.links[i];
  if (Array.isArray(results)) return results[i];
  if (results instanceof Map) return results.get(l.id);
  if (results && typeof results === 'object') return results[l.id];
  return undefined;
};

function resultFor(scene, results, i) {
  return resultAt(results, scene, i) || solveLink(scene, scene.links[i]);
}

/** itemsOfLink(scene, link, result) -> this link's own items (not merged with other links), each with linkIds [link.id]. Use this to score one link. */
export function itemsOfLink(scene, link, result) {
  return itemsForLink(scene, link, result || solveLink(scene, link)).map((it) => ({ ...it, linkIds: [link.id] }));
}

/** assumptionsInUse(scene, results) -> list of the assumed or inferred figures that influenced this scene (see the file header). */
export function assumptionsInUse(scene, results) {
  const byId = new Map();
  const links = (scene && Array.isArray(scene.links)) ? scene.links : [];
  links.forEach((link, i) => {
    const res = resultFor(scene, results, i);
    for (const it of itemsForLink(scene, link, res)) {
      const have = byId.get(it.id);
      if (!have) byId.set(it.id, { ...it, linkIds: [link.id] });
      else {
        have.linkIds.push(link.id);
        if ((it.sensitivityDb || 0) > (have.sensitivityDb || 0)) { have.sensitivityDb = it.sensitivityDb; have.value = it.value; have.effect = it.effect; }
      }
    }
  });
  return [...byId.values()];
}

/**
 * combineSensitivity(items) -> { rssDb, worstCaseDb }. Items of the same mechanism (the same `group`, for example everything that raises the noise floor) are
 * correlated: their sensitivities add linearly, but never beyond the largest effect the group explains (`effectDb`). Different groups are independent: the group
 * totals combine as a root sum of squares (rssDb). worstCaseDb = the plain sum of the group totals (every error the wrong way at once).
 */
export function combineSensitivity(items) {
  const groups = new Map();
  for (const x of items || []) {
    if (!Number.isFinite(x.sensitivityDb)) continue;
    const key = x.group || x.id, g = groups.get(key) || { sum: 0, cap: 0 };
    g.sum += x.sensitivityDb; g.cap = Math.max(g.cap, Number.isFinite(x.effectDb) ? x.effectDb : x.sensitivityDb);
    groups.set(key, g);
  }
  const totals = [...groups.values()].map((g) => Math.min(g.sum, g.cap));
  return { rssDb: r1(Math.sqrt(totals.reduce((a, t) => a + t * t, 0))), worstCaseDb: r1(totals.reduce((a, t) => a + t, 0)) };
}

/** assumptionsForLink(items, linkId) -> the items that touch the link. */
export const assumptionsForLink = (items, linkId) => (items || []).filter((x) => x.linkIds.includes(linkId));

const isBodyWorn = (scene, link, res) => {
  if (link.kind === 'p2p') return false;
  const c = bodyCouplingLossDb((scene && scene.environment) || {}, link.tx.antenna, link.rx);
  return c.totalDb > 0 || !!(link.tx.antenna && link.tx.antenna.type === 'body');
};

/**
 * marginIsProven(link, result, items, scene?) -> { proven, marginDb, bodyWorn, rssDb, worstCaseDb, sumSensitivityDb (= rssDb, older name), reasons }.
 * Not proven when: the margin is under PROVEN_BODY_WORN_MARGIN_DB (10 dB) on a body-worn link; or the assumptions' combined sensitivity (rssDb: root sum of squares between independent mechanisms, a linear sum inside one)
 * is larger than the margin; or the link does not pass at all. `items` = assumptionsForLink(...) for this link (computed from `scene` when omitted).
 */
export function marginIsProven(link, result, items, scene) {
  const own = items || (scene ? assumptionsForLink(assumptionsInUse({ ...scene, links: [link] }, [result]), link.id) : []);
  const marginDb = result.marginDb;
  const { rssDb, worstCaseDb } = combineSensitivity(own);
  const bodyWorn = scene ? isBodyWorn(scene, link, result) : own.some((x) => x.id === 'body-loss');
  const reasons = [];
  if (!(marginDb >= 0)) reasons.push('The link does not pass: the margin is negative.');
  if (bodyWorn && marginDb < PROVEN_BODY_WORN_MARGIN_DB) reasons.push(`The link is body-worn and the margin is ${fmt(marginDb)} dB, under ${PROVEN_BODY_WORN_MARGIN_DB} dB: body loss varies too much to call it proven without a walk test.`);
  if (rssDb > marginDb && marginDb >= 0) reasons.push(`The assumed figures could together move the margin by about ${fmt(rssDb)} dB (root sum of squares; ${fmt(worstCaseDb)} dB if every error went the wrong way), more than the ${fmt(marginDb)} dB available.`);
  return { proven: reasons.length === 0, marginDb, bodyWorn, rssDb, worstCaseDb, sumSensitivityDb: rssDb, reasons };
}

/** confidenceSummary(scene, results) -> one row per link: { linkId, name, marginDb, proven, reasons, sumSensitivityDb, assumptionIds }. */
export function confidenceSummary(scene, results) {
  const links = (scene && Array.isArray(scene.links)) ? scene.links : [];
  const resolved = links.map((_, i) => resultFor(scene, results, i));
  return links.map((link, i) => {
    const own = itemsOfLink(scene, link, resolved[i]), m = marginIsProven(link, resolved[i], own, scene);
    return { linkId: link.id, name: link.name, marginDb: m.marginDb, proven: m.proven, reasons: m.reasons, rssDb: m.rssDb, worstCaseDb: m.worstCaseDb, sumSensitivityDb: m.rssDb, assumptionIds: own.map((x) => x.id) };
  });
}
