import test from 'node:test';
import assert from 'node:assert/strict';
import { START_TARGET, START_VIEW, aimAt, flyToStartView } from '../camera.js';

test('teardown before the initial camera delay prevents a late flight', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let flights = 0;
  let cancelled = 0;
  const stop = flyToStartView({
    isDestroyed: () => false,
    camera: {
      setView() {},
      flyTo() {
        flights++;
      },
      cancelFlight() {
        cancelled++;
      },
    },
  });
  stop();
  t.mock.timers.tick(1000);
  assert.equal(flights, 0);
  assert.equal(cancelled, 1);
});

test('the start view looks across the bay at the Melbourne CBD', () => {
  assert.deepEqual(START_TARGET, { lat: -37.8136, lon: 144.9631 });
  assert.ok(
    START_VIEW.lat < START_TARGET.lat,
    'south of the city, over the bay',
  );
  assert.ok(
    START_VIEW.heading > 0 && START_VIEW.heading < 90,
    'facing north-east',
  );
  assert.ok(
    START_VIEW.pitch < -25 && START_VIEW.pitch > -45,
    'high-ish, looking down',
  );
  const north = aimAt({ lat: 0, lon: 0, alt: 0 }, { lat: 1, lon: 0 });
  assert.equal(Math.round(north.heading), 0);
  assert.equal(north.pitch, -0);
});
