// Glossary of acronyms and abbreviations with plain-language meanings, plus an accessible tooltip helper.
//   GLOSSARY: { term: { full, meaning, wrap? } }   wrap:false = documented (used in help legends) but not auto-wrapped (ordinary words)
//   findTerms(text) -> [{ term, start, end }]       pure, used by the DOM helper and by tests
//   mountGlossary(root?) -> { destroy, scan }      wraps known terms in <abbr>, shows one shared popover
// The popover opens on hover, keyboard focus, or tap/click (not hover-only) and closes on Escape or outside tap.

export const GLOSSARY = Object.freeze({
  RF: { full: 'Radio frequency', meaning: 'The radio signal itself, as opposed to the audio it carries.' },
  IEM: { full: 'In-ear monitor', meaning: 'A wireless system that sends the performer a personal mix to earphones.' },
  Tx: { full: 'Transmitter', meaning: 'The device that sends the radio signal (the microphone, or the IEM base unit).' },
  Rx: { full: 'Receiver', meaning: 'The device that picks the radio signal up (the mic receiver, or the IEM bodypack).' },
  dB: { full: 'Decibel', meaning: 'A ratio on a log scale. +3 dB is double the power, +10 dB is ten times, -6 dB roughly halves the range.' },
  dBm: { full: 'Decibels relative to 1 milliwatt', meaning: 'A power level: 0 dBm is 1 mW, 20 dBm is 100 mW, -90 dBm is a very faint signal.' },
  dBW: { full: 'Decibels relative to 1 watt', meaning: 'A power level that is always 30 less than the same power in dBm.' },
  dBi: { full: 'Decibels relative to an isotropic antenna', meaning: 'Antenna gain compared with an imaginary antenna that radiates equally in every direction.' },
  EIRP: { full: 'Effective isotropic radiated power', meaning: 'Transmit power plus antenna gain: how strong the signal is in its best direction.' },
  ERP: { full: 'Effective radiated power', meaning: 'Radiated power referenced to a half-wave dipole antenna. EIRP is referenced to an isotropic radiator, so EIRP = ERP + 2.15 dB.' },
  SINAD: { full: 'Signal, noise and distortion to noise and distortion ratio', meaning: 'The audio quality figure used for analogue FM receivers, in dB. A sensitivity quoted at 12 dB SINAD is the weakest signal that still gives that audio quality; it is not the same as an RF carrier-to-noise ratio.' },
  HiDyn: { full: 'High-dynamics compander (Sennheiser HDX family)', meaning: 'Audio compression before the transmitter and matching expansion after the receiver, so quiet sounds stay clear of the radio noise. Manufacturer compander names differ; the planner does not model its audio effect.' },
  Tonekey: { full: 'Pilot tone (Tonekey on Shure)', meaning: 'A sub-audible tone sent with the audio that opens the receiver squelch only for its own transmitter. It is not the 19 kHz stereo pilot of broadcast FM. A wireless-mic tone near 32.768 kHz is a medium-confidence figure; check the maker manual.' },
  'FM deviation': { full: 'FM deviation', meaning: 'How far the carrier frequency swings at full audio level, in kHz (for example plus or minus 48 kHz). More deviation gives a cleaner signal at good strength but needs more bandwidth. Preset values are marked assumed unless a manual states them.', wrap: false },
  'low-intermod': { full: 'Low-intermod mode', meaning: 'A reduced-power transmitter mode with a cleaner output stage so it creates weaker intermodulation products. The planner assumes a 6 dB benefit; makers claim around 30 percent more usable channels. Both are assumptions.', wrap: false },
  FSPL: { full: 'Free-space path loss', meaning: 'How much the signal weakens just by spreading out over distance, with nothing in the way.' },
  SNR: { full: 'Signal-to-noise ratio', meaning: 'How far the wanted signal stands above the background noise, in dB. Higher is cleaner.' },
  CNR: { full: 'Carrier-to-noise ratio', meaning: 'Signal-to-noise ratio measured on the radio carrier before demodulation.' },
  CIR: { full: 'Carrier-to-interference ratio', meaning: 'How far the wanted carrier stands above an unwanted signal on the same channel.' },
  'C/I': { full: 'Carrier-to-interference ratio', meaning: 'How far the wanted carrier stands above an unwanted signal on the same channel.' },
  NF: { full: 'Noise figure', meaning: 'How much extra noise a stage adds, in dB. Lower is better; a cable loses signal so its NF equals its loss.' },
  IIP3: { full: 'Input third-order intercept point', meaning: 'A measure of how strong a signal the receiver can take before it starts creating intermodulation. Higher is tougher.' },
  IM3: { full: 'Third-order intermodulation', meaning: 'Unwanted signal at 2f1-f2 made when two transmitters mix in a non-linear stage. The most common offender.' },
  IM5: { full: 'Fifth-order intermodulation', meaning: 'A weaker, wider-spaced intermodulation product (3f1-2f2) made in the same way as IM3.' },
  P1dB: { full: '1 dB compression point', meaning: 'The input level at which an amplifier or receiver front end has lost 1 dB of gain because it is being overdriven.' },
  PIM: { full: 'Passive intermodulation', meaning: 'Intermodulation made by corroded or loose metal joints, connectors or rusty metalwork, not by electronics.' },
  MPX: { full: 'Stereo multiplex', meaning: 'The way left and right audio plus a 19 kHz pilot tone share one FM carrier.' },
  FM: { full: 'Frequency modulation', meaning: 'Audio is carried by slightly varying the frequency of the radio carrier. Hiss rises gradually as the signal weakens.' },
  AM: { full: 'Amplitude modulation', meaning: 'Audio is carried by varying the strength of the radio carrier.' },
  ASK: { full: 'Amplitude-shift keying', meaning: 'Digital modulation that sends bits by switching the carrier strength between levels (on-off keying is the simplest form).' },
  FSK: { full: 'Frequency-shift keying', meaning: 'Digital modulation that sends bits by switching the carrier between two or more frequencies.' },
  PSK: { full: 'Phase-shift keying', meaning: 'Digital modulation that sends bits by shifting the phase of the carrier (BPSK, QPSK).' },
  'M/S': { full: 'Mid/side', meaning: 'Splitting stereo into M = (L+R)/2, what a mono receiver plays, and S = (L-R)/2, the difference that makes the stereo width.' },
  RDS: { full: 'Radio data system', meaning: 'A slow data stream (station name, traffic flags) carried on a 57 kHz subcarrier inside an FM stereo signal.' },
  Carson: { full: "Carson's rule", meaning: 'A rule of thumb for FM bandwidth: 2 x (peak deviation + highest modulating frequency).' },
  BPSK: { full: 'Binary phase-shift keying', meaning: 'Digital modulation with 1 bit per symbol: very robust, low data rate.' },
  QPSK: { full: 'Quadrature phase-shift keying', meaning: 'Digital modulation with 2 bits per symbol: robust and moderate data rate.' },
  QAM: { full: 'Quadrature amplitude modulation', meaning: 'Digital modulation that packs more bits per symbol (16-QAM = 4, 64-QAM = 6) but needs a cleaner signal.' },
  BER: { full: 'Bit error rate', meaning: 'The fraction of received bits that are wrong. Digital audio breaks up once this rises too far.' },
  EVM: { full: 'Error vector magnitude', meaning: 'How far received digital symbols land from their ideal positions, as a percentage. Lower is cleaner.' },
  MER: { full: 'Modulation error ratio', meaning: 'The same idea as EVM expressed in dB: how clean the received digital constellation is. Higher is better.' },
  FEC: { full: 'Forward error correction', meaning: 'Extra bits sent so the receiver can repair some errors without asking for a resend.' },
  PER: { full: 'Packet error rate', meaning: 'The fraction of data packets lost, for example the battery telemetry packets.' },
  'Es/N0': { full: 'Symbol energy to noise density', meaning: 'Signal energy per digital symbol compared with noise, the usual way to judge a digital link.' },
  'Eb/N0': { full: 'Bit energy to noise density', meaning: 'Signal energy per data bit compared with noise.' },
  VSWR: { full: 'Voltage standing-wave ratio', meaning: 'How well an antenna matches its cable. 1:1 is perfect; high values reflect power back.' },
  LNA: { full: 'Low-noise amplifier', meaning: 'A booster placed near the antenna that adds gain while adding very little noise of its own.' },
  AGC: { full: 'Automatic gain control', meaning: 'A receiver circuit that turns its gain down on strong signals to avoid overload.' },
  PLL: { full: 'Phase-locked loop', meaning: 'The circuit that holds a transmitter or receiver precisely on its frequency.' },
  UHF: { full: 'Ultra high frequency', meaning: 'Radio from 300 MHz to 3 GHz, where most wireless microphones work.' },
  VHF: { full: 'Very high frequency', meaning: 'Radio from 30 to 300 MHz, used by some older wireless microphones.' },
  ISM: { full: 'Industrial, scientific and medical band', meaning: 'Licence-exempt radio bands (such as 2.4 and 5.8 GHz) shared by Wi-Fi, Bluetooth, microwave ovens and many wireless audio systems.' },
  DAB: { full: 'Digital audio broadcasting', meaning: 'Digital radio, which in Europe sits in the VHF Band III TV band (blocks such as 5A to 10D) and must be avoided there.' },
  PMSE: { full: 'Programme making and special events', meaning: 'The UK name for wireless microphones, in-ear monitors and similar equipment used in broadcasting, theatre, music and events.' },
  SSP: { full: 'Shared spectrum permission', meaning: 'A permission to use a band that is shared with other users, as opposed to a protected licence. Check the wording of the current rules.' },
  SRD: { full: 'Short-range device', meaning: 'Low-power licence-exempt radio equipment (such as Wi-Fi and Bluetooth) that must accept interference from other users.' },
  ch38: { full: 'UK channel 38 (606.5-613.5 MHz)', meaning: 'A UK TV channel set aside for wireless microphones under the shared microphone licence: not protected from other users.' },
  TV: { full: 'Television', meaning: 'Television channels share the UHF band with wireless microphones, which is why some channels are unavailable.' },
  LOS: { full: 'Line of sight', meaning: 'A clear straight path between transmitter and receiver antennas.' },
  TE: { full: 'Transverse electric', meaning: 'Horizontal polarisation: the electric field is parallel to the reflecting surface.' },
  TM: { full: 'Transverse magnetic', meaning: 'Vertical polarisation: the electric field lies in the plane of incidence.' },
  SMA: { full: 'SubMiniature version A connector', meaning: 'A small threaded RF connector common on bodypacks and antennas.' },
  BNC: { full: 'Bayonet Neill-Concelman connector', meaning: 'A quick-twist RF connector used on receivers and antenna cables.' },
  'N-type': { full: 'N-type connector', meaning: 'A larger, weatherproof RF connector with low loss, used on antennas and long cables.' },
  RG58: { full: 'RG-58 coaxial cable', meaning: 'A thin, common coax cable that loses a lot of signal at UHF over long runs.' },
  LMR: { full: 'LMR low-loss coaxial cable', meaning: 'A family of thicker coax cables that lose much less signal than RG58.' },
  MHz: { full: 'Megahertz', meaning: 'Millions of cycles per second: the unit for the carrier frequency.' },
  kHz: { full: 'Kilohertz', meaning: 'Thousands of cycles per second: used for channel widths and audio tones.' },
  GHz: { full: 'Gigahertz', meaning: 'Billions of cycles per second.' },
  mW: { full: 'Milliwatt', meaning: 'One thousandth of a watt. Handheld microphones typically transmit 10 to 50 mW.' },
  'external noise': { full: 'External RF noise', meaning: 'Unwanted radio noise from TV transmitters, electronics and other sources picked up by the antenna. It raises the noise floor, so it lowers SNR and margin, and it is stronger at lower frequencies.', wrap: false },
  // plain words that are documented for the help legends but not auto-wrapped
  'pre-emphasis': { full: 'Pre-emphasis', meaning: 'A treble boost (50 us in Europe, 75 us in the US) applied before an FM transmitter. The receiver de-emphasis cuts the treble back, which also cuts the hiss, so the audio is flat again with less noise. Both ends must match.', wrap: false },
  'de-emphasis': { full: 'De-emphasis', meaning: 'The receiver treble cut that undoes the transmitter pre-emphasis and lowers the FM hiss. If it is missing the audio sounds bright; if the time constant is wrong the treble is off by a few dB.', wrap: false },
  compander: { full: 'Compander', meaning: 'Compressor before the radio link and expander after it. Quiet sounds are lifted above the channel noise, then pushed back down, which cuts the noise. A mismatched pair gives level errors, and the noise can be heard to breathe with the signal.', wrap: false },
  squelch: { full: 'Squelch', meaning: 'A gate that mutes the audio when the radio signal is too weak, so you hear silence instead of noise.', wrap: false },
  diversity: { full: 'Antenna diversity', meaning: 'Using two receive antennas and choosing or combining the better, since fades rarely hit both at once.', wrap: false },
  Fresnel: { full: 'Fresnel zone', meaning: 'The ellipsoid of space around the direct path that should be clear of obstacles for full signal strength.', wrap: false },
  margin: { full: 'Link margin', meaning: 'How many dB the signal is above what the receiver needs. Below 0 the link drops out.', wrap: false },
  multipath: { full: 'Multipath', meaning: 'The same signal arriving by several paths (direct, floor, walls) that add up or cancel.', wrap: false },
});

