import { createBomWeatherLayer } from '../../layers/bom/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire BoM radar and station readings to the application overlay host. */
export function createApplicationBomWeather(options) {
  return createBomWeatherLayer({ overlayHost, ...options });
}
