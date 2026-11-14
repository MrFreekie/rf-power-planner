// Observable scene store with undo/redo history, selection and copy-on-write updates.
import { createDefaultScene, syncScene } from './model/scene.js';

const HISTORY_LIMIT = 50;

/**
 * createStore(initialScene?) -> {
 *   getScene, setScene(scene, {resetHistory}), update(fn, {coalesce}), subscribe(cb),
 *   select(id), getSelection(), undo, redo, canUndo, canRedo
 * }
 * update(fn): fn receives a deep clone `draft`; mutate it in place, or return a replacement scene.
 * Passing { coalesce: 'key' } merges consecutive updates with the same key into one undo step (drags).
 * Subscribers are called as cb(scene, info) where info = { type: 'scene'|'selection'|'undo'|'redo' }.
 */
export function createStore(initial = createDefaultScene()) {
  let scene = initial;
  let selection = null;
  let past = [];
  let future = [];
  let lastCoalesce = null;
  const subs = new Set();

  const emit = (type) => { for (const cb of [...subs]) cb(scene, { type }); };

  function pushHistory(prev) {
    past.push(prev);
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
  }

  return {
    getScene: () => scene,

    setScene(next, { resetHistory = true } = {}) {
      if (resetHistory) { past = []; future = []; } else pushHistory(scene);
      scene = next;
      lastCoalesce = null;
      emit('scene');
    },

    update(fn, { coalesce = null } = {}) {
      // The venue underlay can be large and is replaced, never edited in place, so it is shared by reference instead of cloned.
      const { venue: heldVenue, ...rest } = scene;
      const draft = structuredClone(rest);
      if (heldVenue !== undefined) draft.venue = heldVenue;
      const result = fn(draft);
      const next = result === undefined ? draft : result;
      syncScene(next); // keeps IEM branch 0 mirrored to the legacy tx/chain fields
      const { venue: nv, ...nrest } = next;
      if (nv === heldVenue && JSON.stringify(nrest) === JSON.stringify(rest)) return false; // no-op
      if (!(coalesce && coalesce === lastCoalesce && past.length)) pushHistory(scene);
      else future = [];
      lastCoalesce = coalesce;
      scene = next;
      emit('scene');
      return true;
    },

    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },

    select(id) {
      const next = id ?? null;
      if (next === selection) return;
      selection = next;
      emit('selection');
    },
    getSelection: () => selection,

    undo() {
      if (!past.length) return false;
      future.push(scene);
      scene = past.pop();
      lastCoalesce = null;
      emit('undo');
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(scene);
      scene = future.pop();
      lastCoalesce = null;
      emit('redo');
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
