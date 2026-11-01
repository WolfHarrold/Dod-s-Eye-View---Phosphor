import test from 'node:test';
import assert from 'node:assert/strict';
import { openElectricityProxy } from './openElectricity.js';

function call(plugin, url = '/') {
  let handler;
  plugin.configureServer({ middlewares: { use: (_, fn) => (handler = fn) } });
  return new Promise((resolve) => {
    const res = {
      destroyed: false,
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        resolve({ status: this.status, body: JSON.parse(body) });
      },
    };
    handler({ method: 'GET', url, socket: { remoteAddress: 'test' } }, res);
  });
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const NOW = Date.parse('2026-10-31T07:29:00Z');
const power = {
  data: [
    {
      metric: 'power',
      results: [
        {
          columns: { unit_code: 'LOYYB1' },
          data: [['2026-10-31T17:20:00+10:00', 566.6]],
        },
      ],
    },
  ],
};
const price = {
  data: [
    {
      metric: 'price',
      results: [
        {
          columns: { region: 'VIC1' },
          data: [['2026-10-31T17:20:00+10:00', -8]],
        },
      ],
    },
  ],
};

test('without a key the route says it is not configured and calls nothing', async () => {
  let calls = 0;
  const plugin = openElectricityProxy({
    fetchImpl: async () => (calls++, json({})),
    resolveKey: () => '',
  });
  const res = await call(plugin);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { schemaVersion: 1, configured: false });
  assert.equal(calls, 0);
});

test('one cached call each for power and price, with the key as a bearer', async () => {
  const seen = [];
  let now = NOW;
  const plugin = openElectricityProxy({
    now: () => now,
    resolveKey: () => 'oe_fixture',
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), auth: init.headers.Authorization });
      return json(String(url).includes('/market/') ? price : power);
    },
  });
  const res = await call(plugin);
  assert.equal(res.status, 200);
  assert.equal(res.body.stale, false);
  assert.equal(res.body.stations.find((s) => s.code === 'LOYYB').mw, 566.6);
  assert.equal(res.body.price.value, -8);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.auth === 'Bearer oe_fixture'));
  const dataUrl = new URL(seen.find((s) => s.url.includes('/data/')).url);
  assert.deepEqual(dataUrl.searchParams.getAll('facility_code'), [
    'LOYYANGA',
    'LOYYB',
    'YALLOURN',
  ]);
  assert.equal(dataUrl.searchParams.get('date_start'), '2026-10-31T16:19:00');
  now += 60_000;
  await call(plugin);
  assert.equal(seen.length, 2);
});

test('a rejected key is reported as such', async () => {
  const plugin = openElectricityProxy({
    now: () => NOW,
    resolveKey: () => 'oe_bad',
    fetchImpl: async () => json({ error: 'unauthorized' }, 401),
  });
  const res = await call(plugin);
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'key_rejected');
});

test('old data is marked stale', async () => {
  const plugin = openElectricityProxy({
    now: () => NOW + 60 * 60_000,
    resolveKey: () => 'oe_fixture',
    fetchImpl: async (url) =>
      json(String(url).includes('/market/') ? price : power),
  });
  assert.equal((await call(plugin)).body.stale, true);
});
