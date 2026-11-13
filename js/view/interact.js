// Pointer / wheel / keyboard interaction shared by plan and side views.
// Handles: item drag (via hitTest), wheel zoom about the cursor, pan (middle button, space+drag,
// or drag on empty background), two-finger pinch + pan, keyboard nudge / zoom / cycle / fit.
//
// opts: {
//   hitTest(sx, sy, isTouch) -> handle | null    handle = {kind, itemId, wx, wy, ...} (wx/wy world pos for offset-free drags)
//   dragStart(handle), dragMove(handle, pointerWorld, targetWorld, state), dragEnd(handle),
//   select(id|null), hover(handle|null), onView() after zoom/pan, fit(), nudge(dx, dy, big), cycle(dir), escape()
// }
import { clamp } from './util.js';

export function attachInteraction(canvas, vp, opts) {
  const pointers = new Map(); // id -> {x, y}
  let mode = null; // 'drag' | 'pan' | 'pinch'
  let drag = null, panLast = null, pinch = null, spaceDown = false, hoverKey = null;

  canvas.style.touchAction = 'none';
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setCursor = (c) => { canvas.style.cursor = c; };

  function onDown(e) {
    canvas.focus({ preventScroll: true });
    const p = local(e);
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture?.(e.pointerId);
    if (pointers.size === 2) { // second finger: switch to pinch
      if (drag) { opts.dragEnd?.(drag.handle); drag = null; }
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      mode = 'pinch';
      return;
    }
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const wantPan = e.button === 1 || spaceDown || e.button === 2;
    const hit = wantPan ? null : opts.hitTest(p.x, p.y, isTouch);
    if (hit) {
      opts.select?.(hit.itemId ?? null);
      const w = vp.screenToWorld(p.x, p.y);
      drag = { handle: hit, offX: (hit.wx ?? w.x) - w.x, offY: (hit.wy ?? w.y) - w.y, state: opts.dragStart?.(hit, w) };
      mode = 'drag'; setCursor('grabbing');
    } else {
      mode = 'pan'; panLast = p; drag = { moved: 0, clickAt: p, button: e.button };
      setCursor('grabbing');
    }
    e.preventDefault();
  }

  function onMove(e) {
    const p = local(e);
    if (!pointers.has(e.pointerId)) { // hover
      const hit = opts.hitTest(p.x, p.y, e.pointerType === 'touch');
      const key = hit ? hit.kind + ':' + hit.itemId : null;
      if (key !== hoverKey) { hoverKey = key; opts.hover?.(hit); }
      setCursor(spaceDown ? 'grab' : hit ? 'grab' : 'default');
      return;
    }
    pointers.set(e.pointerId, p);
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      vp.panBy(mx - pinch.mx, my - pinch.my);
      if (pinch.d > 0 && d > 0) vp.zoomAt(mx, my, d / pinch.d);
      pinch = { d, mx, my };
      opts.onView?.();
    } else if (mode === 'drag' && drag) {
      const w = vp.screenToWorld(p.x, p.y);
      opts.dragMove?.(drag.handle, w, { x: w.x + drag.offX, y: w.y + drag.offY }, drag.state);
    } else if (mode === 'pan' && panLast) {
      vp.panBy(p.x - panLast.x, p.y - panLast.y);
      drag.moved += Math.abs(p.x - panLast.x) + Math.abs(p.y - panLast.y);
      panLast = p;
      opts.onView?.();
    }
  }

  function onUp(e) {
    const wasPan = mode === 'pan' && drag;
    if (wasPan && drag.moved < 4 && drag.button === 0) opts.select?.(null); // click on empty space deselects
    if (mode === 'drag' && drag) opts.dragEnd?.(drag.handle);
    pointers.delete(e.pointerId);
    canvas.releasePointerCapture?.(e.pointerId);
    if (pointers.size === 0) { mode = null; drag = null; panLast = null; pinch = null; setCursor(spaceDown ? 'grab' : 'default'); }
    else if (pointers.size === 1) { mode = 'pan'; panLast = [...pointers.values()][0]; drag = { moved: 99, button: 0 }; pinch = null; }
  }

  function onWheel(e) {
    e.preventDefault();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    vp.zoomAt(p.x, p.y, Math.exp(clamp(-dy, -300, 300) * 0.0015));
    opts.onView?.();
  }

  function onKey(e) {
    if (e.target !== canvas || e.ctrlKey || e.metaKey) return;
    const big = e.shiftKey;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let handled = true;
    if (e.key === ' ') { spaceDown = true; setCursor('grab'); }
    else if (arrows[e.key]) opts.nudge?.(arrows[e.key][0], arrows[e.key][1], big);
    else if (e.key === '+' || e.key === '=') { vp.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2); opts.onView?.(); }
    else if (e.key === '-' || e.key === '_') { vp.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2); opts.onView?.(); }
    else if (e.key === '0') opts.fit?.();
    else if (e.key === ']' || e.key === '.') opts.cycle?.(1);
    else if (e.key === '[' || e.key === ',') opts.cycle?.(-1);
    else if (e.key === 'Escape') opts.escape?.();
    else handled = false;
    if (handled) e.preventDefault();
  }
  function onKeyUp(e) { if (e.key === ' ') { spaceDown = false; setCursor('default'); } }

  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); return () => t.removeEventListener(ev, fn, o); };
  const offs = [
    on(canvas, 'pointerdown', onDown), on(canvas, 'pointermove', onMove),
    on(canvas, 'pointerup', onUp), on(canvas, 'pointercancel', onUp),
    on(canvas, 'wheel', onWheel, { passive: false }),
    on(canvas, 'keydown', onKey), on(canvas, 'keyup', onKeyUp),
    on(canvas, 'blur', () => { spaceDown = false; }),
    on(canvas, 'contextmenu', (e) => e.preventDefault()),
  ];
  return () => offs.forEach((f) => f());
}
