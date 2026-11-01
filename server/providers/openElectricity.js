import {
  POWER_HISTORY_MS,
  POWER_STALE_AFTER_MS,
  POWER_STATIONS,
  nemDateParam,
  normalizePowerResponse,
  normalizePriceResponse,
} from '../../src/layers/power/model.js';
import { readResponseJsonCapped, coalesceProxyRequest } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

// Open Electricity API v4. The key stays here, server-side; CC BY-NC 4.0.
const API = 'https://api.openelectricity.org.au/v4';
const MIB = 1024 * 1024;
/** NEM data moves every five minutes; asking sooner only spends credits. */
const POWER_TTL_MS = 5 * 60_000;
const PRICE_TTL_MS = 15 * 60_000;

/** Fixed-origin, bounded Latrobe Valley power route for dev and preview. */
export function openElectricityProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  resolveKey = () => process.env.OPENELECTRICITY_API_KEY,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 300 });

  async function getJson(path, apiKey) {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`upstream_http_${response.status}`);
    }
    return readResponseJsonCapped(response, 2 * MIB, signal);
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

  const since = () => nemDateParam(now() - POWER_HISTORY_MS - 10 * 60_000);

  const fetchPower = (apiKey) => {
    const params = new URLSearchParams({
      metrics: 'power',
      interval: '5m',
      date_start: since(),
    });
    for (const station of POWER_STATIONS)
      params.append('facility_code', station.code);
    return getJson(`/data/facilities/NEM?${params}`, apiKey).then(
      normalizePowerResponse,
    );
  };

  const fetchPrice = (apiKey) => {
    const params = new URLSearchParams({
      metrics: 'price',
      interval: '5m',
      network_region: 'VIC1',
      date_start: since(),
    });
    return getJson(`/market/network/NEM?${params}`, apiKey).then(
      normalizePriceResponse,
    );
  };

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
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const apiKey = String(resolveKey() ?? '').trim();
    // No key is a setup step, not an outage.
    if (!apiKey) return json(200, { schemaVersion: 1, configured: false });
    // A changed key must not be answered from the old key's cache.
    const keyTag = apiKey.slice(-6);
    const [power, price] = await Promise.allSettled([
      cached(`power:${keyTag}`, POWER_TTL_MS, () => fetchPower(apiKey)),
      cached(`price:${keyTag}`, PRICE_TTL_MS, () => fetchPrice(apiKey)),
    ]);
    if (power.status === 'rejected') {
      const status = /upstream_http_(401|403)/.test(power.reason?.message)
        ? 'key_rejected'
        : 'power_unavailable';
      return json(502, { error: status });
    }
    const stations = power.value.value;
    const newest = Math.max(
      0,
      ...stations.map((station) => station.observedMs ?? 0),
    );
    json(200, {
      schemaVersion: 1,
      configured: true,
      fetchedAt: now(),
      stale: power.value.stale || now() - newest > POWER_STALE_AFTER_MS,
      stations,
      price: price.status === 'fulfilled' ? price.value.value : null,
    });
  }

  return {
    name: 'open-electricity',
    configureServer({ middlewares }) {
      middlewares.use('/api/latrobe-power', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/latrobe-power', handler);
    },
  };
}
