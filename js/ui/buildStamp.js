// Header stamp: when this copy of the software was last updated (the deploy time), shown in the viewer's local time.
import { BUILD_TIME } from '../build-info.js';

const p2 = (n) => String(n).padStart(2, '0');

/** Release label for a deploy time: { version: 'v2026.11.18', time: '18:42' } in the viewer's local time (a date-based release number), or null when unknown. */
export function buildRelease(iso) {
  const d = typeof iso === 'string' ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return { version: `v${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`, time: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

/** Text for the stamp, or '' when the time is unknown: "Release v2026.11.18 · 18:42". */
export function buildStampText(iso) {
  const r = buildRelease(iso);
  return r ? `Release ${r.version} · ${r.time}` : '';
}

export function mountBuildStamp(root = document) {
  const el = root.getElementById('brand-build');
  if (!el) return;
  const r = buildRelease(BUILD_TIME);
  el.textContent = '';
  if (r) {
    const v = root.createElement('b'); v.textContent = r.version;
    const t = root.createElement('span'); t.textContent = r.time;
    el.append(root.createTextNode('Release '), v, t);
    el.title = `Software release ${r.version}, deployed ${BUILD_TIME} UTC (shown in your local time).`;
  } else el.textContent = 'Local build';
}
