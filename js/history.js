// Rolling per-link history of RF level, squelch state and virtual audio for the meters and timeline.
//   history.attach(store, tracker)   begin sampling: about 20 Hz while the scene is changing, 5 Hz when idle,
//                                    nothing while the page is hidden
//   history.get(linkId, seconds)     -> [{ t, rfDbm, rxPowerDbm, thresholdDbm, open, audioDb, audioRawDb,
//                                          audioPeakDb, audioRawPeakDb, cnrDb, blend, mode, pilotLocked,
//                                          audioL, audioR, audioRawL, audioRawR, reason,
//                                          aDbm, bDbm, cableLossADb, cableLossBDb, active, switched, overloadLevel, compressionDb, distortionPct,
//                                          batteryPercent (gauge reading, rounded), batteryTruePercent, batteryReportedPercent, batteryGaugeErrorPct, batteryVoltage, dataLocked, dataAgeMs, dataStale, txPowerSagDb,
//                                          digitalOrder, preFecBer, postFecBer, evmPercent, merDb, digitalState, throughputKbps, noiseRiseDb,
//                                          captured, cirDb, audioQuality, systemNfDb, noiseFloorDbm, sensitivityAtAntennaDbm, marginAtAntennaDb }]
//   (oldest first; bDbm is NaN without diversity; battery/data fields are NaN/false without telemetry)
//   audioL/audioR are the decoded channels (gated, after the stereo/mono blend); with MPX off they equal audioDb.
//   history.clear()                  drop all samples
//   history.subscribe(cb)            cb(linkId, sample) after every sample; returns unsubscribe
// t = seconds on a monotonic clock; time ago = history.now() - t. rfDbm is the receiver input level.
import { AUDIO_FLOOR_DB, createAudioSource, createStereoSource, gate, withGain } from './model/audio.js';
import { monoBlendAudio } from './model/mpx.js';

export const MAX_SECONDS = 120;
export const FAST_MS = 50;
export const IDLE_MS = 200;
const ACTIVE_WINDOW_S = 1;

const toLin = (db) => (db <= AUDIO_FLOOR_DB ? 0 : Math.pow(10, db / 20));
const toDb = (lin) => (lin <= 1e-9 ? AUDIO_FLOOR_DB : Math.max(AUDIO_FLOOR_DB, 20 * Math.log10(lin)));

