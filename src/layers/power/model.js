/**
 * @module layers/power/model
 *
 * Live output of the Latrobe Valley's brown-coal power stations, from Open
 * Electricity (formerly OpenNEM), normalized. Pure — no Cesium, no network.
 * The server proxy and the layer share it, so a station or unit is defined
 * once.
 *
 * Open Electricity data is CC BY-NC 4.0; see DATA_SOURCES.md.
 */
// A portable export: no i18n here. Labels stay English data; the layer row
// (index.js) shows them translated.
const msg = (text) => text;

/**
 * Stations and their generating units, from Open Electricity's facility
 * register (`/v4/facilities`, NEM VIC1). Capacities are the registered
 * maximums in MW. Fixed here so the proxy spends no credits on metadata.
 */
export const POWER_STATIONS = Object.freeze(
  [
    {
      code: 'LOYYANGA',
      name: 'Loy Yang A',
      lat: -38.253534,
      lon: 146.574459,
      units: [
        ['LYA1', 590],
        ['LYA2', 535],
        ['LYA3', 590],
        ['LYA4', 580],
      ],
    },
    {
      code: 'LOYYB',
      name: 'Loy Yang B',
      lat: -38.256446,
      lon: 146.584982,
      units: [
        ['LOYYB1', 600],
        ['LOYYB2', 600],
      ],
    },
    {
      code: 'YALLOURN',
      name: 'Yallourn W',
      lat: -38.177589,
      lon: 146.342556,
      units: [
        ['YWPS1', 395],
        ['YWPS2', 395],
        ['YWPS3', 405],
        ['YWPS4', 405],
      ],
    },
  ].map((station) =>
    Object.freeze({
      ...station,
      units: Object.freeze(
        station.units.map(([code, capacityMw]) =>
          Object.freeze({ code, capacityMw }),
        ),
      ),
      capacityMw: station.units.reduce((sum, [, mw]) => sum + mw, 0),
    }),
  ),
);

const UNIT_STATION = new Map(
  POWER_STATIONS.flatMap((station) =>
    station.units.map((unit) => [unit.code, station.code]),
  ),
);

/** The NEM runs on fixed AEST, without daylight saving. */
export const NEM_UTC_OFFSET_MS = 10 * 60 * 60 * 1000;
/** A unit below this is shown as offline: idle units report a trickle. */
export const POWER_OFFLINE_BELOW_MW = 5;
/** Open Electricity normally runs 5–10 minutes behind; past this it is late. */
export const POWER_STALE_AFTER_MS = 20 * 60 * 1000;
/** History asked for, and kept for the row's trend. */
export const POWER_HISTORY_MS = 60 * 60 * 1000;

export const POWER_OVERLAY_SOURCE_ID = 'latrobe-power';
export const POWER_OVERLAY_COHORT_LIMIT = 8;
export const POWER_OVERLAY_COLLISION_CAPACITY = 8;

/** Load bands for the station columns and legend, by share of capacity. */
export const POWER_LOAD_BANDS = Object.freeze(
  [
    { id: 'off', below: 0.02, color: '#6c757d', label: msg('Offline') },
    { id: 'low', below: 0.5, color: '#ffd166', label: msg('Under half load') },
    {
      id: 'high',
      below: Infinity,
      color: '#ef476f',
      label: msg('Half load or more'),
    },
  ].map((band) => Object.freeze(band)),
);

export function powerLoadBand(share) {
  return (
    POWER_LOAD_BANDS.find((band) => share < band.below) ??
    POWER_LOAD_BANDS[POWER_LOAD_BANDS.length - 1]
  );
}

const finite = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/** `date_start` in NEM time, as the API takes it: no zone suffix. */
export function nemDateParam(ms) {
  return new Date(ms + NEM_UTC_OFFSET_MS).toISOString().slice(0, 19);
}

/** Rows of `[timestamp, value]` as sorted `{ ms, value }` points. */
function readSeries(rows) {
  if (!Array.isArray(rows)) return [];
  const points = [];
  for (const row of rows) {
    const ms = Date.parse(Array.isArray(row) ? row[0] : '');
    const value = finite(Array.isArray(row) ? row[1] : null);
    if (Number.isFinite(ms) && value !== null) points.push({ ms, value });
  }
  return points.sort((a, b) => a.ms - b.ms);
}

/**
 * Normalize a `/v4/data/facilities/NEM?metrics=power` response into one
 * entry per station: total and per-unit MW at the newest interval every
 * reporting unit shares, plus the station's recent totals.
 */
