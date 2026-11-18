// The tilt handle must follow the pointer: the drawn boresight tip (in-slice projection) points at the mouse for any aim, not only when the antenna is aimed along the slice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltForPointer } from '../js/view/tiltGauge.js';
import { antennaFrame } from '../js/model/rf.js';
import { withPitch } from '../js/ui/antennaFields.js';

const DEG = Math.PI / 180;
// drawn tip direction, degrees from straight up, + toward +s (the same projection drawTiltGauge uses)
function tipAngle(ant, tilt, u) {
  const { b } = antennaFrame(withPitch(ant, tilt));
  return Math.atan2(b[0] * u.x + b[1] * u.y, b[2]) / DEG;
}
const pointerAt = (fromUpDeg) => [Math.sin(fromUpDeg * DEG) * 100, Math.cos(fromUpDeg * DEG) * 100]; // dx, dyUp

test('tip follows the pointer when the antenna is aimed along the slice', () => {
  const u = { x: 1, y: 0 }, ant = { type: 'dipole', orientation: { az: 90, el: 0 } };
  for (const want of [5, 20, 45, 70, 90 - 1]) {
    const [dx, dy] = pointerAt(90 - want); // want degrees above horizontal toward +s
    const t = tiltForPointer(ant, u, dx, dy, 1);
    assert.ok(Math.abs((90 - tipAngle(ant, t, u)) - want) <= 1, `want ${want} got tilt ${t}`);
  }
});

test('tip follows the pointer for a vertical whip whose tilt plane is across the slice (old code was 10 degrees off at 10)', () => {
  const u = { x: 0, y: 1 }, ant = { type: 'dipole', orientation: { az: 45, el: 90 } };
  for (const fromUp of [-80, -45, -10, 10, 30, 60, 80]) {
    const [dx, dy] = pointerAt(fromUp);
    const t = tiltForPointer(ant, u, dx, dy, 1);
    assert.ok(Math.abs(tipAngle(ant, t, u) - fromUp) <= 1.2, `pointer ${fromUp} got tip ${tipAngle(ant, t, u)} (tilt ${t})`);
  }
});

test('mirrors onto the boresight side, snaps to the step, null at the centre', () => {
  const u = { x: 1, y: 0 }, ant = { type: 'dipole', orientation: { az: 90, el: 0 } };
  assert.equal(tiltForPointer(ant, u, -100, 100 * Math.tan(30 * DEG), 5), 30); // pointer behind: mirrored, 30 deg up
  assert.equal(tiltForPointer(ant, u, 100, 100 * Math.tan(22 * DEG), 5), 20);
  assert.equal(tiltForPointer(ant, u, 0, 0, 1), null);
});

test('a directional antenna: the drag solves its elevation, and the tip follows the pointer', () => {
  const u = { x: 1, y: 0 }, ant = { type: 'paddle', orientation: { az: 90, el: 0 } };
  for (const want of [5, 20, 45, 70]) {
    const [dx, dy] = pointerAt(90 - want);
    const t = tiltForPointer(ant, u, dx, dy, 1);
    assert.ok(Math.abs(t - want) <= 1, `want elevation ${want} got ${t}`);
    assert.ok(Math.abs((90 - tipAngle(ant, t, u)) - want) <= 1);
  }
});
