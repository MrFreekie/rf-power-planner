// Telemetry tracker: virtual battery drain and the data channel carried above the stereo multiplex.
//   telemetry.get(linkId) -> { enabled, preset, deviceName, battery, data, sagDb, cnrDb } | null
//        battery = { socFrac, voltage, trueSocPercent, reportedPercent, gaugeErrorPct, percentReported (rounded gauge reading), lowWarning,
//                    txPowerSagDb, dead, chemistry, running, timeScale }
//        data    = { locked, per, lastPacketMs, ageMs, stale, packetsOk, packetsLost, decoded }
//   telemetry.subscribe(cb)   cb(states) when a link's state changed (roughly 5 Hz while the battery runs)
//   telemetry.reset(linkId)   refill the battery to its start percentage
// install(squelch, store) hooks it into the squelch tracker: the battery's transmit-power sag lowers the solved level
// (so a dying battery can close the squelch with reason 'battery'), and the data link is fed the CNR of the link.
import { batteryStep, dataLinkStep } from './model/telemetry.js';
import { DATA_PRESETS, DATA_PER_FIT } from './model/data-params.js';
import { RX_PRESETS } from './model/rx-params.js';

export const DEAD_SAG_DB = 60;
const TICK_MS = 200;
const KEYS = ['locked', 'stale', 'packetsOk', 'packetsLost', 'per', 'ageMs'];

/** Data-link parameters for a link: the preset plus its packet-error fit. */
export function dataConfig(link) {
  const id = (link.telemetry && link.telemetry.preset) || 'narrow-telemetry';
  return { ...(DATA_PRESETS[id] || DATA_PRESETS['narrow-telemetry']), ...(DATA_PER_FIT[id] || {}) };
}

/** CNR for the data link when no stereo multiplex supplies one: level over kTB + noise figure at 200 kHz. */
export function plainCnrDb(link, levelDbm) {
  const nf = (RX_PRESETS[link.rx && link.rx.rxPreset] || {}).noiseFigureDb ?? 8;
  return levelDbm - (-174 + 10 * Math.log10(200000) + nf);
}

function seedOf(id) {
  let s = 7;
  for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) % 100003;
  return s;
}

export function createTelemetryTracker({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), setIntervalFn, clearIntervalFn } = {}) {
  const mem = new Map(); // linkId -> { start, bat, data, last: public state }
  const subs = new Set();
  let store = null;
  let squelchTracker = null;
  let timer = null;
  let lastTickMs = null;

  const batOpts = (link, dt) => ({
    chemistry: link.telemetry.battery.chemistry, dtSeconds: dt, timeScale: link.telemetry.battery.timeScale, loadFactor: 1, kind: link.kind,
  });

  function ensure(link) {
    const t = link.telemetry;
    let m = mem.get(link.id);
    const start = Math.min(100, Math.max(0, t.battery.startPercent)) / 100;
    if (!m || m.start !== start || m.chemistry !== t.battery.chemistry) {
      m = { start, chemistry: t.battery.chemistry, bat: batteryStep({ socFrac: start }, batOpts(link, 0)), data: null, last: null };
      mem.set(link.id, m);
    }
    return m;
  }

  /** Transmit-power sag in dB for the squelch tracker. */
  function sagFor(link) {
    if (!link.telemetry || !link.telemetry.enabled) return 0;
    const b = ensure(link).bat;
    return b.dead ? Math.max(DEAD_SAG_DB, b.txPowerSagDb) : b.txPowerSagDb;
  }

  /** Squelch-tracker provider: (link, levelDbm, mpx) -> telemetry state (a new object whenever something visible changed). */
  function provide(link, levelDbm, mpx) {
    if (!link.telemetry || !link.telemetry.enabled) { mem.delete(link.id); return null; }
    const m = ensure(link);
    const cnr = mpx && Number.isFinite(mpx.cnrDb) ? mpx.cnrDb : plainCnrDb(link, levelDbm);
    const t = now();
    m.data = dataLinkStep(m.data, cnr, dataConfig(link), t, m.bat,
      { name: link.telemetry.deviceName, gainDb: link.telemetry.gainDb, mute: false, rfLevelDbm: levelDbm }, { seed: seedOf(link.id) });
    const next = {
      enabled: true, preset: link.telemetry.preset, deviceName: link.telemetry.deviceName, cnrDb: cnr, sagDb: sagFor(link),
      battery: { ...m.bat, chemistry: link.telemetry.battery.chemistry, running: !!link.telemetry.battery.running, timeScale: link.telemetry.battery.timeScale },
      data: m.data,
    };
    const prev = m.last;
    const same = prev && prev.deviceName === next.deviceName && Object.is(prev.cnrDb, next.cnrDb)
      && prev.battery.percentReported === next.battery.percentReported && prev.battery.socFrac === next.battery.socFrac
      && Object.is(prev.battery.reportedPercent, next.battery.reportedPercent)
      && prev.battery.running === next.battery.running && prev.battery.timeScale === next.battery.timeScale
      && prev.battery.chemistry === next.battery.chemistry
      && KEYS.every((k) => Object.is(prev.data[k], next.data[k])) && prev.data.decoded.name === next.data.decoded.name
      && prev.data.decoded.battery === next.data.decoded.battery;
    if (same) return prev;
    m.last = next;
    pending = true;
    return next;
  }
  let pending = false;

  /** Advance every running battery by dtSeconds of real time and recompute. Called by the timer; tests call it directly. */
  function tick(dtSeconds) {
    if (!store) return;
    for (const link of store.getScene().links) {
      if (!link.telemetry || !link.telemetry.enabled) continue;
      const m = ensure(link);
      if (link.telemetry.battery.running) m.bat = batteryStep(m.bat, batOpts(link, dtSeconds));
    }
    if (squelchTracker) squelchTracker.refresh();
    flush();
  }

  function flush() {
    if (!pending) return;
    pending = false;
    for (const cb of [...subs]) cb(mem);
  }

  const api = {
    sagFor, provide, tick, flush,
    get: (linkId) => { const m = mem.get(linkId); return (m && m.last) || null; },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    /** Refill the battery to its start percentage (the link's telemetry.battery.startPercent). */
    reset(linkId) {
      const m = mem.get(linkId);
      if (m) mem.delete(linkId);
      if (squelchTracker) squelchTracker.refresh();
      flush();
    },
    install(squelch, theStore, { start = true } = {}) {
      squelchTracker = squelch;
      store = theStore;
      squelch.setTxSag(sagFor);
      squelch.setTelemetryProvider(provide);
      const off = squelch.subscribe(() => flush());
      if (start) api.start();
      return () => { api.stop(); squelch.setTxSag(null); squelch.setTelemetryProvider(null); off(); };
    },
    /** Begin the real-time tick (browser). */
    start() {
      api.stop();
      const si = setIntervalFn || globalThis.setInterval;
      if (typeof si !== 'function') return;
      lastTickMs = now();
      timer = si(() => {
        if (typeof document !== 'undefined' && document.hidden) { lastTickMs = now(); return; }
        const t = now();
        const dt = Math.min(1, (t - lastTickMs) / 1000);
        lastTickMs = t;
        tick(dt);
      }, TICK_MS);
    },
    stop() {
      if (timer !== null) (clearIntervalFn || globalThis.clearInterval)(timer);
      timer = null;
    },
  };
  return api;
}

export const telemetry = createTelemetryTracker();
