// Inspector: a form for the active link, its antennas, environment, reflectors and cable chain.
// Structure is rebuilt only when the set of editable things changes (selection, chain items, reflectors);
// otherwise every field is patched in place and a focused field is never overwritten.
import { findItem, activeLink, solveCached } from '../view/util.js';
import { chainItemLossDb } from '../model/rf.js';
import { CABLES, ANTENNAS, SURFACES, MATERIALS, BANDS } from '../model/library.js';
import { dbmToUnit } from '../model/units.js';
import { squelch } from '../squelchTracker.js';
import { rxConfig } from '../rxTracker.js';
import { RX_PRESETS } from '../model/rx-params.js';
import { setInterferer, setAntennaBChainMode, setAntennaBOrientation } from '../actions.js';
import { effectiveAntennaB } from '../model/diversity.js';
import { floorHeightAt } from '../model/floor.js';
import { PLATFORM_MATERIALS } from '../model/scene.js';
import { setStage, addPlatform, updatePlatform, removePlatform } from '../actions.js';
import { setImdPreset, setImdCombiner, setImdPim, addImdTransmitter, removeImdTransmitter, updateImdTransmitter } from '../actions.js';

const IMD_PRESETS = [['mic-rack-typical', 'Mic rack, typical'], ['iem-combiner-no-isolation', 'IEM combiner, no isolation'],
  ['iem-combiner-isolated', 'IEM combiner, isolated'], ['pim-corroded-connector', 'PIM: corroded connector']];
import { createChainItem } from '../model/scene.js';
import { dispAxis, internalAxis, dispRange, COORD_HINT } from './coords.js';
import { txLimitHint, getCoordRegion } from './region.js';
import { noiseOptions, noiseValue, noiseFromChoice, noiseHint, interferenceApplies, interferenceOptions, interferenceValue, interferenceHint, rxPresetOffer } from './noise.js';
import {
  setPath, setLinkField, setLinkKind, setUnits, addChainItem, removeChainItem, moveChainItem,
  addReflector, removeReflector,
} from '../actions.js';
import {
  clamp, parseNumber, formatNumber, lengthToUi, lengthFromUi, powerFieldRange, powerUiToDbm,
  bandForFreq, bandCentre, pathRows, lossText,
} from './fields.js';

const getIn = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const val = (v, c) => (typeof v === 'function' ? v(c) : v);
const KIND_NAMES = {
  cable: 'Cable', booster: 'Booster / amplifier', filter: 'Filter', connector: 'Connector',
  attenuator: 'Attenuator', splitter: 'Splitter', combiner: 'Combiner',
};
const PREVIEW_KINDS = new Set(['splitter', 'combiner']);
const SECTION_FOR = { tx: 'tx', rx: 'rx', reflector: 'refl', link: 'link', platform: 'plats' };

