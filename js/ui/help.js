// Tooltips for the toolbar and a "What's this?" explanation per major panel.
import { ANTENNA_LEGEND_TEXT } from '../view/icons.js';
import { legend } from './glossary.js';
// TOOLTIPS and HELP_TOPICS are plain data (tested in Node); applyHelp() touches the DOM.

export const TOOLTIPS = Object.freeze({
  floor: 'Floor material: sets how strongly the floor reflects the signal, which can add to or cancel the direct path.',
  'btn-two-ray': 'Two-ray model: direct path plus floor and wall reflections, added with their phases. Shows fades and nulls.',
  'btn-free-space': 'Free-space model: direct path only, as if there were no floor or walls.',
  'u-dbm': 'Show powers in dBm (decibels relative to 1 milliwatt).',
  'u-dbw': 'Show powers in dBW (decibels relative to 1 watt; 30 less than dBm).',
  'u-mw': 'Show powers in milliwatts.',
  'u-m': 'Show lengths in metres.',
  'u-ft': 'Show lengths in feet.',
  'btn-cmd': 'Find any command, example or panel by typing. Shortcut: Ctrl+K, or / when you are not typing in a field.',
  'btn-undo': 'Undo the last change (Ctrl+Z).',
  'btn-redo': 'Redo the change you just undid (Ctrl+Shift+Z).',
  'btn-walk-all': 'Walk every microphone and every intermod transmitter along the same path at once, to see where the group first causes a problem. Press again to stop.',
  'btn-walk': 'Move the transmitter along a path automatically so you can watch the level and margin change.',
  'walk-speed': 'Walking speed in metres per second (a stroll is about 1.2).',
  'walk-to': 'Where the walk ends: back on stage, or out until the signal is lost.',
  'btn-batt': 'Start or pause the virtual battery drain (sped up by the Time x factor).',
  'btn-batt-reset': 'Refill the virtual battery.',
  'batt-scale': 'How many times faster than real time the battery drains.',
  'btn-vnalab': 'Open the VNA lab: a virtual network analyser with return loss, VSWR, Smith chart, calibration, distance to fault and a library of cable, antenna and filter faults.',
  'btn-modlab': 'Open the Modulation lab: animated AM, FM, digital, stereo FM and radio-mic tone-key demonstrations with spectra.',
  examples: 'Load a ready-made example scene with a note explaining what to look at.',
  'btn-share': 'Copy a link that contains this whole scene. Nothing is uploaded.',
  'btn-report': 'Open a printable link-budget report.',
  'btn-save': 'Download the scene as a JSON file.',
  'btn-load': 'Load a scene from a JSON file.',
  'btn-help': 'Show or hide the Start here guide.',
  'btn-reset': 'Throw away the current scene and go back to the default stage (asks first; Undo can bring it back).',
});

/**
 * Tooltips for controls that other modules build without a title, matched by their visible text (a trailing "*" matches a start). applyTextTips() fills only an empty title.
 */
