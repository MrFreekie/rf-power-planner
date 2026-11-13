// Shared squelch tracker: remembers each link's gate state across scene changes so the
// hysteresis behaves while dragging. Call squelch.attach(store) once at start-up.
//
// Optional hooks (installed by mpxTracker, rxTracker, telemetryTracker; all may be absent):
//   setTxSag(fn(link) -> dB)                       transmit power reduction (dying battery); applied before solving
//   setSolver(fn(scene, link) -> { levelDbm, rxPowerDbm, rx })   replaces solveLink (diversity combining, overload)
//   setMpxProvider(fn(link, levelDbm) -> mpx | null)             stereo multiplex state (pilot squelch)
//   setTelemetryProvider(fn(link, levelDbm, mpx|{cnrDb}) -> telemetry | null)
//   setDesenseProvider(fn(link, scene) -> dB)   extra noise (intermod) that desensitises the receiver; the gate sees level minus it, reason 'imd'
//   setDigitalProvider(fn(link, levelDbm) -> digital state | null)   digital links; 'down'/muted closes the gate (reason 'digital')
// Provider results must be identity-stable while unchanged (the tracker compares them with ===).
import { solveLink } from './model/rf.js';
import { squelchState } from './model/squelch.js';
import { captureState } from './model/interferer.js';

const MPX_KEYS = ['cnrDb', 'blend', 'mode', 'pilotLocked', 'pilotLevelDb', 'separationDb', 'audioSnrDb', 'lrLeak'];
const sameMpx = (a, b) => (a === b) || (!!a && !!b && MPX_KEYS.every((k) => Object.is(a[k], b[k])));

function withSag(link, sagDb) {
  if (!(sagDb > 0)) return link;
  const copy = structuredClone(link);
  copy.tx.powerDbm -= sagDb;
  return copy;
}