export function createHistory({
  now = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000),
  maxSeconds = MAX_SECONDS,
} = {}) {
  const buffers = new Map(); // linkId -> sample[]
  const sources = new Map(); // linkId -> { key, src }
  const subs = new Set();
  const lastSwitch = new Map(); // linkId -> switchCount at the previous sample
  let timer = null;
  let stop = null;
  let lastChange = -Infinity;

  function entryFor(link) {
    const a = link.audio || {};
    const key = `${link.id}|${a.source || 'speech'}`;
    let e = sources.get(link.id);
    if (!e || e.key !== key) {
      let seed = 0;
      for (const ch of link.id) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
      const kind = a.source || 'speech';
      e = { key, src: createAudioSource({ kind, seed }), stereo: createStereoSource({ kind, seed }) };
      sources.set(link.id, e);
    }
    return e;
  }

  function record(link, state, t = now()) {
    let buf = buffers.get(link.id);
    if (!buf) { buf = []; buffers.set(link.id, buf); }
    const gainDb = (link.audio && Number.isFinite(link.audio.gainDb)) ? link.audio.gainDb : 0;
    const ent = entryFor(link);
    const m = state.mpx || null;
    const rx = state.rx || null;
    const tel = state.telemetry || null;
    let raw, rawL, rawR, rawPeakL, rawPeakR;
    const dig = state.digital || null;
    if (m || dig) {
      // two different virtual channels, decoded through the stereo/mono blend (done in linear amplitude)
      const l = withGain(ent.stereo.l(t), gainDb), r = withGain(ent.stereo.r(t), gainDb);
      const rms = monoBlendAudio({ l: toLin(l.rmsDb), r: toLin(r.rmsDb) }, m ? m.blend : 1);
      const pk = monoBlendAudio({ l: toLin(l.peakDb), r: toLin(r.peakDb) }, m ? m.blend : 1);
      rawL = toDb(rms.l); rawR = toDb(rms.r); rawPeakL = toDb(pk.l); rawPeakR = toDb(pk.r);
      raw = { rmsDb: toDb(Math.sqrt((rms.l * rms.l + rms.r * rms.r) / 2)), peakDb: Math.max(rawPeakL, rawPeakR) };
    } else {
      raw = withGain(ent.src.level(t), gainDb);
      rawL = rawR = raw.rmsDb; rawPeakL = rawPeakR = raw.peakDb;
    }
    const q = state.capture ? state.capture.audioQuality : 1;
    const qDb = q >= 1 ? 0 : q <= 0.001 ? -60 : 20 * Math.log10(q); // wanted audio under a stray carrier loses level as its quality falls
    const out = gate(withGain(raw, qDb), state.open);
    const gl = gate(withGain({ rmsDb: rawL, peakDb: rawPeakL }, qDb), state.open);
    const gr = gate(withGain({ rmsDb: rawR, peakDb: rawPeakR }, qDb), state.open);
    const sample = {
      t, rfDbm: state.levelDbm, rxPowerDbm: state.rxPowerDbm ?? state.levelDbm,
      thresholdDbm: link.rx.squelch ? link.rx.squelch.thresholdDbm : NaN,
      open: state.open, reason: state.reason ?? null, audioDb: out.rmsDb, audioRawDb: raw.rmsDb,
      audioPeakDb: out.peakDb, audioRawPeakDb: raw.peakDb,
      cnrDb: m ? m.cnrDb : NaN, blend: m ? m.blend : 0, mode: m ? m.mode : 'mono', pilotLocked: m ? m.pilotLocked : false,
      audioL: gl.rmsDb, audioR: gr.rmsDb, audioRawL: rawL, audioRawR: rawR,
      aDbm: rx && rx.diversity ? rx.diversity.aDbm : state.levelDbm,
      bDbm: rx && rx.diversity ? rx.diversity.bDbm : NaN,
      cableLossADb: rx && rx.diversity ? rx.diversity.cableLossADb : NaN,
      cableLossBDb: rx && rx.diversity ? rx.diversity.cableLossBDb : NaN,
      active: rx && rx.diversity ? rx.diversity.active : 'A',
      switched: !!(rx && rx.diversity && rx.diversity.switchCount !== (lastSwitch.get(link.id) ?? rx.diversity.switchCount)),
      overloadLevel: rx ? rx.overload.level : 'ok',
      compressionDb: rx ? rx.overload.compressionDb : 0,
      distortionPct: rx ? rx.overload.distortionPct : 0,
      batteryPercent: tel && tel.battery ? tel.battery.percentReported : NaN,
      batteryVoltage: tel && tel.battery ? tel.battery.voltage : NaN,
      batteryTruePercent: tel && tel.battery ? tel.battery.trueSocPercent : NaN,
      batteryReportedPercent: tel && tel.battery ? tel.battery.reportedPercent : NaN,
      batteryGaugeErrorPct: tel && tel.battery ? tel.battery.gaugeErrorPct : NaN,
      dataLocked: tel && tel.data ? tel.data.locked : false,
      dataAgeMs: tel && tel.data ? tel.data.ageMs : NaN,
      dataStale: tel && tel.data ? tel.data.stale : false,
      txPowerSagDb: state.sagDb || 0,
      noiseRiseDb: state.desenseDb || 0,
      captured: state.capture ? state.capture.captured : 'wanted',
      cirDb: state.capture ? state.capture.cirDb : NaN,
      audioQuality: state.capture ? state.capture.audioQuality : 1,
      systemNfDb: rx && rx.cascade ? rx.cascade.systemNfDb : NaN,
      noiseFloorDbm: rx && rx.cascade ? rx.cascade.noiseFloorDbm : NaN,
      sensitivityAtAntennaDbm: rx && rx.cascade ? rx.cascade.sensitivityAtAntennaDbm : NaN,
      marginAtAntennaDb: rx && rx.cascade ? rx.cascade.marginAtAntennaDb : NaN,
      digitalOrder: dig ? dig.order : 0,
      preFecBer: dig ? dig.preFecBer : NaN,
      postFecBer: dig ? dig.postFecBer : NaN,
      evmPercent: dig ? dig.evmPercent : NaN,
      merDb: dig ? dig.merDb : NaN,
      digitalState: dig ? dig.state : null,
      throughputKbps: dig ? dig.throughputKbps : 0,
    };
    lastSwitch.set(link.id, rx && rx.diversity ? rx.diversity.switchCount : 0);
    buf.push(sample);
    const cutoff = t - maxSeconds;
    let drop = 0;
    while (drop < buf.length && buf[drop].t < cutoff) drop++;
    if (drop) buf.splice(0, drop);
    for (const cb of [...subs]) cb(link.id, sample);
    return sample;
  }

  const api = {
    now,
    /** Take one sample of every link using `tracker` state. */
    sampleOnce(store, tracker, t = now()) {
      const scene = store.getScene();
      const ids = new Set();
      for (const link of scene.links) {
        ids.add(link.id);
        const st = tracker.get(link.id);
        if (st) record(link, st, t);
      }
      for (const id of [...buffers.keys()]) if (!ids.has(id)) { buffers.delete(id); sources.delete(id); }
    },
    get(linkId, seconds = 30) {
      const buf = buffers.get(linkId) || [];
      const cutoff = now() - seconds;
      let i = 0;
      while (i < buf.length && buf[i].t < cutoff) i++;
      return buf.slice(i);
    },
    clear() { buffers.clear(); },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    /** Start timed sampling (browser). Options let tests inject timers. */
    attach(store, tracker, { setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout, isHidden } = {}) {
      api.detach();
      const hidden = isHidden || (() => typeof document !== 'undefined' && document.hidden);
      const offStore = store.subscribe((_s, info) => { if (info.type !== 'selection') lastChange = now(); });
      const offTracker = tracker.subscribe(() => { lastChange = now(); });
      let running = true;
      const loop = () => {
        if (!running) return;
        if (!hidden()) api.sampleOnce(store, tracker);
        const active = now() - lastChange < ACTIVE_WINDOW_S;
        timer = setTimeoutFn(loop, active ? FAST_MS : IDLE_MS);
      };
      stop = () => { running = false; if (timer !== null) clearTimeoutFn(timer); timer = null; offStore(); offTracker(); };
      loop();
    },
    detach() { if (stop) stop(); stop = null; },
  };
  return api;
}

export const history = createHistory();