export function normalizePowerResponse(payload) {
  const blocks = Array.isArray(payload?.data) ? payload.data : [];
  const series = new Map();
  for (const block of blocks) {
    if (block?.metric !== 'power') continue;
    for (const result of Array.isArray(block.results) ? block.results : []) {
      const code = String(result?.columns?.unit_code ?? '');
      if (!UNIT_STATION.has(code)) continue;
      series.set(code, readSeries(result.data));
    }
  }
  return POWER_STATIONS.map((station) => {
    const totals = new Map();
    const units = station.units.map((unit) => {
      const points = series.get(unit.code) ?? [];
      for (const { ms, value } of points)
        totals.set(ms, (totals.get(ms) ?? 0) + Math.max(0, value));
      const latest = points.at(-1) ?? null;
      const mw = latest ? Math.max(0, latest.value) : null;
      return {
        code: unit.code,
        capacityMw: unit.capacityMw,
        mw,
        observedMs: latest?.ms ?? null,
        online: mw !== null && mw >= POWER_OFFLINE_BELOW_MW,
      };
    });
    const reporting = units.filter((unit) => unit.observedMs !== null);
    // A station's total is only honest at a time every reporting unit has.
    const observedMs = reporting.length
      ? Math.min(...reporting.map((unit) => unit.observedMs))
      : null;
    const history = [...totals.entries()]
      .filter(([ms]) => observedMs !== null && ms <= observedMs)
      .sort((a, b) => a[0] - b[0])
      .map(([ms, mw]) => ({ ms, mw: Math.round(mw * 10) / 10 }));
    return {
      code: station.code,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      capacityMw: station.capacityMw,
      mw: observedMs === null ? null : (history.at(-1)?.mw ?? null),
      observedMs,
      units,
      history,
    };
  });
}

/** Normalize a `/v4/market/network/NEM?metrics=price` response for VIC1. */
export function normalizePriceResponse(payload) {
  const blocks = Array.isArray(payload?.data) ? payload.data : [];
  for (const block of blocks) {
    if (block?.metric !== 'price') continue;
    for (const result of Array.isArray(block.results) ? block.results : []) {
      if (result?.columns?.region !== 'VIC1') continue;
      const latest = readSeries(result.data).at(-1);
      // Spot prices can go negative: keep the sign.
      if (latest)
        return { region: 'VIC1', value: latest.value, observedMs: latest.ms };
    }
  }
  return null;
}

/** Validate a proxy snapshot before the layer draws it. */
export function validatePowerSnapshot(value) {
  if (!value || value.schemaVersion !== 1) return null;
  if (value.configured === false)
    return { configured: false, stations: [], price: null, stale: false };
  if (!Array.isArray(value.stations)) return null;
  const known = new Map(POWER_STATIONS.map((s) => [s.code, s]));
  const stations = value.stations
    .filter((s) => known.has(s?.code))
    .map((s) => ({
      ...known.get(s.code),
      mw: finite(s.mw),
      observedMs: finite(s.observedMs),
      units: Array.isArray(s.units)
        ? s.units.filter((u) => typeof u?.code === 'string')
        : [],
      history: Array.isArray(s.history)
        ? s.history.filter(
            (p) => finite(p?.ms) !== null && finite(p?.mw) !== null,
          )
        : [],
    }));
  const price =
    value.price && finite(value.price.value) !== null
      ? {
          region: 'VIC1',
          value: finite(value.price.value),
          observedMs: finite(value.price.observedMs),
        }
      : null;
  return { configured: true, stations, price, stale: value.stale === true };
}

/** Change over the last hour, in MW, or null without enough history. */
export function powerTrendMw(station) {
  const history = station?.history ?? [];
  if (history.length < 2) return null;
  return Math.round(history.at(-1).mw - history[0].mw);
}

export function createPowerOverlayEntry({ id, position, title, accent }) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent,
    priority: 900,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 10,
    verticalOnly: true,
    placement: 'above',
  };
}

/** JSON-safe record for the analyst query engine. */
export function mapPowerAnalystRecord(station) {
  return {
    id: station.code,
    name: station.name,
    mw: station.mw,
    capacityMw: station.capacityMw,
    unitsOnline: station.units.filter((unit) => unit.online).length,
    units: station.units.length,
    observedMs: station.observedMs,
    lat: station.lat,
    lon: station.lon,
  };
}
