// Tooltips for the toolbar and a "What's this?" explanation per major panel.
import { legend } from './glossary.js';
// TOOLTIPS and HELP_TOPICS are plain data (tested in Node); applyHelp() touches the DOM.

export const TOOLTIPS = Object.freeze({
  'btn-mic': 'Wireless microphone: the transmitter is on the performer, the receiver is off-stage.',
  'btn-iem': 'In-ear monitor: the transmitter is off-stage, the receiver is a bodypack on the performer.',
  freq: 'Carrier frequency in MHz. Higher frequencies lose more in cables and have shorter wavelengths.',
  floor: 'Floor material: sets how strongly the floor reflects the signal, which can add to or cancel the direct path.',
  'btn-two-ray': 'Two-ray model: direct path plus floor and wall reflections, added with their phases. Shows fades and nulls.',
  'btn-free-space': 'Free-space model: direct path only, as if there were no floor or walls.',
  'u-dbm': 'Show powers in dBm (decibels relative to 1 milliwatt).',
  'u-dbw': 'Show powers in dBW (decibels relative to 1 watt; 30 less than dBm).',
  'u-mw': 'Show powers in milliwatts.',
  'u-m': 'Show lengths in metres.',
  'u-ft': 'Show lengths in feet.',
  'btn-undo': 'Undo the last change (Ctrl+Z).',
  'btn-redo': 'Redo the change you just undid (Ctrl+Shift+Z).',
  'btn-walk-all': 'Walk every microphone and Intermod transmitter together by the same shift. Press again to stop.',
  'btn-walk': 'Move the transmitter along a path automatically so you can watch the level and margin change.',
  'walk-speed': 'Walking speed in metres per second (a stroll is about 1.2).',
  'walk-to': 'Where the walk ends: back on stage, or out until the signal is lost.',
  'mod-fm': 'Analog FM link: noise rises gradually as the signal weakens.',
  'mod-digital': 'Digital link: clean audio until a cliff, then drop-outs.',
  'btn-batt': 'Start or pause the virtual battery drain (sped up by the Time x factor).',
  'btn-batt-reset': 'Refill the virtual battery.',
  'batt-scale': 'How many times faster than real time the battery drains.',
  'btn-modlab': 'Open the Modulation lab: animated AM, FM, digital, stereo FM and radio-mic tone-key demonstrations with spectra.',
  'btn-imd': 'Show intermodulation: unwanted extra signals made when several transmitters mix.',
  'cov-mode': 'How the signals from several transmit antennas are added when drawing coverage.',
  examples: 'Load a ready-made example scene with a note explaining what to look at.',
  'btn-share': 'Copy a link that contains this whole scene. Nothing is uploaded.',
  'btn-report': 'Open a printable link-budget report.',
  'btn-save': 'Download the scene as a JSON file.',
  'btn-load': 'Load a scene from a JSON file.',
  'btn-help': 'Show or hide the Start here guide.',
  'btn-reset': 'Throw away the current scene and go back to the default stage (asks first; Undo can bring it back).',
});

