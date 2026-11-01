/**
 * @module layers/bom/model
 *
 * Bureau of Meteorology (Australia) radar and station observations,
 * normalized. Pure — no Cesium, no network. The server proxy and the layer
 * share it, so a station list or a radar site is defined once.
 *
 * BoM publishes these products free of charge for non-commercial use; see
 * DATA_SOURCES.md.
 */
// A portable export: no i18n here. Labels stay English data; the Weather card
// (index.js) shows them translated.
const msg = (text) => text;

/**
 * Stations the layer reports, as listed on BoM's Victorian observation pages.
 * `product` is the state product the station's JSON is published under.
 * Gippsland first: the layer was built for the Latrobe Valley.
 */
export const BOM_STATIONS = Object.freeze(
  [
    ['IDV60801', '94891', 'Latrobe Valley'],
    ['IDV60801', '95901', 'Mount Baw Baw'],
    ['IDV60801', '99806', 'Warragul (Nilma North)'],
    ['IDV60801', '95907', 'East Sale Airport'],
    ['IDV60801', '95890', 'Yarram Airport'],
    ['IDV60801', '95913', 'Mount Moornapa'],
    ['IDV60801', '94893', 'Wilsons Promontory'],
    ['IDV60801', '94949', 'Hogan Island'],
    ['IDV60801', '94912', 'Bairnsdale'],
    ['IDV60801', '95904', 'Lakes Entrance'],
    ['IDV60801', '95918', 'Orbost'],
    ['IDV60801', '94908', 'Omeo'],
    ['IDV60901', '95936', 'Melbourne (Olympic Park)'],
    ['IDV60901', '94866', 'Melbourne Airport'],
    ['IDV60901', '94870', 'Moorabbin Airport'],
    ['IDV60901', '94872', 'Ferny Creek'],
    ['IDV60901', '94864', 'Coldstream'],
    ['IDV60901', '94898', 'Cerberus'],
    ['IDV60901', '94892', 'Rhyll'],
  ].map(([product, wmo, name]) => Object.freeze({ product, wmo, name })),
);

/**
 * Radars drawn by the layer. Coordinates are BoM's published site positions.
 * Code 3 is the 128 km product: a 512 px square transparency centred on the
 * radar, `rangeKm` from the centre to each edge.
 */
export const BOM_RADARS = Object.freeze(
  [
    { id: 'IDR683', name: 'Bairnsdale', lat: -37.89, lon: 147.56 },
    { id: 'IDR023', name: 'Melbourne', lat: -37.86, lon: 144.76 },
  ].map((radar) => Object.freeze({ ...radar, rangeKm: 128 })),
);

const RADAR_IDS = new Set(BOM_RADARS.map((radar) => radar.id));
const STATION_KEYS = new Set(
  BOM_STATIONS.map(({ product, wmo }) => `${product}.${wmo}`),
);

/** Frames kept per radar: half an hour at BoM's five-to-six minute cadence. */
export const BOM_RADAR_FRAME_LIMIT = 6;
/** An observation this old is no longer shown as current. */
export const BOM_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** A radar frame this old means the radar is down or the feed has stalled. */
export const BOM_RADAR_STALE_AFTER_MS = 45 * 60 * 1000;

export const BOM_OVERLAY_SOURCE_ID = 'bom-weather';
export const BOM_OVERLAY_COHORT_LIMIT = 24;
export const BOM_OVERLAY_COLLISION_CAPACITY = 16;

export const BOM_PROVIDER = Object.freeze({
  label: msg('Bureau of Meteorology'),
  coverage: msg('Victoria, Australia: Gippsland and Melbourne'),
  network: 'BoM',
});