// Aliases that map to a glossary key (same meaning, different spelling in the UI).
export const ALIASES = Object.freeze({ TX: 'Tx', RX: 'Rx' });

const wrapTerms = () => [...Object.keys(GLOSSARY).filter((k) => GLOSSARY[k].wrap !== false), ...Object.keys(ALIASES)];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
let termRe = null;
function getRe() {
  if (!termRe) {
    const alt = wrapTerms().sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    termRe = `(?<![A-Za-z0-9_/])(${alt})(?![A-Za-z0-9_])`;
  }
  return termRe;
}

export function lookup(term) {
  const key = GLOSSARY[term] ? term : ALIASES[term];
  return key ? GLOSSARY[key] : null;
}

/** Positions of known terms in a string. Case-sensitive on purpose (so "per" and "tv" are never touched). */
export function findTerms(text) {
  const out = [];
  const re = new RegExp(getRe(), 'g');
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push({ term: m[1], start: m.index, end: m.index + m[1].length });
  return out;
}

/** Terms from the glossary that occur in a piece of text (for legends and tests). */
export function termsIn(text) { return [...new Set(findTerms(text).map((t) => t.term))]; }

const SKIP = new Set(['SCRIPT', 'STYLE', 'CANVAS', 'BUTTON', 'SELECT', 'OPTION', 'TEXTAREA', 'INPUT', 'ABBR', 'SUMMARY', 'NOSCRIPT', 'SVG', 'CODE', 'PRE']);

