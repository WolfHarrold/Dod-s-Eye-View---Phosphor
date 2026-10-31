import { createPlacesLayer } from '../../layers/places/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire Victorian places of interest to the application overlay host. */
export function createApplicationLocalPlaces(options) {
  return createPlacesLayer({ overlayHost, ...options });
}