export const TEXT_TIPS = Object.freeze({
  'Update available': 'A newer version of RF Bench has been downloaded. Click to reload and use it.',
  'Dismiss': 'Hide this note. Pick the example again from Examples to read it again.',
  'Pause': 'Freeze this display; press again to carry on.',
  'Ripples': 'Animate the radio wavefronts on the plan and side views (driven by the real model).',
  'Antenna A': 'Show the level path through receive antenna A (diversity).',
  'Antenna B': 'Show the level path through receive antenna B (diversity).',
  'Audio spectrum': 'The audio signal that is modulating this link (simulated, not real audio).',
  'MPX spectrum': 'The FM stereo multiplex: left plus right, the 19 kHz pilot and the stereo difference signal.',
  'RF spectrum': 'The radio carrier of this link against the receiver channel and the noise floor.',
  'About this spectrum': 'What this plot shows and how to read it.',
  'Heat map': 'Colour the stage by the level or margin a receiver would see at each spot.',
  'Tint by antenna': 'Colour each spot by which receive antenna is strongest there.',
  'Add zone': 'Add a coverage zone: an area of the plan whose coverage you want to check.',
  'Add vertex': 'Add a corner to the selected zone.',
  'Remove vertex': 'Remove the selected corner of the zone.',
  'Remove zone': 'Delete the selected zone.',
  'Add platform': 'Add a raised block on the stage, such as a drum riser. Items on it are measured from its top.',
  'Add overhead panel': 'Add a flown reflector above the stage. Signal bounces off it back down.',
  'Add reflector': 'Add a wall, glass or metal surface that reflects signal and can create multipath.',
  'Add transmitter': 'Add a transmitter that is not in the rack, such as one from a neighbouring venue. It counts as a source of intermod.',
  'Add a band the system uses': 'List another band on this antenna or booster; products landing in it count as hits.',
  'Add several mics or IEMs...': 'Add a number of mics or in-ear monitors at once, each at the next clean frequency, as one undo step.',
  'Pack list': 'A printable list of the transmitters, receivers, antennas and cables in this rack.',
  'Radio items*': 'Every transmitter, receiver, antenna, splitter and combiner in signal order.',
  'Venue builder': 'The room: stage, platforms, crowd, ceiling, noise sources, floor and reflectors.',
  'Stage': 'Stage size and the deck material. Item heights are measured from the deck or the platform they stand on.',
  'Platforms': 'Raised blocks on the stage, such as drum risers or choir steps.',
  'Crowd zones*': 'Areas of audience that absorb signal passing through below head height. Figures are assumed estimates.',
  'Ceiling and overhead panels': 'A ceiling and flown panels reflect signal back down; they can add or cancel the direct path.',
  'Noise sources': 'Things that raise the receiver noise floor: LED walls, lighting, power electronics, camera flash, crew radios and phones.',
  'Environment': 'Floor material, propagation model and body loss, and the outside noise level at the antenna.',
  'Reflectors': 'Walls, glass or metal that reflect signal. They can create dead spots and fades.',
  'People': 'People who carry a mic and an in-ear pack. Dragging a person moves both packs.',
  'Point-to-point link': 'A fixed radio link between two points with its own antennas and cable chain.',
  'Frequency coordination': 'Pick frequencies so that intermod products miss every channel in use.',
  'Intermod demo': 'Settings for the intermod view: where the transmitters come from, the receiver front end, intercepts and extra sources.',
  'Saved scenes': 'Named copies of this scene kept in this browser only.',
  'Compare A / B': 'Remember a scene as A, change something, and see the difference in dB.',
  'Paths*': 'Every signal path from transmitter to receiver (direct and reflected), with its length and delay.',
  'Analogue vs digital': 'The same input level shown as an analogue FM link and as a digital link, side by side.',
  'No assumed figure changes this result': 'Some figures in the budget are assumed rather than measured. This line says whether any of them changed the result.',
  'Table of values': 'The same numbers as the plot, as a table.',
});
const TIP_KEYS = Object.keys(TEXT_TIPS);
/** tipFor(text) -> the TEXT_TIPS entry for a control's visible text (exact, or a "key*" prefix match), else ''. Pure. */
export function tipFor(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (TEXT_TIPS[t]) return TEXT_TIPS[t];
  for (const k of TIP_KEYS) if (k.endsWith('*') && t.startsWith(k.slice(0, -1))) return TEXT_TIPS[k];
  return '';
}
/** Give a title to buttons and section headings that have none. The radio item rows in the rack (one per link) get a generic hint. */
export function applyTextTips(root = document) {
  for (const e of root.querySelectorAll('button:not([title]), summary:not([title])')) {
    let tip = tipFor(e.textContent);
    if (!tip && e.tagName === 'SUMMARY' && e.closest('#rack')) tip = 'Open to see the signal flow and essentials of this item. The dot and the figure show its margin.';
    if (tip) e.title = tip;
  }
}

