// Frequency Coordination panel. Pure helpers (describeResult, applyToScene, parseChannels) plus mountCoordination().
// The generator itself is js/model/coordination.js (maths) with js/model/bands.js (region presets).
import { coordinateFrequencies } from '../model/coordination.js';
import {
  REGIONS, REGION_IDS, tvChannelsToBlocked, BANDS_DISCLAIMER, BAND_GROUPS, BAND_GROUP_IDS, rangeGroup, WIFI_CHANNELS, BAND_III, DAB_BLOCKS,
  bandIIIChannelsToBlocked, dabBlocksToBlocked, CHANNEL_PLANS,
} from '../model/bands.js';
import { licenceInfo, verificationInfo, powerLine, rangeDetail, limitText, setCoordRegion } from './region.js';

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

/** Parse "5A, 9c 10B" into valid DAB block ids (upper case) and the ignored words. */
export function parseDabBlocks(text) {
  const valid = [], ignored = [];
  for (const t of String(text ?? '').split(/[\s,;]+/)) {
    if (!t) continue;
    const id = t.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(DAB_BLOCKS, id)) { if (!valid.includes(id)) valid.push(id); } else ignored.push(t);
  }
  return { valid, ignored };
}

export const isHopping = (group) => !!(BAND_GROUPS[group] && BAND_GROUPS[group].hopping);

/** Ranges of a region that belong to a band group. */
export const rangesFor = (regionId, group) => ((REGIONS[regionId] && REGIONS[regionId].ranges) || []).filter((r) => rangeGroup(r) === group);

/** Named channel plans that sit inside a band group (UK only for now): [[id, label]]. */
export function plansFor(regionId, group) {
  if (regionId !== 'uk') return [];
  const g = BAND_GROUPS[group];
  if (!g) return [];
  return Object.values(CHANNEL_PLANS).filter((p) => p.freqsMHz.every((f) => f >= g.fromMHz && f <= g.toMHz)).map((p) => [p.id, p.label]);
}

/**
 * Cards for the range(s) the search will use: the chosen range, or every non-optional range of the group.
 * Each: { id, name, licence: {label, meaning}, power: 'handheld X mW / body-worn Y mW ERP', verification: {level, label, warn, sourceText}, optional }
 */
export function rangeCards(regionId, group, rangeId) {
  const list = rangesFor(regionId, group).filter((r) => (rangeId ? r.id === rangeId : !r.optional));
  return list.map((r) => {
    const d = rangeDetail(regionId, r);
    return {
      id: r.id, name: `${r.fromMHz}-${r.toMHz} MHz`, optional: !!r.optional,
      licence: licenceInfo(r.licenceClass), licenceClass: r.licenceClass || null,
      power: powerLine(d), verification: verificationInfo(d), note: r.note || '',
    };
  });
}

/** Result notes that are about draft or unverified limits, shown prominently (the rest stay as plain hints). */
export const isLimitWarning = (note) => /draft|unverified/i.test(String(note));

/** Band III TV channels the region defines: { first, last } or null. */
export const bandIIIFor = (regionId) => (BAND_III[regionId] ? { first: BAND_III[regionId].firstChannel, last: BAND_III[regionId].lastChannel } : null);

/** Clamp the requested counts: integers 0..maxPerKind each and maxTotal in all. */
export function clampCounts(mics, iems) {
  const fix = (v) => Math.min(LIMITS.maxPerKind, Math.max(0, Math.floor(Number.isFinite(Number(v)) ? Number(v) : 0)));
  let m = fix(mics), i = fix(iems);
  if (m + i > LIMITS.maxTotal) i = Math.max(0, LIMITS.maxTotal - m);
  return { mics: m, iems: i };
}

