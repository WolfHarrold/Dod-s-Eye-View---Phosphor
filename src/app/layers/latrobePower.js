import { createLatrobePowerLayer } from '../../layers/power/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire Latrobe Valley power station output to the application overlay host. */
export function createApplicationLatrobePower(options) {
  return createLatrobePowerLayer({ overlayHost, ...options });
}