function shouldSkip(el) {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName.toUpperCase())) return true;
    if (e.hasAttribute && (e.hasAttribute('data-no-gloss') || e.id === 'ob-glossary-pop')) return true;
    if (e.isContentEditable) return true;
  }
  return false;
}

/** Wrap the known terms inside the text nodes under `root`. Returns the number of wrapped terms. */
export function annotate(root, doc = root.ownerDocument || document) {
  let n = 0;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || shouldSkip(parent)) continue;
    const hits = findTerms(node.nodeValue);
    if (!hits.length) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const h of hits) {
      if (h.start > last) frag.append(node.nodeValue.slice(last, h.start));
      const a = doc.createElement('abbr');
      a.className = 'gl';
      a.dataset.gl = h.term;
      a.tabIndex = 0;
      a.textContent = h.term;
      frag.append(a);
      last = h.end;
      n++;
    }
    if (last < node.nodeValue.length) frag.append(node.nodeValue.slice(last));
    node.replaceWith(frag);
  }
  return n;
}

/** Compact legend "RF: radio frequency; ..." for a list of terms (used in the What's this? text of canvas panels). */
export function legend(terms) {
  return terms.map((t) => { const g = lookup(t); return g ? `${t} = ${g.full.toLowerCase()}` : null; }).filter(Boolean).join('; ');
}