export const HELP_TOPICS = Object.freeze({
  rack: { title: 'Radio items', text: 'Every transmitter, receiver, antenna, splitter and combiner in one list, in signal order. A channel on a transmitter or receiver unit is matched to its link by frequency, so changing a frequency here moves the link with it. Use the Add buttons to build the rig, then open an item to change its model, power, antenna or cable.', terms: ['Tx','Rx','dB'] },
  'venue-builder': { title: 'Venue builder', text: 'Describe the room the show happens in: stage and platforms, crowd, ceiling, noise sources, floor and reflecting walls. Each one changes the signal paths and the noise that the link budget uses. Crowd and noise figures are assumed estimates, so treat them as a planning guide.', terms: ['dB'] },
  'people-panel': { title: 'People', text: 'The people who wear the packs. One person can carry a mic and an in-ear pack: dragging them on the plan moves both, and body loss applies to both. Their links stay selectable on their own.', terms: ['Tx','Rx'] },
  'p2p-panel': { title: 'Point-to-point link', text: 'A fixed radio link between two points, for example a stage to front-of-house link, with its own antennas and cable chain. Select a point-to-point link to edit its path here.', terms: ['Tx','Rx','dBi'] },
  results: { title: 'Link budget', text: 'Adds up what the signal gains and loses from transmitter to receiver. Margin is how many dB the signal is above the level the receiver needs: 6 dB or more is a pass, 0 to 6 is marginal, below 0 will drop out. Every 6 dB lost halves the range in free space.', terms: ['dBm','dB','Tx','Rx','NF','SNR'] },
  plan: { title: 'Plan view', text: 'The stage from above, drawn to scale. A crowd zone (dotted, tinted polygon) absorbs signal that passes through it below head height; drag it or its corner squares, or add one in the Crowd zones section of the inspector. Crowd figures are assumed estimates. Coordinates are stage-relative: x = 0 is the centre line (positive to the right), y = 0 is the front edge (positive upstage, negative toward the audience). The lobe around an antenna shows where it hears or radiates best. Radio waves bounce off walls and the floor, so moving a few centimetres can change the level a lot.' + ' ' + ANTENNA_LEGEND_TEXT + '', terms: ['Tx','Rx','dBi'] },
  side: { title: 'Side view', text: 'A vertical slice along the transmitter-to-receiver line. The direct ray and the floor-bounce ray arrive at slightly different times; when they are out of step they cancel, which is why antenna height matters. Select an end, then drag the diamond on its elevation gauge to set the elevation (0 = level) (snaps to 5 degrees, hold Shift for 1 degree), or press Page Up and Page Down to change it by 5 degrees (Shift for 1 degree), End or double-click the diamond to reset. Up and down arrows change height, Alt with the arrows aims the antenna. The shaded wedge is the half-power beam, the dotted line is the radiating element.' + ' ' + ANTENNA_LEGEND_TEXT + '', terms: ['Tx','Rx','LOS'] },
  meters: { title: 'Meters', text: 'Live RF level at the receiver and the audio level after the squelch. The squelch mutes the audio when the radio level falls below its threshold, which avoids a burst of noise.', terms: ['RF','dBm','dB','CNR'] },
  waterfall: { title: 'Waterfall', text: 'Follows the signal step by step: transmit power, antenna gains, distance loss, cable loss and boosters, down to the receiver input. A long cable or lossy part shows up as a big drop at that step.', terms: ['dB','dBm','dBi','FSPL','Tx','Rx','NF','LNA','RG58','LMR','SMA','BNC','N-type'] },
  inspector: { title: 'Inspector', text: 'Exact values for the selected item: power, antenna type and direction, height, cables and boosters. Cable loss grows with length and frequency; a booster helps only if it sits before the lossy cable. Interference (Environment, 2.4 and 5.8 GHz only) models the crowding of the shared ISM band by Wi-Fi and Bluetooth: it raises the noise floor by the dB shown, so the margin drops by the same amount. Rotating a platform turns it about its centre. External RF noise (Environment) is the hiss of the surroundings picked up by the antenna: it raises the noise floor, so a noisy venue needs more signal for the same margin. Equipment presets (Transmitter and Receiver) load published figures for common analogue FM radio mics: power options, FM deviation, tuning window and step, squelch and diversity. Every figure the manufacturer does not state is labelled assumed. Presets are based on published specs, are not certified, and never block your own values. SINAD is the audio quality measure used for FM receiver sensitivity. HiDyn is a compander and Tonekey a pilot tone; neither is modelled. Low-intermod mode assumes a 6 dB intermodulation benefit.', terms: ['dBm','dBi','dB','Tx','Rx','RF','VSWR','LNA','NF','IIP3','P1dB','UHF','ISM','SINAD','HiDyn','Tonekey'] },
  scenes: { title: 'Saved scenes', text: 'Keeps named copies of your scene inside this browser only. They are not uploaded, and clearing site data removes them. For a copy you can keep or send, use Save (file) or Share (link).', terms: [] },
  coordination: { title: 'Frequency coordination', text: 'Chooses frequencies for several microphones and IEMs so that the unwanted products they create when mixed (such as 2f1-f2) do not land on a channel in use. Each band shows its licence class and power limit (ERP is measured against a dipole, EIRP against an isotropic radiator: EIRP = ERP + 2.15 dB), flagged when it comes from a draft document or is unverified. Always check licensing and the local TV channels.', terms: ['IM3', 'IEM', 'TV', 'UHF', 'VHF', 'DAB', 'ISM', 'ERP', 'EIRP', 'PMSE', 'SSP', 'SRD', 'ch38'] },
  compare: { title: 'Compare A / B', text: 'Remember a scene as A, change something, and see how received power, margin, SNR and the end-to-end total shift in dB. Good for "with or without the booster" questions.', terms: ['dB','dBm','SNR','NF'] },
  imd: { title: 'Intermodulation', text: 'Transmitters close together, or close to a receive antenna, mix in the first stage they reach and make extra signals at other frequencies (such as 2f1-f2). One that lands on a channel in use becomes hiss, a tone or a dropout. This view reads the in-ear transmitters, combiners and mic links from the rack, and the table lists the worst product at each receiver. To fix a hit: move a frequency, add isolation (isolators, an isolated combiner) or move the antennas apart.', terms: ['IM3','IM5','PIM','IIP3','RF','Tx','Rx'] },
  diversity: { title: 'Antenna diversity', text: 'Two receive antennas let the receiver pick or combine the better one. Because fades depend on position, two antennas a fraction of a metre apart rarely fade at the same moment.', terms: ['Rx','RF','dB'] },
  coverage: { title: 'Coverage zones', text: 'Colours the stage by how much margin a receiver would have at each spot. Dead spots appear where reflections cancel the direct signal or a wall blocks it.', terms: ['dB','dBm','Rx','Tx'] },
  mpx: { title: 'Stereo multiplex', text: 'In-ear monitors send left and right audio plus a 19 kHz pilot tone on one FM carrier. A weak signal makes the receiver blend towards mono to keep the hiss down. The spectrum of this multiplex is in the bottom bar (MPX spectrum).', terms: ['MPX','FM','CNR','dB'] },
  digital: { title: 'Digital link', text: 'Digital links stay clean until the signal-to-noise ratio gets too low for the chosen modulation, then fail suddenly (the "cliff"). Error correction stretches the usable range.', terms: ['BER','EVM','MER','FEC','QAM','QPSK','BPSK','Es/N0','Eb/N0','SNR'] },
  telemetry: { title: 'Telemetry and battery', text: 'Battery level reported back over the radio link. As the battery runs down the transmit power sags, which lowers the margin at the receiver.', terms: ['PER','Tx','Rx','dB'] },
  spectra: { title: 'Spectra', text: 'Spectrum views for the selected link (the Intermod button beside the title swaps them for the intermod view): Audio spectrum (a simulated voice or music signal, not real audio), MPX spectrum (the FM stereo multiplex: pilot, stereo difference signal) and RF spectrum (the own carrier of this link against the receiver channel and noise floor; noise sources in the channel raise the floor in time with the plan rings). Shapes are illustrative; the received level and noise floor are the planner numbers.', terms: ['FM','MPX','dBm'] },
  timeline: { title: 'Timeline', text: 'The last couple of minutes of RF level, squelch state and audio, so you can see when a walk or an edit caused a dropout.', terms: ['RF','dBm'] },
});

