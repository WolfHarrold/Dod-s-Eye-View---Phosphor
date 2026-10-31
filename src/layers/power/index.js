import * as Cesium from 'cesium';
import { msg, t, tn } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import {
  POWER_LOAD_BANDS,
  POWER_OVERLAY_COHORT_LIMIT,
  POWER_OVERLAY_COLLISION_CAPACITY,
  POWER_OVERLAY_SOURCE_ID,
  POWER_STALE_AFTER_MS,
  createPowerOverlayEntry,
  mapPowerAnalystRecord,
  powerLoadBand,
  powerTrendMw,
} from './model.js';
export * from './model.js';
export { createPowerSource } from './source.js';

/** Column height per MW: Loy Yang A at full load stands about 4.6 km tall. */
const METRES_PER_MW = 2;
// Loy Yang A and B stand under a kilometre apart.
const COLUMN_RADIUS_M = 380;
const KEY_ID = 'openelectricity';

const formatMw = (mw) =>
  Number.isFinite(mw) ? `${Math.round(mw).toLocaleString('en-AU')} MW` : '—';

/** Live output of Loy Yang A, Loy Yang B and Yallourn W. */
export function createLatrobePowerLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Power stations require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Power stations require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  let _stations = [];
  let _price = null;
  let _stale = false;
  let _configured = true;
  let _lastUpdate = null;
  let _lastError = null;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  function column(station, heightM, color, id) {
    return new Cesium.Entity({
      id,
      position: Cesium.Cartesian3.fromDegrees(
        station.lon,
        station.lat,
        heightM / 2,
      ),
      cylinder: {
        length: heightM,
        topRadius: COLUMN_RADIUS_M,
        bottomRadius: COLUMN_RADIUS_M,
        material: color,
        outline: false,
      },
      properties: { ...mapPowerAnalystRecord(station) },
    });
  }

  function render() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    const entries = [];
    for (const station of _stations) {
      const share = station.mw === null ? 0 : station.mw / station.capacityMw;
      const band = powerLoadBand(share);
      const color = Cesium.Color.fromCssColorString(band.color);
      // A faint column for capacity, a solid one for what it makes now.
      _dataSource.entities.add(
        column(
          station,
          station.capacityMw * METRES_PER_MW,
          color.withAlpha(0.12),
          `latrobe-power:${station.code}:capacity`,
        ),
      );
      if (station.mw > 0)
        _dataSource.entities.add(
          column(
            station,
            station.mw * METRES_PER_MW,
            color.withAlpha(_stale ? 0.45 : 0.85),
            `latrobe-power:${station.code}`,
          ),
        );
      entries.push(
        createPowerOverlayEntry({
          id: station.code,
          position: Cesium.Cartesian3.fromDegrees(
            station.lon,
            station.lat,
            station.capacityMw * METRES_PER_MW,
          ),
          title: `${station.name} ${formatMw(station.mw)}`,
          accent: band.color,
        }),
      );
    }
    if (_enabled)
      overlayHost.setEntries(POWER_OVERLAY_SOURCE_ID, entries, {
        cohortLimit: POWER_OVERLAY_COHORT_LIMIT,
        collisionCapacity: POWER_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      });
    _viewer?.scene?.requestRender?.();
  }

  const layer = {
    id: 'latrobe-power',
    name: 'Latrobe Valley power',
    icon: '⚡',
    source: 'Open Electricity',
    requiresKeyId: KEY_ID,
    updateInterval: 300_000,

    init(viewer) {
      if (_viewer) throw new Error('Power layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('latrobe-power');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(POWER_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(POWER_OVERLAY_SOURCE_ID, true);
      notify();
    },

    disable() {
      _enabled = false;
      _request?.abort();
      _request = null;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(POWER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(POWER_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _configured = snapshot.configured;
        _stations = snapshot.stations;
        _price = snapshot.price;
        _stale = snapshot.stale;
        _lastUpdate = Date.now();
        _lastError = null;
        render();
        notify();
        // No key yet is a setup step the row explains, not a failure.
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Power output unavailable');
        console.warn('[Data:Power] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      this.disable();
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _stations = [];
      rowControlsListener = null;
    },

    /** Layer row: each station's output, its units, and the Victorian price. */
    getRowControls() {
      const notes = [];
      if (!_configured)
        notes.push(t('Add an Open Electricity key in Data Keys & Providers'));
      if (_stale) notes.push(t('Open Electricity is running late'));
      if (_price)
        notes.push(
          t('Victorian spot price {price} $/MWh', {
            price: _price.value.toFixed(2),
          }),
        );
      const newest = Math.max(0, ..._stations.map((s) => s.observedMs ?? 0));
      if (newest)
        notes.push(
          t('As of {time} AEST', {
            time: new Date(newest + 10 * 3_600_000).toISOString().slice(11, 16),
          }),
        );
      return {
        legend: POWER_LOAD_BANDS.map((band) => ({
          color: band.color,
          label: t(band.label),
          count: _stations.filter(
            (s) =>
              powerLoadBand(s.mw === null ? 0 : s.mw / s.capacityMw).id ===
              band.id,
          ).length,
        })),
        info: notes.join(' · '),
        list: _stations.length
          ? {
              ariaLabel: t('Power stations'),
              items: _stations.map((station, index) => {
                const online = station.units.filter((u) => u.online).length;
                const trend = powerTrendMw(station);
                return {
                  id: station.code,
                  ordinal: index + 1,
                  lead: formatMw(station.mw),
                  text: [
                    station.name,
                    tn(
                      online,
                      '{count} of {total} unit running',
                      '{count} of {total} units running',
                      { total: station.units.length },
                    ),
                    ...(trend !== null && Math.abs(trend) >= 10
                      ? [
                          t('{change} MW in the last hour', {
                            change: trend > 0 ? `+${trend}` : String(trend),
                          }),
                        ]
                      : []),
                  ].join(' · '),
                  accent: powerLoadBand(
                    station.mw === null ? 0 : station.mw / station.capacityMw,
                  ).color,
                };
              }),
            }
          : null,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getAnalystRecords() {
      if (!_enabled) return [];
      return _stations.map(mapPowerAnalystRecord);
    },

    getStats() {
      const newest = Math.max(0, ..._stations.map((s) => s.observedMs ?? 0));
      return {
        count: _stations.filter((s) => s.mw !== null).length,
        lastUpdate: _lastUpdate,
        error: _lastError ? translateFeedError(_lastError) : null,
        stale:
          _stale || (newest > 0 && Date.now() - newest > POWER_STALE_AFTER_MS),
        keyRequired: !_configured,
      };
    },
  };
  return layer;
}
