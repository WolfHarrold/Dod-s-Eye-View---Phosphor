import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOM_RADAR_FRAME_LIMIT,
  BOM_STATIONS,
  bomRadarBounds,
  bomTemperatureColor,
  bomCandidateTimes,
  bomFrameName,
  normalizeBomObservation,
  parseBomFrameName,
  validateBomRadar,
} from './model.js';

const LATROBE = BOM_STATIONS[0];

const row = (stamp, temp, extra = {}) => ({
  name: 'Latrobe Valley',
  lat: -38.2,
  lon: 146.5,
  aifstime_utc: stamp,
  air_temp: temp,
  apparent_t: temp - 2,
  rel_hum: 60,
  wind_dir: 'SW',
  wind_spd_kmh: 20,
  gust_kmh: 31,
  rain_trace: '0.4',
  press_msl: 1012.3,
  ...extra,
});

test('the Latrobe Valley station leads the list', () => {
  assert.deepEqual(
    { product: LATROBE.product, wmo: LATROBE.wmo },
    { product: 'IDV60801', wmo: '94891' },
  );
  assert.equal(
    new Set(BOM_STATIONS.map((s) => `${s.product}.${s.wmo}`)).size,
    BOM_STATIONS.length,
  );
});

test('an observation normalizes its latest row and the hour trend', () => {
  const reading = normalizeBomObservation(
    {
      observations: {
        data: [
          row('20261031053000', 18.4),
          row('20261031050000', 18.0),
          row('20261031043000', 17.1),
        ],
      },
    },
    LATROBE,
  );
  assert.equal(reading.id, 'IDV60801.94891');
  assert.equal(reading.tempC, 18.4);
  assert.equal(reading.apparentC, 16.4);
  assert.equal(reading.rainMm, 0.4);
  assert.equal(reading.windDir, 'SW');
  assert.equal(reading.trendC, 1.3);
  assert.equal(reading.observedMs, Date.UTC(2026, 9, 31, 5, 30));
});

test('missing values become null and unusable payloads are rejected', () => {
  const reading = normalizeBomObservation(
    {
      observations: {
        data: [
          row('20261031053000', null, { rain_trace: '-', wind_dir: '<b>' }),
        ],
      },
    },
    LATROBE,
  );
  assert.equal(reading.tempC, null);
  assert.equal(reading.rainMm, null);
  assert.equal(reading.windDir, null);
  assert.equal(reading.trendC, null);
  assert.equal(normalizeBomObservation({}, LATROBE), null);
  assert.equal(
    normalizeBomObservation(
      { observations: { data: [row('not-a-time', 10)] } },
      LATROBE,
    ),
    null,
  );
});

test('only known radars and real UTC stamps are accepted as frame names', () => {
  assert.deepEqual(parseBomFrameName('IDR683.T.202610310540.png'), {
    radar: 'IDR683',
    name: 'IDR683.T.202610310540.png',
    time: '2026-10-31T05:40:00.000Z',
  });
  assert.equal(parseBomFrameName('IDR713.T.202610310540.png'), null);
  assert.equal(parseBomFrameName('IDR683.T.202613310540.png'), null);
  assert.equal(parseBomFrameName('../IDR683.T.202610310540.png'), null);
  assert.equal(parseBomFrameName('IDR683.T.202610310540.png?x=1'), null);
});

test('scan times step back five minutes from the newest on the radar minute', () => {
  const now = Date.UTC(2026, 9, 31, 6, 41, 30);
  const names = bomCandidateTimes(now, 4, 3).map((ms) =>
    bomFrameName('IDR683', ms),
  );
  assert.deepEqual(names, [
    'IDR683.T.202610310639.png',
    'IDR683.T.202610310634.png',
    'IDR683.T.202610310629.png',
  ]);
  assert.ok(names.every((name) => parseBomFrameName(name)));
  assert.equal(
    bomFrameName('IDR023', bomCandidateTimes(now, 0, 1)[0]),
    'IDR023.T.202610310640.png',
  );
  assert.ok(BOM_RADAR_FRAME_LIMIT <= 8);
});

test('radar bounds are a square of the radar range around the site', () => {
  const bounds = bomRadarBounds({ lat: -37.89, lon: 147.56, rangeKm: 128 });
  assert.ok(Math.abs(bounds.north - bounds.south - 2.2997) < 0.001);
  assert.ok(bounds.east - bounds.west > bounds.north - bounds.south);
  const snapshot = validateBomRadar({
    schemaVersion: 1,
    radars: [
      {
        id: 'IDR683',
        frames: [{ name: 'IDR683.T.202610310540.png' }, { name: 'evil.png' }],
      },
      { id: 'IDR999', frames: [] },
    ],
  });
  assert.equal(snapshot.radars.length, 1);
  assert.equal(snapshot.radars[0].frames.length, 1);
});

test('temperature colours follow the bands', () => {
  assert.equal(bomTemperatureColor(2), '#4cc9f0');
  assert.equal(bomTemperatureColor(18), '#ffd43b');
  assert.equal(bomTemperatureColor(40), '#c1121f');
  assert.equal(bomTemperatureColor(null), '#6b7785');
});
