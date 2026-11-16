// Inspector: the people form and the point-to-point and intermod demo forms. The venue forms (stage, platforms, noise, audience, ceiling, environment, reflectors) are built here but shown in the Venue builder panel. The active mic or IEM link's own
// Link, Transmitter, Receiver and cable sections are built here too but shown inside its radio items (see linkDock.js, rackUi.js).
// Structure is rebuilt only when the set of editable things changes (selection, chain items, reflectors);
// otherwise every field is patched in place and a focused field is never overwritten.
import { findItem, activeLink, solveCached } from '../view/util.js';
import { setLinkDock, LINK_DOCK_SECTIONS, setVenueDock, VENUE_DOCK_SECTIONS } from './linkDock.js';
import { chainItemLossDb } from '../model/rf.js';
import { CABLES, ANTENNAS, SURFACES, MATERIALS, BANDS, GROUND_PLANE_LABELS, GROUND_PLANE_GAIN_DBI, ANTENNA_CONTACT_LABELS, ANTENNA_DAMPNESS_LABELS, allowedPolarisations, defaultPolarisation } from '../model/library.js';
import { setAntennaField, setAntennaType, antennaOf } from '../actions.js';
import { POLARISATION_LABELS, ORIENTATION_HINT, POLARISATION_HINT } from './antennaFields.js';
import { CHAIN_PRESETS, DC_MODES, FILTER_TYPES } from '../model/chain-presets.js';
import { announce } from '../view/a11y.js';
import { NOISE_CATALOGUE, NOISE_SOURCE_LIMITS, dutyOf } from '../model/noise-sources.js';
import { catalogueOptions, flagText, behaviourText, FLAG_WORDS } from './noiseUi.js';
import { addNoiseSource, addEngCrew, addWallNoiseSource, updateNoiseSource, removeNoiseSource, setReflectorName, REFLECTOR_NAME_MAX } from '../actionsAreas.js';
import { PERSON_ROLES, PERSON_COLOURS, PEOPLE_LIMITS } from '../model/people.js';
import { addPerson, updatePerson, assignMic, assignIem, assignExtraMic, removeExtraMic, removePerson, reorderPerson } from '../actions.js';
import { confirmDialog } from './confirmDialog.js';
import { linkChoices, personMargins, extraChoices } from './peopleUi.js';
import { cleanName, limitMessage } from './nameInput.js';
import { addAudience, updateAudience, removeAudience, setCeiling, addOverheadPanel, updateOverheadPanel, removeOverheadPanel, setP2pField, setAntennaDesignBand, densityChoiceId, setWallField, setImdIntercept, setImdFilter, addImdBand, updateImdBand, removeImdBand, setImdHarmonic } from '../actionsAreas.js';
import { IIP2_PRESETS, DEFAULT_IIP2_DBM, IIP4_OVER_IIP2_DB } from '../model/imd-even.js';
import { WALL_CONSTRUCTIONS, WALL_NOISE_PRESETS, WALL_NOISE_LIMITS } from '../model/ledwall.js';
import { AUDIENCE_DENSITY_PRESETS, AUDIENCE_DENSITY_LIMITS, AUDIENCE_DB_PER_M_PER_PERSON, AUDIENCE_MAX_LOSS_DB } from '../model/audience.js';
import { CEILING_MATERIALS, CEILING_LIMITS } from '../model/ceiling.js';
import { addCrowd, updateCrowd, removeCrowd } from '../actionsAreas.js';
import { CROWD_MODES, CROWD_DEFAULTS, CROWD_LIMITS, CROWD_CAVEAT, crowdParams } from '../model/crowd.js';
import { CROWD_MODE_LABELS, CROWD_SHORT_NOTE, newCrowdPartial, polygonAddAfter, polygonRemoveAt, polygonSetPoint, confidenceLines, crowdParamText } from './crowdUi.js';
import { ANTENNA_BANDS, antennaMatch, resolveDesignBand } from '../model/antenna-band.js';
import { rofEffective } from '../model/rof.js';
import { vswrText } from './budgetExtras.js';
import { createChainItemFromPreset } from '../model/scene.js';
import { FLAG_TEXT, DC_MODE_LABELS, FILTER_TYPE_LABELS, presetOptions, presetFlag } from './chainFields.js';
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
import { addOrLimit, showLimit } from './limitNote.js';
import { txPresetOptions, powerOptionChoices, currentPowerOption, lowIntermodAvailable, presetNotes, txFigures, rxFigures, tuningHint, rxPresetChoices, isFmRxPreset, LOW_IM_LABEL } from './fmui.js';
import { setTxFmPreset, setTxPowerOption, setTxLowIntermod, setRxFmPreset, setImdTransmitterFm } from '../actions.js';
import { noiseOptions, noiseValue, noiseFromChoice, noiseHint, interferenceApplies, interferenceOptions, interferenceValue, interferenceHint, rxPresetOffer } from './noise.js';
import {
  setPath, setLinkField, setLinkKind, addChainItem, removeChainItem, moveChainItem,
  addReflector, removeReflector, addRoomWalls,
} from '../actions.js';
import {
  clamp, parseNumber, formatNumber, lengthToUi, lengthFromUi, powerFieldRange, powerUiToDbm,
  bandForFreq, bandCentre, lossText,
} from './fields.js';

const getIn = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const val = (v, c) => (typeof v === 'function' ? v(c) : v);
const KIND_NAMES = {
  cable: 'Cable', booster: 'Booster / amplifier', filter: 'Filter', connector: 'Connector',
  attenuator: 'Attenuator', splitter: 'Splitter', combiner: 'Combiner',
  rof: 'RF over fibre', coupler: 'Directional coupler', biastee: 'Bias tee', dcblock: 'DC block', activesplitter: 'Active splitter', activecombiner: 'Active combiner',
};
const PREVIEW_KINDS = new Set(['splitter', 'combiner']);
const SECTION_FOR = { tx: 'tx', rx: 'rx', reflector: 'refl', link: 'link', platform: 'plats', audience: 'aud', crowd: 'crowd', panel: 'ovh', person: 'ppl', noise: 'noise' };