export function mountInspector({ container, store }) {
  container.classList.add('inspector');
  let uid = 0;
  let structKey = null;
  let updaters = [];
  let refs = {};
  let session = 0; // bumped on focus so each editing burst is its own undo step
  const open = { stage: false, plats: false, chainB: true, imd: true, link: true, tx: false, rx: false, env: false, chain: true, refl: false, paths: false };
  let lastSel = Symbol('none');

  const getCtx = () => {
    const scene = store.getScene();
    const sel = store.getSelection();
    const link = activeLink(scene, sel);
    return {
      scene, sel, found: findItem(scene, sel), link,
      result: link ? solveCached(scene, link) : null,
      pu: scene.units?.power || 'dBm', lu: scene.units?.length || 'm',
    };
  };

  // ---- DOM helpers ----------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function fieldRow(label, control, key, unitText) {
    const id = `insp-${++uid}`;
    const row = el('div', 'f');
    const lab = el('label', null, label);
    lab.htmlFor = id;
    control.id = id;
    control.dataset.fkey = key;
    const wrap = el('span', 'inp');
    wrap.append(control);
    const u = el('span', 'u', unitText || '');
    wrap.append(u);
    row.append(lab, wrap);
    return { row, unitEl: u, labelEl: lab };
  }

  /** Number field. spec: {key,label,get(c),set(c,v,opts),min,max,step,unit(c),decimals,visible(c)} */
  function numberField(spec) {
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    const { row, unitEl } = fieldRow(spec.label, input, spec.key, '');
    const opts = () => ({ coalesce: `insp:${spec.key}:${session}` });
    const range = (c) => ({ lo: val(spec.min, c), hi: val(spec.max, c) });
    input.addEventListener('focus', () => { session++; });
    input.addEventListener('input', () => {
      const c = getCtx();
      if (!c.link) return;
      const v = parseNumber(input.value);
      const { lo, hi } = range(c);
      const bad = !Number.isFinite(v) || v < lo || v > hi;
      input.setAttribute('aria-invalid', String(bad));
      if (!bad) spec.set(c, v, opts());
    });
    input.addEventListener('change', () => {
      const c = getCtx();
      if (!c.link) return;
      const v = parseNumber(input.value);
      if (Number.isFinite(v)) {
        const { lo, hi } = range(c);
        spec.set(c, clamp(v, lo, hi), opts());
      }
      input.setAttribute('aria-invalid', 'false');
      input.value = formatNumber(spec.get(getCtx()), spec.decimals ?? 3); // show what was actually stored
    });
    updaters.push((c) => {
      const { lo, hi } = range(c);
      input.min = lo; input.max = hi; input.step = val(spec.step, c) ?? 'any';
      unitEl.textContent = val(spec.unit, c) || '';
      row.hidden = spec.visible ? !spec.visible(c) : false;
      if (document.activeElement !== input) {
        const v = spec.get(c);
        input.value = formatNumber(v, spec.decimals ?? 3);
        input.setAttribute('aria-invalid', 'false');
      }
    });
    return row;
  }

  function textField(spec) {
    const input = el('input');
    input.type = 'text';
    input.maxLength = 40;
    input.autocomplete = 'off';
    const { row } = fieldRow(spec.label, input, spec.key, '');
    input.addEventListener('focus', () => { session++; });
    input.addEventListener('input', () => {
      const c = getCtx();
      if (c.link) spec.set(c, input.value, { coalesce: `insp:${spec.key}:${session}` });
    });
    updaters.push((c) => { if (document.activeElement !== input) input.value = spec.get(c) ?? ''; });
    return row;
  }

  /** Select field. spec: {key,label,options:[[value,text]...] | fn(c),get(c),set(c,v),visible(c)} */
  function selectField(spec) {
    const sel = el('select');
    const { row } = fieldRow(spec.label, sel, spec.key, '');
    let built = '';
    sel.addEventListener('change', () => { const c = getCtx(); if (c.link) spec.set(c, sel.value); });
    updaters.push((c) => {
      const opts = val(spec.options, c);
      const sig = JSON.stringify(opts);
      if (sig !== built) {
        built = sig;
        sel.textContent = '';
        for (const [v, t] of opts) { const o = el('option', null, t); o.value = v; sel.append(o); }
      }
      row.hidden = spec.visible ? !spec.visible(c) : false;
      const v = spec.get(c);
      if (document.activeElement !== sel || sel.value !== v) sel.value = v;
    });
    return row;
  }

  function button(text, key, onClick, { label, cls } = {}) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.dataset.fkey = key;
    if (label) { b.setAttribute('aria-label', label); b.title = label; }
    b.addEventListener('click', onClick);
    return b;
  }

  function section(name, title, note) {
    const d = el('details', 'insp-sec');
    d.dataset.sec = name;
    d.open = !!open[name];
    d.addEventListener('toggle', () => { open[name] = d.open; });
    const s = el('summary', null, title);
    const body = el('div', 'insp-body');
    d.append(s, body);
    if (note) body.append(el('p', 'hint', note));
    refs[name] = { details: d, body, summary: s };
    return body;
  }

  // ---- spec shortcuts --------------------------------------------------------------------
  const linkSet = (path) => (c, v, o) => setLinkField(store, c.link.id, path, v, o);
  const numLink = (key, label, path, min, max, step, unit, extra = {}) => numberField({
    key, label, min, max, step, unit, get: (c) => getIn(c.link, path), set: (c, v, o) => linkSet(path)(c, v, o), ...extra,
  });
  // axis 'x' | 'y' shows the value in stage coordinates (see ui/coords.js); the stored value is unchanged
  const lenLink = (key, label, path, minM, maxM, axis = null) => numberField({
    key, label, decimals: 2,
    min: (c) => lengthToUi(dispRange(c.scene, axis, minM, maxM)[0], c.lu), max: (c) => lengthToUi(dispRange(c.scene, axis, minM, maxM)[1], c.lu), step: (c) => (c.lu === 'ft' ? 0.5 : 0.1),
    unit: (c) => c.lu,
    get: (c) => lengthToUi(dispAxis(c.scene, axis, getIn(c.link, path)), c.lu),
    set: (c, v, o) => linkSet(path)(c, internalAxis(c.scene, axis, lengthFromUi(v, c.lu)), o),
  });
  const numEnv = (key, label, field, min, max, step) => numberField({
    key, label, min, max, step, unit: 'dB',
    get: (c) => c.scene.environment[field],
    set: (c, v, o) => setPath(store, `environment.${field}`, v, o),
  });

  function antennaFields(who, prefix) {
    const frag = document.createDocumentFragment();
    frag.append(
      selectField({
        key: `${who}-ant`, label: 'Antenna type',
        options: Object.entries(ANTENNAS).map(([id, a]) => [id, a.name]),
        get: (c) => c.link[who].antenna.type,
        set: (c, v) => store.update((d) => {
          const l = d.links.find((x) => x.id === c.link.id);
          if (!l) return;
          l[who].antenna.type = v;
          if (ANTENNAS[v]) l[who].antenna.gainDbi = ANTENNAS[v].gainDbi;
        }),
      }),
      numLink(`${who}-gain`, 'Antenna gain', `${prefix}.antenna.gainDbi`, -20, 40, 0.5, 'dBi', { decimals: 1 }),
      numLink(`${who}-az`, 'Azimuth', `${prefix}.antenna.orientation.az`, 0, 360, 1, '° (0 = toward audience, clockwise)', { decimals: 1 }),
      numLink(`${who}-el`, 'Elevation', `${prefix}.antenna.orientation.el`, -90, 90, 1, '° (0 = horizontal)', { decimals: 1 }),
    );
    return frag;
  }

  function posFields(who) {
    const frag = document.createDocumentFragment();
    frag.append(
      lenLink(`${who}-x`, 'Position x (0 = centre line)', `${who}.pos.x`, -50, 100, 'x'),
      lenLink(`${who}-y`, 'Position y (0 = front edge)', `${who}.pos.y`, -50, 100, 'y'),
      lenLink(`${who}-z`, 'Height above floor', `${who}.pos.z`, 0, 50),
    );
    const hint = el('p', 'hint');
    updaters.push((cc) => {
      const pos = cc.link[who].pos, fl = floorHeightAt(cc.scene, pos.x, pos.y);
      hint.textContent = `${COORD_HINT} Floor beneath: ${lengthToUi(fl, cc.lu).toFixed(2)} ${cc.lu}. Absolute height above the ground: ${lengthToUi(fl + pos.z, cc.lu).toFixed(2)} ${cc.lu}.`;
    });
    frag.append(hint);
    return frag;
  }

  // ---- build -----------------------------------------------------------------------------
  function build(c) {
    container.textContent = '';
    updaters = [];
    refs = {};
    if (!c.link) {
      container.append(el('p', 'hint', 'No link in the scene.'));
      return;
    }
    const link = c.link;
    const heading = el('h2', null, 'Inspector');
    const who = c.found
      ? el('p', 'insp-who', c.found.type === 'platform' ? `Selected: platform "${c.found.item.name}"` : c.found.type === 'reflector' ? `Selected: reflector "${c.found.item.name}"`
        : c.found.type === 'link' ? `Selected: link "${link.name}"` : `Selected: ${c.found.type === 'tx' ? 'transmitter' : 'receiver'} "${c.found.item.name}"`)
      : el('p', 'insp-who', `Nothing selected: editing link "${link.name}"`);
    container.append(heading, who);

    // Stage and platforms
    const sb = section('stage', 'Stage', `Item heights are measured from the floor beneath them: the deck, or the top of the platform they stand on. ${COORD_HINT}`);
    const stageNum = (key, label, field, min, max) => numberField({
      key, label, decimals: 2, min: (cc) => lengthToUi(min, cc.lu), max: (cc) => lengthToUi(max, cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(cc.scene.stage[field] ?? 0, cc.lu), set: (cc, v, o) => setStage(store, { [field]: lengthFromUi(v, cc.lu) }, o),
    });
    sb.append(stageNum('stage-w', 'Stage width', 'width', 0.5, 500), stageNum('stage-d', 'Stage depth', 'depth', 0.5, 500), stageNum('stage-h', 'Deck height above the ground', 'heightM', 0, 20));
    const plb = section('plats', 'Platforms', 'A platform is a raised block on the stage (drum riser, choir steps). Its top height is measured from the ground.');
    buildPlatforms(plb, c);

    // Link
    const lb = section('link', 'Link');
    lb.append(
      textField({ key: 'link-name', label: 'Link name', get: (cc) => cc.link.name, set: (cc, v, o) => linkSet('name')(cc, v, o) }),
      selectField({
        key: 'link-kind', label: 'Link kind', options: [['mic', 'Microphone (Tx on stage, Rx at rack)'], ['iem', 'In-ear monitor (Tx at rack, Rx on performer)']],
        get: (cc) => cc.link.kind, set: (cc, v) => setLinkKind(store, cc.link.id, v),
      }),
      numberField({
        key: 'link-freq', label: 'Frequency', min: 1, max: 6000, step: 0.025, unit: 'MHz', decimals: 3,
        get: (cc) => cc.link.freqMHz, set: (cc, v, o) => linkSet('freqMHz')(cc, v, o),
      }),
      selectField({
        key: 'link-band', label: 'Band preset',
        options: [['', 'Custom'], ...BANDS.map((b) => [b.id, b.name])],
        get: (cc) => bandForFreq(cc.link.freqMHz),
        set: (cc, v) => { const f = bandCentre(v); if (Number.isFinite(f)) linkSet('freqMHz')(cc, f); },
      }),
      selectField({
        key: 'units-power', label: 'Power unit', options: [['dBm', 'dBm'], ['dBW', 'dBW'], ['mW', 'mW']],
        get: (cc) => cc.pu, set: (cc, v) => setUnits(store, { power: v }),
      }),
      selectField({
        key: 'units-length', label: 'Length unit', options: [['m', 'metres'], ['ft', 'feet']],
        get: (cc) => cc.lu, set: (cc, v) => setUnits(store, { length: v }),
      }),
    );

    // Transmitter
    const tb = section('tx', 'Transmitter');
    tb.append(
      textField({ key: 'tx-name', label: 'Name', get: (cc) => cc.link.tx.name, set: (cc, v, o) => linkSet('tx.name')(cc, v, o) }),
      numberField({
        key: 'tx-power', label: 'Tx power', decimals: 3,
        min: (cc) => powerFieldRange(cc.pu).min, max: (cc) => powerFieldRange(cc.pu).max, step: (cc) => powerFieldRange(cc.pu).step,
        unit: (cc) => cc.pu,
        get: (cc) => dbmToUnit(cc.link.tx.powerDbm, cc.pu),
        set: (cc, v, o) => { const d = powerUiToDbm(v, cc.pu); if (Number.isFinite(d)) linkSet('tx.powerDbm')(cc, d, o); },
      }),
      txLimitRow(),
      antennaFields('tx', 'tx'),
      posFields('tx'),
    );

    // Receiver
    const rb = section('rx', 'Receiver');
    rb.append(
      textField({ key: 'rx-name', label: 'Name', get: (cc) => cc.link.rx.name, set: (cc, v, o) => linkSet('rx.name')(cc, v, o) }),
      numLink('rx-sens', 'Sensitivity', 'rx.sensitivityDbm', -130, -20, 1, 'dBm', { decimals: 1 }),
      numLink('rx-body', 'Rx body loss', 'rx.bodyLossDb', 0, 40, 0.5, 'dB', { decimals: 1 }),
      selectField({
        key: 'rx-sq-en', label: 'Squelch', options: [['on', 'Enabled'], ['off', 'Disabled']],
        get: (cc) => (cc.link.rx.squelch?.enabled === false ? 'off' : 'on'),
        set: (cc, v) => setSquelch(cc, 'enabled', v === 'on'),
      }),
      numberField({
        key: 'rx-sq-thr', label: 'Squelch threshold', min: -130, max: -20, step: 1, unit: 'dBm (at receiver input)', decimals: 1,
        get: (cc) => cc.link.rx.squelch?.thresholdDbm ?? -90, set: (cc, v, o) => setSquelch(cc, 'thresholdDbm', v, o),
      }),
      numberField({
        key: 'rx-sq-hys', label: 'Squelch hysteresis', min: 0, max: 20, step: 0.5, unit: 'dB', decimals: 1,
        get: (cc) => cc.link.rx.squelch?.hysteresisDb ?? 3, set: (cc, v, o) => setSquelch(cc, 'hysteresisDb', v, o),
      }),
      antennaFields('rx', 'rx'),
      posFields('rx'),
    );
    rb.append(
      selectField({
        key: 'rx-preset', label: 'Receiver preset', options: Object.entries(RX_PRESETS).map(([id, p]) => [id, p.label || id]),
        get: (cc) => cc.link.rx.rxPreset || (cc.link.kind === 'iem' ? 'iem-bodypack-typical' : 'mic-receiver-typical'),
        set: (cc, v) => setNested(cc, 'rx.rxPreset', v),
      }),
      presetOffer(),
      numberField({
        key: 'rx-maxin', label: 'Max input', min: -60, max: 20, step: 1, unit: 'dBm', decimals: 1,
        get: (cc) => cc.link.rx.overload?.maxInputDbm ?? rxConfig(cc.link).maxInputDbm, set: (cc, v, o) => setNested(cc, 'rx.overload.maxInputDbm', v, o),
      }),
      numberField({
        key: 'rx-p1db', label: 'P1dB (compression)', min: -60, max: 20, step: 1, unit: 'dBm', decimals: 1,
        get: (cc) => cc.link.rx.overload?.p1dBDbm ?? rxConfig(cc.link).p1dBDbm, set: (cc, v, o) => setNested(cc, 'rx.overload.p1dBDbm', v, o),
      }),
      selectField({
        key: 'rx-div-en', label: 'Diversity', options: [['off', 'Off (antenna A only)'], ['on', 'On (antenna A + B)']],
        get: (cc) => (cc.link.rx.diversity?.enabled ? 'on' : 'off'), set: (cc, v) => setNested(cc, 'rx.diversity.enabled', v === 'on'),
      }),
      selectField({
        key: 'rx-div-mode', label: 'Diversity mode', options: [['switching', 'Switching'], ['true', 'True diversity (best of A/B)'], ['ratio', 'Ratio combining']],
        visible: (cc) => !!cc.link.rx.diversity?.enabled,
        get: (cc) => cc.link.rx.diversity?.mode || 'switching', set: (cc, v) => setNested(cc, 'rx.diversity.mode', v),
      }),
      ...['x', 'y', 'z'].map((ax) => numberField({
        key: `rx-b-${ax}`, label: `Antenna B ${ax}${ax === 'z' ? ' (height)' : ax === 'x' ? ' (0 = centre line)' : ' (0 = front edge)'}`, decimals: 2,
        min: (cc) => lengthToUi(dispRange(cc.scene, ax, ax === 'z' ? 0 : -50, ax === 'z' ? 50 : 100)[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, ax, ax === 'z' ? 0 : -50, ax === 'z' ? 50 : 100)[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
        visible: (cc) => !!cc.link.rx.diversity?.enabled,
        get: (cc) => lengthToUi(dispAxis(cc.scene, ax, cc.link.rx.diversity?.antennaB?.pos?.[ax] ?? cc.link.rx.pos[ax]), cc.lu),
        set: (cc, v, o) => {
          const cur = cc.link.rx.diversity?.antennaB?.pos || cc.link.rx.pos;
          setNested(cc, 'rx.diversity.antennaB.pos', { x: cur.x, y: cur.y, z: cur.z, [ax]: internalAxis(cc.scene, ax, lengthFromUi(v, cc.lu)) }, o);
        },
      })),
      selectField({
        key: 'rx-b-antmode', label: 'Antenna B type', options: [['same', 'Same as antenna A'], ['custom', 'Different antenna']],
        visible: (cc) => !!cc.link.rx.diversity?.enabled,
        get: (cc) => (cc.link.rx.diversity?.antennaB?.antenna ? 'custom' : 'same'),
        set: (cc, v) => setNested(cc, 'rx.diversity.antennaB.antenna', v === 'custom' ? structuredClone(cc.link.rx.antenna) : null),
      }),
      selectField({
        key: 'rx-b-ant', label: 'Antenna B model', options: Object.entries(ANTENNAS).map(([id, a]) => [id, a.name]),
        visible: (cc) => !!cc.link.rx.diversity?.enabled && !!cc.link.rx.diversity?.antennaB?.antenna,
        get: (cc) => cc.link.rx.diversity?.antennaB?.antenna?.type,
        set: (cc, v) => store.update((d) => {
          const l = d.links.find((x) => x.id === cc.link.id);
          const a = l?.rx.diversity?.antennaB?.antenna;
          if (!a) return;
          a.type = v;
          if (ANTENNAS[v]) a.gainDbi = ANTENNAS[v].gainDbi;
        }),
      }),
      numLink('rx-b-gain', 'Antenna B gain', 'rx.diversity.antennaB.antenna.gainDbi', -20, 40, 0.5, 'dBi', {
        decimals: 1, visible: (cc) => !!cc.link.rx.diversity?.enabled && !!cc.link.rx.diversity?.antennaB?.antenna,
      }),
      selectField({
        key: 'rx-b-dirmode', label: 'Antenna B direction', options: [['same', 'Same as antenna A'], ['own', 'Own direction']],
        visible: (cc) => !!cc.link.rx.diversity?.enabled,
        get: (cc) => (cc.link.rx.diversity?.antennaB?.orientation ? 'own' : 'same'),
        set: (cc, v) => setAntennaBOrientation(store, cc.link.id, v === 'same' ? null : { ...effectiveAntennaB(cc.link).orientation }),
      }),
      numberField({
        key: 'rx-b-az', label: 'Antenna B azimuth', min: 0, max: 360, step: 1, unit: '\u00b0 (0 = toward audience, clockwise)', decimals: 1,
        visible: (cc) => !!cc.link.rx.diversity?.enabled && !!cc.link.rx.diversity?.antennaB?.orientation,
        get: (cc) => effectiveAntennaB(cc.link).orientation.az, set: (cc, v, o) => setAntennaBOrientation(store, cc.link.id, { az: v }, o),
      }),
      numberField({
        key: 'rx-b-el', label: 'Antenna B elevation', min: -90, max: 90, step: 1, unit: '\u00b0 (0 = horizontal)', decimals: 1,
        visible: (cc) => !!cc.link.rx.diversity?.enabled && !!cc.link.rx.diversity?.antennaB?.orientation,
        get: (cc) => effectiveAntennaB(cc.link).orientation.el, set: (cc, v, o) => setAntennaBOrientation(store, cc.link.id, { el: v }, o),
      }),
      numberField({
        key: 'rx-div-hys', label: 'Switch hysteresis', min: 0, max: 20, step: 0.5, unit: 'dB', decimals: 1,
        visible: (cc) => !!cc.link.rx.diversity?.enabled && (cc.link.rx.diversity.mode || 'switching') === 'switching',
        get: (cc) => cc.link.rx.diversity?.hysteresisDb ?? 3, set: (cc, v, o) => setNested(cc, 'rx.diversity.hysteresisDb', v, o),
      }),
      numberField({
        key: 'rx-div-ms', label: 'Switch time', min: 0, max: 1000, step: 1, unit: 'ms', decimals: 0,
        visible: (cc) => !!cc.link.rx.diversity?.enabled && (cc.link.rx.diversity.mode || 'switching') === 'switching',
        get: (cc) => cc.link.rx.diversity?.switchMs ?? 5, set: (cc, v, o) => setNested(cc, 'rx.diversity.switchMs', v, o),
      }),
    );
    rb.append(
      selectField({
        key: 'ifr-en', label: 'Stray carrier', options: [['off', 'Off'], ['on', 'On (same channel)']],
        get: (cc) => (cc.link.interferer?.enabled ? 'on' : 'off'), set: (cc, v) => setInterferer(store, cc.link.id, { enabled: v === 'on' }),
      }),
      numberField({
        key: 'ifr-level', label: 'Stray level', min: -130, max: -10, step: 1, unit: 'dBm at receiver input', decimals: 1,
        visible: (cc) => !!cc.link.interferer?.enabled,
        get: (cc) => cc.link.interferer?.levelDbm ?? -70, set: (cc, v) => setInterferer(store, cc.link.id, { levelDbm: v }),
      }),
      selectField({
        key: 'ifr-pilot', label: 'Stray has pilot', options: [['no', 'No pilot (mono / data)'], ['yes', 'Yes (stereo FM)']],
        visible: (cc) => !!cc.link.interferer?.enabled,
        get: (cc) => (cc.link.interferer?.hasPilot ? 'yes' : 'no'), set: (cc, v) => setInterferer(store, cc.link.id, { hasPilot: v === 'yes' }),
      }),
      numberField({
        key: 'ifr-off', label: 'Stray offset', min: -200, max: 200, step: 1, unit: 'kHz from the channel', decimals: 0,
        visible: (cc) => !!cc.link.interferer?.enabled,
        get: (cc) => cc.link.interferer?.offsetKHz ?? 0, set: (cc, v, o) => setInterferer(store, cc.link.id, { offsetKHz: v }),
      }),
    );
    const live = el('p', 'sq-live');
    live.setAttribute('role', 'status');
    rb.prepend(live);
    updaters.push((cc) => {
      const g = squelch.get(cc.link.id);
      const on = cc.link.rx.squelch?.enabled !== false;
      if (!g) { live.textContent = ''; return; }
      live.dataset.state = !on ? 'off' : g.open ? 'open' : 'closed';
      const hr = Number.isFinite(g.headroomDb) ? `${g.headroomDb >= 0 ? '+' : '−'}${Math.abs(g.headroomDb).toFixed(1)} dB vs threshold` : '';
      live.textContent = `Squelch ${!on ? 'disabled (always open)' : g.open ? 'OPEN' : 'CLOSED (muted)'}  ${hr}`;
    });
    rb.append(el('p', 'hint', 'Body loss values stack: environment body loss, Rx body loss and the negative gain of a body-worn antenna type are all applied together. Enter each effect once.'));

    // Environment
    const eb = section('env', 'Environment');
    eb.append(
      selectField({
        key: 'env-floor', label: 'Stage surface', options: Object.entries(SURFACES).map(([id, s]) => [id, s.name]),
        get: (cc) => cc.scene.environment.floor, set: (cc, v) => setPath(store, 'environment.floor', v),
      }),
      selectField({
        key: 'env-pol', label: 'Polarisation', options: [['vertical', 'Vertical'], ['horizontal', 'Horizontal']],
        get: (cc) => cc.scene.environment.polarisation, set: (cc, v) => setPath(store, 'environment.polarisation', v),
      }),
      selectField({
        key: 'env-model', label: 'Propagation model', options: [['two-ray', 'Two-ray (multipath)'], ['free-space', 'Free space']],
        get: (cc) => cc.scene.environment.model, set: (cc, v) => setPath(store, 'environment.model', v),
      }),
      selectField({
        key: 'env-noise', label: 'External RF noise', options: (cc) => noiseOptions(cc.scene.environment.externalNoise, cc.link.freqMHz),
        get: (cc) => noiseValue(cc.scene.environment.externalNoise), set: (cc, v) => { const n = noiseFromChoice(v); if (n !== undefined) setPath(store, 'environment.externalNoise', n); },
      }),
      selectField({
        key: 'env-interf', label: 'Interference (2.4 / 5.8 GHz)', options: (cc) => interferenceOptions(cc.link.freqMHz), visible: (cc) => interferenceApplies(cc.link.freqMHz),
        get: (cc) => interferenceValue(cc.scene.environment.interference), set: (cc, v) => setPath(store, 'environment.interference', v),
      }),
      numEnv('env-fade', 'Fade margin', 'fadeMarginDb', 0, 40, 0.5),
      numEnv('env-body', 'Environment body loss', 'bodyLossDb', 0, 40, 0.5),
    );
    eb.append(el('p', 'hint', 'Body loss values stack: environment + Rx body loss + body-worn antenna are summed.'));
    eb.append(el('p', 'hint', noiseHint()));
    eb.append(el('p', 'hint', 'Stage surface is the material of the stage floor: it sets how strongly the floor reflects the signal (platforms have their own material).'));
    const interfHint = el('p', 'hint');
    updaters.push((cc) => { interfHint.hidden = !interferenceApplies(cc.link.freqMHz); interfHint.textContent = interferenceHint(cc.scene.environment.interference, cc.link.freqMHz); });
    eb.append(interfHint);

    // Chain
    const endNote = link.kind === 'iem' ? 'Order: transmitter, then these items, then the Tx antenna.' : 'Order: Rx antenna, then these items, then the receiver.';
    const cb = section('chain', link.kind === 'iem' ? 'Cable chain' : 'Cable A (antenna A to receiver)', endNote);
    buildChain(cb, c);
    if (link.kind === 'iem') {
      const rxb = section('rxchain', 'Bodypack-side chain (optional)', 'Order: bodypack antenna, then these items, then the bodypack. Leave empty for a bodypack with its own antenna on the unit.');
      buildChain(rxb, c, 'rx');
    }
    const hasB = link.kind !== 'iem' && !!(link.rx.diversity && link.rx.diversity.enabled && link.rx.diversity.antennaB);
    if (hasB) {
      const bb = section('chainB', 'Cable B (antenna B to receiver)', 'Order: antenna B, then these items, then the receiver.');
      bb.append(selectField({
        key: 'chainB-mode', label: 'Cable B', options: [['same', 'Same as cable A'], ['own', 'Own cable']],
        get: (cc) => (Array.isArray(cc.link.rx.diversity?.antennaB?.chain) ? 'own' : 'same'),
        set: (cc, v) => setAntennaBChainMode(store, cc.link.id, v),
      }));
      if (Array.isArray(link.rx.diversity.antennaB.chain)) buildChain(bb, c, 'antennaB');
      else {
        const note = el('p', 'hint chain-total');
        updaters.push((cc) => { let sum = 0; for (const it of cc.link.chain) sum += safeLoss(it, cc.link.freqMHz); note.textContent = `Antenna B uses cable A: ${lossText(sum)}. Choose "Own cable" to give it its own run (it starts as a copy of cable A).`; });
        bb.append(note);
      }
    }

    // Reflectors
    const fb = section('refl', 'Reflectors');
    buildReflectors(fb, c);

    // Paths
    const pb = section('paths', 'Paths');
    const ptable = el('table', 'paths-table');
    ptable.innerHTML = '<thead><tr><th scope="col">Ray</th><th scope="col" class="num">Length</th><th scope="col" class="num">Delay (ns)</th><th scope="col" class="num">vs direct (dB)</th></tr></thead><tbody></tbody>';
    const pbody = ptable.querySelector('tbody');
    pb.append(ptable);
    updaters.push((cc) => {
      refs.paths.summary.textContent = `Paths (${cc.result ? cc.result.paths.length : 0})`;
      ptable.querySelector('th:nth-child(2)').textContent = `Length (${cc.lu})`;
      pbody.textContent = '';
      for (const r of pathRows(cc.result, cc.scene, cc.lu)) {
        const tr = el('tr');
        const k = el('td', null, r.kind);
        tr.append(k, el('td', 'num', r.length), el('td', 'num', r.delayNs), el('td', 'num', r.relDb));
        pbody.append(tr);
      }
    });

    const secs = ['stage', 'plats', 'link', 'tx', 'rx', 'env', 'chain', ...(refs.chainB ? ['chainB'] : []), 'refl', 'paths'];
    if (c.scene.imd && c.scene.imd.enabled) { buildImd(section('imd', 'Intermod demo'), c); secs.unshift('imd'); }
    container.append(...secs.map((n) => refs[n].details));
  }

  function buildImd(body, c) {
    const m = c.scene.imd;
    const upd = (id) => (cc, patch, o) => updateImdTransmitter(store, id, patch, o);
    body.append(
      selectField({ key: 'imd-preset', label: 'Preset', options: IMD_PRESETS, get: (cc) => cc.scene.imd.preset, set: (cc, v) => setImdPreset(store, v) }),
      selectField({
        key: 'imd-comb', label: 'Combiner', options: [['none', 'None (separate antennas)'], ['hybrid', 'Passive hybrid'], ['isolated', 'Isolated (cavity / isolators)']],
        get: (cc) => cc.scene.imd.combiner?.type || 'none', set: (cc, v) => setImdCombiner(store, { type: v }),
      }),
      numberField({
        key: 'imd-iso', label: 'Isolation', min: 0, max: 80, step: 1, unit: 'dB', decimals: 1,
        visible: (cc) => (cc.scene.imd.combiner?.type || 'none') !== 'none',
        get: (cc) => cc.scene.imd.combiner?.isolationDb ?? 0, set: (cc, v, o) => setImdCombiner(store, { isolationDb: v }),
      }),
      numberField({
        key: 'imd-closs', label: 'Combiner loss', min: 0, max: 20, step: 0.5, unit: 'dB', decimals: 1,
        visible: (cc) => (cc.scene.imd.combiner?.type || 'none') !== 'none',
        get: (cc) => cc.scene.imd.combiner?.lossDb ?? 0, set: (cc, v, o) => setImdCombiner(store, { lossDb: v }),
      }),
      selectField({
        key: 'imd-pim', label: 'PIM', options: [['none', 'None'], ['good', 'Good connectors'], ['corroded', 'Corroded connector']],
        get: (cc) => cc.scene.imd.pim?.preset || 'none', set: (cc, v) => setImdPim(store, { preset: v }),
      }),
      numberField({
        key: 'imd-pimdbc', label: 'PIM level', min: -170, max: -60, step: 1, unit: 'dBc', decimals: 0,
        visible: (cc) => (cc.scene.imd.pim?.preset || 'none') !== 'none',
        get: (cc) => cc.scene.imd.pim?.levelDbc ?? -110, set: (cc, v) => setImdPim(store, { levelDbc: v }),
      }),
      numberField({
        key: 'imd-bw', label: 'Channel bandwidth', min: 10, max: 1000, step: 5, unit: 'kHz', decimals: 0,
        get: (cc) => cc.scene.imd.channelBwKHz ?? 200, set: (cc, v, o) => setPath(store, 'imd.channelBwKHz', v, o),
      }),
    );
    m.transmitters.forEach((t, i) => {
      const T = (cc) => cc.scene.imd.transmitters[i];
      const k = (s) => `imd-t${t.id}-${s}`;
      const head = el('div', 'ci-head');
      head.append(el('strong', null, `Transmitter ${i + 1}`));
      head.append(button('\u00d7', k('del'), () => removeImdTransmitter(store, t.id), { label: `Remove transmitter ${i + 1}`, cls: 'danger' }));
      const box = el('div', 'ci'); box.append(head);
      const fields = el('div', 'ci-fields');
      fields.append(
        textField({ key: k('name'), label: 'Name', get: (cc) => T(cc)?.name, set: (cc, v, o) => updateImdTransmitter(store, t.id, { name: v }, o) }),
        numberField({ key: k('f'), label: 'Frequency', min: 100, max: 6000, step: 0.025, unit: 'MHz', decimals: 3, get: (cc) => T(cc)?.freqMHz ?? 0, set: (cc, v, o) => updateImdTransmitter(store, t.id, { freqMHz: v }, o) }),
        numberField({ key: k('p'), label: 'Power', min: -10, max: 40, step: 1, unit: 'dBm', decimals: 1, get: (cc) => T(cc)?.powerDbm ?? 0, set: (cc, v, o) => updateImdTransmitter(store, t.id, { powerDbm: v }, o) }),
      );
      box.append(fields);
      body.append(box);
    });
    body.append(button('Add transmitter', 'imd-add', () => { const id = addImdTransmitter(store); if (id) store.select(id); }));
  }

  function buildPlatforms(body, c) {
    const list = el('ul', 'refl-list');
    (c.scene.platforms || []).forEach((p) => {
      const li = el('li');
      const b = button(p.name || 'Platform', `plat:${p.id}`, () => store.select(p.id));
      b.setAttribute('aria-pressed', String(c.sel === p.id));
      li.append(b); list.append(li);
    });
    if (!(c.scene.platforms || []).length) body.append(el('p', 'hint', 'No platforms. Add one to put a riser on the stage.'));
    body.append(list);
    body.append(button('Add platform', 'plat-add', () => { const id = addPlatform(store); if (id) store.select(id); }));
    const p0 = c.found?.type === 'platform' ? c.found.item : null;
    if (!p0) return;
    const id = p0.id;
    const P = (cc) => (cc.scene.platforms || []).find((q) => q.id === id);
    const len = (key, label, field, min, max, axis = null) => numberField({
      key: `plat-${key}`, label, decimals: 2, min: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(dispAxis(cc.scene, axis, P(cc)?.[field] ?? 0), cc.lu), set: (cc, v, o) => updatePlatform(store, id, { [field]: internalAxis(cc.scene, axis, lengthFromUi(v, cc.lu)) }, o),
    });
    const form = el('div', 'refl-form');
    form.append(
      textField({ key: 'plat-name', label: 'Name', get: (cc) => P(cc)?.name, set: (cc, v, o) => updatePlatform(store, id, { name: v }, o) }),
      selectField({
        key: 'plat-mat', label: 'Material', options: PLATFORM_MATERIALS.map((m) => [m, (SURFACES[m] || MATERIALS[m] || {}).name || m]),
        get: (cc) => P(cc)?.material, set: (cc, v) => updatePlatform(store, id, { material: v }),
      }),
      numberField({
        key: 'plat-rot', label: 'Rotation', decimals: 1, min: -180, max: 180, step: 5, unit: 'degrees',
        get: (cc) => P(cc)?.rotationDeg ?? 0, set: (cc, v, o) => updatePlatform(store, id, { rotationDeg: v }, o),
      }),
      len('x', 'Left edge x (0 = centre line)', 'x', -500, 1000, 'x'), len('y', 'Back edge y (0 = front edge)', 'y', -500, 1000, 'y'),
      len('w', 'Width', 'width', 0.1, 500), len('d', 'Depth', 'depth', 0.1, 500),
      len('top', 'Top height above the ground', 'topM', 0.05, 30),
    );
    form.append(el('p', 'hint', 'Material sets how much signal passes through the platform and how it reflects. Rotation turns it about its centre (0 = front edge facing the audience, clockwise from above); the position fields name its unrotated corner.'));
    const rise = el('p', 'hint');
    updaters.push((cc) => {
      const p = P(cc); if (!p) { rise.textContent = ''; return; }
      const below = floorHeightAt({ ...cc.scene, platforms: (cc.scene.platforms || []).filter((q) => q.id !== id) }, p.x + p.width / 2, p.y + p.depth / 2);
      rise.textContent = `Rise above the surface below: ${lengthToUi(p.topM - below, cc.lu).toFixed(2)} ${cc.lu} (the surface under its centre is ${lengthToUi(below, cc.lu).toFixed(2)} ${cc.lu} high).`;
    });
    form.append(rise, button('Remove platform', 'plat-remove', () => { removePlatform(store, id); store.select(null); }, { cls: 'danger' }));
    body.append(form);
  }

  /** Small hint under the Tx power field: the regional power limit for this band (UK by default) and a warning, never a block. */
  function txLimitRow() {
    const p = el('p', 'hint insp-txlimit');
    updaters.push((cc) => {
      const h = txLimitHint(getCoordRegion(), cc.link.freqMHz, cc.link.tx.powerDbm, cc.link.tx.antenna && cc.link.tx.antenna.gainDbi);
      p.hidden = !h;
      if (!h) return;
      p.textContent = (h.over ? 'Warning: ' : '') + h.text;
      p.dataset.over = String(h.over);
    });
    return p;
  }

  /** Inline offer (never automatic) to switch the receiver preset when the carrier moves into VHF, 2.4 GHz or 5.8 GHz or back. */
  function presetOffer() {
    const row = el('div', 'hint insp-offer');
    const txt = el('span');
    const btn = button('', 'rx-preset-offer', () => {
      const cc = getCtx();
      const o = cc.link && rxPresetOffer(cc.link.kind, cc.link.freqMHz, cc.link.rx.rxPreset);
      if (o) setNested(cc, 'rx.rxPreset', o.id);
    });
    row.append(txt, ' ', btn);
    updaters.push((cc) => {
      const o = rxPresetOffer(cc.link.kind, cc.link.freqMHz, cc.link.rx.rxPreset);
      row.hidden = !o;
      if (o) { txt.textContent = o.text; btn.textContent = o.buttonText; }
    });
    return row;
  }

  function buildChain(body, c, target = 'main') {
    const link = c.link;
    const chainOf = (l) => (target === 'antennaB' ? ((l.rx.diversity && l.rx.diversity.antennaB && l.rx.diversity.antennaB.chain) || []) : target === 'rx' ? (l.rx.chain || []) : l.chain);
    const base = target === 'antennaB' ? 'rx.diversity.antennaB.chain' : target === 'rx' ? 'rx.chain' : 'chain';
    const tOpt = { target };
    const list = el('ol', 'chain-list');
    chainOf(link).forEach((item, i) => {
      const li = el('li', 'ci');
      const head = el('div', 'ci-head');
      const name = el('strong', null, `${i + 1}. ${KIND_NAMES[item.kind] || item.kind}`);
      head.append(name);
      if (PREVIEW_KINDS.has(item.kind)) head.append(el('span', 'badge', 'preview'));
      const lossEl = el('span', 'ci-loss');
      const btns = el('span', 'ci-btns');
      const idKey = `${target}:${item.id || `i${i}`}`;
      const up = button('↑', `ci:${idKey}:up`, () => moveChainItem(store, link.id, item.id, -1, tOpt), { label: `Move ${KIND_NAMES[item.kind]} ${i + 1} up` });
      const down = button('↓', `ci:${idKey}:down`, () => moveChainItem(store, link.id, item.id, 1, tOpt), { label: `Move ${KIND_NAMES[item.kind]} ${i + 1} down` });
      const del = button('×', `ci:${idKey}:del`, () => removeChainItem(store, link.id, item.id, tOpt), { label: `Remove ${KIND_NAMES[item.kind]} ${i + 1}`, cls: 'danger' });
      up.disabled = i === 0;
      down.disabled = i === chainOf(link).length - 1;
      btns.append(up, down, del);
      head.append(lossEl, btns);
      const fields = el('div', 'ci-fields');
      li.append(head, fields);
      list.append(li);

      const p = `${base}.${i}`;
      const here = (c2) => chainOf(c2.link)[i];
      const k = (s) => `ci:${idKey}:${s}`;
      const add = (...nodes) => fields.append(...nodes);
      switch (item.kind) {
        case 'cable': {
          const isCustom = (c2) => here(c2)?.cableType === 'custom' || here(c2)?.freqLossOverrideDbPer100m != null;
          add(
            selectField({
              key: k('type'), label: 'Cable type',
              options: [...Object.entries(CABLES).map(([id, cab]) => [id, cab.name]), ['custom', 'Custom (dB/100 m)']],
              get: (c2) => (isCustom(c2) ? 'custom' : here(c2)?.cableType ?? 'rg58'),
              set: (c2, v) => store.update((d) => {
                const l = d.links.find((x) => x.id === c2.link.id);
                const it = l ? chainOf(l)[i] : null;
                if (!it) return;
                if (v === 'custom') {
                  const per100 = it.lengthM > 0 ? (chainItemLossDb(chainOf(c2.link)[i], c2.link.freqMHz) / it.lengthM) * 100 : 20;
                  it.cableType = 'custom';
                  if (it.freqLossOverrideDbPer100m == null) it.freqLossOverrideDbPer100m = Math.round(per100 * 10) / 10;
                } else {
                  it.cableType = v;
                  delete it.freqLossOverrideDbPer100m;
                }
              }),
            }),
            numberField({
              key: k('custom'), label: 'Cable loss', min: 0, max: 300, step: 0.5, unit: 'dB per 100 m', decimals: 1,
              visible: isCustom,
              get: (c2) => here(c2)?.freqLossOverrideDbPer100m ?? 0, set: (c2, v, o) => linkSet(`${p}.freqLossOverrideDbPer100m`)(c2, v, o),
            }),
            numberField({
              key: k('len'), label: 'Length', decimals: 2, min: 0, max: (c2) => lengthToUi(500, c2.lu), step: (c2) => (c2.lu === 'ft' ? 1 : 0.5),
              unit: (c2) => c2.lu,
              get: (c2) => lengthToUi(here(c2)?.lengthM ?? 0, c2.lu),
              set: (c2, v, o) => linkSet(`${p}.lengthM`)(c2, lengthFromUi(v, c2.lu), o),
            }),
          );
          break;
        }
        case 'booster':
          add(
            numLink(k('gain'), 'Gain', `${p}.gainDb`, 0, 60, 0.5, 'dB', { decimals: 1 }),
            numLink(k('nf'), 'Noise figure', `${p}.nfDb`, 0, 20, 0.5, 'dB (not in power budget)', { decimals: 1, get: (c2) => here(c2)?.nfDb ?? 0 }),
          );
          break;
        case 'splitter':
        case 'combiner':
          add(
            numLink(k('ports'), 'Ports', `${p}.ports`, 2, 16, 1, '', { decimals: 0 }),
            numLink(k('il'), 'Insertion loss', `${p}.insertionLossDb`, 0, 20, 0.5, 'dB (plus split loss)', { decimals: 1 }),
          );
          break;
        default:
          add(numLink(k('loss'), 'Loss', `${p}.lossDb`, 0, 60, 0.1, 'dB', { decimals: 2 }));
      }
      updaters.push((c2) => {
        const it = here(c2);
        lossEl.textContent = it ? lossText(safeLoss(it, c2.link.freqMHz)) : '';
      });
    });
    if (!chainOf(link).length) body.append(el('p', 'hint', 'No items. The link is connected directly.'));
    body.append(list);

    const total = el('p', 'chain-total');
    updaters.push((c2) => {
      let sum = 0;
      for (const it of chainOf(c2.link)) sum += safeLoss(it, c2.link.freqMHz);
      total.textContent = `${target === 'antennaB' ? 'Cable B' : target === 'rx' ? 'Bodypack side' : 'Cable A'} total: ${lossText(sum)}`;
    });
    body.append(total);

    const addRow = el('div', 'chain-add');
    const kindSel = el('select');
    kindSel.setAttribute('aria-label', 'Chain item to add');
    kindSel.dataset.fkey = `chain-kind-${target}`;
    for (const kd of Object.keys(KIND_NAMES)) {
      const o = el('option', null, PREVIEW_KINDS.has(kd) ? `${KIND_NAMES[kd]} (preview)` : KIND_NAMES[kd]);
      o.value = kd;
      kindSel.append(o);
    }
    addRow.append(kindSel, button('Add item', `chain-add-${target}`, () => {
      const cc = getCtx();
      if (cc.link) addChainItem(store, cc.link.id, createChainItem(kindSel.value), undefined, tOpt);
    }));
    body.append(addRow);
    if (target === 'main') body.append(el('p', 'hint', 'Splitters and combiners are included in the budget but are a preview feature.'));
  }

  /** Set a link-relative dotted path, creating missing intermediate objects. */
  function setNested(c, path, v, o = {}) {
    store.update((d) => {
      const l = d.links.find((x) => x.id === c.link.id);
      if (!l) return;
      const parts = path.split('.');
      let cur = l;
      for (let i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = v;
    }, o.coalesce ? { coalesce: o.coalesce } : {});
  }

  function setSquelch(c, field, v, o = {}) {
    store.update((d) => {
      const l = d.links.find((x) => x.id === c.link.id);
      if (!l) return;
      l.rx.squelch = { enabled: true, thresholdDbm: -90, hysteresisDb: 3, ...(l.rx.squelch || {}) };
      l.rx.squelch[field] = v;
    }, o.coalesce ? { coalesce: o.coalesce } : {});
  }

  function safeLoss(item, f) {
    try { return chainItemLossDb(item, f); } catch { return NaN; }
  }

  function buildReflectors(body, c) {
    const list = el('ul', 'refl-list');
    c.scene.reflectors.forEach((r) => {
      const li = el('li');
      const b = button(r.name || 'Reflector', `refl:${r.id}`, () => store.select(r.id));
      b.setAttribute('aria-pressed', String(c.sel === r.id));
      li.append(b);
      list.append(li);
    });
    if (!c.scene.reflectors.length) body.append(el('p', 'hint', 'No reflectors. Add walls, glass or metal to see multipath.'));
    body.append(list);
    body.append(button('Add reflector', 'refl-add', () => {
      const id = addReflector(store);
      store.select(id);
    }));

    const idx = c.found?.type === 'reflector' ? c.scene.reflectors.findIndex((r) => r.id === c.found.item.id) : -1;
    if (idx < 0) return;
    const base = `reflectors.${idx}`;
    const rid = c.scene.reflectors[idx].id;
    const R = (cc) => cc.scene.reflectors[idx];
    const form = el('div', 'refl-form');
    const lenR = (key, label, sub, min, max, axis = null) => numberField({
      key: `refl-${key}`, label, decimals: 2,
      min: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(dispAxis(cc.scene, axis, getIn(R(cc), sub) ?? 0), cc.lu),
      set: (cc, v, o) => setPath(store, `${base}.${sub}`, internalAxis(cc.scene, axis, lengthFromUi(v, cc.lu)), o),
    });
    form.append(
      textField({ key: 'refl-name', label: 'Name', get: (cc) => R(cc)?.name, set: (cc, v, o) => setPath(store, `${base}.name`, v, o) }),
      selectField({
        key: 'refl-mat', label: 'Material', options: Object.entries(MATERIALS).map(([id, m]) => [id, m.name]),
        get: (cc) => R(cc)?.material, set: (cc, v) => setPath(store, `${base}.material`, v),
      }),
      lenR('p1x', 'Start x (0 = centre line)', 'p1.x', -50, 100, 'x'), lenR('p1y', 'Start y (0 = front edge)', 'p1.y', -50, 100, 'y'),
      lenR('p2x', 'End x', 'p2.x', -50, 100, 'x'), lenR('p2y', 'End y', 'p2.y', -50, 100, 'y'),
      numberField({
        key: 'refl-thick', label: 'Wall thickness', min: 0, max: 1, step: 0.01, unit: 'm (loss scales with it)', decimals: 2,
        get: (cc) => R(cc)?.thicknessM ?? 0.1, set: (cc, v, o) => setPath(store, `${base}.thicknessM`, v, o),
      }),
      numberField({
        key: 'refl-zmin', label: 'Bottom height', decimals: 2, min: 0, max: (cc) => lengthToUi(Math.max(0, (R(cc)?.zMax ?? 1) - 0.1), cc.lu),
        step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
        get: (cc) => lengthToUi(R(cc)?.zMin ?? 0, cc.lu), set: (cc, v, o) => setPath(store, `${base}.zMin`, lengthFromUi(v, cc.lu), o),
      }),
      numberField({
        key: 'refl-zmax', label: 'Top height', decimals: 2, min: (cc) => lengthToUi((R(cc)?.zMin ?? 0) + 0.1, cc.lu), max: (cc) => lengthToUi(50, cc.lu),
        step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
        get: (cc) => lengthToUi(R(cc)?.zMax ?? 1, cc.lu), set: (cc, v, o) => setPath(store, `${base}.zMax`, lengthFromUi(v, cc.lu), o),
      }),
    );
    form.append(button('Remove reflector', 'refl-remove', () => { removeReflector(store, rid); store.select(null); }, { cls: 'danger' }));
    body.append(form);
  }

  // ---- sync ------------------------------------------------------------------------------
  function keyOf(c) {
    if (!c.link) return 'none';
    return JSON.stringify([
      c.found?.type ?? null, c.sel ?? null, c.link.id, c.link.kind,
      c.link.chain.map((x, i) => `${x.id || i}:${x.kind}`),
      c.link.kind === 'iem' ? (c.link.rx.chain || []).map((x, i) => `${x.id || i}:${x.kind}`) : null,
      c.link.kind !== 'iem' && c.link.rx.diversity && c.link.rx.diversity.enabled && c.link.rx.diversity.antennaB ? (Array.isArray(c.link.rx.diversity.antennaB.chain) ? c.link.rx.diversity.antennaB.chain.map((x, i) => `${x.id || i}:${x.kind}`) : 'same') : null,
      c.scene.reflectors.map((r) => `${r.id}:${r.name}`),
      (c.scene.platforms || []).map((p) => `${p.id}:${p.name}`),
      c.scene.imd && c.scene.imd.enabled ? c.scene.imd.transmitters.map((t) => t.id) : null,
    ]);
  }

  function sync() {
    const c = getCtx();
    const sel = c.sel ?? null;
    if (sel !== lastSel) {
      lastSel = sel;
      if (c.scene.imd && c.scene.imd.transmitters && c.scene.imd.transmitters.some((t) => t.id === sel)) open.imd = true;
      const sec = c.found ? SECTION_FOR[c.found.type] : null;
      if (sec) open[sec] = true;
    }
    const key = keyOf(c);
    if (key !== structKey) {
      structKey = key;
      const a = document.activeElement;
      const focusKey = a && container.contains(a) ? a.dataset.fkey : null;
      const pos = a && 'selectionStart' in a && a.type !== 'number' ? [a.selectionStart, a.selectionEnd] : null;
      build(c);
      if (focusKey) {
        const t = [...container.querySelectorAll('[data-fkey]')].find((n) => n.dataset.fkey === focusKey && !n.disabled);
        if (t) { t.focus({ preventScroll: true }); if (pos && 'setSelectionRange' in t) { try { t.setSelectionRange(pos[0], pos[1]); } catch { /* number inputs */ } } }
      }
    }
    for (const u of updaters) { try { u(c); } catch (err) { console.warn('inspector field update failed', err); } }
  }

  const unsubSq = squelch.subscribe(() => sync()); // sync rebuilds first if the chain/selection changed
  const unsub = store.subscribe(sync);
  sync();
  return { refresh: sync, destroy() { unsub(); unsubSq(); container.textContent = ''; } };
}
