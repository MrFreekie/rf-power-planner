// "Place measurement" mode shared between the Measurements dialog and the plan: the dialog closes, the next plan click is delivered to onPick(world),
// Escape (or the banner's Cancel) ends the mode. Pure state + subscribers, so it is testable without a DOM.
let mode = null;
const subs = new Set();
const emit = () => { for (const f of [...subs]) f(mode); };
export function startPlace(onPick, { message = 'Click the plan where you took the reading. Escape cancels.', onCancel } = {}) { mode = { onPick, onCancel, message }; emit(); }
export function isPlacing() { return !!mode; }
export function placeMessage() { return mode ? mode.message : ''; }
/** Deliver a world point; the mode ends first so the callback may start another one. */
export function pickPlace(world) { const m = mode; if (!m) return false; mode = null; emit(); m.onPick(world); return true; }
export function cancelPlace() { const m = mode; if (!m) return false; mode = null; emit(); if (m.onCancel) m.onCancel(); return true; }
export function subscribePlace(fn) { subs.add(fn); return () => subs.delete(fn); }
