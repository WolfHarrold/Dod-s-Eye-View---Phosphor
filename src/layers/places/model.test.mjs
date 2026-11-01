import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFoiFeatures,
  normalizeGooglePlaces,
  normalizeHeritagePlaces,
  normalizeParkFeatures,
  normalizeRapNames,
  parsePlacesBbox,
  placePriority,
  snapPlacesBbox,
  validatePlacesSnapshot,
} from './model.js';

test('a places window must be finite, ordered, small and in Victoria', () => {
  assert.deepEqual(parsePlacesBbox('146.2,-38.4,146.8,-38.0'), {
    west: 146.2,
    south: -38.4,
    east: 146.8,
    north: -38.0,
  });
  assert.equal(parsePlacesBbox('146.8,-38.4,146.2,-38.0'), null);
  assert.equal(parsePlacesBbox('144,-38.4,147,-38.0'), null);
  assert.equal(parsePlacesBbox('151,-34,151.5,-33.5'), null);
  assert.equal(parsePlacesBbox('146.2,,146.8,-38.0'), null);
  assert.equal(parsePlacesBbox(undefined), null);
});

test('windows snap outwards to a quarter-degree grid', () => {
  assert.deepEqual(
    snapPlacesBbox({ west: 146.3, south: -38.4, east: 146.6, north: -38.1 }),
    { west: 146.25, south: -38.5, east: 146.75, north: -38 },
  );
});

test('Vicmap features keep only mapped categories with a name and point', () => {
  const places = normalizeFoiFeatures({
    features: [
      {
        geometry: { coordinates: [146.53, -38.24] },
        properties: {
          pfi: 1,
          name_label: 'Morwell Lookout',
          feature_type: 'landmark',
          feature_subtype: 'lookout',
        },
      },
      {
        geometry: { coordinates: [146.5, -38.2] },
        properties: { pfi: 2, name: 'Depot', feature_type: 'storage facility' },
      },
      {
        geometry: { coordinates: [] },
        properties: {
          pfi: 3,
          name: 'Nowhere',
          feature_type: 'landmark',
          feature_subtype: 'lookout',
        },
      },
    ],
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].id, 'foi:1');
  assert.equal(places[0].category, 'landmark');
  assert.equal(places[0].name, 'Morwell Lookout');
});

test('heritage places skip the archaeological inventory and title-case names', () => {
  const places = normalizeHeritagePlaces({
    _embedded: {
      places: [
        {
          id: 101,
          name: 'YALLOURN POWER STATION',
          heritage_authority_brief: 'VHR',
          heritage_authority_name: 'Victorian Heritage Register',
          latlon: '-38.18, 146.35',
          url: 'https://evil.example/x',
        },
        {
          id: 102,
          name: 'ARTEFACT SCATTER',
          heritage_authority_brief: 'VHI',
          latlon: '-38.2,146.4',
        },
      ],
    },
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Yallourn Power Station');
  assert.equal(places[0].lat, -38.18);
  assert.equal(
    places[0].url,
    'https://vhd.heritagecouncil.vic.gov.au/places/101',
  );
});

test('parks take one label per name at their largest part', () => {
  const square = (x, y, d) => [
    [
      [x, y],
      [x + d, y],
      [x + d, y + d],
      [x, y + d],
      [x, y],
    ],
  ];
  const places = normalizeParkFeatures({
    features: [
      {
        properties: { NAME: 'MORWELL NATIONAL PARK' },
        geometry: { type: 'Polygon', coordinates: square(146.4, -38.4, 0.01) },
      },
      {
        properties: { NAME: 'MORWELL NATIONAL PARK' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [square(146.5, -38.4, 0.1)],
        },
      },
    ],
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Morwell National Park');
  assert.equal(places[0].category, 'outdoors');
  assert.ok(Math.abs(places[0].lon - 146.55) < 1e-9);
});

test('RAP boundaries yield names only, never their contact fields', () => {
  const names = normalizeRapNames({
    features: [
      {
        properties: {
          NAME: 'Gunaikurnai Land and Waters Aboriginal Corporation',
          EMAIL: 'someone@example.org',
          CONTACT: '0400 000 000',
        },
      },
      {
        properties: {
          NAME: 'Gunaikurnai Land and Waters Aboriginal Corporation',
        },
      },
    ],
  });
  assert.deepEqual(names, [
    'Gunaikurnai Land and Waters Aboriginal Corporation',
  ]);
});

test('Google results need 4 stars and enough reviews', () => {
  const row = (id, rating, userRatingCount) => ({
    id,
    displayName: { text: id },
    location: { latitude: -38.2, longitude: 146.5 },
    rating,
    userRatingCount,
    googleMapsUri: 'https://maps.google.com/?cid=1',
  });
  const places = normalizeGooglePlaces({
    places: [row('good', 4.6, 300), row('low', 3.9, 900), row('few', 4.9, 3)],
  });
  assert.deepEqual(
    places.map((place) => place.name),
    ['good'],
  );
  assert.equal(places[0].category, 'top-rated');
  assert.equal(places[0].url, 'https://maps.google.com/?cid=1');
});

test('snapshots drop unknown categories and keep Country names', () => {
  const snapshot = validatePlacesSnapshot({
    schemaVersion: 1,
    places: [
      { id: 'a', name: 'A', category: 'heritage', lat: -38, lon: 146 },
      { id: 'b', name: 'B', category: 'secret', lat: -38, lon: 146 },
    ],
    country: ['Gunaikurnai Land and Waters Aboriginal Corporation', 5],
    errors: ['parks'],
    googleConfigured: false,
  });
  assert.equal(snapshot.places.length, 1);
  assert.deepEqual(snapshot.country, [
    'Gunaikurnai Land and Waters Aboriginal Corporation',
  ]);
  assert.deepEqual(snapshot.errors, ['parks']);
  assert.equal(snapshot.googleConfigured, false);
  assert.equal(validatePlacesSnapshot({ schemaVersion: 2, places: [] }), null);
});

test('Country and heritage outrank other places', () => {
  assert.ok(
    placePriority({ category: 'country' }) >
      placePriority({ category: 'top-rated', reviews: 50_000 }),
  );
  assert.ok(
    placePriority({ category: 'heritage' }) >
      placePriority({ category: 'landmark' }),
  );
});