/** Section ids that get a "What's this?" row, in sidebar order, and the panes handled separately. */
export const HELP_SIDEBAR_IDS = ['rack', 'venue-builder', 'people-panel', 'p2p-panel', 'results', 'meters', 'mpx', 'diversity', 'telemetry', 'digital', 'coverage', 'imd', 'scenes', 'compare', 'coordination', 'inspector', 'waterfall', 'timeline', 'spectra'];

function makeToggle(topic, id) {
  const wrap = document.createElement('div');
  wrap.className = 'ob-help';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ob-help-btn';
  btn.textContent = "What's this?";
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', `help-${id}`);
  btn.setAttribute('aria-label', `What's this? ${topic.title}`);
  btn.title = `Plain-language explanation of ${topic.title}`;
  const pop = document.createElement('p');
  pop.id = `help-${id}`; pop.className = 'ob-help-text'; pop.hidden = true;
  const b = document.createElement('strong');
  b.textContent = topic.title + ': ';
  pop.append(b, document.createTextNode(topic.text));
  const lg = legend(topic.terms || []);
  if (lg) { const t = document.createElement('span'); t.className = 'ob-help-terms'; t.textContent = ` Terms: ${lg}.`; pop.append(t); }
  btn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  wrap.append(btn, pop);
  return wrap;
}

