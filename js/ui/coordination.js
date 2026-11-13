// Frequency Coordination panel. Pure helpers (describeResult, applyToScene, parseChannels) plus mountCoordination().
// The generator itself is js/model/coordination.js (maths) with js/model/bands.js (region presets).
import { coordinateFrequencies } from '../model/coordination.js';
import { REGIONS, REGION_IDS, tvChannelsToBlocked, BANDS_DISCLAIMER } from '../model/bands.js';

export const LIMITS = Object.freeze({ maxPerKind: 16, maxTotal: 24 });

/** Parse "24, 27 31" into unique integer TV channel numbers (1..99). */
export function parseChannels(text) {
  const out = [];
  for (const t of String(text ?? '').split(/[\s,;]+/)) {
    if (!/^\d{1,2}$/.test(t)) continue;
    const n = Number(t);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Clamp the requested counts: integers 0..maxPerKind each and maxTotal in all. */
export function clampCounts(mics, iems) {
  const fix = (v) => Math.min(LIMITS.maxPerKind, Math.max(0, Math.floor(Number.isFinite(Number(v)) ? Number(v) : 0)));
  let m = fix(mics), i = fix(iems);
  if (m + i > LIMITS.maxTotal) i = Math.max(0, LIMITS.maxTotal - m);
  return { mics: m, iems: i };
}

/** Table rows with the spacing to the nearest other channel and the regulatory power limit text. */
export function describeResult(result) {
  const rows = (result.frequencies || []).map((f) => ({ ...f }));
  const placed = rows.filter((r) => r.freqMHz !== null);
  return rows.map((r) => {
    let nearest = null;
    if (r.freqMHz !== null) for (const o of placed) if (o !== r && (nearest === null || Math.abs(o.freqMHz - r.freqMHz) * 1000 < nearest)) nearest = Math.round(Math.abs(o.freqMHz - r.freqMHz) * 1000);
    const pl = r.powerLimit;
    return {
      id: r.id, name: r.name, kind: r.kind, freqMHz: r.freqMHz,
      freqText: r.freqMHz === null ? 'not placed' : `${r.freqMHz.toFixed(3)} MHz`,
      nearestSpacingKHz: nearest,
      spacingText: nearest === null ? '-' : `${nearest} kHz`,
      limitText: pl ? `${pl.maxPowerMw} mW ${pl.powerBasis}` : '-',
    };
  });
}

/**
 * Write the generated frequencies into a scene draft: link of kind mic <- first Mic row, link of kind iem <- first IEM row,
 * then the Intermod transmitters (scene.imd.transmitters) <- the remaining Mic rows in order.
 * Returns { applied: [{target, name, freqMHz}], unassigned: rows without a place in the scene }.
 */
export function applyToScene(scene, result) {
  const queues = { mic: [], iem: [] };
  for (const r of result.frequencies || []) if (r.freqMHz !== null && queues[r.kind]) queues[r.kind].push(r);
  const applied = [];
  for (const link of scene.links || []) {
    const q = queues[link.kind];
    const r = q && q.shift();
    if (!r) continue;
    link.freqMHz = r.freqMHz;
    applied.push({ target: link.name || link.id, name: r.name, freqMHz: r.freqMHz });
  }
  const imd = scene.imd && Array.isArray(scene.imd.transmitters) ? scene.imd.transmitters : [];
  for (const t of imd) {
    const r = queues.mic.shift();
    if (!r) break;
    t.freqMHz = r.freqMHz;
    applied.push({ target: t.name || t.id, name: r.name, freqMHz: r.freqMHz });
  }
  return { applied, unassigned: [...queues.mic, ...queues.iem] };
}

export function runCoordination({ regionId, rangeId, mics, iems, tvChannels, seed }) {
  const c = clampCounts(mics, iems);
  const req = { regionId, mics: c.mics, iems: c.iems, seed };
  if (rangeId) req.rangeIds = [rangeId];
  const ch = parseChannels(tvChannels);
  if (ch.length) req.blocked = tvChannelsToBlocked(regionId, ch);
  return { result: coordinateFrequencies(req), counts: c, channels: ch };
}

/** mountCoordination({ container, store }) - container is a <details>. */
export function mountCoordination({ container, store }) {
  container.textContent = '';
  const summary = document.createElement('summary');
  summary.textContent = 'Frequency coordination';
  const body = document.createElement('div');
  body.className = 'ob-body';
  container.append(summary, body);

  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
  const field = (label, control, title) => { const l = el('label', { className: 'ob-field', title: title || '' }, label + ' ', control); return l; };

  const intro = el('p', { className: 'hint', textContent: 'Picks carrier frequencies for several microphones and IEMs so that third-order intermodulation products (2f1-f2, f1+f2-f3) do not land on a channel in use. Planning estimate only: check local licensing and the TV channels in use at the venue.' });
  const region = el('select', { id: 'coord-region' });
  for (const id of REGION_IDS) region.append(el('option', { value: id, textContent: REGIONS[id].name }));
  const range = el('select', { id: 'coord-range' });
  const fillRanges = () => {
    range.textContent = '';
    range.append(el('option', { value: '', textContent: 'All bands' }));
    for (const r of REGIONS[region.value].ranges) range.append(el('option', { value: r.id, textContent: `${r.fromMHz}-${r.toMHz} MHz` }));
  };
  region.addEventListener('change', fillRanges);
  fillRanges();
  const mics = el('input', { id: 'coord-mics', type: 'number', min: 0, max: LIMITS.maxPerKind, step: 1, value: 4 });
  const iems = el('input', { id: 'coord-iems', type: 'number', min: 0, max: LIMITS.maxPerKind, step: 1, value: 2 });
  const tv = el('input', { id: 'coord-tv', type: 'text', placeholder: 'e.g. 24, 27', size: 10 });
  const form = el('form', { className: 'ob-row' },
    field('Region', region, 'Band preset with approximate power limits'),
    field('Band', range, 'Limit the search to one band of the region'),
    field('Mics', mics, 'Number of microphone transmitters'),
    field('IEMs', iems, 'Number of in-ear-monitor transmitters'),
    field('TV channels in use', tv, 'Local TV channel numbers to avoid, separated by commas'));
  const gen = el('button', { type: 'submit', id: 'coord-generate', textContent: 'Generate', title: 'Find an intermod-free set of frequencies' });
  const again = el('button', { type: 'button', id: 'coord-again', textContent: 'Try another set', title: 'Search again with a different seed', disabled: true });
  const apply = el('button', { type: 'button', id: 'coord-apply', textContent: 'Apply to scene', title: 'Write these frequencies to the transmitters in the scene (one Undo step)', disabled: true });
  form.append(gen, again, apply);
  const status = el('p', { className: 'hint', role: 'status' });
  const out = el('div', { className: 'ob-coord-out' });
  const disclaimer = el('p', { className: 'hint', textContent: BANDS_DISCLAIMER });
  body.append(intro, form, status, out, disclaimer);

  let last = null, seed = 1;

  function show(run) {
    out.textContent = '';
    const r = run.result;
    last = r;
    apply.disabled = !r.frequencies.some((f) => f.freqMHz !== null);
    again.disabled = false;
    if (r.failure) {
      const msg = el('p', { className: 'hint', textContent: r.failure.message });
      msg.dataset.bad = 'true';
      out.append(msg);
      if (r.failure.suggestions) out.append(el('ul', {}, ...r.failure.suggestions.map((s) => el('li', { textContent: s }))));
    } else {
      const m = r.marginKHz;
      out.append(el('p', { className: 'ob-coord-sum', textContent: `Score ${r.score} of 100. Nearest intermod product is ${r.minProductDistanceKHz} kHz from a channel (guard ${r.guardKHz} kHz, margin ${m} kHz); closest channel spacing ${r.minChannelSpacingKHz} kHz.` }));
    }
    const rows = describeResult(r);
    if (rows.length) {
      const table = el('table', { className: 'ob-table' });
      table.append(el('caption', { className: 'sr-only', textContent: 'Generated frequencies' }));
      const head = el('thead'); head.innerHTML = '<tr><th scope="col">Transmitter</th><th scope="col" class="num">Frequency</th><th scope="col" class="num">Nearest channel</th><th scope="col">Region power limit</th></tr>';
      const tb = el('tbody');
      for (const d of rows) {
        tb.append(el('tr', {}, el('th', { scope: 'row', textContent: d.name }), el('td', { className: 'num', textContent: d.freqText }), el('td', { className: 'num', textContent: d.spacingText }), el('td', { textContent: d.limitText })));
      }
      table.append(head, tb);
      out.append(table);
    }
    for (const n of r.notes || []) out.append(el('p', { className: 'hint', textContent: n }));
    if (run.counts.mics + run.counts.iems === 0) status.textContent = 'Set at least one microphone or IEM.';
  }

  function generate(nextSeed) {
    seed = nextSeed;
    status.textContent = 'Searching...';
    gen.disabled = again.disabled = true;
    // let the "Searching" text paint before the (synchronous) search runs
    setTimeout(() => {
      try {
        const run = runCoordination({ regionId: region.value, rangeId: range.value, mics: mics.value, iems: iems.value, tvChannels: tv.value, seed });
        show(run);
        status.textContent = run.channels.length ? `Avoiding TV channel${run.channels.length > 1 ? 's' : ''} ${run.channels.join(', ')}.` : '';
      } catch (err) {
        console.error(err);
        status.textContent = `Could not coordinate: ${err.message}`;
      }
      gen.disabled = false;
      again.disabled = !last;
    }, 20);
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); generate(1); });
  again.addEventListener('click', () => generate(seed + 1));
  apply.addEventListener('click', () => {
    if (!last) return;
    let res = null;
    store.update((d) => { res = applyToScene(d, last); });
    const n = res ? res.applied.length : 0;
    status.textContent = n
      ? `Applied ${n} frequenc${n === 1 ? 'y' : 'ies'} to the scene.${res.unassigned.length ? ` ${res.unassigned.length} more have no transmitter in the scene yet (turn on Intermod to add mics).` : ''} Undo restores the old ones.`
      : 'No transmitter in the scene to receive these frequencies.';
  });
  return { generate, destroy() { container.textContent = ''; } };
}