export const HELP_TOPICS = Object.freeze({
  results: { title: 'Link budget', text: 'Adds up what the signal gains and loses from transmitter to receiver. Margin is how many dB the signal is above the level the receiver needs: 6 dB or more is a pass, 0 to 6 is marginal, below 0 will drop out. Every 6 dB lost halves the range in free space.', terms: ['dBm','dB','Tx','Rx','NF','SNR'] },
  plan: { title: 'Plan view', text: 'The stage from above, drawn to scale. Coordinates are stage-relative: x = 0 is the centre line (positive to the right), y = 0 is the front edge (positive upstage, negative toward the audience). The lobe around an antenna shows where it hears or radiates best. Radio waves bounce off walls and the floor, so moving a few centimetres can change the level a lot.', terms: ['Tx','Rx','dBi'] },
  side: { title: 'Side view', text: 'A vertical slice along the transmitter-to-receiver line. The direct ray and the floor-bounce ray arrive at slightly different times; when they are out of step they cancel, which is why antenna height matters.', terms: ['Tx','Rx','LOS'] },
  meters: { title: 'Meters', text: 'Live RF level at the receiver and the audio level after the squelch. The squelch mutes the audio when the radio level falls below its threshold, which avoids a burst of noise.', terms: ['RF','dBm','dB','CNR'] },
  waterfall: { title: 'Waterfall', text: 'Follows the signal step by step: transmit power, antenna gains, distance loss, cable loss and boosters, down to the receiver input. A long cable or lossy part shows up as a big drop at that step.', terms: ['dB','dBm','dBi','FSPL','Tx','Rx','NF','LNA','RG58','LMR','SMA','BNC','N-type'] },
  inspector: { title: 'Inspector', text: 'Exact values for the selected item: power, antenna type and direction, height, cables and boosters. Cable loss grows with length and frequency; a booster helps only if it sits before the lossy cable. Interference (Environment, 2.4 and 5.8 GHz only) models the crowding of the shared ISM band by Wi-Fi and Bluetooth: it raises the noise floor by the dB shown, so the margin drops by the same amount. Rotating a platform turns it about its centre. External RF noise (Environment) is the hiss of the surroundings picked up by the antenna: it raises the noise floor, so a noisy venue needs more signal for the same margin. Equipment presets (Transmitter and Receiver) load published figures for common analogue FM radio mics: power options, FM deviation, tuning window and step, squelch and diversity. Every figure the manufacturer does not state is labelled assumed. Presets are based on published specs, are not certified, and never block your own values. SINAD is the audio quality measure used for FM receiver sensitivity. HiDyn is a compander and Tonekey a pilot tone; neither is modelled. Low-intermod mode assumes a 6 dB intermodulation benefit.', terms: ['dBm','dBi','dB','Tx','Rx','RF','VSWR','LNA','NF','IIP3','P1dB','UHF','ISM','SINAD','HiDyn','Tonekey'] },
  scenes: { title: 'Saved scenes', text: 'Keeps named copies of your scene inside this browser only. They are not uploaded, and clearing site data removes them. For a copy you can keep or send, use Save (file) or Share (link).', terms: [] },
  coordination: { title: 'Frequency coordination', text: 'Chooses frequencies for several microphones and IEMs so that the unwanted products they create when mixed (such as 2f1-f2) do not land on a channel in use. Each band shows its licence class and power limit (ERP is measured against a dipole, EIRP against an isotropic radiator: EIRP = ERP + 2.15 dB), flagged when it comes from a draft document or is unverified. Always check licensing and the local TV channels.', terms: ['IM3', 'IEM', 'TV', 'UHF', 'VHF', 'DAB', 'ISM', 'ERP', 'EIRP', 'PMSE', 'SSP', 'SRD', 'ch38'] },
  compare: { title: 'Compare A / B', text: 'Remember a scene as A, change something, and see how received power, margin, SNR and the end-to-end total shift in dB. Good for "with or without the booster" questions.', terms: ['dB','dBm','SNR','NF'] },
  imd: { title: 'Intermodulation', text: 'When several transmitters are close to a receiver antenna, their signals mix in its front end and create extra frequencies (products such as 2f1-f2). If one lands on a wanted channel it raises the noise floor.', terms: ['IM3','IM5','PIM','IIP3','RF','Tx','Rx'] },
  diversity: { title: 'Antenna diversity', text: 'Two receive antennas let the receiver pick or combine the better one. Because fades depend on position, two antennas a fraction of a metre apart rarely fade at the same moment.', terms: ['Rx','RF','dB'] },
  coverage: { title: 'Coverage zones', text: 'Colours the stage by how much margin a receiver would have at each spot. Dead spots appear where reflections cancel the direct signal or a wall blocks it.', terms: ['dB','dBm','Rx','Tx'] },
  mpx: { title: 'Stereo multiplex', text: 'In-ear monitors send left and right audio plus a 19 kHz pilot tone on one FM carrier. A weak signal makes the receiver blend towards mono to keep the hiss down.', terms: ['MPX','FM','CNR','dB'] },
  digital: { title: 'Digital link', text: 'Digital links stay clean until the signal-to-noise ratio gets too low for the chosen modulation, then fail suddenly (the "cliff"). Error correction stretches the usable range.', terms: ['BER','EVM','MER','FEC','QAM','QPSK','BPSK','Es/N0','Eb/N0','SNR'] },
  telemetry: { title: 'Telemetry and battery', text: 'Battery level reported back over the radio link. As the battery runs down the transmit power sags, which lowers the margin at the receiver.', terms: ['PER','Tx','Rx','dB'] },
  timeline: { title: 'Timeline', text: 'The last couple of minutes of RF level, squelch state and audio, so you can see when a walk or an edit caused a dropout.', terms: ['RF','dBm'] },
});

/** Section ids that get a "What's this?" row, in sidebar order, and the panes handled separately. */
export const HELP_SIDEBAR_IDS = ['results', 'meters', 'mpx', 'diversity', 'telemetry', 'digital', 'coverage', 'imd', 'scenes', 'compare', 'coordination', 'inspector', 'waterfall', 'timeline'];

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
