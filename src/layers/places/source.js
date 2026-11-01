import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validatePlacesSnapshot } from './model.js';

// A portable export: no i18n here. Failures stay English data; the Layers
// panel shows them translated.
const msg = (text) => text;

/**
 * Victorian places of interest for one map window, read through the local
 * `/api/local-places` proxy.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {number} [options.timeoutMs=45000] - Deadline for each request.
 */
export function createPlacesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 45_000,
} = {}) {
  return {
    /** @param {{ bbox: { west: number, south: number, east: number, north: number }, signal?: AbortSignal }} options */
    async getSnapshot({ bbox, signal } = {}) {
      const edges = [bbox?.west, bbox?.south, bbox?.east, bbox?.north];
      if (!edges.every(Number.isFinite))
        throw new Error(msg('Places window unavailable'));
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error(msg('Places request timed out'))),
        timeoutMs,
      );
      try {
        signal?.throwIfAborted();
        const response = await fetchImpl(
          `/api/local-places?bbox=${edges.map((v) => v.toFixed(4)).join(',')}`,
          { signal: controller.signal, redirect: 'error' },
        );
        if (!response.ok) throw new Error(`Places HTTP ${response.status}`);
        const value = validatePlacesSnapshot(
          await readResponseJsonCapped(
            response,
            2 * 1024 * 1024,
            controller.signal,
          ),
        );
        if (!value) throw new Error(msg('Malformed places response'));
        return value;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
