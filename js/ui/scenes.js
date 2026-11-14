// Named scenes saved in the browser (localStorage). The storage logic is pure (storage is injected) so Node can test it;
// the DOM panel is mountScenes() below.
//   createSceneLibrary(storage) -> { list, save, load, rename, remove, clear, usage }
//   Every method returns plain data and never throws; failures come back as { ok:false, error }.
import { serialize, deserialize } from '../model/scene.js';

export const LIBRARY_KEY = 'rf-power-planner.scenes.v1';
export const LIMITS = Object.freeze({ maxScenes: 20, maxSceneBytes: 200 * 1024, maxTotalBytes: 2 * 1024 * 1024, maxNameLength: 60 });

/** Trim, collapse whitespace and cap the length. Returns '' when nothing usable is left. */
export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxNameLength);
}

/** Storage that is safe to touch: returns window.localStorage or null (blocked, private mode, Node). */
export function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function readItems(storage) {
  if (!storage) return { items: [], corrupt: false };
  let text;
  try { text = storage.getItem(LIBRARY_KEY); } catch { return { items: [], corrupt: false }; }
  if (!text) return { items: [], corrupt: false };
  try {
    const data = JSON.parse(text);
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return { items: [], corrupt: true };
    const items = data.items.filter((it) => it && typeof it.id === 'string' && typeof it.name === 'string' && typeof it.json === 'string' && it.json.length <= LIMITS.maxSceneBytes) // a tampered or oversize entry is dropped
      .map((it) => ({ id: it.id, name: cleanName(it.name) || 'Untitled', savedAt: Number.isFinite(it.savedAt) ? it.savedAt : 0, json: it.json }));
    return { items, corrupt: items.length !== data.items.length };
  } catch { return { items: [], corrupt: true }; }
}

