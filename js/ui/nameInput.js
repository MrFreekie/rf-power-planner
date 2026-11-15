// Pure helpers for name text fields in the inspector.
export const NAME_MAX = 40;

/** Strip control characters (keeps spaces, accents, symbols; markup is harmless because names are only drawn as text) and cap the length. */
export function cleanName(v, max = NAME_MAX) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max); }

/** Name to store when a field is left empty (whitespace only counts as empty). */
export function nameOrDefault(v, fallback) { const c = cleanName(v); return c.trim() === '' ? fallback : c; }

/** Message shown beside the field once the limit is reached, else ''. */
export function limitMessage(value, max = NAME_MAX) { return String(value ?? '').length >= max ? `Limit reached: ${max} characters. Longer text is not accepted.` : ''; }

/** Rename a reflector by id, never by list position, so a selection change while typing cannot write to another reflector. */
export function renameReflector(store, id, name, o = {}) {
  store.update((d) => { const r = (d.reflectors || []).find((x) => x.id === id); if (r) r.name = name; }, o && o.coalesce ? { coalesce: o.coalesce } : {});
}
