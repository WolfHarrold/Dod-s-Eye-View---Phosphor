/**
 * qa-bom.mjs — live proof for the Australian weather (BoM) proxy.
 *
 * Runs the `/api/bom` routes against the real Bureau of Meteorology site,
 * without a browser: station readings, radar frame lists and one radar frame.
 * Unit tests use fixtures; this checks BoM still answers in the shape the
 * layer expects.
 *
 * Run:  node scripts/qa-bom.mjs
 */
import { bomProxy } from '../server/providers/bom.js';

function call(plugin, url) {
  let handler;
  plugin.configureServer({ middlewares: { use: (_, fn) => (handler = fn) } });
  return new Promise((resolve) => {
    const res = {
      destroyed: false,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body });
      },
    };
    handler({ method: 'GET', url, socket: { remoteAddress: 'qa' } }, res);
  });
}

let failed = false;
const record = (name, ok, detail) => {
  if (!ok) failed = true;
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `  — ${detail}` : ''}`,
  );
};

const plugin = bomProxy();
const observations = await call(plugin, '/observations');
const stations =
  observations.status === 200 ? JSON.parse(observations.body).stations : [];
record(
  'station readings',
  stations.length > 0,
  `HTTP ${observations.status}, ${stations.length} stations`,
);
const latrobe = stations.find((station) => station.wmo === '94891');
if (latrobe)
  console.log(
    `         Latrobe Valley: ${latrobe.tempC}°C, wind ${latrobe.windDir} ${latrobe.windKmh} km/h, ` +
      `observed ${new Date(latrobe.observedMs).toISOString()}`,
  );

const radar = await call(plugin, '/radar');
const radars = radar.status === 200 ? JSON.parse(radar.body).radars : [];
for (const { id, frames } of radars)
  record(
    `radar ${id} frames`,
    frames.length > 0,
    frames.length ? `${frames.length}, newest ${frames.at(-1).time}` : 'none',
  );
if (radar.status !== 200)
  record('radar frame lists', false, `HTTP ${radar.status}`);

const newest = radars.flatMap(({ frames }) => frames).at(-1);
if (newest) {
  const image = await call(plugin, `/radar/${newest.name}`);
  record(
    'radar frame image',
    image.status === 200 && image.headers['Content-Type'] === 'image/png',
    `HTTP ${image.status}, ${image.body?.length ?? 0} bytes`,
  );
}
process.exitCode = failed ? 1 : 0;
