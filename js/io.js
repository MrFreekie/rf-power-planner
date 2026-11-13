// Scene file save/load. Parsing is pure and testable in Node; download needs a browser.
import { serialize, deserialize } from './model/scene.js';

export const MAX_SCENE_BYTES = 2 * 1024 * 1024;

export function sceneToBlob(scene) {
  return new Blob([serialize(scene)], { type: 'application/json' });
}

/** Trigger a browser download of the scene as JSON. */
export function downloadScene(scene, filename = 'rf-power-scene.json') {
  const url = URL.createObjectURL(sceneToBlob(scene));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse + migrate + validate JSON text. Never throws. */
export function parseSceneText(text) {
  try {
    return { ok: true, scene: deserialize(text) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Could not read scene' };
  }
}

/** Read a File/Blob and parse it as a scene. Never rejects. */
export async function loadSceneFromFile(file) {
  try {
    if (!file) return { ok: false, error: 'No file selected' };
    if (file.size > MAX_SCENE_BYTES) return { ok: false, error: 'File is too large to be a scene' };
    return parseSceneText(await file.text());
  } catch (e) {
    return { ok: false, error: `Could not read file: ${e && e.message ? e.message : e}` };
  }
}