/** Temperature bands for markers and the legend, coldest first. */
export const BOM_TEMPERATURE_BANDS = Object.freeze(
  [
    { max: 5, color: '#4cc9f0', label: msg('Below 5°C') },
    { max: 15, color: '#80ed99', label: msg('5 to 15°C') },
    { max: 25, color: '#ffd43b', label: msg('15 to 25°C') },
    { max: 35, color: '#ff6b35', label: msg('25 to 35°C') },
    { max: Infinity, color: '#c1121f', label: msg('35°C and above') },
  ].map(Object.freeze),
);
export const BOM_UNKNOWN_COLOR = '#6b7785';

export function isBomRadarId(id) {
  return RADAR_IDS.has(id);
}

export function isBomStation(product, wmo) {
  return STATION_KEYS.has(`${product}.${wmo}`);
}

/** The only frame names the proxy will fetch: `IDR683.T.202610310540.png`. */
const FRAME_NAME = /^(IDR\d{3})\.T\.(\d{12})\.png$/;

/** Parse a radar transparency name; null unless it names a known radar. */
export function parseBomFrameName(name) {
  const match = typeof name === 'string' ? FRAME_NAME.exec(name) : null;
  if (!match || !RADAR_IDS.has(match[1])) return null;
  const stamp = match[2];
  const ms = Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
  );
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 16).replace(/\D/g, '') !== stamp
  )
    return null;
  return { radar: match[1], name, time: new Date(ms).toISOString() };
}

/** BoM's transparency name for one radar scan at a UTC minute. */
export function bomFrameName(radarId, ms) {
  const stamp = new Date(ms).toISOString().slice(0, 16).replace(/\D/g, '');
  return `${radarId}.T.${stamp}.png`;
}

/**
 * Scan times to look for, newest first. BoM's radars scan every five minutes
 * at a fixed minute within each five (`phase`; 4 for Bairnsdale and
 * Melbourne as of October 2026), and no longer list the frames anywhere
 * public, so the proxy asks for each expected frame by name.
 */
export function bomCandidateTimes(nowMs, phase, count) {
  const minute = 60_000;
  let ms = Math.floor(nowMs / minute) * minute;
  while (new Date(ms).getUTCMinutes() % 5 !== phase) ms -= minute;
  return Array.from({ length: count }, (_, i) => ms - i * 5 * minute);
}

/** Lon/lat degrees covered by a radar's square transparency. */
export function bomRadarBounds({ lat, lon, rangeKm }) {
  const KM_PER_DEGREE = 111.32;
  const dLat = rangeKm / KM_PER_DEGREE;
  const dLon = rangeKm / (KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
  };
}

const finite = (value) => {
  if (value === null || value === undefined || value === '' || value === '-')
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** BoM's `aifstime_utc` is `YYYYMMDDhhmmss` in UTC. */
export function parseBomUtc(stamp) {
  if (typeof stamp !== 'string' || !/^\d{14}$/.test(stamp)) return null;
  const ms = Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14)),
  );
  return Number.isFinite(ms) ? ms : null;
}

export function bomTemperatureColor(tempC) {
  if (!Number.isFinite(tempC)) return BOM_UNKNOWN_COLOR;
  return BOM_TEMPERATURE_BANDS.find((band) => tempC < band.max).color;
}

/**
 * One station's latest reading from its 72-hour observation JSON, or null
 * when the payload carries no usable row. `trendC` is the change over the
 * last hour, when a reading from about an hour ago exists.
 */
