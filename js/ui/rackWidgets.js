// Small DOM builders for the Radio items list: labelled fields, the item summary (status dot, name, chips), the signal-flow strip,
// and position fields in stage coordinates. No scene edits here; callers pass the action to run.
import { formatPower, formatDb } from '../model/units.js';
import { dispAxis, internalAxis } from './coords.js';
import { lengthToUi, lengthFromUi } from './fields.js';

export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export const STATUS_WORD = { ok: 'OK', warn: 'Check', fail: 'Fail' };

/** field(label, control, unit?) -> <label> with the caption, the control and an optional unit. */
export function field(label, control, unit) {
  const l = el('label', 'inv-field'), cap = el('span', '', label);
  l.append(cap);
  if (unit) { const w = el('span', 'rf-inp'); w.append(control, el('span', 'rf-unit', unit)); l.append(w); } else l.append(control);
  return l;
}
export function select(label, options, value, onPick) {
  const s = el('select'); s.setAttribute('aria-label', label);
  for (const o of options) {
    if (o && o.group) { const g = el('optgroup'); g.label = o.group; for (const [v, t] of o.items) g.append(Object.assign(el('option', '', t), { value: v })); s.append(g); continue; }
    const [v, t] = o; s.append(Object.assign(el('option', '', t), { value: v }));
  }
  s.value = value == null ? '' : value; s.addEventListener('change', () => onPick(s.value)); return s;
}
export function text(label, value, onSet, maxLength = 40) {
  const i = el('input'); i.type = 'text'; i.value = value || ''; i.maxLength = maxLength; i.setAttribute('aria-label', label);
  i.addEventListener('change', () => onSet(i.value)); return i;
}
export function num(label, value, onSet, min = -1000, max = 1000, step = 0.1) {
  const i = el('input'); i.type = 'number'; i.step = String(step); i.min = String(min); i.max = String(max); i.value = String(Math.round(value * 1000) / 1000); i.setAttribute('aria-label', label);
  i.inputMode = 'decimal';
  i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v) && i.value !== '') onSet(Math.min(max, Math.max(min, v))); else i.value = String(Math.round(value * 1000) / 1000); }); return i;
}
export function btn(label, onClick, title, cls) { const b = el('button', cls || '', label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', onClick); return b; }

/** chip(text, title?, kind?) -> a small inline fact for the summary row. */
export function chip(t, title, kind) { const c = el('span', `rf-chip${kind ? ` rf-chip-${kind}` : ''}`, t); if (title) c.title = title; return c; }

/** statusDot('ok'|'warn'|'fail') -> a coloured dot with its word for screen readers. */
export function statusDot(state) {
  const d = el('span', 'rf-dot'); d.dataset.state = state; d.setAttribute('role', 'img'); d.setAttribute('aria-label', `Status: ${STATUS_WORD[state] || state}`); d.title = STATUS_WORD[state] || state;
  return d;
}

/**
 * flowStrip(flow, powerUnit) -> <ol> of the signal-flow stages: label, change in dB, level after it; the last cell adds the margin.
 * The levels are the link maths' own figures (formatPower in the scene's unit), so they read the same as the Budgets panel.
 */
export function flowStrip(flow, powerUnit) {
  const ol = el('ol', 'rf-flow'); ol.setAttribute('aria-label', 'Signal flow, level after each stage');
  if (!flow) return ol;
  flow.stages.forEach((s, i) => {
    const li = el('li', 'rf-stage'); li.dataset.key = s.key;
    li.append(el('span', 'rf-stage-name', s.label));
    if (i > 0 && i < flow.stages.length - 1) li.append(el('span', 'rf-stage-delta', formatDb(s.deltaDb)));
    li.append(el('span', 'rf-stage-level', formatPower(s.levelDbm, powerUnit)));
    ol.append(li);
  });
  const end = el('li', 'rf-stage rf-stage-margin'); end.dataset.status = flow.status || '';
  end.append(el('span', 'rf-stage-name', 'Margin'), el('span', 'rf-stage-level', formatDb(flow.marginDb)));
  ol.append(end);
  return ol;
}

/** posFields(scene, pos, onSet(axis, metres), label) -> x, y and height fields in stage display coordinates and the scene's length unit (as the inspector). */
export function posFields(scene, pos, onSet, label) {
  const lu = (scene.units && scene.units.length) || 'm', wrap = el('div', 'rf-pos');
  const cap = { x: 'x (from centre line)', y: 'y (from stage front)', z: 'Height' };
  for (const k of ['x', 'y', 'z']) {
    const shown = lengthToUi(dispAxis(scene, k, pos[k]), lu);
    const lim = k === 'z' ? [0, 50] : [-500, 500]; // metres, internal (as before)
    wrap.append(field(cap[k], num(`${label} ${cap[k]}`, shown, (v) => onSet(k, Math.min(lim[1], Math.max(lim[0], internalAxis(scene, k, lengthFromUi(v, lu))))), k === 'z' ? 0 : -2000, k === 'z' ? 200 : 2000, 0.1), lu));
  }
  return wrap;
}
