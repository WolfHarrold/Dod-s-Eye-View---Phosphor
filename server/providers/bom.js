import {
  BOM_RADARS,
  BOM_STATIONS,
  extractBomFrames,
  normalizeBomObservation,
  parseBomFrameName,
} from '../../src/layers/bom/model.js';
import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  readResponseTextCapped,
  coalesceProxyRequest,
} from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

// Bureau of Meteorology public web products (keyless, non-commercial use).
// BoM turns away requests that carry no browser-like User-Agent.
const ORIGINS = ['https://www.bom.gov.au', 'https://reg.bom.gov.au'];
const HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (compatible; GodsEyeView/0.2; +https://github.com/WolfHarrold/Dod-s-Eye-View---Phosphor)',
  Accept: '*/*',
});
const MIB = 1024 * 1024;
const OBSERVATIONS_TTL_MS = 10 * 60_000;
const FRAMES_TTL_MS = 2 * 60_000;
const IMAGE_CACHE_LIMIT = 32;
const STATION_CONCURRENCY = 4;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Fixed-origin, bounded BoM radar and observation routes for dev and preview. */
export function bomProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  origins = ORIGINS,
} = {}) {
  const cache = new Map();
  const images = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 120,
    globalMax: 2400,
  });

  /** Try each BoM origin in turn; the first good answer wins. */
  async function upstream(path, read, timeoutMs) {
    let lastError = new Error('upstream_unavailable');
    for (const origin of origins) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetchImpl(`${origin}${path}`, {
          headers: HEADERS,
          signal,
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          lastError = new Error(`upstream_http_${response.status}`);
          continue;
        }
        return await read(response, signal);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function fetchStation(station) {
    try {
      const payload = await upstream(
        `/fwo/${station.product}/${station.product}.${station.wmo}.json`,
        (response, signal) => readResponseJsonCapped(response, 2 * MIB, signal),
        15_000,
      );
      return normalizeBomObservation(payload, station);
    } catch {
      return null;
    }
  }

  async function fetchObservations() {
    const results = [];
    for (let i = 0; i < BOM_STATIONS.length; i += STATION_CONCURRENCY) {
      const batch = BOM_STATIONS.slice(i, i + STATION_CONCURRENCY);
      results.push(...(await Promise.all(batch.map(fetchStation))));
    }
    const stations = results.filter(Boolean);
    // Every station failing is an outage, not an empty network.
    if (stations.length === 0) throw new Error('no_observations');
    return { schemaVersion: 1, fetchedAt: now(), stations };
  }

  async function fetchFrames() {
    const radars = await Promise.all(
      BOM_RADARS.map(async (radar) => {
        try {
          const html = await upstream(
            `/products/${radar.id}.loop.shtml`,
            (response, signal) =>
              readResponseTextCapped(response, 1 * MIB, signal),
            15_000,
          );
          return { id: radar.id, frames: extractBomFrames(html, radar.id) };
        } catch {
          return { id: radar.id, frames: [], error: 'unavailable' };
        }
      }),
    );
    if (radars.every((radar) => radar.frames.length === 0))
      throw new Error('no_radar_frames');
    return { schemaVersion: 1, fetchedAt: now(), radars };
  }

  async function fetchImage(name) {
    return upstream(
      `/radar/${name}`,
      async (response, signal) => {
        const bytes = await readResponseBytesCapped(response, 2 * MIB, signal);
        if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte))
          throw new Error('invalid_png');
        return bytes;
      },
      15_000,
    );
  }

  async function cached(key, ttl, load) {
    const previous = cache.get(key);
    if (previous && now() - previous.savedAt < ttl)
      return { value: previous.value, stale: false };
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, async () => {
        const value = await load();
        cache.set(key, { value, savedAt: now() });
        return value;
      });
      return { value: await promise, stale: false };
    } catch (error) {
      if (previous) return { value: previous.value, stale: true };
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value, stale = false) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...(stale ? { 'X-Data-Stale': 'true' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const path = (req.url || '/').split('?')[0];
    try {
      if (path === '/observations') {
        const { value, stale } = await cached(
          'observations',
          OBSERVATIONS_TTL_MS,
          fetchObservations,
        );
        return json(200, stale ? { ...value, stale: true } : value, stale);
      }
      if (path === '/radar') {
        const { value, stale } = await cached(
          'radar',
          FRAMES_TTL_MS,
          fetchFrames,
        );
        return json(200, stale ? { ...value, stale: true } : value, stale);
      }
      if (path.startsWith('/radar/')) {
        const name = path.slice('/radar/'.length);
        if (!parseBomFrameName(name))
          return json(400, { error: 'invalid_frame' });
        let bytes = images.get(name);
        if (!bytes) {
          const { promise } = coalesceProxyRequest(
            inFlight,
            `image:${name}`,
            () => fetchImage(name),
          );
          bytes = await promise;
          images.set(name, bytes);
          while (images.size > IMAGE_CACHE_LIMIT)
            images.delete(images.keys().next().value);
        }
        if (res.destroyed) return;
        res.writeHead(200, {
          'Content-Type': 'image/png',
          // A frame name carries its own time: the image never changes.
          'Cache-Control': 'public, max-age=86400, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(bytes);
      }
      return json(404, { error: 'unknown_route' });
    } catch {
      return json(502, { error: 'bom_unavailable' });
    }
  }

  return {
    name: 'bom',
    configureServer({ middlewares }) {
      middlewares.use('/api/bom', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/bom', handler);
    },
  };
}
