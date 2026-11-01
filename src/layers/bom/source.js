import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validateBomObservations, validateBomRadar } from './model.js';

// A portable export: no i18n here. Failures stay English data; the Layers
// panel and the Weather card show them translated.
const msg = (text) => text;

/**
 * Bureau of Meteorology observations and radar frames, read through the
 * local `/api/bom` proxy (BoM sends no CORS headers).
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {number} [options.timeoutMs=20000] - Deadline for each request.
 */
export function createBomSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 20_000,
} = {}) {
  const getJson = async (path, signal) => {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(msg('BoM request timed out'))),
      timeoutMs,
    );
    try {
      signal?.throwIfAborted();
      const response = await fetchImpl(path, {
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`BoM HTTP ${response.status}`);
      return await readResponseJsonCapped(
        response,
        512 * 1024,
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };

  return {
    /** Latest station readings and radar frame lists, fetched together. */
    async getSnapshot({ signal } = {}) {
      const [observations, radar] = await Promise.allSettled([
        getJson('/api/bom/observations', signal),
        getJson('/api/bom/radar', signal),
      ]);
      signal?.throwIfAborted();
      const stations =
        observations.status === 'fulfilled'
          ? validateBomObservations(observations.value)
          : null;
      const radars =
        radar.status === 'fulfilled' ? validateBomRadar(radar.value) : null;
      if (!stations && !radars)
        throw new Error(msg('Bureau of Meteorology unavailable'));
      return {
        stations: stations?.stations ?? [],
        radars: radars?.radars ?? [],
        stationsError: stations ? null : msg('Station readings unavailable'),
        radarError: radars ? null : msg('Radar unavailable'),
      };
    },
    /** Same-origin URL of one radar transparency. */
    frameUrl(name) {
      return `/api/bom/radar/${encodeURIComponent(name)}`;
    },
  };
}
