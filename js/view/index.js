// View entry point.
//
// mountViews({ planCanvas, sideCanvas, store }) -> { plan, side, destroy() }
//
// DOM / CSS contract (css/style.css), matching the current index.html:
//   <main id="workspace">
//     <section class="pane"><h2>Plan</h2><canvas id="plan-canvas" tabindex="0" aria-label="..."></canvas></section>
//     <section class="pane"><h2>Side</h2><canvas id="side-canvas" tabindex="0" aria-label="..."></canvas></section>
//     <aside id="results"><h2>...</h2><dl id="readout">...</dl></aside>
//   </main>
// The CSS sizes each canvas to fill its .pane (flex column: heading + canvas), so the views must NOT set
// canvas width/height attributes; they track the CSS size with a ResizeObserver and handle devicePixelRatio.
// Optional shared classes: .panel (card style for #results or any side panel), .status.pass/.marginal/.fail,
// .chip. Views read colours from CSS custom properties (--paper, --ink, --grid, --pass, --marginal, --fail...).
//
// Views subscribe to the store themselves; they never mutate the scene, only call store.update / store.select.
// Selection ids are tx.id, rx.id and reflector.id.
import { createPlanView } from './plan.js';
import { createSideView } from './side.js';

export function mountViews({ planCanvas, sideCanvas, store }) {
  const plan = createPlanView(planCanvas, store);
  const side = createSideView(sideCanvas, store);
  return { plan, side, destroy() { plan.destroy(); side.destroy(); } };
}
export { createPlanView, createSideView };