export function createSquelchTracker() {
  let mpxProvider = null;
  let txSag = null;
  let solver = null;
  let telemetryProvider = null;
  let digitalProvider = null;
  let desenseProvider = null;
  let lastScene = null;
  const states = new Map(); // linkId -> { open, carrierOpen, reason, levelDbm, rxPowerDbm, headroomDb, sagDb, mpx, rx, telemetry }
  const subs = new Set();
  let off = null;

  function recompute(scene) {
    lastScene = scene;
    const seen = new Set();
    let changed = false;
    for (const link of scene.links) {
      seen.add(link.id);
      let sagDb = 0;
      if (txSag) { try { sagDb = Number(txSag(link)) || 0; } catch { sagDb = 0; } }
      const lk = withSag(link, sagDb);
      let levelDbm = NaN, rxPowerDbm = NaN, rx = null;
      try {
        if (solver) {
          const r = solver(scene, lk);
          levelDbm = r.levelDbm; rxPowerDbm = r.rxPowerDbm; rx = r.rx || null;
        } else {
          const r = solveLink(scene, lk);
          levelDbm = r.inputPowerDbm; rxPowerDbm = r.rxPowerDbm;
        }
      } catch { /* leave NaN: gate closed */ }
      const prev = states.get(link.id);
      // A stray carrier at the receiver input: the carrier squelch sees the stronger of the two carriers, while the stereo
      // decoder and the pilot squelch only ever use the wanted pilot, which is lost when the wanted signal is not captured.
      const itf = link.interferer;
      const cap = itf && itf.enabled && Number.isFinite(levelDbm) ? captureState(levelDbm, itf.levelDbm) : null;
      let m = null;
      if (mpxProvider) { try { m = mpxProvider(link, cap && cap.captured !== 'wanted' ? levelDbm - 40 : levelDbm) || null; } catch { m = null; } }
      let dig = null;
      if (digitalProvider) { try { dig = digitalProvider(link, levelDbm) || null; } catch { dig = null; } }
      let tel = null;
      if (telemetryProvider) {
        try { tel = telemetryProvider(link, levelDbm, m || (dig ? { cnrDb: dig.cnrDb } : null)) || null; } catch { tel = null; }
      }
      let desenseDb = 0;
      if (desenseProvider) { try { desenseDb = Math.max(0, Number(desenseProvider(link, scene)) || 0); } catch { desenseDb = 0; } }
      const pilotRequired = !!(m && link.mpx && link.mpx.pilotSquelch);
      const q = link.rx && link.rx.squelch;
      let { open, carrierOpen, headroomDb, reason } = squelchState(
        prev ? prev.carrierOpen : false, (cap ? cap.carrierLevelDbm : levelDbm) - desenseDb, q,
        { pilotRequired, pilotLocked: m ? m.pilotLocked : true });
      // A digital link that is down (or muted after concealment ran out) closes the gate; a weak carrier keeps 'carrier'.
      if (dig && (dig.state === 'down' || dig.muted) && open) { open = false; reason = 'digital'; }
      // A flat battery that pushed the level under the threshold is reported as 'battery', not 'carrier'.
      if (reason === 'pilot' && cap && cap.captured !== 'wanted' && itf.hasPilot) reason = 'interferer'; // a foreign pilot is present but rejected
      if (reason === 'carrier' && desenseDb > 0.1 && Number.isFinite(levelDbm) && levelDbm >= (q && Number.isFinite(q.thresholdDbm) ? q.thresholdDbm : -90)) reason = 'imd';
      if (reason === 'carrier' && sagDb > 0.1 && Number.isFinite(levelDbm) && levelDbm + sagDb >= (q && Number.isFinite(q.thresholdDbm) ? q.thresholdDbm : -90)) reason = 'battery';
      if (!prev || prev.open !== open || !Object.is(prev.levelDbm, levelDbm) || !Object.is(prev.rxPowerDbm, rxPowerDbm)
        || !Object.is(prev.headroomDb, headroomDb) || prev.reason !== reason || !Object.is(prev.sagDb, sagDb) || !Object.is(prev.desenseDb, desenseDb)
        || !sameMpx(prev.mpx, m) || prev.rx !== rx || prev.telemetry !== tel || prev.digital !== dig
        || !Object.is(prev.capture && prev.capture.cirDb, cap && cap.cirDb) || (prev.capture && prev.capture.captured) !== (cap && cap.captured)) {
        states.set(link.id, { open, carrierOpen, reason, levelDbm, rxPowerDbm, headroomDb, sagDb, desenseDb, capture: cap, mpx: m, rx, telemetry: tel, digital: dig });
        changed = true;
      }
    }
    for (const id of [...states.keys()]) if (!seen.has(id)) { states.delete(id); changed = true; }
    if (changed) for (const cb of [...subs]) cb(states);
  }

  return {
    setMpxProvider(fn) { mpxProvider = fn || null; },
    setTxSag(fn) { txSag = fn || null; },
    setSolver(fn) { solver = fn || null; },
    setTelemetryProvider(fn) { telemetryProvider = fn || null; },
    setDigitalProvider(fn) { digitalProvider = fn || null; },
    setDesenseProvider(fn) { desenseProvider = fn || null; },
    /** Recompute from the last seen scene (for time-driven inputs such as the battery). */
    refresh() { if (lastScene) recompute(lastScene); },
    /** Start following a store (replaces any previous one). Returns a detach function. */
    attach(store) {
      if (off) off();
      states.clear();
      off = store.subscribe((scene, info) => { if (info.type !== 'selection') recompute(scene); });
      recompute(store.getScene());
      return () => { if (off) off(); off = null; };
    },
    /** -> { open, carrierOpen, reason: null|'carrier'|'pilot'|'battery'|'digital'|'imd'|'interferer', desenseDb, capture:{captured, cirDb, audioQuality, carrierLevelDbm}|null, levelDbm, rxPowerDbm, headroomDb, sagDb, mpx, rx, telemetry, digital }
     *  or null when the link is unknown / not attached. */
    get: (linkId) => states.get(linkId) || null,
    /** cb(states) fires only when some link's state changed. Returns an unsubscribe function. */
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}

export const squelch = createSquelchTracker();

// The sample history lives in history.js and is reachable from here too.
export { history } from './history.js';
