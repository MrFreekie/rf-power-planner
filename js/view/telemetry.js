// Telemetry panel: battery gauge, low-battery warning, device name/gain/mute/RF level decoded from the data packets,
// data lock LED, packet age with STALE greying, and ok/lost counters. Shown when link.telemetry.enabled.
import { activeLink } from './util.js';
import { telemetry } from '../telemetryTracker.js';
import { formatPower } from '../model/units.js';

/** Battery gauge level class from percent and warning flag. Pure. */
export function batteryLevel(percent, lowWarning) {
  if (!Number.isFinite(percent)) return 'unknown';
  if (percent <= 5) return 'critical';
  if (lowWarning || percent <= 20) return 'low';
  return 'ok';
}

/** Age text: "0.4 s", "12 s" or "never". Pure. */
export function ageText(ageMs) {
  if (!Number.isFinite(ageMs)) return 'never';
  return ageMs < 10000 ? `${(ageMs / 1000).toFixed(1)} s` : `${Math.round(ageMs / 1000)} s`;
}

export function mountTelemetry({ container, store }) {
  container.classList.add('telemetry');
  container.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const h2 = el('h2', null, 'Telemetry');
  const msg = el('p', 'hint');
  const body = el('div', 'tm-body');
  const gauge = el('div', 'tm-gauge');
  gauge.setAttribute('role', 'meter'); gauge.setAttribute('aria-label', 'Transmitter battery');
  gauge.setAttribute('aria-valuemin', '0'); gauge.setAttribute('aria-valuemax', '100');
  const fill = el('div', 'tm-fill');
  const trueTick = el('div', 'tm-true'); trueTick.title = 'True state of charge';
  gauge.append(fill, trueTick);
  const cap = el('div', 'tm-cap');
  const gaugeRow = el('div', 'tm-gauge-row'); gaugeRow.append(gauge, cap);
  const battText = el('p', 'tm-batt');
  const warn = el('p', 'tm-warn'); warn.setAttribute('role', 'alert');
  const lockRow = el('div', 'tm-lock');
  const led = el('span', 'mpx-led'); const lockText = el('span', 'tm-lock-text');
  lockRow.append(led, lockText);
  const grid = el('dl', 'mpx-nums tm-grid');
  const f = {};
  for (const [k, label] of [['name', 'Device'], ['gain', 'Gain'], ['mute', 'Mute'], ['rf', 'RF level (reported)'], ['age', 'Packet age'], ['ok', 'Packets ok'], ['lost', 'Packets lost']]) {
    const d = el('div'); d.append(el('dt', null, label)); const dd = el('dd', null, '-'); d.append(dd); grid.append(d); f[k] = dd;
  }
  const note = el('p', 'hint', 'The transmitter reports its battery, name, gain and RF level over a low-rate data channel. When the link gets weak the data packets fail before the audio does, so telemetry is an early warning. Values go grey (STALE) when no recent packet has arrived. Illustrative.');
  body.append(gaugeRow, battText, warn, lockRow, grid, note);
  container.append(h2, msg, body);

  let gaugeErr = 0;
  function render() {
    const link = activeLink(store.getScene(), store.getSelection());
    const on = !!(link && link.telemetry && link.telemetry.enabled);
    msg.hidden = on; body.hidden = !on;
    msg.textContent = link ? 'Telemetry is off for this link. Enable it in the inspector to see battery and data-link status.' : 'No link selected.';
    if (!on) return;
    const st = telemetry.get(link.id);
    if (!st) return;
    const b = st.battery, d = st.data;
    const pct = b.percentReported;
    gauge.dataset.level = batteryLevel(pct, b.lowWarning);
    const rep = Number.isFinite(b.reportedPercent) ? b.reportedPercent : pct;
    const tru = Number.isFinite(b.trueSocPercent) ? b.trueSocPercent : rep;
    fill.style.width = `${Math.max(0, Math.min(100, rep))}%`;
    trueTick.style.left = `calc(${Math.max(0, Math.min(100, tru))}% - 1.5px)`;
    trueTick.hidden = !Number.isFinite(b.trueSocPercent);
    gaugeErr = Number.isFinite(b.gaugeErrorPct) ? b.gaugeErrorPct : rep - tru;
    gauge.setAttribute('aria-valuenow', String(Math.round(pct)));
    cap.textContent = `${Math.round(pct)} %`;
    battText.textContent = `Fill = reported ${Math.round(rep)} %, tick = true ${Math.round(tru)} %: gauge error ${gaugeErr >= 0 ? '+' : '\u2212'}${Math.abs(gaugeErr).toFixed(1)} points. ${b.voltage.toFixed(2)} V, ${b.chemistry}${b.running ? '' : ' (drain paused)'}${b.txPowerSagDb > 0.05 ? `, transmit power sag ${b.txPowerSagDb.toFixed(1)} dB` : ''}`;
    warn.hidden = !(b.dead || b.lowWarning);
    warn.textContent = b.dead ? 'BATTERY DEAD: the transmitter has stopped.' : 'LOW BATTERY: change the battery soon.';
    led.dataset.state = d.locked ? 'locked' : 'lost';
    lockText.textContent = d.locked ? 'DATA LOCK' : 'DATA LOST';
    body.classList.toggle('stale', !!d.stale);
    const dc = d.decoded || {};
    f.name.textContent = dc.name ?? '-';
    f.gain.textContent = Number.isFinite(dc.gainDb) ? `${dc.gainDb > 0 ? '+' : dc.gainDb < 0 ? '−' : ''}${Math.abs(dc.gainDb)} dB` : '-';
    f.mute.textContent = dc.mute == null ? '-' : dc.mute ? 'MUTED' : 'live';
    f.rf.textContent = Number.isFinite(dc.rfLevelDbm) ? formatPower(dc.rfLevelDbm, store.getScene().units.power) : '-';
    f.age.textContent = ageText(d.ageMs) + (d.stale ? ' STALE' : '');
    f.ok.textContent = String(d.packetsOk); f.lost.textContent = String(d.packetsLost);
  }

  const u1 = telemetry.subscribe(render);
  const u2 = store.subscribe(render);
  render();
  return { destroy() { u1(); u2(); container.textContent = ''; } };
}
