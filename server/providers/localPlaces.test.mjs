import test from 'node:test';
import assert from 'node:assert/strict';
import { localPlacesProxy } from './localPlaces.js';

function call(plugin, url) {
  let handler;
  plugin.configureServer({ middlewares: { use: (_, fn) => (handler = fn) } });
  return new Promise((resolve) => {
    const res = {
      destroyed: false,
      status: 0,
      writeHead(status) {
        this.status = status;
      },
      setHeader() {},
      end(body) {
        resolve({ status: this.status || this.statusCode, body });
      },
    };
    handler(
      {
        method: 'GET',
        url,
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );
  });
}

const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });

const routes = {
  arcgis: () =>
    json({
      features: [
        {
          geometry: { coordinates: [146.53, -38.24] },
          properties: {
            pfi: 7,
            name: 'Lookout',
            feature_type: 'landmark',
            feature_subtype: 'lookout',
          },
        },
      ],
    }),
  heritagecouncil: () =>
    json({
      _embedded: {
        places: [
          {
            id: 1,
            name: 'OLD HALL',
            heritage_authority_brief: 'HO',
            latlon: '-38.2,146.5',
          },
        ],
      },
    }),
  'typeName=open-data-platform%3Aparkres': () =>
    new Response('', { status: 504 }),
  'typeName=open-data-platform%3Arap': () =>
    json({
      features: [
        {
          properties: {
            NAME: 'Gunaikurnai Land and Waters Aboriginal Corporation',
          },
        },
      ],
    }),
  googleapis: () =>
    json({
      places: [
        {
          id: 'g1',
          displayName: { text: 'Gallery' },
          location: { latitude: -38.2, longitude: 146.5 },
          rating: 4.7,
          userRatingCount: 400,
        },
      ],
    }),
};

function fakeFetch(seen = []) {
  return async (url) => {
    seen.push(String(url));
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return key ? routes[key]() : new Response('', { status: 404 });
  };
}

test('a window merges every source and reports the ones that failed', async () => {
  const plugin = localPlacesProxy({
    fetchImpl: fakeFetch(),
    resolveGoogleKey: () => 'key',
  });
  const res = await call(plugin, '/?bbox=146.3,-38.4,146.7,-38.1');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.bbox, {
    west: 146.25,
    south: -38.5,
    east: 146.75,
    north: -38,
  });
  const categories = body.places.map((place) => place.category).sort();
  // Durt-Yowan (Latrobe River) lies inside this window.
  assert.deepEqual(categories, [
    'country',
    'heritage',
    'landmark',
    'top-rated',
  ]);
  assert.deepEqual(body.errors, ['parks']);
  assert.deepEqual(body.country, [
    'Gunaikurnai Land and Waters Aboriginal Corporation',
  ]);
  assert.equal(body.googleConfigured, true);
});

test('Google is not called without a key, and open data is cached', async () => {
  const seen = [];
  const plugin = localPlacesProxy({
    fetchImpl: fakeFetch(seen),
    resolveGoogleKey: () => '',
  });
  const first = JSON.parse(
    (await call(plugin, '/?bbox=146.3,-38.4,146.7,-38.1')).body,
  );
  assert.equal(first.googleConfigured, false);
  assert.ok(!seen.some((url) => url.includes('googleapis')));
  const before = seen.length;
  await call(plugin, '/?bbox=146.31,-38.39,146.69,-38.11');
  // Only the failed parks request is retried; the rest come from the cache.
  assert.equal(seen.length - before, 1);
});

test('bad windows are refused before any upstream call', async () => {
  const seen = [];
  const plugin = localPlacesProxy({ fetchImpl: fakeFetch(seen) });
  assert.equal((await call(plugin, '/?bbox=1,2,3')).status, 400);
  assert.equal((await call(plugin, '/?bbox=151,-34,151.5,-33.5')).status, 400);
  assert.equal(seen.length, 0);
});

test('every source failing is an outage', async () => {
  const plugin = localPlacesProxy({
    fetchImpl: async () => new Response('', { status: 503 }),
    resolveGoogleKey: () => '',
  });
  const res = await call(plugin, '/?bbox=146.3,-38.4,146.7,-38.1');
  assert.equal(res.status, 502);
});