export function mountInspector({ container, store }) {
  container.classList.add('inspector');
  let uid = 0;
  let structKey = null;
  let updaters = [];
  let refs = {};
  let session = 0; // bumped on focus so each editing burst is its own undo step
  const open = { stage: false, plats: false, chainB: true, imd: true, aud: false, ovh: false, p2p: true, link: true, tx: false, rx: false, env: false, chain: true, refl: false };
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

  /** Text field. spec: {key,label,get(c),set(c,v,opts), fallback(c) (name used when left empty), maxLength (default 40)}. Spaces are kept, control characters dropped, the limit is announced. */
  function textField(spec) {
    const max = spec.maxLength || 40;
    const input = el('input');
    input.type = 'text';
    input.maxLength = max;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const { row } = fieldRow(spec.label, input, spec.key, '');
    const note = el('span', 'field-limit');
    note.setAttribute('role', 'status'); note.hidden = true;
    row.append(note);
    const showLimit = () => { const m = limitMessage(input.value, max); note.hidden = !m; note.textContent = m; };
    input.addEventListener('focus', () => { session++; });
    input.addEventListener('input', () => {
      const clean = cleanName(input.value, max);
      if (clean !== input.value) input.value = clean;
      showLimit();
      const c = getCtx();
      if (!c.link) return;
      input.setAttribute('aria-invalid', String(clean === '' && !!spec.fallback));
      if (clean === '' && spec.fallback) return; // empty while typing: keep the old name until the field is left
      spec.set(c, clean, { coalesce: `insp:${spec.key}:${session}` });
    });
    input.addEventListener('change', () => {
      const c = getCtx();
      if (c.link && spec.fallback && input.value.trim() === '') spec.set(c, spec.fallback(c), { coalesce: `insp:${spec.key}:${session}` });
      input.setAttribute('aria-invalid', 'false');
      input.value = spec.get(getCtx()) ?? '';
      showLimit();
    });
    updaters.push((c) => { if (document.activeElement !== input) { input.value = spec.get(c) ?? ''; showLimit(); } });
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
        set: (c, v) => setAntennaType(store, c.link.id, who, v),
      }),
      numLink(`${who}-gain`, 'Antenna gain', `${prefix}.antenna.gainDbi`, -20, 40, 0.5, 'dBi', { decimals: 1 }),
      numLink(`${who}-az`, 'Azimuth', `${prefix}.antenna.orientation.az`, 0, 360, 1, '° (0 = toward audience, clockwise)', { decimals: 1 }),
      numLink(`${who}-el`, 'Elevation', `${prefix}.antenna.orientation.el`, -90, 90, 1, '° (0 = horizontal)', { decimals: 1 }),
      detailFields(who, who, () => true),
    );
    return frag;
  }

  /** One line under the band fields: VSWR, return loss and mismatch loss of the antenna at the link frequency. */
  function vswrLine(A, vis) {
    const p = el('p', 'hint insp-vswr');
    updaters.push((c) => {
      const a = A(c);
      const m = a && vis(c) && resolveDesignBand(a) ? antennaMatch(a, c.link.freqMHz) : null;
      p.hidden = !m; p.textContent = m ? `At ${c.link.freqMHz} MHz: ${vswrText(m)}. Series-resonator model, assumed.` : '';
      p.dataset.over = String(!!(m && m.vswr >= 3));
    });
    return p;
  }

  /** Tilt, roll, polarisation, ground plane, contact and dampness for the antenna named by target ('tx' | 'rx' | 'antennaB'). */
  function detailFields(key, target, visible) {
    const frag = document.createDocumentFragment();
    const A = (c) => antennaOf(c.link, target);
    const vis = (c) => !!A(c) && visible(c);
    const label = key === 'antennaB' ? 'Antenna B ' : '';
    frag.append(
      numberField({
        key: `${key}-tilt`, label: `${label}Tilt (deg, nose up)`, min: -90, max: 90, step: 1, unit: '\u00b0 (0 = as aimed)', decimals: 1,
        visible: vis, get: (c) => A(c)?.tiltDeg ?? 0, set: (c, v, o) => setAntennaField(store, c.link.id, target, 'tiltDeg', v, o),
      }),
      numberField({
        key: `${key}-roll`, label: `${label}Roll (deg)`, min: -180, max: 180, step: 1, unit: '\u00b0 (0 = upright)', decimals: 1,
        visible: vis, get: (c) => A(c)?.rollDeg ?? 0, set: (c, v, o) => setAntennaField(store, c.link.id, target, 'rollDeg', v, o),
      }),
      selectField({
        key: `${key}-pol`, label: `${label}Polarisation`,
        options: (c) => allowedPolarisations(A(c)?.type).map((p) => [p, POLARISATION_LABELS[p] || p]),
        visible: vis, get: (c) => A(c)?.polarisation ?? defaultPolarisation(A(c)?.type), set: (c, v) => setAntennaField(store, c.link.id, target, 'polarisation', v),
      }),
      selectField({
        key: `${key}-gp`, label: `${label}Ground plane`,
        options: [['', 'Not set']].concat(Object.keys(GROUND_PLANE_GAIN_DBI).map((g) => [g, `${GROUND_PLANE_LABELS[g]} (${GROUND_PLANE_GAIN_DBI[g]} dBi)`])),
        visible: (c) => vis(c) && A(c).type === 'quarterwave', get: (c) => A(c)?.groundPlane ?? '',
        set: (c, v) => setAntennaField(store, c.link.id, target, 'groundPlane', v || null),
      }),
      selectField({
        key: `${key}-contact`, label: `${label}Body contact`, options: Object.entries(ANTENNA_CONTACT_LABELS),
        visible: vis, get: (c) => A(c)?.contact ?? 'free', set: (c, v) => setAntennaField(store, c.link.id, target, 'contact', v),
      }),
      selectField({
        key: `${key}-damp`, label: `${label}Dampness`, options: Object.entries(ANTENNA_DAMPNESS_LABELS),
        visible: vis, get: (c) => A(c)?.dampness ?? 'dry', set: (c, v) => setAntennaField(store, c.link.id, target, 'dampness', v),
      }),
      selectField({
        key: `${key}-band`, label: `${label}Design band`,
        options: [['', 'Not stated (no mismatch)'], ...Object.entries(ANTENNA_BANDS).map(([id, b]) => [id, b.label]), ['custom', 'Custom lo / hi band']],
        visible: vis, get: (c) => { const b = A(c)?.designBand; return b === undefined ? '' : typeof b === 'string' ? b : 'custom'; },
        set: (c, v) => {
          if (v === 'custom') { const f = c.link.freqMHz; setAntennaDesignBand(store, c.link.id, target, { loMHz: Math.round(f * 0.96 * 1000) / 1000, hiMHz: Math.round(f * 1.04 * 1000) / 1000 }); }
          else setAntennaDesignBand(store, c.link.id, target, v || null);
        },
      }),
      numberField({
        key: `${key}-band-lo`, label: `${label}Band low`, min: 1, max: 99999, step: 1, unit: 'MHz', decimals: 3,
        visible: (c) => vis(c) && typeof A(c)?.designBand === 'object', get: (c) => A(c)?.designBand?.loMHz,
        set: (c, v, o) => { const b = A(c)?.designBand; if (b && typeof b === 'object') setAntennaDesignBand(store, c.link.id, target, { ...b, loMHz: v }, o); },
      }),
      numberField({
        key: `${key}-band-hi`, label: `${label}Band high`, min: 1, max: 99999, step: 1, unit: 'MHz', decimals: 3,
        visible: (c) => vis(c) && typeof A(c)?.designBand === 'object', get: (c) => A(c)?.designBand?.hiMHz,
        set: (c, v, o) => { const b = A(c)?.designBand; if (b && typeof b === 'object') setAntennaDesignBand(store, c.link.id, target, { ...b, hiMHz: v }, o); },
      }),
      vswrLine(A, vis),
      el('p', 'hint', POLARISATION_HINT),
      el('p', 'hint', ORIENTATION_HINT),
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
      setLinkDock(null); setVenueDock(null);
      return;
    }
    const link = c.link;
    const heading = el('h2', null, 'Inspector');
    const who = c.found
      ? el('p', 'insp-who', c.found.type === 'platform' ? `Selected: platform "${c.found.item.name}"` : c.found.type === 'audience' ? `Selected: audience area "${c.found.item.name}"` : c.found.type === 'crowd' ? `Selected: crowd zone "${c.found.item.name}"` : c.found.type === 'panel' ? `Selected: overhead panel "${c.found.item.name}"` : c.found.type === 'reflector' ? `Selected: reflector "${c.found.item.name}"`
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
    sb.append(selectField({
      key: 'stage-mat', label: 'Stage deck surface', options: [['', 'Same as venue floor'], ...Object.entries(SURFACES).map(([id, s]) => [id, s.name])],
      get: (cc) => cc.scene.stage.material || '', set: (cc, v) => setStage(store, { material: v }),
    }));
    const plb = section('plats', 'Platforms', 'A platform is a raised block on the stage (drum riser, choir steps). Its top height is measured from the ground.');
    buildPlatforms(plb, c);

    const audb = section('aud', 'Audience', `A crowd absorbs signal below head height: ${AUDIENCE_DB_PER_M_PER_PERSON} dB per metre per person per square metre, capped at ${AUDIENCE_MAX_LOSS_DB} dB per path (assumed, unverified). Drag an audience area onto the plan, or add one here.`);
    buildAudience(audb, c);
    const crb = section('crowd', 'Crowd zones (assumed)', `A crowd zone is a polygon on the plan that absorbs signal passing through it below head height. ${CROWD_SHORT_NOTE} Drag a zone or its corner squares on the plan, or edit the corners below.`);
    buildCrowd(crb, c);
    const ppb = section('ppl', 'People', 'A person carries a mic and an in-ear pack. Dragging a person moves both packs together; each link stays selectable on its own. Body contact and dampness apply to both packs.');
    buildPeople(ppb, c);
    const nsb = section('noise', 'Noise sources', 'Things that raise the receiver noise floor: displays and lights, power electronics, camera flash, crew radios and phones. All catalogue figures are planning values; the letter in brackets is the least certain figure (S rule or class limit, I inferred, U unverified guess). Average power raises the floor; the peak is what a squelch or meter sees during a burst.');
    buildNoise(nsb, c);
    const ovb = section('ovh', 'Ceiling and overhead panels', 'A ceiling and flown panels reflect signal back down. Heights are above the ground. Panels are drawn on the plan and in the side view.');
    buildOverhead(ovb, c);

    // Link
    const lb = section('link', 'Link');
    lb.append(
      textField({ key: 'link-name', label: 'Link name', get: (cc) => cc.link.name, set: (cc, v, o) => linkSet('name')(cc, v, o) }),
      selectField({
        key: 'link-kind', label: 'Link kind', options: [['mic', 'Microphone (Tx on stage, Rx at rack)'], ['iem', 'In-ear monitor (Tx at rack, Rx on performer)'], ['p2p', 'Point to point, P2P (fixed directional link)']],
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
      selectField({
        key: 'tx-fm', label: 'Equipment preset', options: () => txPresetOptions(),
        get: (cc) => cc.link.tx.fmPreset || '', set: (cc, v) => setTxFmPreset(store, cc.link.id, v || null),
      }),
      selectField({
        key: 'tx-fm-pow', label: 'Power option',
        options: (cc) => { const o = powerOptionChoices(cc.link.tx.fmPreset); return currentPowerOption(cc.link) === 'custom' ? [...o, ['custom', 'Custom (edited)']] : o; },
        get: (cc) => currentPowerOption(cc.link), set: (cc, v) => { if (v !== 'custom') setTxPowerOption(store, cc.link.id, v); },
        visible: (cc) => !!cc.link.tx.fmPreset,
      }),
      selectField({
        key: 'tx-fm-li', label: LOW_IM_LABEL, options: [['off', 'Off'], ['on', 'On']],
        get: (cc) => (cc.link.tx.lowIntermod ? 'on' : 'off'), set: (cc, v) => setTxLowIntermod(store, cc.link.id, v === 'on'),
        visible: (cc) => lowIntermodAvailable(cc.link.tx.fmPreset),
      }),
      fmBlock((cc) => cc.link.tx.fmPreset, (cc) => cc.link, cc2 => cc2.link.freqMHz),
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
      numLink('rx-bias-v', 'Antenna bias supplied', 'rx.antennaBiasV', 0, 1000, 0.5, 'V (0 = none)', { decimals: 1, visible: (cc) => cc.link.kind !== 'iem', get: (cc) => cc.link.rx.antennaBiasV ?? 0 }),
      numLink('rx-bias-ma', 'Antenna bias current limit', 'rx.antennaBiasMa', 0, 1000, 5, 'mA (0 = not stated)', { decimals: 0, visible: (cc) => cc.link.kind !== 'iem' && (cc.link.rx.antennaBiasV ?? 0) > 0, get: (cc) => cc.link.rx.antennaBiasMa ?? 0 }),
      posFields('rx'),
    );
    rb.append(
      selectField({
        key: 'rx-preset', label: 'Receiver preset', options: () => rxPresetChoices(),
        get: (cc) => cc.link.rx.rxPreset || (cc.link.kind === 'iem' ? 'iem-bodypack-typical' : 'mic-receiver-typical'),
        set: (cc, v) => { if (isFmRxPreset(v)) setRxFmPreset(store, cc.link.id, v); else setNested(cc, 'rx.rxPreset', v); },
      }),
      fmBlock((cc) => (isFmRxPreset(cc.link.rx.rxPreset) ? cc.link.rx.rxPreset : null), (cc) => cc.link, null),
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
        set: (cc, v) => setAntennaType(store, cc.link.id, 'antennaB', v),
      }),
      numLink('rx-b-gain', 'Antenna B gain', 'rx.diversity.antennaB.antenna.gainDbi', -20, 40, 0.5, 'dBi', {
        decimals: 1, visible: (cc) => !!cc.link.rx.diversity?.enabled && !!cc.link.rx.diversity?.antennaB?.antenna,
      }),
      detailFields('antennaB', 'antennaB', (cc) => !!cc.link.rx.diversity?.enabled),
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
        key: 'env-floor', label: 'Venue floor surface', options: Object.entries(SURFACES).map(([id, s]) => [id, s.name]),
        get: (cc) => cc.scene.environment.floor, set: (cc, v) => setPath(store, 'environment.floor', v),
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
    eb.append(el('p', 'hint', 'Venue floor surface is the ground material of the whole venue: it sets how strongly the floor reflects the signal. The stage deck and platforms can have their own material.'));
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

    const p2pb = c.link.kind === 'p2p' ? section('p2p', 'Point-to-point path', 'Heights are above a common flat datum. Terrain profiles, multiple edges, rain and ducting are not modelled.') : null;
    if (p2pb) buildP2p(p2pb);
    const secs = ['stage', 'plats', ...(p2pb ? ['p2p'] : []), 'ppl', 'noise', 'aud', 'crowd', 'ovh', 'link', 'tx', 'rx', 'env', 'chain', ...(refs.chainB ? ['chainB'] : []), 'refl'];
    if (c.scene.imd && c.scene.imd.enabled) { buildImd(section('imd', 'Intermod demo'), c); secs.unshift('imd'); }
    // This element is a hidden form engine now: every section is handed to its panel (radio items, Venue builder, People, Point-to-point, Intermodulation).
    const docked = LINK_DOCK_SECTIONS.filter((n) => refs[n]);
    const venueDocked = [...VENUE_DOCK_SECTIONS, 'ppl', 'imd'].filter((n) => refs[n]);
    container.append(...secs.filter((n) => !docked.includes(n) && !venueDocked.includes(n)).map((n) => refs[n].details));
    { const vmap = {}; for (const n of venueDocked) vmap[n] = refs[n].details; setVenueDock(vmap); } // shown in the Venue builder panel (ui/venueBuilderUi.js)
    if (docked.length) { const map = {}; for (const n of docked) { refs[n].details.open = true; map[n] = refs[n].details; } setLinkDock(map); } else setLinkDock(null);
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
    // even-order products (second and fourth order, imd-even.js): receiver or booster intercepts, other bands in use, filters before and after
    const iip2 = (cc) => (Number.isFinite(cc.scene.imd.iip2Dbm) ? cc.scene.imd.iip2Dbm : DEFAULT_IIP2_DBM);
    const evenHead = el('h3', 'cv-sug-h', 'Even-order intermod (second and fourth order)');
    body.append(evenHead, el('p', 'hint', 'Products such as f1 + f2 and 2f land far from the carriers, so they matter for wideband boosters, mixed bands on one antenna and harmonics. Intercepts are assumed planning numbers (flag U).'));
    body.append(
      selectField({
        key: 'imd-iip2p', label: 'Nonlinear stage', options: [['custom', 'Custom IIP2'], ...Object.entries(IIP2_PRESETS).map(([id, p]) => [id, `${p.label} [${p.flag}]`])],
        get: (cc) => Object.entries(IIP2_PRESETS).find(([, p]) => p.iip2Dbm === iip2(cc))?.[0] || 'custom',
        set: (cc, v) => { if (IIP2_PRESETS[v]) { setImdIntercept(store, 'iip2Dbm', IIP2_PRESETS[v].iip2Dbm); setImdIntercept(store, 'iip4Dbm', null); } },
      }),
      numberField({ key: 'imd-iip2', label: 'IIP2', min: -100, max: 200, step: 1, unit: 'dBm (higher is better)', decimals: 1, get: (cc) => iip2(cc), set: (cc, v, o) => setImdIntercept(store, 'iip2Dbm', v, o) }),
      numberField({ key: 'imd-iip4', label: 'IIP4', min: -100, max: 200, step: 1, unit: `dBm (default IIP2 + ${IIP4_OVER_IIP2_DB})`, decimals: 1, get: (cc) => (Number.isFinite(cc.scene.imd.iip4Dbm) ? cc.scene.imd.iip4Dbm : iip2(cc) + IIP4_OVER_IIP2_DB), set: (cc, v, o) => setImdIntercept(store, 'iip4Dbm', v, o) }),
    );
    (m.bands || []).forEach((b, i) => {
      const B = (cc) => (cc.scene.imd.bands || [])[i];
      const head = el('div', 'ci-head'); head.append(el('strong', null, `Other band ${i + 1}`), button('×', `imd-band${i}-del`, () => removeImdBand(store, i), { label: `Remove other band ${i + 1}`, cls: 'danger' }));
      const box = el('div', 'ci'), fl = el('div', 'ci-fields'); box.append(head, fl);
      fl.append(
        textField({ key: `imd-band${i}-name`, label: 'Name', get: (cc) => B(cc)?.name, set: (cc, v, o) => updateImdBand(store, i, { name: v }, o) }),
        numberField({ key: `imd-band${i}-lo`, label: 'From', min: 1, max: 100000, step: 1, unit: 'MHz', decimals: 1, get: (cc) => B(cc)?.loMHz ?? 0, set: (cc, v, o) => updateImdBand(store, i, { loMHz: v }, o) }),
        numberField({ key: `imd-band${i}-hi`, label: 'To', min: 1, max: 100000, step: 1, unit: 'MHz', decimals: 1, get: (cc) => B(cc)?.hiMHz ?? 0, set: (cc, v, o) => updateImdBand(store, i, { hiMHz: v }, o) }),
      );
      body.append(box);
    });
    body.append(button('Add a band the system uses', 'imd-band-add', (e) => { if (!addImdBand(store)) showLimit(e && e.currentTarget, 'band'); }));
    for (const [which, title] of [['filterBefore', 'Filter before the nonlinear stage (cleans the tones)'], ['filterAfter', 'Filter after it (cleans the products)']]) {
      const F = (cc) => cc.scene.imd[which];
      const has = (cc) => !!F(cc);
      body.append(
        selectField({ key: `imd-${which}`, label: title, options: [['none', 'None'], ['bandpass', 'Bandpass']], get: (cc) => (has(cc) ? 'bandpass' : 'none'), set: (cc, v) => setImdFilter(store, which, v === 'none' ? null : {}) }),
        numberField({ key: `imd-${which}-lo`, label: 'Pass from', min: 1, max: 100000, step: 1, unit: 'MHz', decimals: 1, visible: has, get: (cc) => F(cc)?.passLoMHz ?? 470, set: (cc, v, o) => setImdFilter(store, which, { passLoMHz: v }, o) }),
        numberField({ key: `imd-${which}-hi`, label: 'Pass to', min: 1, max: 100000, step: 1, unit: 'MHz', decimals: 1, visible: has, get: (cc) => F(cc)?.passHiMHz ?? 608, set: (cc, v, o) => setImdFilter(store, which, { passHiMHz: v }, o) }),
        numberField({ key: `imd-${which}-rej`, label: 'Rejection outside', min: 0, max: 200, step: 1, unit: 'dB', decimals: 0, visible: has, get: (cc) => F(cc)?.rejectionDb ?? 40, set: (cc, v, o) => setImdFilter(store, which, { rejectionDb: v }, o) }),
      );
    }
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
        numberField({ key: k('h2'), label: 'Second harmonic', min: 0, max: 200, step: 1, unit: 'dB below carrier (default 50)', decimals: 0, get: (cc) => T(cc)?.h2Dbc ?? 50, set: (cc, v, o) => setImdHarmonic(store, t.id, { h2Dbc: v }, o) }),
        numberField({ key: k('hf'), label: 'Harmonic filter', min: 0, max: 200, step: 1, unit: 'dB extra rejection', decimals: 0, get: (cc) => T(cc)?.harmonicFilterDb ?? 0, set: (cc, v, o) => setImdHarmonic(store, t.id, { harmonicFilterDb: v }, o) }),
        selectField({ key: k('fm'), label: 'Equipment preset', options: () => txPresetOptions(), get: (cc) => T(cc)?.fmPreset || '', set: (cc, v) => setImdTransmitterFm(store, t.id, { fmPreset: v || null }) }),
        selectField({
          key: k('li'), label: LOW_IM_LABEL, options: [['off', 'Off'], ['on', 'On']],
          get: (cc) => (T(cc)?.lowIntermod ? 'on' : 'off'), set: (cc, v) => setImdTransmitterFm(store, t.id, { lowIntermod: v === 'on' }),
          visible: (cc) => lowIntermodAvailable(T(cc)?.fmPreset),
        }),
      );
      box.append(fields);
      body.append(box);
    });
    body.append(button('Add transmitter', 'imd-add', (e) => { addOrLimit(store, e && e.currentTarget, 'transmitter', () => addImdTransmitter(store)); }));
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
    body.append(button('Add platform', 'plat-add', (e) => { addOrLimit(store, e && e.currentTarget, 'platform', () => addPlatform(store)); }));
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

  // ---- audience areas -------------------------------------------------------------------------
  function buildNoise(body, c) {
    const srcs = c.scene.noiseSources || [];
    const list = el('ul', 'refl-list');
    srcs.forEach((n) => {
      const li = el('li');
      const b = button(n.name || 'Noise source', `ns:${n.id}`, () => store.select(n.id));
      b.setAttribute('aria-pressed', String(c.sel === n.id));
      li.append(b); list.append(li);
    });
    if (!srcs.length) body.append(el('p', 'hint', 'No noise sources. Pick a kind below and add it, or add an ENG crew.'));
    body.append(list);
    // catalogue picker
    const pick = el('select'); pick.id = 'ns-kind-pick'; pick.dataset.fkey = 'ns-pick'; pick.setAttribute('aria-label', 'Noise source kind to add');
    for (const g of catalogueOptions()) { const og = el('optgroup'); og.label = g.label; for (const [id, t] of g.options) { const o = el('option', null, t); o.value = id; og.append(o); } pick.append(og); }
    const pickDesc = el('p', 'hint ns-pick-desc');
    const showPick = () => { const d = NOISE_CATALOGUE[pick.value]; pickDesc.textContent = d ? `${d.note} Confidence: ${flagText(pick.value)}.` : ''; };
    pick.addEventListener('change', showPick); showPick();
    const row = el('div', 'ppl-bar');
    row.append(pick,
      button('Add noise source', 'ns-add', (e) => { addOrLimit(store, e && e.currentTarget, 'noise source', () => addNoiseSource(store, pick.value)); }, { label: 'Add the selected kind of noise source to the scene' }),
      button('Add ENG crew', 'ns-eng', (e) => { const ids = addEngCrew(store, { x: 5, y: -3, z: 0 }); if (ids.length) { store.select(ids[0]); announce(`ENG crew added: ${ids.length} noise sources`, { key: 'ns', delay: 100 }); } else showLimit(e.currentTarget, 'noise source'); }, { label: 'Add an ENG crew: camera transmitter, two PTT radios, an LED light and a generator, each separately editable' }));
    body.append(row, pickDesc);
    const n0 = c.found?.type === 'noise' ? c.found.item : null;
    if (!n0) return;
    const id = n0.id, linked = !!n0.reflectorId;
    const N = (cc) => (cc.scene.noiseSources || []).find((q) => q.id === id) || n0;
    const upd = (patch, o) => updateNoiseSource(store, id, patch, o);
    const def = (cc) => NOISE_CATALOGUE[N(cc).kind] || { params: {}, flags: {} };
    const val0 = (cc, k, d) => { const v = N(cc)[k]; return Number.isFinite(v) ? v : def(cc).params[k] ?? d; };
    const type = (NOISE_CATALOGUE[n0.kind] || { params: {} }).params.type, beh = (NOISE_CATALOGUE[n0.kind] || {}).behaviour;
    const form = el('div', 'refl-form');
    const fnum = (k, label, lim, step, unit, decimals = 1) => numberField({ key: `ns-${k}`, label: `${label}${def(c).flags[k] ? ` [${def(c).flags[k]}]` : ''}`, min: lim[0], max: lim[1], step, unit, decimals, get: (cc) => val0(cc, k, 0), set: (cc, v, o) => upd({ [k]: v }, o) });
    const lenN = (key, label, sub, axis) => numberField({
      key: `ns-${key}`, label, decimals: 2,
      min: (cc) => lengthToUi(dispRange(cc.scene, axis, NOISE_SOURCE_LIMITS.coord[0], NOISE_SOURCE_LIMITS.coord[1])[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, axis, NOISE_SOURCE_LIMITS.coord[0], NOISE_SOURCE_LIMITS.coord[1])[1], cc.lu),
      step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(sub === 'z' ? (N(cc).pos?.z ?? 0) : dispAxis(cc.scene, axis, N(cc).pos?.[sub] ?? 0), cc.lu),
      set: (cc, v, o) => upd({ pos: { [sub]: sub === 'z' ? lengthFromUi(v, cc.lu) : internalAxis(cc.scene, axis, lengthFromUi(v, cc.lu)) } }, o),
    });
    form.append(
      textField({ key: 'ns-name', label: 'Name', get: (cc) => N(cc).name, fallback: () => NOISE_CATALOGUE[n0.kind]?.label || 'Noise source', set: (cc, v, o) => upd({ name: v }, o) }),
      selectField({ key: 'ns-kind', label: linked ? 'Kind (linked to a reflector wall)' : 'Kind', options: catalogueOptions().flatMap((g) => g.options), get: (cc) => N(cc).kind, set: (cc, v) => { if (!linked) upd({ kind: v }); } }),
      selectField({ key: 'ns-enabled', label: 'State', options: [['on', 'On'], ['off', 'Muted (off)']], get: (cc) => (N(cc).enabled === false ? 'off' : 'on'), set: (cc, v) => { upd({ enabled: v === 'on' }); announce(`${n0.name} ${v === 'on' ? 'on' : 'muted'}`, { key: 'ns', delay: 100 }); } }),
    );
    if (!linked) form.append(lenN('x', 'Position x (0 = centre line)', 'x', 'x'), lenN('y', 'Position y (0 = front edge)', 'y', 'y'), lenN('z', 'Height above floor', 'z', null));
    const info = el('p', 'hint ns-info');
    updaters.push((cc) => { const d = NOISE_CATALOGUE[N(cc).kind]; const t = d ? `${d.note} Behaviour: ${behaviourText(N(cc), dutyOf)}. Confidence: ${flagText(N(cc).kind)} (${Object.keys(FLAG_WORDS).map((k) => `${k} ${FLAG_WORDS[k]}`).join('; ')}).` : ''; if (info.textContent !== t) info.textContent = t; });
    if (!linked) {
      if (type === 'narrowband') form.append(fnum('freqMHz', 'Frequency', NOISE_SOURCE_LIMITS.bandMHz, 1, 'MHz', 3), fnum('erpDbm', 'ERP while on', NOISE_SOURCE_LIMITS.erpDbm, 1, 'dBm'), fnum('bwKHz', 'Occupied bandwidth', NOISE_SOURCE_LIMITS.bwKHz, 1, 'kHz'));
      else form.append(fnum('fieldDbuvmAt10m', beh === 'impulsive' ? 'Peak field at 10 m' : 'Field at 10 m', NOISE_SOURCE_LIMITS.fieldDbuvm, 1, 'dBuV/m (120 kHz)'), fnum('tiltDbPerDecade', 'Tilt', NOISE_SOURCE_LIMITS.tiltDbPerDecade, 1, 'dB per decade'));
      if (beh === 'intermittent') form.append(fnum('dutyCycle', 'Duty cycle (fraction on)', NOISE_SOURCE_LIMITS.dutyCycle, 0.01, '0 to 1', 3), fnum('onS', 'Typical on time', NOISE_SOURCE_LIMITS.timeS, 0.1, 's', 2));
      if (beh === 'impulsive' || beh === 'pulsed-tdma') form.append(fnum('pulseWidthMs', 'Pulse width', NOISE_SOURCE_LIMITS.pulseWidthMs, 0.1, 'ms', 3), fnum('repHz', 'Repetition rate', NOISE_SOURCE_LIMITS.repHz, 1, 'Hz', 2));
    } else buildWallFields(form, c, n0.reflectorId);
    const contrib = el('p', 'hint ns-contrib'); contrib.setAttribute('role', 'status');
    updaters.push((cc) => {
      const r = cc.result && cc.result.noiseSources, s = r && (r.sources || []).find((q) => q.id === id);
      const t = linked ? 'The wall noise is summed in the link budget as Video wall noise.' : s && Number.isFinite(s.averageDbm) ? `At the active receiver, ${s.distanceM.toFixed(1)} m away: average ${s.averageDbm.toFixed(1)} dBm, peak ${s.peakDbm.toFixed(1)} dBm${s.inChannel === false ? `, ${Math.abs(s.offsetMHz).toFixed(1)} MHz off channel` : ''}.` : (N(cc).enabled === false ? 'Muted: no contribution.' : 'No contribution at the active receiver.');
      if (contrib.textContent !== t) contrib.textContent = t;
    });
    const bar = el('div', 'ppl-bar');
    bar.append(button(linked ? 'Mute wall noise' : 'Delete noise source', 'ns-del', () => { removeNoiseSource(store, id); if (!linked) store.select(null); announce(linked ? 'Wall noise muted' : 'Noise source deleted', { key: 'ns', delay: 100 }); }, { label: linked ? 'Mute this video wall noise source' : 'Delete this noise source', cls: 'danger' }));
    body.append(form, info, contrib, bar);
  }

  function buildPeople(body, c) {
    const people = c.scene.people || [];
    const list = el('ul', 'refl-list');
    people.forEach((p) => {
      const li = el('li');
      const b = button(p.name || 'Person', `ppl:${p.id}`, () => store.select(p.id));
      b.setAttribute('aria-pressed', String(c.sel === p.id));
      li.append(b); list.append(li);
    });
    if (!people.length) body.append(el('p', 'hint', 'No people. Add one, then choose the mic and in-ear links they carry.'));
    body.append(list);
    body.append(button('Add person', 'ppl-add', (e) => { addOrLimit(store, e && e.currentTarget, 'person', () => addPerson(store, { pos: { x: 0, y: 1 } })); }, { label: `Add a person (up to ${PEOPLE_LIMITS.max})` }));
    const p0 = c.found?.type === 'person' ? c.found.item : null;
    if (!p0) return;
    const id = p0.id, idx = people.findIndex((q) => q.id === id);
    const P = (cc) => (cc.scene.people || []).find((q) => q.id === id);
    const upd = (patch, o) => updatePerson(store, id, patch, o);
    const linkSelect = (which) => selectField({
      key: `ppl-${which}`, label: which === 'iem' ? 'In-ear link' : 'Mic link',
      options: (cc) => linkChoices(cc.scene, P(cc) || p0, which).map((x) => [x.value, x.label]),
      get: (cc) => (P(cc) || {})[which === 'iem' ? 'iemLinkId' : 'micLinkId'] || '',
      set: async (cc, v) => {
        const ch = linkChoices(cc.scene, P(cc) || p0, which).find((x) => x.value === v);
        const act = which === 'iem' ? assignIem : assignMic;
        if (ch && ch.swap) {
          const ok = await confirmDialog({ title: 'Swap links?', message: `${ch.label.replace(/ \(.*$/, '')} is carried by someone else. Swap links with them?`, confirmText: 'Swap', opener: document.activeElement });
          if (!ok) { sync(); return; }
          act(store, id, v, { swap: true });
        } else act(store, id, v || null);
        announce(`${p0.name} ${which === 'iem' ? 'in-ear' : 'mic'} link updated`, { key: 'ppl', delay: 200 });
      },
    });
    const form = el('div', 'refl-form');
    form.append(
      textField({ key: 'ppl-name', label: 'Name', maxLength: PEOPLE_LIMITS.nameChars, get: (cc) => P(cc)?.name, fallback: () => `Person ${idx + 1}`, set: (cc, v, o) => upd({ name: v }, o) }),
      selectField({ key: 'ppl-role', label: 'Role', options: PERSON_ROLES.map((r) => [r, r.charAt(0).toUpperCase() + r.slice(1)]), get: (cc) => P(cc)?.role || 'singer', set: (cc, v) => upd({ role: v }) }),
      selectField({ key: 'ppl-colour', label: 'Colour tag', options: PERSON_COLOURS.map((r) => [r, r.charAt(0).toUpperCase() + r.slice(1)]), get: (cc) => P(cc)?.colour || 'red', set: (cc, v) => upd({ colour: v }) }),
      numberField({ key: 'ppl-facing', label: 'Facing (0 = upstage, 90 = right)', min: -360, max: 360, step: 5, unit: '°', decimals: 0, get: (cc) => P(cc)?.facingDeg ?? 0, set: (cc, v, o) => upd({ facingDeg: v }, o) }),
      linkSelect('mic'), linkSelect('iem'),
      selectField({ key: 'ppl-contact', label: 'Body contact (both packs)', options: Object.entries(ANTENNA_CONTACT_LABELS), get: (cc) => P(cc)?.contact ?? 'free', set: (cc, v) => upd({ contact: v }) }),
      selectField({ key: 'ppl-damp', label: 'Dampness (both packs)', options: Object.entries(ANTENNA_DAMPNESS_LABELS), get: (cc) => P(cc)?.dampness ?? 'dry', set: (cc, v) => upd({ dampness: v }) }),
    );
    // backup mic packs: a list with Remove buttons and an "Add" select (same swap confirm as the main links)
    const extraBox = el('div', 'ppl-extra'); extraBox.setAttribute('role', 'group'); extraBox.setAttribute('aria-label', 'Backup mic packs');
    extraBox.append(el('p', 'hint', `Backup mic packs (up to ${PEOPLE_LIMITS.maxExtra}): further mic links this person carries. They move with the person and drag to set their own offset.`));
    const exList = el('ul', 'ppl-extra-list');
    for (const lid of p0.extraLinkIds || []) {
      const l = c.scene.links.find((q) => q.id === lid); if (!l) continue;
      const li = el('li', null, null); const nm = el('span', 'ppl-extra-name', l.name);
      const rm = button('Remove', `ppl-extra-rm-${lid}`, () => { removeExtraMic(store, id, lid); announce(`${l.name} is no longer a backup pack of ${p0.name}; the link stays`, { key: 'ppl', delay: 100 }); }, { label: `Remove ${l.name} from this person (the link stays in the scene)` });
      li.append(nm, rm); exList.append(li);
    }
    if (!exList.children.length) exList.append(el('li', 'hint', 'No backup packs.'));
    const addSel = selectField({
      key: 'ppl-extra-add', label: 'Add a backup mic pack',
      options: (cc) => [['', (P(cc)?.extraLinkIds || []).length >= PEOPLE_LIMITS.maxExtra ? 'Limit reached' : 'Choose a mic link...'], ...extraChoices(cc.scene, P(cc) || p0).map((x) => [x.value, x.label])],
      get: () => '',
      set: async (cc, v) => {
        if (!v) return;
        const ch = extraChoices(cc.scene, P(cc) || p0).find((x) => x.value === v);
        let swap = false;
        if (ch && ch.swap) {
          const ok = await confirmDialog({ title: 'Swap links?', message: `${ch.label.replace(/ \(.*$/, '')} is carried by someone else. Swap links with them?`, confirmText: 'Swap', opener: document.activeElement });
          if (!ok) { sync(); return; }
          swap = true;
        }
        const done = assignExtraMic(store, id, v, { swap });
        announce(done ? `${p0.name} now carries a backup mic pack` : 'Could not add the backup pack (limit reached or not allowed)', { key: 'ppl', delay: 200 });
        sync();
      },
    });
    extraBox.append(exList, addSel);
    const marg = el('ul', 'ppl-margins'); marg.setAttribute('aria-label', 'Margins of the links this person carries');
    updaters.push((cc) => {
      const rows = personMargins(cc.scene, P(cc) || p0, (l) => solveCached(cc.scene, l));
      const sig = rows.map((r) => r.text + r.name).join('|');
      if (marg.dataset.sig === sig) return; marg.dataset.sig = sig;
      marg.replaceChildren(...(rows.length ? rows : [{ text: 'No links assigned yet.', name: '' }]).map((r) => { const li = el('li', null, r.name ? `${r.name}: ${r.text}` : r.text); return li; }));
    });
    const bar = el('div', 'ppl-bar');
    const up = button('Move up', 'ppl-up', () => { reorderPerson(store, id, Math.max(0, idx - 1)); announce('Person moved up the list', { key: 'ppl', delay: 100 }); }, { label: 'Move this person up the list' });
    const dn = button('Move down', 'ppl-down', () => { reorderPerson(store, id, Math.min(people.length - 1, idx + 1)); announce('Person moved down the list', { key: 'ppl', delay: 100 }); }, { label: 'Move this person down the list' });
    up.disabled = idx <= 0; dn.disabled = idx >= people.length - 1;
    const del = button('Delete person', 'ppl-del', () => { removePerson(store, id); store.select(null); announce('Person deleted; their links stay', { key: 'ppl', delay: 100 }); }, { label: 'Delete this person (the links stay in the scene)', cls: 'danger' });
    bar.append(up, dn, del);
    body.append(form, extraBox, marg, bar);
  }

  function buildAudience(body, c) {
    const areas = c.scene.audience || [];
    const list = el('ul', 'refl-list');
    areas.forEach((a) => {
      const li = el('li');
      const b = button(a.name || 'Audience', `aud:${a.id}`, () => store.select(a.id));
      b.setAttribute('aria-pressed', String(c.sel === a.id));
      li.append(b); list.append(li);
    });
    if (!areas.length) body.append(el('p', 'hint', 'No audience areas. Add one, or drag the chip below onto the plan.'));
    body.append(list);
    const addB = button('Add audience area', 'aud-add', (e) => { addOrLimit(store, e && e.currentTarget, 'audience area', () => { const id = addAudience(store); if (id) store.select(id); return id; }); });
    const chip = el('span', 'drag-chip', 'Drag onto the plan');
    chip.draggable = true; chip.title = 'Drag onto the plan to place an audience area';
    chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-rfbench-audience', 'standing'); e.dataTransfer.setData('text/plain', 'audience area'); e.dataTransfer.effectAllowed = 'copy'; });
    body.append(addB, chip);
    const a0 = c.found?.type === 'audience' ? c.found.item : null;
    if (!a0) return;
    const id = a0.id;
    const Aa = (cc) => (cc.scene.audience || []).find((q) => q.id === id);
    const len = (key, label, field, min, max, axis = null) => numberField({
      key: `aud-${key}`, label, decimals: 2, min: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(dispAxis(cc.scene, axis, Aa(cc)?.[field] ?? 0), cc.lu), set: (cc, v, o) => updateAudience(store, id, { [field]: internalAxis(cc.scene, axis, lengthFromUi(v, cc.lu)) }, o),
    });
    const form = el('div', 'refl-form');
    const flagU = (row) => { const sp = el('span', 'flag flag-U', 'U'); sp.title = FLAG_TEXT.U; sp.setAttribute('role', 'img'); sp.setAttribute('aria-label', FLAG_TEXT.U); row.querySelector('.inp').append(sp); return row; };
    form.append(
      textField({ key: 'aud-name', label: 'Name', get: (cc) => Aa(cc)?.name, set: (cc, v, o) => updateAudience(store, id, { name: v }, o) }),
      selectField({ key: 'aud-kind', label: 'Posture', options: [['standing', 'Standing (head 1.7 m)'], ['seated', 'Seated (head 1.2 m)']], get: (cc) => Aa(cc)?.kind, set: (cc, v) => updateAudience(store, id, { kind: v }) }),
      flagU(selectField({
        key: 'aud-dens-preset', label: 'Density',
        options: [...AUDIENCE_DENSITY_PRESETS.filter((p) => p.id !== 'seated').map((p) => [p.id, `${p.label}, ${p.densityPerM2}/m2`]), ['custom', 'Custom']],
        get: (cc) => densityChoiceId(AUDIENCE_DENSITY_PRESETS, Aa(cc)?.densityPerM2 ?? 2),
        set: (cc, v) => { const p = AUDIENCE_DENSITY_PRESETS.find((q) => q.id === v); if (p) updateAudience(store, id, { densityPerM2: p.densityPerM2 }); },
      })),
      numberField({
        key: 'aud-dens', label: 'Persons per square metre', decimals: 2, min: AUDIENCE_DENSITY_LIMITS[0], max: AUDIENCE_DENSITY_LIMITS[1], step: 0.1, unit: `per m2 (${AUDIENCE_DENSITY_LIMITS[0]} to ${AUDIENCE_DENSITY_LIMITS[1]})`,
        get: (cc) => Aa(cc)?.densityPerM2, set: (cc, v, o) => updateAudience(store, id, { densityPerM2: v }, o),
      }),
      len('x', 'Left edge x (0 = centre line)', 'x', -500, 1000, 'x'), len('y', 'Back edge y (0 = front edge)', 'y', -500, 1000, 'y'),
      len('w', 'Width', 'width', 0.1, 500), len('d', 'Depth', 'depth', 0.1, 500),
    );
    const slider = el('input'); slider.type = 'range'; slider.min = AUDIENCE_DENSITY_LIMITS[0]; slider.max = AUDIENCE_DENSITY_LIMITS[1]; slider.step = 0.1;
    slider.setAttribute('aria-label', 'Audience density, persons per square metre'); slider.dataset.fkey = 'aud-slider';
    slider.addEventListener('input', () => updateAudience(store, id, { densityPerM2: Number(slider.value) }, { coalesce: `aud-dens-${id}` }));
    updaters.push((cc) => { const a = Aa(cc); if (a && document.activeElement !== slider) slider.value = a.densityPerM2; });
    const srow = el('div', 'f'); const sl = el('label', null, 'Density slider'); sl.htmlFor = (slider.id = `insp-aud-sl`); srow.append(sl, slider);
    const info = el('p', 'hint');
    updaters.push((cc) => { const a = Aa(cc); if (a) info.textContent = `About ${Math.round(a.width * a.depth * a.densityPerM2)} people. Loss ${(AUDIENCE_DB_PER_M_PER_PERSON * a.densityPerM2).toFixed(2)} dB per metre of path inside the crowd (assumed, unverified).`; });
    form.append(srow, info, button('Remove audience area', 'aud-remove', () => { removeAudience(store, id); store.select(null); }, { cls: 'danger' }));
    body.append(form);
  }

  // ---- crowd zones (polygon absorption) ------------------------------------------------------------
  function buildCrowd(body, c) {
    const zones = c.scene.crowds || [];
    const list = el('ul', 'refl-list');
    zones.forEach((q) => {
      const li = el('li');
      const b = button(q.name || 'Crowd', `crowd:${q.id}`, () => store.select(q.id));
      b.setAttribute('aria-pressed', String(c.sel === q.id));
      li.append(b); list.append(li);
    });
    if (!zones.length) body.append(el('p', 'hint', 'No crowd zones. Add one to model audience absorption.'));
    body.append(list, button('Add crowd zone', 'crowd-add', (e) => { addOrLimit(store, e && e.currentTarget, 'crowd zone', () => addCrowd(store, newCrowdPartial(store.getScene()))); }, { label: 'Add a crowd zone in front of the stage' }));
    const q0 = c.found?.type === 'crowd' ? c.found.item : null;
    if (!q0) return;
    const id = q0.id;
    const Q = (cc) => (cc.scene.crowds || []).find((q) => q.id === id) || q0;
    const upd = (patch, o) => updateCrowd(store, id, patch, o);
    const assumedFlag = (row) => { const sp = el('span', 'flag flag-A', 'assumed'); sp.title = 'Assumed: an engineering estimate, not a measurement'; row.querySelector('.inp').append(sp); return row; };
    const lenAxis = (key, label, axis, i) => numberField({
      key, label, decimals: 2, min: (cc) => lengthToUi(dispRange(cc.scene, axis, -500, 1000)[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, axis, -500, 1000)[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(dispAxis(cc.scene, axis, (Q(cc).polygon[i] || {})[axis] ?? 0), cc.lu),
      set: (cc, v, o) => { const pt = { ...Q(cc).polygon[i] }; pt[axis] = internalAxis(cc.scene, axis, lengthFromUi(v, cc.lu)); upd({ polygon: polygonSetPoint(Q(cc).polygon, i, pt) }, o); },
    });
    const form = el('div', 'refl-form crowd-form');
    const def = (cc) => CROWD_DEFAULTS[crowdParams(Q(cc)).mode];
    form.append(
      textField({ key: 'crowd-name', label: 'Name', maxLength: CROWD_LIMITS.nameChars, get: (cc) => Q(cc).name, fallback: () => 'Crowd', set: (cc, v, o) => upd({ name: v }, o) }),
      assumedFlag(selectField({ key: 'crowd-mode', label: 'Mode', options: CROWD_MODES.map((m) => [m, `${CROWD_MODE_LABELS[m]} (head ${CROWD_DEFAULTS[m].headHeightM} m, cap ${CROWD_DEFAULTS[m].lMaxDb} dB)`]), get: (cc) => crowdParams(Q(cc)).mode, set: (cc, v) => upd({ mode: v }) })),
      assumedFlag(numberField({
        key: 'crowd-dens', label: 'Density', decimals: 2, min: CROWD_LIMITS.densityPerM2[0], max: CROWD_LIMITS.densityPerM2[1], step: 0.1, unit: 'persons per m2',
        get: (cc) => crowdParams(Q(cc)).densityPerM2, set: (cc, v, o) => upd({ densityPerM2: v, kDbPerM: null }, o), // density drives the slope (0.9 dB per metre per person per m2) until the slope is set by hand
      })),
      assumedFlag(numberField({
        key: 'crowd-head', label: 'Head height', decimals: 2, min: (cc) => lengthToUi(CROWD_LIMITS.headHeightM[0], cc.lu), max: (cc) => lengthToUi(CROWD_LIMITS.headHeightM[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.25 : 0.05), unit: (cc) => cc.lu,
        get: (cc) => lengthToUi(crowdParams(Q(cc)).headHeightM, cc.lu), set: (cc, v, o) => upd({ headHeightM: lengthFromUi(v, cc.lu) }, o),
      })),
      assumedFlag(numberField({
        key: 'crowd-k', label: 'Loss slope', decimals: 2, min: CROWD_LIMITS.kDbPerM[0], max: CROWD_LIMITS.kDbPerM[1], step: 0.1, unit: 'dB per metre inside',
        get: (cc) => crowdParams(Q(cc)).kDbPerM, set: (cc, v, o) => upd({ kDbPerM: v }, o),
      })),
      assumedFlag(numberField({
        key: 'crowd-lmax', label: 'Loss cap', decimals: 1, min: CROWD_LIMITS.lMaxDb[0], max: CROWD_LIMITS.lMaxDb[1], step: 0.5, unit: 'dB (at most 26)',
        get: (cc) => crowdParams(Q(cc)).lMaxDb, set: (cc, v, o) => upd({ lMaxDb: v }, o),
      })),
    );
    const eff = el('p', 'hint');
    updaters.push((cc) => { const t = `${crowdParamText(Q(cc))} Mode default: slope ${def(cc).kDbPerM} dB per metre, cap ${def(cc).lMaxDb} dB.`; if (eff.textContent !== t) eff.textContent = t; });
    form.append(eff, button('Reset to mode defaults', 'crowd-reset', () => { upd({ densityPerM2: null, headHeightM: null, kDbPerM: null, lMaxDb: null }); announce('Crowd values reset to the mode defaults', { key: 'crowd', delay: 100 }); }, { label: 'Clear the density, head height, slope and cap overrides of this crowd zone' }));
    const pts = el('fieldset', 'crowd-pts');
    pts.append(el('legend', null, 'Corners (stage coordinates)'));
    q0.polygon.forEach((_, i) => {
      const row = el('div', 'crowd-pt');
      row.append(lenAxis(`crowd-x${i}`, `Corner ${i + 1} x`, 'x', i), lenAxis(`crowd-y${i}`, `Corner ${i + 1} y`, 'y', i));
      row.append(button('Add corner after', `crowd-add-pt${i}`, () => { const p = polygonAddAfter(Q(getCtx()).polygon, i); if (p) { upd({ polygon: p }); announce(`Corner added after corner ${i + 1}`, { key: 'crowd', delay: 100 }); } }, { label: `Add a corner after corner ${i + 1}` }));
      row.append(button('Remove', `crowd-del-pt${i}`, () => { const p = polygonRemoveAt(Q(getCtx()).polygon, i); if (p) { upd({ polygon: p }); announce(`Corner ${i + 1} removed`, { key: 'crowd', delay: 100 }); } }, { label: `Remove corner ${i + 1} (a zone needs at least three)` }));
      pts.append(row);
    });
    form.append(pts);
    const cav = el('p', 'hint crowd-caveat'); cav.textContent = CROWD_CAVEAT; cav.setAttribute('role', 'note');
    const conf = el('ul', 'crowd-conf'); conf.setAttribute('aria-label', 'Confidence of the crowd model: S sourced, I inferred, A assumed');
    for (const t of confidenceLines()) conf.append(el('li', null, t));
    const info = el('p', 'hint');
    updaters.push((cc) => { const r = cc.result && cc.result.crowd, m = r && r.crowds.find((x) => x.id === id); const t = m ? `On the active link: ${m.lengthM.toFixed(1)} m of path inside, ${m.lossDb.toFixed(1)} dB${m.capped ? ' (at the cap)' : ''}${m.clearance < 1 ? `, antenna height factor ${m.clearance.toFixed(2)}` : ''} (assumed).` : 'The active link does not pass through this zone.'; if (info.textContent !== t) info.textContent = t; });
    form.append(info, cav, conf, button('Delete crowd zone', 'crowd-remove', () => { removeCrowd(store, id); store.select(null); announce('Crowd zone deleted', { key: 'crowd', delay: 100 }); }, { label: 'Delete this crowd zone', cls: 'danger' }));
    body.append(form);
  }

  // ---- ceiling and overhead panels --------------------------------------------------------------
  function buildOverhead(body, c) {
    const matOpts = Object.entries(CEILING_MATERIALS).map(([id, m]) => [id, m.name]);
    const C = (cc) => cc.scene.ceiling;
    const hRange = CEILING_LIMITS.heightM;
    body.append(
      selectField({
        key: 'ceil-on', label: 'Ceiling', options: [['off', 'None'], ['on', 'Reflecting ceiling']],
        get: (cc) => (C(cc) && C(cc).enabled !== false ? 'on' : 'off'),
        set: (cc, v) => (v === 'on' ? setCeiling(store, { enabled: true }) : setCeiling(store, C(cc) ? { enabled: false } : null)),
      }),
      numberField({
        key: 'ceil-h', label: 'Ceiling height', decimals: 2, min: (cc) => lengthToUi(hRange[0], cc.lu), max: (cc) => lengthToUi(hRange[1], cc.lu), step: 0.1, unit: (cc) => cc.lu,
        visible: (cc) => !!C(cc), get: (cc) => lengthToUi(C(cc)?.heightM ?? 5, cc.lu), set: (cc, v, o) => setCeiling(store, { heightM: lengthFromUi(v, cc.lu) }, o),
      }),
      selectField({ key: 'ceil-mat', label: 'Ceiling material', options: matOpts, visible: (cc) => !!C(cc), get: (cc) => C(cc)?.material, set: (cc, v) => setCeiling(store, { material: v }) }),
      numberField({
        key: 'ceil-loss', label: 'Extra ceiling loss', min: 0, max: CEILING_LIMITS.lossDb[1], step: 0.5, unit: 'dB', decimals: 1,
        visible: (cc) => !!C(cc), get: (cc) => C(cc)?.lossDb ?? 0, set: (cc, v, o) => setCeiling(store, { lossDb: v }, o),
      }),
    );
    const panels = c.scene.overheadPanels || [];
    const list = el('ul', 'refl-list');
    panels.forEach((p) => {
      const li = el('li');
      const b = button(p.name || 'Overhead panel', `ovh:${p.id}`, () => store.select(p.id));
      b.setAttribute('aria-pressed', String(c.sel === p.id));
      li.append(b); list.append(li);
    });
    if (!panels.length) body.append(el('p', 'hint', 'No overhead panels. Add one to put a flown reflector above the stage.'));
    body.append(list, button('Add overhead panel', 'ovh-add', (e) => { addOrLimit(store, e && e.currentTarget, 'overhead panel', () => { const id = addOverheadPanel(store); if (id) store.select(id); return id; }); }));
    const p0 = c.found?.type === 'panel' ? c.found.item : null;
    if (!p0) return;
    const id = p0.id;
    const P = (cc) => (cc.scene.overheadPanels || []).find((q) => q.id === id);
    const len = (key, label, field, min, max, axis = null) => numberField({
      key: `ovh-${key}`, label, decimals: 2, min: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[0], cc.lu), max: (cc) => lengthToUi(dispRange(cc.scene, axis, min, max)[1], cc.lu), step: (cc) => (cc.lu === 'ft' ? 0.5 : 0.1), unit: (cc) => cc.lu,
      get: (cc) => lengthToUi(dispAxis(cc.scene, axis, P(cc)?.[field] ?? 0), cc.lu), set: (cc, v, o) => updateOverheadPanel(store, id, { [field]: internalAxis(cc.scene, axis, lengthFromUi(v, cc.lu)) }, o),
    });
    const form = el('div', 'refl-form');
    form.append(
      textField({ key: 'ovh-name', label: 'Name', get: (cc) => P(cc)?.name, set: (cc, v, o) => updateOverheadPanel(store, id, { name: v }, o) }),
      selectField({ key: 'ovh-mat', label: 'Material', options: matOpts, get: (cc) => P(cc)?.material, set: (cc, v) => updateOverheadPanel(store, id, { material: v }) }),
      len('x', 'Left edge x (0 = centre line)', 'x', -500, 1000, 'x'), len('y', 'Back edge y (0 = front edge)', 'y', -500, 1000, 'y'),
      len('w', 'Width', 'width', 0.1, 500), len('d', 'Depth', 'depth', 0.1, 500),
      numberField({
        key: 'ovh-h', label: 'Height above the ground', decimals: 2, min: (cc) => lengthToUi(hRange[0], cc.lu), max: (cc) => lengthToUi(hRange[1], cc.lu), step: 0.1, unit: (cc) => cc.lu,
        get: (cc) => lengthToUi(P(cc)?.heightM ?? 5, cc.lu), set: (cc, v, o) => updateOverheadPanel(store, id, { heightM: lengthFromUi(v, cc.lu) }, o),
      }),
      numberField({ key: 'ovh-loss', label: 'Extra loss', min: 0, max: CEILING_LIMITS.lossDb[1], step: 0.5, unit: 'dB', decimals: 1, get: (cc) => P(cc)?.lossDb ?? 0, set: (cc, v, o) => updateOverheadPanel(store, id, { lossDb: v }, o) }),
    );
    form.append(button('Remove overhead panel', 'ovh-remove', () => { removeOverheadPanel(store, id); store.select(null); }, { cls: 'danger' }));
    body.append(form);
  }

  // ---- point-to-point block ---------------------------------------------------------------------
  function buildP2p(body) {
    const Q = (cc) => cc.link.p2p || {};
    body.append(
      numberField({ key: 'p2p-k', label: 'Earth radius factor K', min: 0.5, max: 10, step: 0.05, unit: '(4/3 standard)', decimals: 2, get: (cc) => Q(cc).kFactor ?? 4 / 3, set: (cc, v, o) => setP2pField(store, cc.link.id, 'kFactor', v, o) }),
      numberField({ key: 'p2p-fade', label: 'Fade margin', min: 0, max: 60, step: 1, unit: 'dB', decimals: 1, get: (cc) => Q(cc).fadeMarginDb ?? 0, set: (cc, v, o) => setP2pField(store, cc.link.id, 'fadeMarginDb', v, o) }),
      numberField({ key: 'p2p-od', label: 'Obstacle distance from Tx', min: 1, max: 40000, step: 10, unit: 'm (blank = none)', decimals: 0, get: (cc) => Q(cc).obstacle?.distanceM, set: (cc, v, o) => setP2pField(store, cc.link.id, 'obstacleDistanceM', v, o) }),
      numberField({ key: 'p2p-oh', label: 'Obstacle height', min: -100, max: 5000, step: 1, unit: 'm above the datum', decimals: 1, visible: (cc) => !!Q(cc).obstacle, get: (cc) => Q(cc).obstacle?.heightM, set: (cc, v, o) => setP2pField(store, cc.link.id, 'obstacleHeightM', v, o) }),
      selectField({ key: 'p2p-gr', label: 'Ground reflection', options: [['off', 'Off (direct only)'], ['on', 'On (short paths only)']], get: (cc) => (Q(cc).groundReflection === true ? 'on' : 'off'), set: (cc, v) => setP2pField(store, cc.link.id, 'groundReflection', v === 'on') }),
      button('Remove obstacle', 'p2p-od-clear', () => { const cc = getCtx(); setP2pField(store, cc.link.id, 'obstacleDistanceM', null); }),
    );
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
  /** Notes, figures with text "assumed"/"sourced" badges and the tuning hint for an FM preset. get(cc) gives the preset id. */
  function fmBlock(getId, getLink, getFreq) {
    const box = el('div', 'fm-block');
    let sig = '';
    updaters.push((cc) => {
      const id = getId(cc);
      box.hidden = !id;
      if (!id) { sig = ''; return; }
      const link = getLink(cc);
      const freq = getFreq ? getFreq(cc) : null;
      const rx = isFmRxPreset(id);
      const figs = rx ? rxFigures(id) : txFigures(id, link);
      const tune = rx || freq === null ? null : tuningHint(id, freq);
      const s = JSON.stringify([id, figs, tune]);
      if (s === sig) return;
      sig = s;
      box.textContent = '';
      const ul = el('ul', 'fm-figs');
      for (const f of figs) {
        const li = el('li', null, `${f.label}: ${f.value} `);
        li.append(el('span', f.assumed ? 'fm-badge fm-assumed' : 'fm-badge fm-sourced', f.word));
        ul.append(li);
      }
      box.append(ul);
      if (tune) box.append(el('p', tune.warn ? 'hint fm-warn' : 'hint', (tune.warn ? 'Tuning: ' : '') + tune.text));
      for (const t of presetNotes(id)) box.append(el('p', 'hint', t));
    });
    return box;
  }

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
      const fl = (row, field) => {
        const f = presetFlag(item, field);
        if (f) {
          const sp = el('span', `flag flag-${f}`, f);
          sp.title = FLAG_TEXT[f]; sp.setAttribute('role', 'img'); sp.setAttribute('aria-label', FLAG_TEXT[f]);
          row.querySelector('.inp').append(sp);
        }
        return row;
      };
      // optional figure: blank when the item does not carry it
      const nf = (field, label, min, max, step, unit, extra = {}) => fl(numLink(k(field), label, `${p}.${field}`, min, max, step, unit, { decimals: 1, get: (c2) => here(c2)?.[field], ...extra }), field);
      const sel = (field, label, options, dflt) => fl(selectField({
        key: k(field), label, options, get: (c2) => here(c2)?.[field] ?? dflt,
        set: (c2, v) => setNested(c2, `${p}.${field}`, v),
      }), field);
      const dcOk = () => fl(selectField({
        key: k('noDc'), label: 'DC on the ports', options: [['rated', 'Rated for DC'], ['noDc', 'Not rated for DC (warns if bias is present)']],
        get: (c2) => (here(c2)?.noDc ? 'noDc' : 'rated'),
        set: (c2, v) => store.update((d) => { const l = d.links.find((x) => x.id === c2.link.id); const it = l ? chainOf(l)[i] : null; if (!it) return; if (v === 'noDc') it.noDc = true; else delete it.noDc; }),
      }), 'dcMode');
      if (item.presetId && CHAIN_PRESETS[item.presetId]) {
        const pr = CHAIN_PRESETS[item.presetId];
        li.append(el('p', 'hint ci-preset', `Preset: ${pr.label}. ${pr.note || ''} S = stated in a source, I = inferred, U = unverified; check the datasheet.`));
      }
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
            fl(numLink(k('gain'), 'Gain', `${p}.gainDb`, 0, 60, 0.5, 'dB', { decimals: 1 }), 'gainDb'),
            fl(numLink(k('nf'), 'Noise figure', `${p}.nfDb`, 0, 20, 0.5, 'dB (not in power budget)', { decimals: 1, get: (c2) => here(c2)?.nfDb ?? 0 }), 'nfDb'),
            nf('iip3Dbm', 'Input IP3', -30, 60, 0.5, 'dBm (blank = not set)'),
            nf('op1dBDbm', 'Output P1dB', -20, 60, 0.5, 'dBm (blank = IP3 - 9.6 dB, or 20 dBm IP3 assumed)'),
            nf('maxInputDbm', 'Max input', -30, 60, 0.5, 'dBm (blank = not set)'),
            nf('dcNeedV', 'DC needed over the coax', 0, 48, 0.5, 'V (0 = own supply)'),
            nf('dcNeedMa', 'DC current needed', 0, 2000, 5, 'mA'),
          );
          break;
        case 'activesplitter':
        case 'activecombiner':
          add(
            fl(numLink(k('ports'), 'Ports', `${p}.ports`, 2, 16, 1, '', { decimals: 0 }), 'ports'),
            fl(numLink(k('gain'), 'Gain', `${p}.gainDb`, -30, 40, 0.5, 'dB', { decimals: 1, get: (c2) => here(c2)?.gainDb ?? 0 }), 'gainDb'),
            fl(numLink(k('nf'), 'Noise figure', `${p}.nfDb`, 0, 30, 0.5, 'dB', { decimals: 1, get: (c2) => here(c2)?.nfDb ?? 0 }), 'nfDb'),
            nf('iip3Dbm', 'Input IP3', -30, 60, 0.5, 'dBm (blank = not set)'),
            nf('op1dBDbm', 'Output P1dB', -20, 60, 0.5, 'dBm (blank = IP3 - 9.6 dB, or 20 dBm IP3 assumed)'),
            nf('isolationDb', 'Port isolation', 0, 80, 1, 'dB'),
            nf('maxInputDbm', 'Max input', -30, 60, 0.5, 'dBm (blank = not set)'),
            nf('dcNeedV', 'DC needed over the coax', 0, 48, 0.5, 'V (0 = own supply)'),
            nf('dcNeedMa', 'DC current needed', 0, 2000, 5, 'mA'),
          );
          break;
        case 'rof': {
          const eff = el('p', 'hint ci-rof');
          add(
            fl(numLink(k('gain'), 'Gain at 0 km fibre', `${p}.gainDb`, -60, 40, 0.5, 'dB', { decimals: 1, get: (c2) => here(c2)?.gainDb ?? 0 }), 'gainDb'),
            fl(numLink(k('nf'), 'Noise figure', `${p}.nfDb`, 0, 60, 0.5, 'dB', { decimals: 1, get: (c2) => here(c2)?.nfDb ?? 0 }), 'nfDb'),
            nf('iip3Dbm', 'Input IP3', -30, 60, 0.5, 'dBm (blank = from SFDR)'),
            nf('op1dBDbm', 'Output P1dB', -20, 60, 0.5, 'dBm (blank = IP3 - 9.6 dB)'),
            nf('sfdrDbHz23', 'SFDR', 60, 140, 1, 'dB Hz^(2/3)'),
            fl(numLink(k('km'), 'Fibre length', `${p}.fibreKm`, 0, 100, 0.01, 'km', { decimals: 2, get: (c2) => here(c2)?.fibreKm ?? 0 }), 'fibreKm'),
            nf('fibreLossDbPerKm', 'Fibre loss', 0, 5, 0.05, 'dB per km', { decimals: 2 }),
            nf('connectorLossDb', 'Connector loss', 0, 10, 0.1, 'dB'),
            nf('bwMinMHz', 'Band low', 0, 6000, 10, 'MHz'),
            nf('bwMaxMHz', 'Band high', 0, 6000, 10, 'MHz'),
            nf('powerV', 'Own supply', 0, 48, 0.5, 'V (information)'),
            nf('powerMa', 'Own supply current', 0, 2000, 5, 'mA (information)'),
            eff,
          );
          updaters.push((c2) => {
            const it = here(c2); if (!it) return;
            try { const e = rofEffective(it); eff.textContent = `Effective at this fibre length: gain ${e.gainDb.toFixed(1)} dB, NF ${e.nfDb.toFixed(1)} dB, optical loss ${e.opticalLossDb.toFixed(2)} dB each way, input IP3 ${e.iip3Dbm.toFixed(1)} dBm, delay ${e.delayUs.toFixed(2)} us (${e.electricalLengthM.toFixed(0)} m of coax-equivalent).`; } catch { eff.textContent = ''; }
          });
          break;
        }
        case 'coupler':
          add(
            nf('couplingDb', 'Coupling (tap)', 1, 60, 0.5, 'dB'),
            nf('excessLossDb', 'Excess loss', 0, 10, 0.05, 'dB (plus the tap loss)', { decimals: 2 }),
            nf('isolationDb', 'Isolation / directivity', 0, 80, 1, 'dB'),
            nf('maxInputDbm', 'Max input', -30, 60, 0.5, 'dBm (blank = not set)'),
          );
          break;
        case 'biastee':
          add(
            fl(numLink(k('loss'), 'Insertion loss', `${p}.lossDb`, 0, 20, 0.1, 'dB', { decimals: 2 }), 'lossDb'),
            nf('dcSupplyV', 'DC injected', 0, 48, 0.5, 'V'),
            nf('dcSupplyMa', 'DC current available', 0, 2000, 5, 'mA (blank = not limited)'),
            nf('maxInputDbm', 'Max RF input', -30, 60, 0.5, 'dBm (blank = not set)'),
          );
          break;
        case 'dcblock':
          add(
            fl(numLink(k('loss'), 'Insertion loss', `${p}.lossDb`, 0, 20, 0.1, 'dB', { decimals: 2 }), 'lossDb'),
            sel('dcMode', 'DC behaviour', DC_MODES.map((m) => [m, DC_MODE_LABELS[m]]), 'block'),
            nf('maxInputDbm', 'Max RF input', -30, 60, 0.5, 'dBm (blank = not set)'),
          );
          break;
        case 'splitter':
        case 'combiner':
          add(
            fl(numLink(k('ports'), 'Ports', `${p}.ports`, 2, 16, 1, '', { decimals: 0 }), 'ports'),
            fl(numLink(k('il'), 'Insertion loss', `${p}.insertionLossDb`, 0, 20, 0.5, 'dB (plus split loss)', { decimals: 1 }), 'insertionLossDb'),
            nf('isolationDb', 'Port isolation', 0, 80, 1, 'dB'),
            dcOk(),
          );
          break;
        default:
          add(fl(numLink(k('loss'), 'Loss', `${p}.lossDb`, 0, 60, 0.1, 'dB', { decimals: 2 }), 'lossDb'));
          if (item.kind === 'filter') add(
            sel('filterType', 'Filter type', FILTER_TYPES.map((m) => [m, FILTER_TYPE_LABELS[m]]), 'bandpass'),
            nf('rejectionDb', 'Rejection', 0, 120, 1, 'dB'),
          );
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
    const presetRow = el('div', 'chain-add');
    const presetSel = el('select');
    presetSel.setAttribute('aria-label', 'Add a chain item from a preset');
    presetSel.dataset.fkey = `chain-preset-${target}`;
    for (const [v, t] of presetOptions()) { const o = el('option', null, t); o.value = v; presetSel.append(o); }
    presetSel.addEventListener('change', () => {
      const id = presetSel.value; presetSel.value = '';
      const cc = getCtx();
      if (id && cc.link) addChainItem(store, cc.link.id, createChainItemFromPreset(id), undefined, tOpt);
    });
    presetRow.append(presetSel);
    body.append(presetRow);
    body.append(el('p', 'hint', 'Presets are generic device classes, not products. Each figure carries a flag: S stated in a source, I inferred, U unverified.'));
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

  /** Construction and wall-noise fields of one reflector (ledwall.js). Shown inside the linked video-wall noise source. */
  function buildWallFields(form, c, rid) {
    const R = (cc) => (cc.scene.reflectors || []).find((q) => q.id === rid);
    // video wall: construction and noise (ledwall.js); shown for every reflector, the noise rows follow the preset
    const wallFlag = (flag) => (flag ? ` [${flag}]` : '');
    form.append(
      selectField({
        key: 'refl-cons', label: 'Construction', options: [['none', 'Not specified (use the material above)'], ...Object.entries(WALL_CONSTRUCTIONS).map(([id, k]) => [id, k.label + wallFlag(k.flag)])],
        get: (cc) => R(cc)?.construction || 'none', set: (cc, v) => setWallField(store, rid, 'construction', v),
      }),
    );
    if (String(c.scene.reflectors.find((q) => q.id === rid).construction || '').startsWith('mesh')) form.append(numberField({
      key: 'refl-hole', label: 'Mesh hole size', min: 0.01, max: 2000, step: 1, unit: 'mm (shielding falls as holes approach half a wavelength)', decimals: 1,
      get: (cc) => R(cc)?.holeSizeMm ?? 10, set: (cc, v, o) => setWallField(store, rid, 'holeSizeMm', v, o),
    }));
    form.append(selectField({
      key: 'refl-noise', label: 'Wall noise', options: Object.entries(WALL_NOISE_PRESETS).map(([id, p]) => [id, p.label + wallFlag(p.flag)]),
      get: (cc) => R(cc)?.noise?.preset || 'off', set: (cc, v) => setWallField(store, rid, 'preset', v),
    }));
    const np = c.scene.reflectors.find((q) => q.id === rid).noise?.preset || 'off';
    if (np !== 'off') {
      const NL = WALL_NOISE_LIMITS;
      if (np === 'custom') form.append(
        numberField({ key: 'refl-nlevel', label: 'Noise level', min: NL.levelDbuvmAt10m[0], max: NL.levelDbuvmAt10m[1], step: 1, unit: 'dBuV/m at 10 m, 600 MHz', decimals: 1, get: (cc) => R(cc)?.noise?.levelDbuvmAt10m ?? 40, set: (cc, v, o) => setWallField(store, rid, 'levelDbuvmAt10m', v, o) }),
        numberField({ key: 'refl-ntilt', label: 'Noise tilt', min: NL.tiltDbPerDecade[0], max: NL.tiltDbPerDecade[1], step: 1, unit: 'dB per decade of frequency', decimals: 1, get: (cc) => R(cc)?.noise?.tiltDbPerDecade ?? 0, set: (cc, v, o) => setWallField(store, rid, 'tiltDbPerDecade', v, o) }),
      );
      form.append(
        numberField({ key: 'refl-nrear', label: 'Rear loss', min: NL.rearLossDb[0], max: NL.rearLossDb[1], step: 1, unit: 'dB behind the wall', decimals: 1, get: (cc) => R(cc)?.noise?.rearLossDb ?? 8, set: (cc, v, o) => setWallField(store, rid, 'rearLossDb', v, o) }),
        numberField({ key: 'refl-nheight', label: 'Noisy height', min: NL.heightM[0], max: NL.heightM[1], step: 0.1, unit: 'm above the bottom edge', decimals: 1, get: (cc) => R(cc)?.noise?.heightM ?? ((R(cc)?.zMax ?? 3) - (R(cc)?.zMin ?? 0)), set: (cc, v, o) => setWallField(store, rid, 'heightM', v, o) }),
        selectField({ key: 'refl-nface', label: 'Facing (front = left of start to end)', options: [['left', 'Left of start to end'], ['right', 'Right of start to end']], get: (cc) => R(cc)?.noise?.facing || 'left', set: (cc, v) => setWallField(store, rid, 'facing', v) }),
      );
      form.append(el('p', 'hint', 'Presets are EMC emission limits (flag I) or assumed (U). The noise shows on the plan and in the link budget when the receiver floor rises.'));
    }
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
    body.append(button('Add reflector', 'refl-add', (e) => {
      addOrLimit(store, e && e.currentTarget, 'reflector', () => addReflector(store));
    }));

    const wallMat = el('select', 'wall-mat'); wallMat.setAttribute('aria-label', 'Wall material');
    for (const [id, m] of Object.entries(MATERIALS)) { const o = el('option', null, m.name); o.value = id; wallMat.append(o); }
    wallMat.value = 'concrete';
    const wallsRow = el('div', 'refl-walls');
    wallsRow.append(wallMat, button('Add room walls', 'refl-walls-add', (e) => {
      const ids = addRoomWalls(store, { material: wallMat.value });
      if (!ids.length) addOrLimit(store, e && e.currentTarget, 'reflector', () => null);
      else store.select(ids[0]);
    }, { label: 'Add four walls (back, front, left, right) around the stage and audience as reflectors' }));
    body.append(wallsRow);

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
      textField({ key: 'refl-name', label: 'Name', maxLength: REFLECTOR_NAME_MAX, get: (cc) => R(cc)?.name, fallback: (cc) => `Reflector ${idx + 1}`, set: (cc, v, o) => setReflectorName(store, rid, v, o) }),
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
    // video wall noise lives in the Noise sources section; the wall data stays on the reflector
    const linked = (c.scene.noiseSources || []).find((n) => n.reflectorId === rid);
    form.append(el('p', 'hint', 'Construction and video wall noise are edited under Noise sources.'));
    form.append(button(linked ? 'Edit video wall noise' : 'Add video wall noise source', 'refl-wallnoise', () => { const nid = linked ? linked.id : addWallNoiseSource(store, rid); if (nid) store.select(nid); }, { label: 'Open the video wall noise source of this reflector' }));
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
      c.scene.reflectors.map((r) => `${r.id}:${r.id === c.sel || (c.found?.type === 'noise' && c.found.item.reflectorId === r.id) ? `${r.construction || ''}/${(r.noise && r.noise.preset) || ''}` : ''}`),
      (c.scene.noiseSources || []).map((n) => `${n.id}:${n.kind}:${n.reflectorId || ''}`),
      (c.scene.people || []).map((p) => `${p.id}:${p.micLinkId || ''}:${p.iemLinkId || ''}:${(p.extraLinkIds || []).join('+')}`), c.scene.links.map((l) => `${l.id}:${l.kind}`),
      (c.scene.platforms || []).map((p) => p.id),
      (c.scene.audience || []).map((a) => a.id), (c.scene.crowds || []).map((q) => `${q.id}:${q.id === c.sel ? q.polygon.length : ''}`), (c.scene.overheadPanels || []).map((o) => o.id), !!(c.scene.ceiling),
      c.scene.imd && c.scene.imd.enabled ? c.scene.imd.transmitters.map((t) => t.id) : null,
      c.scene.imd && c.scene.imd.enabled ? (c.scene.imd.bands || []).length : null,
    ]);
  }

  /** Keep the list buttons in step with renamed items without rebuilding the form (a rebuild per keystroke would break typing and undo). */
  function relabelLists(c) {
    const names = new Map();
    for (const r of c.scene.reflectors) names.set(`refl:${r.id}`, r.name || 'Reflector');
    for (const p of c.scene.platforms || []) names.set(`plat:${p.id}`, p.name || 'Platform');
    for (const a of c.scene.audience || []) names.set(`aud:${a.id}`, a.name || 'Audience');
    for (const n of c.scene.noiseSources || []) names.set(`ns:${n.id}`, n.name || 'Noise source');
    for (const p of c.scene.people || []) names.set(`ppl:${p.id}`, p.name || 'Person');
    for (const o of c.scene.overheadPanels || []) names.set(`ovh:${o.id}`, o.name || 'Overhead panel');
    for (const b of container.querySelectorAll('button[data-fkey]')) { const t = names.get(b.dataset.fkey); if (t !== undefined && b.textContent !== t) b.textContent = t; }
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
    relabelLists(c);
    for (const u of updaters) { try { u(c); } catch (err) { console.warn('inspector field update failed', err); } }
  }

  const unsubSq = squelch.subscribe(() => sync()); // sync rebuilds first if the chain/selection changed
  const unsub = store.subscribe(sync);
  sync();
  return { refresh: sync, destroy() { unsub(); unsubSq(); container.textContent = ''; } };
}
