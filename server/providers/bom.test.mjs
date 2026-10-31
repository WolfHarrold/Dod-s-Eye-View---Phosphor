import test from 'node:test';
import assert from 'node:assert/strict';
import { bomProxy } from './bom.js';
import { BOM_STATIONS } from '../../src/layers/bom/model.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function call(plugin, url) {
  let handler;
  plugin.configureServer({ middlewares: { use: (_, fn) => (handler = fn) } });
  return new Promise((resolve) => {
    const res = {
      destroyed: false,
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body });
      },
    };
    handler({ method: 'GET', url, socket: { remoteAddress: 'test' } }, res);
  });
}

const observation = (stamp) => ({
  observations: {
    data: [
      { name: 'X', lat: -38.2, lon: 146.5, aifstime_utc: stamp, air_temp: 12 },
    ],
  },
});

test('observations are fetched per station with a browser user agent', async () => {
  const seen = [];
  const plugin = bomProxy({
    fetchImpl: async (url, init) => {
      seen.push({ url, ua: init.headers['User-Agent'] });
      return new Response(JSON.stringify(observation('20261031053000')));
    },
  });
  const { status, body } = await call(plugin, '/observations');
  assert.equal(status, 200);
  const value = JSON.parse(body);
  assert.equal(value.stations.length, BOM_STATIONS.length);
  assert.ok(seen.every(({ ua }) => /Mozilla/.test(ua)));
  assert.ok(
    seen.some(
      ({ url }) =>
        url === 'https://www.bom.gov.au/fwo/IDV60801/IDV60801.94891.json',
    ),
  );
});

test('a failed origin falls back to the next one', async () => {
  const plugin = bomProxy({
    fetchImpl: async (url) =>
      url.startsWith('https://www.')
        ? new Response('no', { status: 403 })
        : new Response(
            'x "/radar/IDR683.T.202610310540.png" "/radar/IDR023.T.202610310535.png"',
          ),
  });
  const { status, body } = await call(plugin, '/radar');
  assert.equal(status, 200);
  const value = JSON.parse(body);
  assert.deepEqual(
    value.radars.map((r) => r.frames.map((f) => f.name)),
    [['IDR683.T.202610310540.png'], ['IDR023.T.202610310535.png']],
  );
});

test('radar images are validated by name and by PNG signature', async () => {
  const requested = [];
  const plugin = bomProxy({
    fetchImpl: async (url) => {
      requested.push(url);
      return url.endsWith('0540.png')
        ? new Response(PNG)
        : new Response('<html>');
    },
  });
  const ok = await call(plugin, '/radar/IDR683.T.202610310540.png');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'image/png');
  const bad = await call(plugin, '/radar/..%2Fsecret');
  assert.equal(bad.status, 400);
  const notPng = await call(plugin, '/radar/IDR683.T.202610310545.png');
  assert.equal(notPng.status, 502);
  assert.ok(requested.every((url) => /bom\.gov\.au\/radar\/IDR683/.test(url)));
});

test('an outage answers 502 and a later outage serves the last good copy', async () => {
  let up = true;
  let clock = 0;
  const plugin = bomProxy({
    now: () => clock,
    fetchImpl: async () => {
      if (!up) throw new Error('down');
      return new Response(JSON.stringify(observation('20261031053000')));
    },
  });
  assert.equal((await call(plugin, '/observations')).status, 200);
  up = false;
  clock = 60 * 60_000;
  const stale = await call(plugin, '/observations');
  assert.equal(stale.status, 200);
  assert.equal(JSON.parse(stale.body).stale, true);
  const cold = bomProxy({
    fetchImpl: async () => {
      throw new Error('down');
    },
  });
  assert.equal((await call(cold, '/observations')).status, 502);
});
