import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validatePowerSnapshot } from './model.js';

// A portable export: no i18n here. Failures stay English data; the Layers
// panel shows them translated.
const msg = (text) => text;

/**
 * Latrobe Valley power station output, read through the local
 * `/api/latrobe-power` proxy, which holds the Open Electricity key.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {number} [options.timeoutMs=30000] - Deadline for each request.
 */
export function createPowerSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 30_000,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error(msg('Power request timed out'))),
        timeoutMs,
      );
      try {
        signal?.throwIfAborted();
        const response = await fetchImpl('/api/latrobe-power', {
          signal: controller.signal,
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (body?.error === 'key_rejected')
            throw new Error(msg('Open Electricity rejected the key'));
          throw new Error(`Open Electricity HTTP ${response.status}`);
        }
        const value = validatePowerSnapshot(
          await readResponseJsonCapped(response, 512 * 1024, controller.signal),
        );
        if (!value) throw new Error(msg('Malformed power response'));
        return value;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