export function normalizeBomObservation(payload, station) {
  const rows = payload?.observations?.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const latest = rows[0];
  const observedMs = parseBomUtc(latest?.aifstime_utc);
  const lat = finite(latest?.lat);
  const lon = finite(latest?.lon);
  if (
    observedMs === null ||
    lat === null ||
    lon === null ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return null;
  const tempC = finite(latest.air_temp);
  let trendC = null;
  if (tempC !== null) {
    const hourAgo = rows.find((row) => {
      const ms = parseBomUtc(row?.aifstime_utc);
      return ms !== null && observedMs - ms >= 50 * 60_000;
    });
    const before = finite(hourAgo?.air_temp);
    const beforeMs = parseBomUtc(hourAgo?.aifstime_utc);
    if (before !== null && observedMs - beforeMs <= 90 * 60_000)
      trendC = Math.round((tempC - before) * 10) / 10;
  }
  const name =
    typeof latest.name === 'string' && latest.name.trim()
      ? latest.name.trim().slice(0, 80)
      : station.name;
  return {
    id: `${station.product}.${station.wmo}`,
    wmo: station.wmo,
    name,
    lat,
    lon,
    observedMs,
    tempC,
    apparentC: finite(latest.apparent_t),
    humidity: finite(latest.rel_hum),
    windDir:
      typeof latest.wind_dir === 'string' &&
      /^[A-Z]{1,3}$|^CALM$/.test(latest.wind_dir)
        ? latest.wind_dir
        : null,
    windKmh: finite(latest.wind_spd_kmh),
    gustKmh: finite(latest.gust_kmh),
    rainMm: finite(latest.rain_trace),
    pressureHpa: finite(latest.press_msl),
    trendC,
  };
}

/** Validate a proxy observation snapshot before the layer draws it. */
export function validateBomObservations(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.stations))
    return null;
  const stations = value.stations.filter(
    (row) =>
      row &&
      typeof row.id === 'string' &&
      typeof row.name === 'string' &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lon) &&
      Number.isFinite(row.observedMs),
  );
  return { fetchedAt: value.fetchedAt, stations };
}

/** Validate a proxy radar snapshot; frames must be names the proxy serves. */
export function validateBomRadar(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.radars))
    return null;
  const radars = [];
  for (const radar of value.radars) {
    const site = BOM_RADARS.find((known) => known.id === radar?.id);
    if (!site || !Array.isArray(radar.frames)) continue;
    const frames = radar.frames
      .map((frame) => parseBomFrameName(frame?.name))
      .filter((frame) => frame && frame.radar === site.id)
      .slice(-BOM_RADAR_FRAME_LIMIT);
    radars.push({ ...site, bounds: bomRadarBounds(site), frames });
  }
  return { radars };
}

/** Compass point to a short phrase: `SW 20 km/h`, or `Calm`. */
export function formatBomWind(reading) {
  if (reading.windDir === 'CALM' || reading.windKmh === 0) return msg('Calm');
  if (reading.windKmh === null) return null;
  return `${reading.windDir ?? ''} ${reading.windKmh} km/h`.trim();
}

export function bomReadingsAreStale(readings, now = Date.now()) {
  return (
    readings.length > 0 &&
    readings.every((reading) => now - reading.observedMs > BOM_STALE_AFTER_MS)
  );
}

/** Readings inside a lon/lat rectangle, warmest first, for the readout card. */
export function bomReadingsInView(readings, rectangle, limit) {
  const inside = rectangle
    ? readings.filter(
        (reading) =>
          reading.lat >= rectangle.south &&
          reading.lat <= rectangle.north &&
          (rectangle.west <= rectangle.east
            ? reading.lon >= rectangle.west && reading.lon <= rectangle.east
            : reading.lon >= rectangle.west || reading.lon <= rectangle.east),
      )
    : readings;
  return inside
    .slice()
    .sort((a, b) => (b.tempC ?? -Infinity) - (a.tempC ?? -Infinity))
    .slice(0, limit);
}

/** One station label for the overlay host. */
export function createBomOverlayEntry({
  id,
  position,
  title,
  accent,
  priority,
}) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent,
    priority,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** JSON-safe record for the analyst query engine. */
export function mapBomAnalystRecord(reading, index = 0) {
  return {
    id: reading.id || `BOM-${String(index).padStart(4, '0')}`,
    name: reading.name,
    tempC: reading.tempC,
    apparentC: reading.apparentC,
    humidity: reading.humidity,
    wind: formatBomWind(reading),
    gustKmh: reading.gustKmh,
    rainMm: reading.rainMm,
    lat: reading.lat,
    lon: reading.lon,
    observedMs: reading.observedMs,
  };
}
