// Assumptions in this scene: pure view model for the link-budget chip and the Report section (no DOM). Data from js/model/assumptions-in-use.js.
import { assumptionsInUse, itemsOfLink, marginIsProven, PROVEN_BODY_WORN_MARGIN_DB } from '../model/assumptions-in-use.js';

const FLAG_WORD = { U: 'U: assumed, no source behind it', I: 'I: inferred from a rule of thumb or a published range' };
const fin = Number.isFinite;
const d1 = (v) => (fin(v) ? v.toFixed(1) : '-');

/** One row per item with words (the flag letter always comes with its meaning). */
export function assumptionRows(items, scene) {
  const names = new Map(((scene && scene.links) || []).map((l) => [l.id, l.name]));
  return (items || []).map((x) => ({
    id: x.id, label: x.label, value: x.value, flag: x.flag, flagText: FLAG_WORD[x.flag] || x.flag,
    effect: x.effect, sensitivity: fin(x.sensitivityDb) ? `up to ${d1(x.sensitivityDb)} dB` : 'not a single number', fix: x.fix,
    links: (x.linkIds || []).map((id) => names.get(id) || id),
  }));
}

/** Short chip text for a verdict: names the first reason in a few words. */
export function chipText(v) {
  if (!v) return '';
  if (v.proven) return v.items.length ? `Margin holds against ${v.items.length} assumed figure${v.items.length === 1 ? '' : 's'} (up to ${d1(v.sumSensitivityDb)} dB)` : 'No assumed figure changes this result';
  if (!(v.marginDb >= 0)) return 'Margin unproven: the link does not pass';
  if (v.bodyWorn && v.marginDb < PROVEN_BODY_WORN_MARGIN_DB) return `Margin unproven: body-worn, under ${PROVEN_BODY_WORN_MARGIN_DB} dB`;
  return `Margin unproven: assumed figures could move it up to ${d1(v.sumSensitivityDb)} dB`;
}

/**
 * confidenceView(scene, link, result, items?) -> { proven, marginDb, bodyWorn, sumSensitivityDb, reasons, items (this link), all (whole scene), chip, severity }.
 * `items` = assumptionsInUse(scene, results) when the caller already has it.
 */
export function confidenceView(scene, link, result, items) {
  if (!scene || !link || !result) return null;
  const all = items || assumptionsInUse(scene);
  const own = itemsOfLink(scene, link, result); // this link's own figures, not the merged scene list (which keeps the largest sensitivity of any link)
  const m = marginIsProven(link, result, own, scene);
  const v = { ...m, items: own, all, severity: m.proven ? 'ok' : 'info' };
  v.chip = chipText(v);
  return v;
}

/** Report data block: the whole scene's list as rows plus the active link's verdict. */
export function reportAssumptions(scene, link, result) {
  const v = confidenceView(scene, link, result);
  if (!v) return null;
  return { verdict: v.chip, proven: v.proven, reasons: v.reasons, rows: assumptionRows(v.all, scene) };
}