/** Add title tooltips to the toolbar controls (and their wrapping label for inputs and selects). */
export function applyTooltips(root = document) {
  for (const [id, text] of Object.entries(TOOLTIPS)) {
    const el = root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
    if (!el) continue;
    el.title = text;
    const label = el.closest && el.closest('label');
    if (label) label.title = text;
  }
}

/**
 * Add a "What's this?" row before each major panel. A panel that is hidden or empty gets its row hidden too
 * (the panels are filled in later by their own modules, hence the observer).
 */
export function mountHelp(root = document) {
  applyTooltips(root);
  applyTextTips(root);
  if (typeof MutationObserver === 'function' && root.body) {
    let queued = false; // coalesced: live readouts change the page every frame
    new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; applyTextTips(root); }, 400); }).observe(root.body, { childList: true, subtree: true });
  }
  const targets = HELP_SIDEBAR_IDS.map((id) => [id, root.getElementById(id)]).filter(([, el]) => el);
  for (const [id, el] of targets) {
    const topic = HELP_TOPICS[id];
    if (!topic) continue;
    const row = makeToggle(topic, id);
    el.parentNode.insertBefore(row, el);
    const sync = () => { row.hidden = el.hidden || (el.childElementCount === 0 && !el.textContent.trim()); };
    sync();
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['hidden'], childList: true });
  }
  for (const [id, label] of [['plan', 'Plan view'], ['side', 'Side view']]) {
    const pane = [...root.querySelectorAll('.pane')].find((p) => p.getAttribute('aria-label') === label);
    if (!pane) continue;
    const h2 = pane.querySelector('h2');
    const row = makeToggle(HELP_TOPICS[id], id);
    row.classList.add('ob-help-pane');
    if (h2) h2.after(row); else pane.prepend(row);
  }
}
