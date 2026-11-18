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

/** isNewerBuild(current, latest) -> true when `latest` is a later ISO time than `current`. Either missing or unreadable gives false. Pure. */
export function isNewerBuild(current, latest) {
  const a = Date.parse(current), b = Date.parse(latest);
  return Number.isFinite(a) && Number.isFinite(b) && b > a;
}

/** buildTimeFrom(text) -> the BUILD_TIME string in the text of js/build-info.js, or null. Pure. */
export function buildTimeFrom(text) {
  const m = /BUILD_TIME\s*=\s*['"]([^'"]+)['"]/.exec(String(text || ''));
  return m ? m[1] : null;
}

/**
 * Watches for a newer deploy: fetches js/build-info.js fresh (no cache) on a timer, when the tab becomes visible again, and once at start. When it names a later build than the one
 * running, the "Update available" button next to the release label is shown; pressing it reloads the page. Does nothing for a local build or when fetch fails.
 */
export function watchForUpdate({ button = document.getElementById('brand-update'), current = BUILD_TIME, everyMs = 5 * 60 * 1000, fetchFn = (typeof fetch === 'function' ? fetch : null), reload = () => location.reload() } = {}) {
  if (!button || !current || !fetchFn) return () => {};
  let stopped = false, timer = null;
  const check = async () => {
    if (stopped || !button.hidden) return;
    try {
      const res = await fetchFn(new URL('./js/build-info.js', document.baseURI).href + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const latest = buildTimeFrom(await res.text());
      if (isNewerBuild(current, latest)) { button.hidden = false; button.title = 'A newer version has been published. Reload to get it; your work is kept if you Save first.'; }
    } catch { /* offline or blocked: try again later */ }
  };
  button.addEventListener('click', () => reload());
  const onVis = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', onVis);
  timer = setInterval(check, everyMs); check();
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
}
