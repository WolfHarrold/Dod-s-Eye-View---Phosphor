import {
  GUNAIKURNAI_PLACES,
  foiWhereClause,
  normalizeFoiFeatures,
  normalizeGooglePlaces,
  normalizeHeritagePlaces,
  normalizeParkFeatures,
  normalizeRapNames,
  parsePlacesBbox,
  snapPlacesBbox,
} from '../../src/layers/places/model.js';
import { readResponseJsonCapped, coalesceProxyRequest } from './common/http.js';
import {
  makeRateLimiter,
  makeCostRateLimiter,
  clientKey,
} from './common/rate-limit.js';
import { admitSameSite } from './common/same-site.js';
import { googleServerApiKey } from './places/google-key.js';

// Vicmap Features of Interest, published by the State as an ArcGIS service.
const FOI_URL =
  'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_Features_of_Interest/FeatureServer/1/query';
// Victorian Heritage Database (Heritage Council), keyless and read-only.
const VHD_URL = 'https://api.heritagecouncil.vic.gov.au/v1/places';
// DataVic's GeoServer: parks and Registered Aboriginal Party boundaries.
const WFS_URL = 'https://opendata.maps.vic.gov.au/geoserver/wfs';
const GOOGLE_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';

const MIB = 1024 * 1024;
const OPEN_DATA_TTL_MS = 6 * 60 * 60_000;
/** Google results are held briefly, never stored: only place IDs may be kept. */
const GOOGLE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 64;

/** Fixed-origin, bounded Victorian places routes for dev and preview. */
export function localPlacesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  resolveGoogleKey = googleServerApiKey,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let googleLimiter;

  async function getJson(url, init = {}, timeoutMs = 20_000) {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url, {
      ...init,
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`upstream_http_${response.status}`);
    }
    return readResponseJsonCapped(response, 8 * MIB, signal);
  }

  const envelope = ({ west, south, east, north }) =>
    `${west},${south},${east},${north}`;

  const sources = {
    async landmarks(box) {
      const url = new URL(FOI_URL);
      url.search = new URLSearchParams({
        where: foiWhereClause(),
        geometry: envelope(box),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields:
          'pfi,feature_id,name,name_label,feature_type,feature_subtype',
        outSR: '4326',
        resultRecordCount: '500',
        f: 'geojson',
      }).toString();
      return normalizeFoiFeatures(await getJson(url.href));
    },
    async heritage(box) {
      const url = new URL(VHD_URL);
      url.search = new URLSearchParams({
        geo: `${box.south},${box.west},${box.north},${box.east}`,
        rpp: '500',
      }).toString();
      return normalizeHeritagePlaces(
        await getJson(url.href, {
          headers: { Accept: 'application/hal+json' },
        }),
      );
    },
    async parks(box) {
      return normalizeParkFeatures(
        await getWfs('open-data-platform:parkres', box),
      );
    },
    async country(box) {
      return normalizeRapNames(
        await getWfs('open-data-platform:rap', box, 'NAME'),
      );
    },
    async topRated(box, apiKey) {
      const data = await getJson(
        GOOGLE_TEXT_SEARCH,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.location',
              'places.rating',
              'places.userRatingCount',
              'places.googleMapsUri',
              'places.primaryTypeDisplayName',
            ].join(','),
          },
          body: JSON.stringify({
            textQuery: 'tourist attractions',
            minRating: 4,
            maxResultCount: 20,
            locationRestriction: {
              rectangle: {
                low: { latitude: box.south, longitude: box.west },
                high: { latitude: box.north, longitude: box.east },
              },
            },
          }),
        },
        15_000,
      );
      return normalizeGooglePlaces(data);
    },
  };

  // WFS 1.0.0 takes the bbox as lon,lat whatever the CRS.
  async function getWfs(typeName, box, propertyName) {
    const url = new URL(WFS_URL);
    url.search = new URLSearchParams({
      service: 'WFS',
      version: '1.0.0',
      request: 'GetFeature',
      typeName,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      bbox: envelope(box),
      maxFeatures: '300',
      ...(propertyName ? { propertyName } : {}),
    }).toString();
    return getJson(url.href, {}, 25_000);
  }

  async function cached(key, ttl, load) {
    const previous = cache.get(key);
    if (previous && now() - previous.savedAt < ttl) return previous.value;
    const { promise } = coalesceProxyRequest(inFlight, key, async () => {
      const value = await load();
      cache.delete(key);
      cache.set(key, { value, savedAt: now() });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return value;
    });
    try {
      return await promise;
    } catch (error) {
      // A failed refresh keeps showing what this window last had.
      if (previous) return previous.value;
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (admitSameSite(req, res)) return;
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/' && url.pathname !== '')
      return json(404, { error: 'unknown_route' });
    const parsed = parsePlacesBbox(url.searchParams.get('bbox'));
    if (!parsed) return json(400, { error: 'invalid_bbox' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const box = snapPlacesBbox(parsed);
    const key = envelope(box);

    const apiKey = String(resolveGoogleKey() ?? '').trim();
    googleLimiter ??= makeCostRateLimiter(
      process.env.GEV_RATELIMIT_GOOGLE_PER_MIN,
      120,
    );
    const googleAllowed = !googleLimiter || googleLimiter(clientKey(req));

    const jobs = {
      landmarks: () =>
        cached(`landmarks:${key}`, OPEN_DATA_TTL_MS, () =>
          sources.landmarks(box),
        ),
      heritage: () =>
        cached(`heritage:${key}`, OPEN_DATA_TTL_MS, () =>
          sources.heritage(box),
        ),
      parks: () =>
        cached(`parks:${key}`, OPEN_DATA_TTL_MS, () => sources.parks(box)),
      country: () =>
        cached(`country:${key}`, OPEN_DATA_TTL_MS, () => sources.country(box)),
      ...(apiKey && googleAllowed
        ? {
            topRated: () =>
              cached(`google:${key}`, GOOGLE_TTL_MS, () =>
                sources.topRated(box, apiKey),
              ),
          }
        : {}),
    };
    const names = Object.keys(jobs);
    const results = await Promise.allSettled(names.map((name) => jobs[name]()));
    const places = [];
    const errors = [];
    let country = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') errors.push(names[i]);
      else if (names[i] === 'country') country = result.value;
      else places.push(...result.value);
    });
    if (errors.length === names.length)
      return json(502, { error: 'places_unavailable' });
    for (const place of GUNAIKURNAI_PLACES) {
      if (
        place.lat >= box.south &&
        place.lat <= box.north &&
        place.lon >= box.west &&
        place.lon <= box.east
      )
        places.push({
          id: `country:${place.id}`,
          category: 'country',
          name: place.name,
          kind: place.english,
          lat: place.lat,
          lon: place.lon,
          source: 'Gunaikurnai (public name)',
        });
    }
    json(200, {
      schemaVersion: 1,
      bbox: box,
      places,
      country,
      errors,
      googleConfigured: Boolean(apiKey),
    });
  }

  return {
    name: 'local-places',
    configureServer({ middlewares }) {
      middlewares.use('/api/local-places', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/local-places', handler);
    },
  };
}