export function mountGlossary(root = document.body) {
  const doc = root.ownerDocument || document;
  const pop = doc.createElement('div');
  pop.id = 'ob-glossary-pop';
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  const title = doc.createElement('strong');
  const text = doc.createElement('span');
  pop.append(title, doc.createElement('br'), text);
  doc.body.append(pop);

  let current = null;
  function show(el) {
    const g = lookup(el.dataset.gl);
    if (!g) return;
    if (current && current !== el) current.removeAttribute('aria-describedby');
    current = el;
    title.textContent = `${el.dataset.gl}: ${g.full}`;
    text.textContent = g.meaning;
    pop.hidden = false;
    el.setAttribute('aria-describedby', pop.id);
    const r = el.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    pop.style.left = '0px'; pop.style.top = '0px';
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), Math.max(8, vw - pw - 8));
    let top = r.bottom + 6;
    if (top + ph > doc.documentElement.clientHeight - 4 && r.top - ph - 6 > 4) top = r.top - ph - 6;
    pop.style.left = `${left + (doc.defaultView ? doc.defaultView.scrollX : 0)}px`;
    pop.style.top = `${top + (doc.defaultView ? doc.defaultView.scrollY : 0)}px`;
  }
  function hide() {
    pop.hidden = true;
    if (current) { current.removeAttribute('aria-describedby'); delete current.dataset.tapped; }
    current = null;
  }
  const target = (e) => (e.target && e.target.closest ? e.target.closest('abbr.gl') : null);
  doc.addEventListener('mouseover', (e) => { const a = target(e); if (a) show(a); });
  doc.addEventListener('mouseout', (e) => { const a = target(e); if (a && a !== doc.activeElement) hide(); });
  doc.addEventListener('focusin', (e) => { const a = target(e); if (a) show(a); });
  doc.addEventListener('focusout', (e) => { if (target(e)) hide(); });
  doc.addEventListener('click', (e) => { const a = target(e); if (a) { if (current === a && !pop.hidden && e.detail !== 0 && a.dataset.tapped === '1') { delete a.dataset.tapped; hide(); } else { a.dataset.tapped = '1'; show(a); } } else hide(); });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) hide(); });
  doc.addEventListener('scroll', hide, true);

  const scan = (node = root) => { try { annotate(node, doc); } catch (err) { console.error(err); } };
  scan();
  // Dynamic text: re-annotate what changed, coalesced so fast-updating meters stay cheap.
  const pending = new Set();
  let timer = null;
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.type === 'characterData' ? r.target.parentElement : r.target;
      if (el && el.nodeType === 1 && !(el.tagName === 'ABBR') && el.id !== 'ob-glossary-pop') pending.add(el);
    }
    if (pending.size && !timer) timer = setTimeout(() => {
      timer = null;
      const els = [...pending]; pending.clear();
      for (const el of els) if (el.isConnected) scan(el);
    }, 120);
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  return { scan, hide, destroy() { mo.disconnect(); pop.remove(); } };
}
