// Equipment pickers for one link (transmitter model, power, modulation, receiver model), shared by the Radio items list.
// part: 'tx' (transmitter end), 'rx' (receiver end) or 'all'. Each change is one undoable step through the same actions the inspector uses.
import { gearOptions, powerChoices } from '../model/inventory.js';
import { setTxFmPreset, setRxFmPreset, setTxPowerOption, setModulation } from '../actions.js';
import { DIGITAL_PRESETS } from '../model/digital-params.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  /** Transmitter model, power and receiver model selects for one link. Each change is one undoable step through the same actions the inspector uses. */
export function gearPickers(store, link, part = 'all') {
    const opts = gearOptions(link), wrap = el('div', 'inv-gear');
    const mod = link.modulation || { type: 'analog-fm', digital: {} };
    const pick = (label, items, current, onPick) => {
      const lab = el('label', 'inv-field'); lab.append(el('span', '', label));
      const sel = el('select'); sel.setAttribute('aria-label', `${label} for ${link.name}`);
      for (const [v, t] of items) sel.append(Object.assign(el('option', '', t), { value: v }));
      sel.value = current; sel.addEventListener('change', () => onPick(sel.value)); lab.append(sel); return lab;
    };
    const wantTx = part !== 'rx', wantRx = part !== 'tx';
    if (wantTx) wrap.append(pick('Modulation', [['analog-fm', 'Analog FM'], ['digital', 'Digital']], mod.type, (v) => setModulation(store, link.id, { type: v })));
    if (wantTx && mod.type === 'digital') {
      wrap.append(pick('Digital preset', Object.entries(DIGITAL_PRESETS).map(([id, p]) => [id, p.label || id]), (mod.digital && mod.digital.preset) || '', (v) => setModulation(store, link.id, { preset: v, fixedOrder: null })));
      wrap.append(pick('Digital order', [['', 'Adaptive'], ['2', 'BPSK'], ['4', 'QPSK'], ['16', '16-QAM'], ['64', '64-QAM'], ['256', '256-QAM']], mod.digital && mod.digital.fixedOrder ? String(mod.digital.fixedOrder) : '', (v) => setModulation(store, link.id, { fixedOrder: v ? Number(v) : null })));
    }
    if (!opts.tx.length && !opts.rx.length) return wrap;
    const field = (label, current, list, generic, onPick) => {
      const lab = el('label', 'inv-field'); lab.append(el('span', '', label));
      const sel = el('select'); sel.setAttribute('aria-label', `${label} for ${link.name}`);
      if (generic) sel.append(Object.assign(el('option', '', generic), { value: '' }));
      const groups = [[`Tunes at ${link.freqMHz} MHz`, list.filter((o) => o.tunes)], ['Does not tune at this frequency', list.filter((o) => !o.tunes)]];
      for (const [title, items] of groups) {
        if (!items.length) continue;
        const og = el('optgroup'); og.label = title;
        for (const o of items) og.append(Object.assign(el('option', '', o.label + (o.assumed ? ' *' : '')), { value: o.id }));
        sel.append(og);
      }
      sel.value = current || '';
      sel.addEventListener('change', () => onPick(sel.value));
      lab.append(sel); return lab;
    };
    if (wantTx) wrap.append(field('Transmitter model', link.tx.fmPreset, opts.tx, 'Generic (no model)', (id) => setTxFmPreset(store, link.id, id)));
    const pc = powerChoices(link);
    if (wantTx && pc.options.length) {
      const lab = el('label', 'inv-field'); lab.append(el('span', '', 'Transmit power'));
      const sel = el('select'); sel.setAttribute('aria-label', `Transmit power for ${link.name}`);
      for (const o of pc.options) sel.append(Object.assign(el('option', '', o.label), { value: o.id }));
      if (pc.current) sel.value = pc.current;
      sel.addEventListener('change', () => setTxPowerOption(store, link.id, sel.value));
      lab.append(sel); wrap.append(lab);
    }
    if (wantRx) wrap.append(field('Receiver model', link.rx.rxPreset && opts.rx.some((o) => o.id === link.rx.rxPreset) ? link.rx.rxPreset : '', opts.rx, 'Generic (typical)', (id) => { if (id) setRxFmPreset(store, link.id, id); }));
    if (wantTx || wantRx) wrap.append(el('p', 'hint', 'Class figures from published specifications; * marks a model with some assumed figures. Models are grouped by whether they tune at this link’s frequency.'));
    return wrap;
  }
