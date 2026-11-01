import {
  BOM_RADARS,
  BOM_RADAR_FRAME_LIMIT,
  BOM_STATIONS,
  bomCandidateTimes,
  bomFrameName,
  normalizeBomObservation,
  parseBomFrameName,
} from '../../src/layers/bom/model.js';
import {
  readResponseBytesCapped,
  readResponseJsonCapped,
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
/** Scan times probed per radar: 40 minutes, enough for a full loop. */
const FRAME_CANDIDATES = 8;
/** A scan not yet published is asked for again after this long. */
const MISS_RETRY_MS = 90_000;
const MISS_LIMIT = 256;
/** Minute within each five that BoM's radars scan at, most likely first. */
const PHASES = [4, 0, 1, 2, 3];
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
  /** Frame name → when it was last found not yet published. */
  const missing = new Map();
  /** Radar id → the minute within each five that it scans at. */
  const phases = new Map();
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
          // Not found is an answer, not an outage: the mirror has the same files.
          if (response.status === 404) break;
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

  /** One radar frame's bytes, kept so the image route need not refetch them. */
  async function loadImage(name) {
    const hit = images.get(name);
    if (hit) return hit;
    const { promise } = coalesceProxyRequest(inFlight, `image:${name}`, () =>
      fetchImage(name),
    );
    const bytes = await promise;
    images.set(name, bytes);
    while (images.size > IMAGE_CACHE_LIMIT)
      images.delete(images.keys().next().value);
    return bytes;
  }

  async function frameExists(name) {
    if (images.has(name)) return true;
    const missedAt = missing.get(name);
    if (missedAt !== undefined && now() - missedAt < MISS_RETRY_MS)
      return false;
    try {
      await loadImage(name);
      missing.delete(name);
      return true;
    } catch {
      missing.delete(name);
      missing.set(name, now());
      while (missing.size > MISS_LIMIT)
        missing.delete(missing.keys().next().value);
      return false;
    }
  }

  /**
   * BoM no longer lists radar frames on a public page, so ask for each
   * expected scan by name. The scan minute is learned once per radar and
   * relearned if a radar stops answering on it.
   */
  async function findFrames(radar) {
    const look = async (phase, count) => {
      const names = bomCandidateTimes(now(), phase, count).map((ms) =>
        bomFrameName(radar.id, ms),
      );
      const found = await Promise.all(names.map(frameExists));
      return names.filter((_, i) => found[i]).reverse();
    };
    const known = phases.get(radar.id);
    let names = known === undefined ? [] : await look(known, FRAME_CANDIDATES);
    if (names.length === 0) {
      for (const phase of new Set(PHASES)) {
        if (phase === known || (await look(phase, 3)).length === 0) continue;
        phases.set(radar.id, phase);
        names = await look(phase, FRAME_CANDIDATES);
        break;
      }
    }
    return names
      .slice(-BOM_RADAR_FRAME_LIMIT)
      .map((name) => parseBomFrameName(name));
  }

  async function fetchFrames() {
    const radars = await Promise.all(
      BOM_RADARS.map(async (radar) => ({
        id: radar.id,
        frames: await findFrames(radar),
      })),
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
        const bytes = await loadImage(name);
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