export function createSceneLibrary(storage = defaultStorage(), { now = () => Date.now() } = {}) {
  const write = (items) => {
    if (!storage) return { ok: false, error: 'Browser storage is not available (private mode or blocked), so scenes cannot be saved.' };
    try {
      storage.setItem(LIBRARY_KEY, JSON.stringify({ v: 1, items }));
      return { ok: true };
    } catch {
      return { ok: false, error: 'The browser refused to store the scene (storage full or blocked). Delete a saved scene or use Save to download a file.' };
    }
  };
  const bytes = (items) => items.reduce((n, it) => n + it.json.length + it.name.length, 0);
  const newId = () => `s${now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  return {
    available: () => !!storage,
    list() {
      return readItems(storage).items.map((it) => ({ id: it.id, name: it.name, savedAt: it.savedAt, bytes: it.json.length }))
        .sort((a, b) => b.savedAt - a.savedAt);
    },
    usage() {
      const { items } = readItems(storage);
      return { count: items.length, bytes: bytes(items), maxScenes: LIMITS.maxScenes, maxTotalBytes: LIMITS.maxTotalBytes };
    },
    /** Save under a name; an existing scene with the same name (case-insensitive) is replaced. */
    save(name, scene) {
      const nm = cleanName(name);
      if (!nm) return { ok: false, error: 'Give the scene a name first.' };
      let json;
      try { json = serialize(scene); } catch (e) { return { ok: false, error: `Could not serialise the scene: ${e.message}` }; }
      if (json.length > LIMITS.maxSceneBytes) return { ok: false, error: `This scene is too large to keep in the browser (${Math.round(json.length / 1024)} KB, limit ${LIMITS.maxSceneBytes / 1024} KB). Use Save to download it.` };
      const { items } = readItems(storage);
      const i = items.findIndex((it) => it.name.toLowerCase() === nm.toLowerCase());
      const entry = { id: i >= 0 ? items[i].id : newId(), name: nm, savedAt: now(), json };
      const next = items.slice();
      if (i >= 0) next[i] = entry; else next.push(entry);
      if (next.length > LIMITS.maxScenes) return { ok: false, error: `Up to ${LIMITS.maxScenes} scenes can be kept. Delete one first.` };
      if (bytes(next) > LIMITS.maxTotalBytes) return { ok: false, error: 'The saved scenes would use too much browser storage. Delete one first.' };
      const w = write(next);
      return w.ok ? { ok: true, id: entry.id, replaced: i >= 0 } : w;
    },
    /** Parse, migrate and validate a stored scene. A scene that no longer validates is reported, not loaded. */
    load(id) {
      const it = readItems(storage).items.find((x) => x.id === id);
      if (!it) return { ok: false, error: 'That saved scene was not found.' };
      try { return { ok: true, scene: deserialize(it.json), name: it.name }; } catch (e) { return { ok: false, error: `"${it.name}" could not be loaded: ${e.message}` }; }
    },
    rename(id, name) {
      const nm = cleanName(name);
      if (!nm) return { ok: false, error: 'Give the scene a name first.' };
      const { items } = readItems(storage);
      const it = items.find((x) => x.id === id);
      if (!it) return { ok: false, error: 'That saved scene was not found.' };
      if (items.some((x) => x.id !== id && x.name.toLowerCase() === nm.toLowerCase())) return { ok: false, error: 'Another saved scene already has that name.' };
      it.name = nm;
      return write(items);
    },
    remove(id) {
      const { items } = readItems(storage);
      const next = items.filter((x) => x.id !== id);
      if (next.length === items.length) return { ok: false, error: 'That saved scene was not found.' };
      return write(next);
    },
    clear() {
      if (!storage) return { ok: true };
      try { storage.removeItem(LIBRARY_KEY); return { ok: true }; } catch { return { ok: false, error: 'Could not clear browser storage.' }; }
    },
  };
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * mountScenes({ container, getScene, onLoad(scene, name), library? })
 * container is a <details> (or any element); the panel renders into it.
 */
export function mountScenes({ container, getScene, onLoad, library = createSceneLibrary() }) {
  container.textContent = '';
  const summary = document.createElement('summary');
  summary.textContent = 'Saved scenes';
  const body = document.createElement('div');
  body.className = 'ob-body';
  if (container.tagName === 'DETAILS') container.append(summary, body); else { summary.className = 'ob-summary'; container.append(summary, body); }

  const form = document.createElement('form');
  form.className = 'ob-row';
  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = LIMITS.maxNameLength; input.placeholder = 'Scene name';
  input.setAttribute('aria-label', 'Name for the saved scene');
  input.title = 'Name under which the current scene is kept in this browser';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit'; saveBtn.textContent = 'Save here';
  saveBtn.title = 'Keep the current scene in this browser under this name (same name replaces it)';
  form.append(input, saveBtn);
  const msg = document.createElement('p');
  msg.className = 'hint ob-msg'; msg.setAttribute('role', 'status');
  const listEl = document.createElement('ul');
  listEl.className = 'ob-list';
  body.append(form, msg, listEl);

  const say = (t, bad = false) => { msg.textContent = t || ''; msg.dataset.bad = bad ? 'true' : 'false'; };
  let renaming = null, confirming = null;

  function render() {
    listEl.textContent = '';
    if (!library.available()) say('Browser storage is unavailable here; use Save / Load for files.', true);
    const items = library.list();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'ob-empty'; li.textContent = 'Nothing saved yet.';
      listEl.append(li);
    }
    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'ob-item';
      const btn = (text, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text; b.title = title;
        b.addEventListener('click', fn);
        return b;
      };
      if (renaming === it.id) {
        const f = document.createElement('form');
        f.className = 'ob-row';
        const inp = document.createElement('input');
        inp.type = 'text'; inp.value = it.name; inp.maxLength = LIMITS.maxNameLength; inp.setAttribute('aria-label', `New name for ${it.name}`);
        const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = 'OK';
        f.append(inp, ok, btn('Cancel', 'Keep the old name', () => { renaming = null; render(); }));
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const r = library.rename(it.id, inp.value);
          if (r.ok) { renaming = null; say('Renamed.'); } else say(r.error, true);
          render();
        });
        li.append(f);
        listEl.append(li);
        queueMicrotask(() => inp.focus());
        continue;
      }
      const label = document.createElement('span');
      label.className = 'ob-name';
      label.textContent = it.name;
      const when = document.createElement('span');
      when.className = 'hint ob-when';
      when.textContent = `${fmtDate(it.savedAt)} (${Math.max(1, Math.round(it.bytes / 1024))} KB)`;
      const del = confirming === it.id
        ? btn('Really delete?', 'Click again to delete this saved scene', () => { confirming = null; const r = library.remove(it.id); say(r.ok ? 'Deleted.' : r.error, !r.ok); render(); })
        : btn('Delete', 'Delete this saved scene', () => { confirming = it.id; render(); });
      li.append(label, when, btn('Load', 'Replace the current scene with this one (Undo brings the old one back)', () => {
        const r = library.load(it.id);
        if (!r.ok) { say(r.error, true); return; }
        onLoad(r.scene, r.name);
        say(`Loaded "${r.name}".`);
      }), btn('Rename', 'Rename this saved scene', () => { renaming = it.id; confirming = null; render(); }), del);
      listEl.append(li);
    }
    const u = library.usage();
    if (u.count) body.dataset.usage = `${u.count} of ${u.maxScenes} scenes, ${Math.round(u.bytes / 1024)} KB`;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = library.save(input.value, getScene());
    if (r.ok) { say(r.replaced ? 'Replaced the scene with that name.' : 'Saved in this browser.'); input.value = ''; } else say(r.error, true);
    render();
  });
  render();
  return { render, destroy() { container.textContent = ''; } };
}
