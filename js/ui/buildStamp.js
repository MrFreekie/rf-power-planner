// Header stamp: when this copy of the software was last updated (the deploy time), shown in the viewer's local time.
import { BUILD_TIME } from '../build-info.js';

/** Text for the stamp, or '' when the time is unknown. Pure; `locale` lets tests pin the output. */
export function buildStampText(iso, locale) {
  const d = typeof iso === 'string' ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `Updated ${d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function mountBuildStamp(root = document) {
  const el = root.getElementById('brand-build');
  if (!el) return;
  const t = buildStampText(BUILD_TIME);
  el.textContent = t || 'Local build';
  if (BUILD_TIME) el.title = `Last software update (deployed ${BUILD_TIME} UTC), shown in your local time.`;
}