/** Table rows with the spacing to the nearest other channel and the regulatory power limit text. */
export function describeResult(result, { regionId = null, bodyWorn = false } = {}) {
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
      limitText: regionId && r.freqMHz !== null ? limitText(regionId, r.freqMHz, { bodyWorn, kind: r.kind }) : (pl ? `${pl.maxPowerMw} mW ${pl.powerBasis}` : '-'),
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

/** Wi-Fi channel numbers valid for a hopping group, from free text. */
export function parseWifiChannels(text, group) {
  const plan = WIFI_CHANNELS[group];
  if (!plan) return [];
  const known = new Set(plan.channels.map((c) => c.channel));
  const out = [];
  for (const t of String(text ?? '').split(/[\s,;]+/)) {
    const n = /^\d{1,3}$/.test(t) ? Number(t) : NaN;
    if (known.has(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Chips for the Wi-Fi channel strip and the summary lines of an occupancy result. */
export function describeOccupancy(result) {
  const o = result && result.occupancy;
  if (!o) return null;
  const pct = Math.round((o.occupiedFraction || 0) * 100);
  const lines = [
    `${pct} percent of the ${o.band.spanMHz} MHz band is covered by Wi-Fi channels in use; ${Math.round(o.freeMHz * 10) / 10} MHz is free, in a largest free block of ${Math.round(o.largestFreeMHz * 10) / 10} MHz.`,
  ];
  if (Number.isFinite(o.perSystemFreeMHz)) lines.push(`With ${o.systems} hopping system${o.systems === 1 ? '' : 's'} sharing it, about ${Math.round(o.perSystemFreeMHz * 10) / 10} MHz of free spectrum each.`);
  if (o.nonOverlapping && o.nonOverlapping.length) lines.push(`Wi-Fi channels that do not overlap each other: ${o.nonOverlapping.join(', ')}.`);
  return { chips: o.wifi.map((w) => ({ channel: w.channel, centerMHz: w.centerMHz, inUse: !!w.inUse })), lines, links: o.links || [] };
}

export function runCoordination({ regionId, rangeId, mics, iems, tvChannels, seed, bandGroup = 'uhf', bandIII, dabBlocks, wifiChannels, channelPlan, outdoor }) {
  const c = clampCounts(mics, iems);
  const req = { regionId, mics: c.mics, iems: c.iems, seed, bandGroup };
  if (rangeId) req.rangeIds = [rangeId];
  if (channelPlan && CHANNEL_PLANS[channelPlan]) req.channelPlan = channelPlan;
  if (outdoor) req.outdoor = true;
  const ch = parseChannels(tvChannels);
  const blocked = [];
  const notes = [];
  if (bandGroup === 'uhf' && ch.length) blocked.push(...tvChannelsToBlocked(regionId, ch));
  let b3 = [], dab = [];
  if (bandGroup === 'vhf') {
    b3 = parseChannels(bandIII);
    const parsed = parseDabBlocks(dabBlocks);
    dab = parsed.valid;
    if (parsed.ignored.length) notes.push(`Ignored unknown DAB block${parsed.ignored.length > 1 ? 's' : ''}: ${parsed.ignored.join(', ')}.`);
    blocked.push(...bandIIIChannelsToBlocked(regionId, b3), ...dabBlocksToBlocked(dab));
  }
  if (blocked.length) req.blocked = blocked;
  let wifi = [];
  if (isHopping(bandGroup)) { wifi = parseWifiChannels(wifiChannels, bandGroup); req.wifiChannels = wifi; }
  return { result: coordinateFrequencies(req), counts: c, channels: bandGroup === 'uhf' ? ch : bandGroup === 'vhf' ? b3 : wifi, dab, wifi, bandGroup, notes };
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

  const intro = el('p', { className: 'hint', textContent: 'Picks carrier frequencies for several microphones and IEMs so that third-order intermodulation products (2f1-f2, f1+f2-f3) do not land on a channel in use (VHF and UHF). The 2.4 and 5.8 GHz bands are different: those systems hop between channels on their own, so no frequencies are assigned and you get a channel occupancy and Wi-Fi overlap report instead. Planning estimate only: check local licensing and what is on air at the venue.' });
  const region = el('select', { id: 'coord-region' });
  for (const id of REGION_IDS) region.append(el('option', { value: id, textContent: REGIONS[id].name }));
  const group = el('select', { id: 'coord-group' });
  for (const id of BAND_GROUP_IDS) group.append(el('option', { value: id, textContent: BAND_GROUPS[id].name + (BAND_GROUPS[id].hopping ? ' (hopping)' : '') }));
  group.value = 'uhf';
  const range = el('select', { id: 'coord-range' });
  const fillRanges = () => {
    range.textContent = '';
    range.append(el('option', { value: '', textContent: 'All bands' }));
    for (const r of rangesFor(region.value, group.value)) range.append(el('option', { value: r.id, textContent: `${r.fromMHz}-${r.toMHz} MHz${r.optional ? ' (optional)' : ''}` }));
    plan.textContent = '';
    plan.append(el('option', { value: '', textContent: 'None: search the whole band' }));
    for (const [id, label] of plansFor(region.value, group.value)) plan.append(el('option', { value: id, textContent: label }));
    planF.hidden = plan.options.length < 2;
    outdoorF.hidden = !(region.value === 'uk' && group.value === 'uhf');
    renderCards();
    const b3 = bandIIIFor(region.value);
    b3in.placeholder = b3 ? `Band III ${b3.first}-${b3.last}, e.g. ${b3.first + 1}, ${b3.first + 4}` : 'none for this region';
  };
  const mics = el('input', { id: 'coord-mics', type: 'number', min: 0, max: LIMITS.maxPerKind, step: 1, value: 4 });
  const iems = el('input', { id: 'coord-iems', type: 'number', min: 0, max: LIMITS.maxPerKind, step: 1, value: 2 });
  const tv = el('input', { id: 'coord-tv', type: 'text', placeholder: 'e.g. 24, 27', size: 10 });
  const plan = el('select', { id: 'coord-plan' });
  const outdoor = el('input', { id: 'coord-outdoor', type: 'checkbox' });
  const bodyWorn = el('input', { id: 'coord-bodyworn', type: 'checkbox', checked: true });
  const planF = field('Channel plan', plan, 'Use a fixed list of channels (for example UK channel 38 or the UK VHF licence-exempt channels) instead of searching the whole band');
  const outdoorF = field('Outdoor use', outdoor, 'Outdoor use also keeps clear of 976.5-979.5 MHz');
  const bodyF = field('Body-worn transmitters', bodyWorn, 'Show the body-worn power limit for microphone transmitters instead of the handheld one');
  const cards = el('ul', { className: 'ob-cards' });
  const renderCards = () => {
    cards.textContent = '';
    for (const c of rangeCards(region.value, group.value, range.value)) {
      const li = el('li', { className: 'ob-card' });
      const head = el('div', { className: 'ob-card-head' }, el('strong', { textContent: c.name }), ' ', el('span', { className: 'ob-badge', textContent: c.licence.label }), ' ',
        el('span', { className: 'ob-badge', textContent: c.verification.level === 'verified' ? 'verified' : c.verification.level === 'draft' ? 'draft IR 2030' : 'unverified' }));
      head.lastChild.dataset.level = c.verification.level;
      li.append(head, el('div', { className: 'hint', textContent: `${c.licence.meaning} Power: ${c.power}.` }));
      if (c.verification.warn) {
        const w = el('div', { className: 'ob-warn', textContent: `Warning: ${c.verification.label}. Source: ${c.verification.sourceText || 'none recorded'}.` });
        w.setAttribute('role', 'note');
        li.append(w);
      }
      if (c.note) li.append(el('div', { className: 'hint', textContent: c.note }));
      cards.append(li);
    }
  };
  range.addEventListener('change', renderCards);
  const b3in = el('input', { id: 'coord-b3', type: 'text', size: 14 });
  const dabin = el('input', { id: 'coord-dab', type: 'text', placeholder: 'e.g. 5A, 9C', size: 10 });
  const wifiin = el('input', { id: 'coord-wifi', type: 'text', placeholder: 'e.g. 1, 6, 11', size: 10 });
  const tvF = field('TV channels in use', tv, 'Local TV channel numbers to avoid, separated by commas');
  const b3F = field('Band III TV channels in use', b3in, 'VHF TV channels at the venue to avoid, separated by commas');
  const dabF = field('DAB blocks in use', dabin, 'DAB digital radio blocks at the venue to avoid, e.g. 5A, 9C');
  const wifiF = field('Wi-Fi channels in use', wifiin, 'Wi-Fi channel numbers seen at the venue, separated by commas');
  const syncGroup = () => {
    const g = group.value;
    tvF.hidden = g !== 'uhf'; b3F.hidden = dabF.hidden = g !== 'vhf'; wifiF.hidden = !isHopping(g);
    gen.textContent = isHopping(g) ? 'Check occupancy' : 'Generate';
    gen.title = isHopping(g) ? 'Report Wi-Fi channel occupancy in this band' : 'Find an intermod-free set of frequencies';
    fillRanges();
  };
  const form = el('form', { className: 'ob-row' },
    field('Region', region, 'Band preset with approximate power limits'),
    field('Band group', group, 'VHF, UHF, 2.4 GHz or 5.8 GHz. 2.4 and 5.8 GHz systems hop, so they get an occupancy report instead of assigned frequencies'),
    field('Band', range, 'Limit the search to one band of the region'),
    field('Mics', mics, 'Number of microphone transmitters'),
    field('IEMs', iems, 'Number of in-ear-monitor transmitters'),
    tvF, b3F, dabF, wifiF, planF, outdoorF, bodyF);
  const gen = el('button', { type: 'submit', id: 'coord-generate', textContent: 'Generate', title: 'Find an intermod-free set of frequencies' });
  const again = el('button', { type: 'button', id: 'coord-again', textContent: 'Try another set', title: 'Search again with a different seed', disabled: true });
  const apply = el('button', { type: 'button', id: 'coord-apply', textContent: 'Apply to scene', title: 'Write these frequencies to the transmitters in the scene (one Undo step)', disabled: true });
  form.append(gen, again, apply);
  region.addEventListener('change', () => { setCoordRegion(region.value); fillRanges(); });
  group.addEventListener('change', syncGroup);
  syncGroup();
  const status = el('p', { className: 'hint', role: 'status' });
  const out = el('div', { className: 'ob-coord-out' });
  const notesBox = el('div', { className: 'ob-coord-notes' });
  const disclaimer = el('p', { className: 'hint', textContent: BANDS_DISCLAIMER });
  body.append(intro, form, cards, status, out, notesBox, disclaimer);

  let last = null, seed = 1;

  function showNotes(notes) {
    const warn = notes.filter(isLimitWarning), rest = notes.filter((n) => !isLimitWarning(n));
    if (warn.length) {
      const box = el('div', { className: 'ob-warn' });
      box.setAttribute('role', 'note');
      box.append(el('strong', { textContent: 'Check these limits: ' }), ...warn.map((n) => el('p', { textContent: n })));
      notesBox.append(box);
    }
    for (const n of rest) notesBox.append(el('p', { className: 'hint', textContent: n }));
  }

  function show(run) {
    out.textContent = '';
    notesBox.textContent = '';
    const r = run.result;
    last = r;
    const occ = r.mode === 'occupancy';
    apply.hidden = occ;
    apply.disabled = occ || !r.frequencies.some((f) => f.freqMHz !== null);
    again.hidden = occ;
    again.disabled = false;
    if (occ) {
      const d = describeOccupancy(r);
      out.append(el('p', { className: 'ob-coord-sum', textContent: `${BAND_GROUPS[r.bandGroup].name}: channel occupancy (score ${r.score} of 100 = free share of the band)` }));
      const strip = el('ul', { className: 'ob-wifi' });
      strip.setAttribute('aria-label', 'Wi-Fi channels');
      for (const c of d.chips) {
        const li = el('li', { className: 'ob-wifi-ch', textContent: `${c.channel}${c.inUse ? ' \u25cf' : ''}` });
        li.dataset.inUse = String(c.inUse);
        li.title = `Wi-Fi channel ${c.channel}, centre ${c.centerMHz} MHz${c.inUse ? ', in use' : ', free'}`;
        li.setAttribute('aria-label', li.title);
        strip.append(li);
      }
      out.append(strip, el('p', { className: 'hint', textContent: 'Channels marked with a dot are in use. Each Wi-Fi channel is 20 MHz wide, so neighbouring channel numbers overlap.' }));
      for (const line of d.lines) out.append(el('p', { className: 'hint', textContent: line }));
      out.append(el('p', { className: 'hint', textContent: 'Hopping systems (digital mics and IEMs in this band) move between channels many times a second and avoid busy ones automatically, so there is no single frequency to apply to a transmitter. Use this to see how crowded the band is.' }));
      const bad = d.links.filter((l) => l.overlapsInUse);
      if (bad.length) out.append(el('p', { className: 'hint', textContent: `${bad.length} link${bad.length > 1 ? 's' : ''} in the scene sit${bad.length > 1 ? '' : 's'} on a Wi-Fi channel marked in use.` }));
      showNotes([...(r.notes || []), ...(run.notes || [])]);
      return;
    }
    if (r.failure) {
      const msg = el('p', { className: 'hint', textContent: r.failure.message });
      msg.dataset.bad = 'true';
      out.append(msg);
      if (r.failure.suggestions) out.append(el('ul', {}, ...r.failure.suggestions.map((s) => el('li', { textContent: s }))));
    } else {
      const m = r.marginKHz;
      out.append(el('p', { className: 'ob-coord-sum', textContent: `Score ${r.score} of 100. Nearest intermod product is ${r.minProductDistanceKHz} kHz from a channel (guard ${r.guardKHz} kHz, margin ${m} kHz); closest channel spacing ${r.minChannelSpacingKHz} kHz.` }));
    }
    const rows = describeResult(r, { regionId: region.value, bodyWorn: bodyWorn.checked });
    if (rows.length) {
      const table = el('table', { className: 'ob-table' });
      table.append(el('caption', { className: 'sr-only', textContent: 'Generated frequencies' }));
      const head = el('thead'); head.innerHTML = '<tr><th scope="col">Transmitter</th><th scope="col" class="num">Frequency</th><th scope="col" class="num">Nearest channel</th><th scope="col">Power limit' + (bodyWorn.checked ? ' (mics: body-worn)' : ' (handheld)') + '</th></tr>';
      const tb = el('tbody');
      for (const d of rows) {
        tb.append(el('tr', {}, el('th', { scope: 'row', textContent: d.name }), el('td', { className: 'num', textContent: d.freqText }), el('td', { className: 'num', textContent: d.spacingText }), el('td', { textContent: d.limitText })));
      }
      table.append(head, tb);
      out.append(table);
    }
    showNotes([...(r.notes || []), ...(run.notes || [])]);
    if (run.counts.mics + run.counts.iems === 0) status.textContent = 'Set at least one microphone or IEM.';
  }

  function generate(nextSeed) {
    seed = nextSeed;
    status.textContent = 'Searching...';
    gen.disabled = again.disabled = true;
    // let the "Searching" text paint before the (synchronous) search runs
    setTimeout(() => {
      try {
        const run = runCoordination({ regionId: region.value, rangeId: range.value, mics: mics.value, iems: iems.value, tvChannels: tv.value, seed, bandGroup: group.value, bandIII: b3in.value, dabBlocks: dabin.value, wifiChannels: wifiin.value, channelPlan: plan.value, outdoor: outdoor.checked });
        show(run);
        const what = { uhf: 'TV channel', vhf: 'Band III TV channel', '2g4': 'Wi-Fi channel', '5g8': 'Wi-Fi channel' }[run.bandGroup];
        status.textContent = run.channels.length ? `${isHopping(run.bandGroup) ? 'Marked in use' : 'Avoiding'}: ${what}${run.channels.length > 1 ? 's' : ''} ${run.channels.join(', ')}.` : '';
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
