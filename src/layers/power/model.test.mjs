import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_STATIONS,
  nemDateParam,
  normalizePowerResponse,
  normalizePriceResponse,
  powerLoadBand,
  powerTrendMw,
  validatePowerSnapshot,
} from './model.js';

const result = (unit, rows) => ({
  name: `power_${unit}`,
  columns: { unit_code: unit },
  data: rows,
});

test('stations carry their units and summed capacity', () => {
  const loyYangA = POWER_STATIONS.find((s) => s.code === 'LOYYANGA');
  assert.equal(loyYangA.units.length, 4);
  assert.equal(loyYangA.capacityMw, 2295);
});

test('date_start is NEM time with no zone', () => {
  assert.equal(
    nemDateParam(Date.parse('2026-10-31T07:00:00Z')),
    '2026-10-31T17:00:00',
  );
});

test('unit series sum per station at the newest shared interval', () => {
  const stations = normalizePowerResponse({
    data: [
      {
        metric: 'power',
        results: [
          result('LOYYB1', [
            ['2026-10-31T17:15:00+10:00', 560],
            ['2026-10-31T17:20:00+10:00', 566.6],
          ]),
          result('LOYYB2', [
            ['2026-10-31T17:15:00+10:00', 570],
            ['2026-10-31T17:20:00+10:00', 572.3],
          ]),
          result('YWPS1', [['2026-10-31T17:20:00+10:00', 322.5]]),
          result('YWPS2', [['2026-10-31T17:20:00+10:00', 0.25]]),
          result('NOTOURS', [['2026-10-31T17:20:00+10:00', 99]]),
        ],
      },
    ],
  });
  const loyYangB = stations.find((s) => s.code === 'LOYYB');
  assert.equal(loyYangB.mw, 1138.9);
  assert.equal(loyYangB.observedMs, Date.parse('2026-10-31T07:20:00Z'));
  assert.equal(loyYangB.history.length, 2);
  assert.equal(powerTrendMw(loyYangB), 9);
  const yallourn = stations.find((s) => s.code === 'YALLOURN');
  assert.equal(yallourn.units.find((u) => u.code === 'YWPS2').online, false);
  assert.equal(yallourn.units.find((u) => u.code === 'YWPS1').online, true);
  assert.equal(yallourn.units.find((u) => u.code === 'YWPS3').mw, null);
  const loyYangA = stations.find((s) => s.code === 'LOYYANGA');
  assert.equal(loyYangA.mw, null);
});

test('a lagging unit holds the station total back to its time', () => {
  const [, loyYangB] = normalizePowerResponse({
    data: [
      {
        metric: 'power',
        results: [
          result('LOYYB1', [
            ['2026-10-31T17:15:00+10:00', 500],
            ['2026-10-31T17:20:00+10:00', 500],
          ]),
          result('LOYYB2', [['2026-10-31T17:15:00+10:00', 400]]),
        ],
      },
    ],
  });
  assert.equal(loyYangB.mw, 900);
  assert.equal(loyYangB.observedMs, Date.parse('2026-10-31T07:15:00Z'));
});

test('a negative Victorian price keeps its sign', () => {
  assert.deepEqual(
    normalizePriceResponse({
      data: [
        {
          metric: 'price',
          results: [
            {
              columns: { region: 'VIC1' },
              data: [
                ['2026-10-31T17:15:00+10:00', -7.8],
                ['2026-10-31T17:20:00+10:00', -8],
              ],
            },
          ],
        },
      ],
    }),
    {
      region: 'VIC1',
      value: -8,
      observedMs: Date.parse('2026-10-31T07:20:00Z'),
    },
  );
  assert.equal(normalizePriceResponse({ data: [] }), null);
});

test('load bands follow share of capacity', () => {
  assert.equal(powerLoadBand(0).id, 'off');
  assert.equal(powerLoadBand(0.3).id, 'low');
  assert.equal(powerLoadBand(0.9).id, 'high');
});

test('snapshots without a key say so, and unknown stations are dropped', () => {
  assert.deepEqual(
    validatePowerSnapshot({ schemaVersion: 1, configured: false }),
    {
      configured: false,
      stations: [],
      price: null,
      stale: false,
    },
  );
  const snapshot = validatePowerSnapshot({
    schemaVersion: 1,
    configured: true,
    stations: [
      { code: 'LOYYB', mw: 1000, observedMs: 1, units: [], history: [] },
      { code: 'HAZELWOOD', mw: 1600 },
    ],
    price: { value: -8, observedMs: 1 },
  });
  assert.deepEqual(
    snapshot.stations.map((s) => s.code),
    ['LOYYB'],
  );
  assert.equal(snapshot.price.value, -8);
  assert.equal(validatePowerSnapshot({ schemaVersion: 2 }), null);
});
