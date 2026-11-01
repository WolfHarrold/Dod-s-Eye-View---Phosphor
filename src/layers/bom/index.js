import * as Cesium from 'cesium';
import { msg, t, tn } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import { createShellSurface } from '../weather/shellRendering.js';
import {
  BOM_OVERLAY_COHORT_LIMIT,
  BOM_OVERLAY_COLLISION_CAPACITY,
  BOM_OVERLAY_SOURCE_ID,
  BOM_PROVIDER,
  BOM_RADAR_STALE_AFTER_MS,
  BOM_TEMPERATURE_BANDS,
  bomReadingsAreStale,
  bomReadingsInView,
  bomTemperatureColor,
  createBomOverlayEntry,
  formatBomWind,
  mapBomAnalystRecord,
} from './model.js';
export * from './model.js';
export { createBomSource } from './source.js';

const STATION_MARKER_RADIUS_M = 3_000;
const READOUT_LIMIT = 6;
/** Just under the US radar shell, so the two never fight for the same height. */
const RADAR_SHELL_HEIGHT = 6_100;
const RADAR_ALPHA = 0.8;
const LOOP_STEP_MS = 650;
/** Ticks the newest frame is held before the loop restarts. */
const LOOP_HOLD_TICKS = 4;

const formatTemp = (value) =>
  Number.isFinite(value) ? `${value.toFixed(1)}°` : '—';

/** Bureau of Meteorology radar loops and station thermometers. */
export function createBomWeatherLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('BoM weather requires a snapshot source');
  if (!overlayHost) throw new TypeError('BoM weather requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _readings = [];
  let _radars = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _radarError = null;
  let _enabled = false;
  let rowControlsListener = null;
  /** radar id → { shell, frames: [{ name, time, image }], index, hold } */
  const loops = new Map();
  let loopTimer = null;

  const notify = () => rowControlsListener?.();

  const viewRectangle = () => {
    const rectangle = _viewer?.camera?.computeViewRectangle?.();
    if (!rectangle) return null;
    const toDeg = Cesium.Math.toDegrees;
    return {
      west: toDeg(rectangle.west),
      south: toDeg(rectangle.south),
      east: toDeg(rectangle.east),
      north: toDeg(rectangle.north),
    };
  };

  const loadImage = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(msg('Radar frame unavailable')));
      image.src = url;
    });

  const stopLoop = () => {
    if (loopTimer !== null) clearInterval(loopTimer);
    loopTimer = null;
  };

  const step = () => {
    for (const loop of loops.values()) {
      const ready = loop.frames.filter((frame) => frame.image);
      if (ready.length === 0) continue;
      if (loop.index >= ready.length - 1 && loop.hold < LOOP_HOLD_TICKS) {
        loop.hold++;
        continue;
      }
      loop.hold = 0;
      loop.index = loop.index >= ready.length - 1 ? 0 : loop.index + 1;
      loop.shell.setImage(ready[loop.index].image);
    }
  };

  const startLoop = () => {
    stopLoop();
    if (_enabled && loops.size) loopTimer = setInterval(step, LOOP_STEP_MS);
  };

  const removeLoop = (id) => {
    loops.get(id)?.shell.destroy();
    loops.delete(id);
  };

  /** Keep one shell per radar; load only frames not already decoded. */
  async function renderRadar(request) {
    if (!_viewer) return;
    const wanted = new Set(_radars.map((radar) => radar.id));
    for (const id of [...loops.keys()]) if (!wanted.has(id)) removeLoop(id);
    for (const radar of _radars) {
      let loop = loops.get(radar.id);
      if (!loop) {
        const { west, south, east, north } = radar.bounds;
        const shell = createShellSurface({
          viewer: _viewer,
          cesium: Cesium,
          rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
          height: RADAR_SHELL_HEIGHT,
        });
        shell.setAlpha(RADAR_ALPHA);
        shell.setShow(_enabled);
        loop = { shell, frames: [], index: 0, hold: 0 };
        loops.set(radar.id, loop);
      }
      const known = new Map(loop.frames.map((frame) => [frame.name, frame]));
      loop.frames = radar.frames.map(
        (frame) => known.get(frame.name) ?? { ...frame, image: null },
      );
      if (loop.index >= loop.frames.length) loop.index = 0;
    }
    const pending = [];
    for (const loop of loops.values()) {
      for (const frame of loop.frames) {
        if (frame.image || frame.loading) continue;
        frame.loading = true;
        pending.push(
          loadImage(source.frameUrl(frame.name))
            .then((image) => {
              if (request.signal.aborted) return;
              frame.image = image;
            })
            .catch(() => {})
            .finally(() => {
              frame.loading = false;
            }),
        );
      }
    }
    await Promise.all(pending);
    if (request.signal.aborted || !_enabled) return;
    // Show the newest frame at once; the loop takes it from there.
    for (const loop of loops.values()) {
      const ready = loop.frames.filter((frame) => frame.image);
      if (!ready.length) continue;
      loop.index = ready.length - 1;
      loop.hold = 0;
      loop.shell.setImage(ready.at(-1).image);
    }
    startLoop();
  }

  const newestFrameMs = () =>
    _radars.reduce((max, radar) => {
      const last = radar.frames.at(-1);
      return last ? Math.max(max, Date.parse(last.time)) : max;
    }, 0);

  const layer = {
    id: 'bom-weather',
    name: 'Australian weather (BoM)',
    icon: '☂',
    source: 'Bureau of Meteorology',
    updateInterval: 300_000,

    init(viewer) {
      if (_viewer) throw new Error('BoM weather layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('bom-weather');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _readings = [];
      _radars = [];
      _lastUpdate = null;
      _lastError = null;
      _radarError = null;
      _enabled = false;
      overlayHost.setVisible(BOM_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      for (const loop of loops.values()) loop.shell.setShow(true);
      overlayHost.setVisible(BOM_OVERLAY_SOURCE_ID, true);
      startLoop();
      notify();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      stopLoop();
      if (_dataSource) _dataSource.show = false;
      for (const loop of loops.values()) loop.shell.setShow(false);
      overlayHost.clearSource(BOM_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BOM_OVERLAY_SOURCE_ID, false);
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
        // A failed half keeps what it last showed.
        if (!snapshot.stationsError) _readings = snapshot.stations;
        if (!snapshot.radarError) _radars = snapshot.radars;
        _radarError = snapshot.radarError;
        _lastError = snapshot.stationsError;
        this._renderStations();
        _lastUpdate = Date.now();
        notify();
        await renderRadar(request);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Bureau of Meteorology unavailable');
        console.warn('[Data:BoM] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    _renderStations() {
      if (!_dataSource) return;
      _dataSource.entities.removeAll();
      const overlayEntries = [];
      for (const reading of _readings) {
        const position = Cesium.Cartesian3.fromDegrees(
          reading.lon,
          reading.lat,
        );
        const color = Cesium.Color.fromCssColorString(
          bomTemperatureColor(reading.tempC),
        );
        _dataSource.entities.add(
          new Cesium.Entity({
            id: `bom-weather:${reading.id}`,
            position,
            ellipse: {
              semiMajorAxis: STATION_MARKER_RADIUS_M,
              semiMinorAxis: STATION_MARKER_RADIUS_M,
              material: new Cesium.ColorMaterialProperty(color.withAlpha(0.35)),
              outline: true,
              outlineColor: color.withAlpha(0.9),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: { ...mapBomAnalystRecord(reading, 0) },
          }),
        );
        overlayEntries.push(
          createBomOverlayEntry({
            id: reading.id,
            position,
            title: `${reading.name} ${formatTemp(reading.tempC)}`,
            accent: bomTemperatureColor(reading.tempC),
            // The Latrobe Valley station is listed first and wins ties.
            priority: 1000 - _readings.indexOf(reading),
          }),
        );
      }
      if (_enabled) {
        overlayHost.setEntries(BOM_OVERLAY_SOURCE_ID, overlayEntries, {
          cohortLimit: BOM_OVERLAY_COHORT_LIMIT,
          collisionCapacity: BOM_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        });
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      stopLoop();
      for (const id of [...loops.keys()]) removeLoop(id);
      overlayHost.clearSource(BOM_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BOM_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _readings = [];
      _radars = [];
      _lastUpdate = null;
      _lastError = null;
      _radarError = null;
      rowControlsListener = null;
    },

    /** Readout for the Weather panel: temperature legend and stations in view. */
    getRowControls() {
      const inView = bomReadingsInView(
        _readings,
        viewRectangle(),
        READOUT_LIMIT,
      );
      const newest = _readings.reduce(
        (max, reading) => Math.max(max, reading.observedMs || 0),
        0,
      );
      const radarMs = newestFrameMs();
      const radarStatus = _radarError
        ? translateFeedError(_radarError)
        : radarMs && Date.now() - radarMs > BOM_RADAR_STALE_AFTER_MS
          ? t('Radar delayed')
          : null;
      const stationStatus = _lastError
        ? translateFeedError(_lastError)
        : _readings.length === 0
          ? _lastUpdate === null
            ? t('No readings available')
            : t('No current readings')
          : tn(
              _readings.length,
              '{count} station reporting',
              '{count} stations reporting',
            );
      return {
        readout: true,
        summary: {
          label: t(BOM_PROVIDER.label),
          coverage: t(BOM_PROVIDER.coverage),
          validTime: newest ? new Date(newest).toISOString() : undefined,
          detail: t('Radar: Bairnsdale and Melbourne'),
          status: radarStatus
            ? `${stationStatus} · ${radarStatus}`
            : stationStatus,
          units: '°C',
        },
        legend: BOM_TEMPERATURE_BANDS.map((band) => ({
          color: band.color,
          label: t(band.label),
        })),
        legendCategorical: true,
        list: {
          ariaLabel: t('Station temperatures in view'),
          items: inView.map((reading, index) => {
            const wind = formatBomWind(reading);
            const trend =
              reading.trendC === null
                ? ''
                : ` ${reading.trendC > 0 ? '↑' : reading.trendC < 0 ? '↓' : '→'}`;
            return {
              id: reading.id,
              ordinal: index + 1,
              lead: `${formatTemp(reading.tempC)}C${trend}`,
              text: [
                reading.name,
                wind === 'Calm' ? t('Calm') : wind,
                Number.isFinite(reading.rainMm) && reading.rainMm > 0
                  ? t('{mm} mm since 9am', { mm: reading.rainMm })
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
              accent: bomTemperatureColor(reading.tempC),
            };
          }),
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_readings.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _readings.slice(0, limit).map(mapBomAnalystRecord);
    },

    getStats() {
      const observedAt = _readings.reduce(
        (max, reading) => Math.max(max, reading.observedMs || 0),
        0,
      );
      return {
        count: _readings.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        observedAt: observedAt || null,
        stale: _lastUpdate !== null && bomReadingsAreStale(_readings),
      };
    },

    /** Radar loop state, for QA scripts. */
    getDiagnostics() {
      return [...loops.entries()].map(([id, loop]) => ({
        id,
        frames: loop.frames.length,
        decoded: loop.frames.filter((frame) => frame.image).length,
        index: loop.index,
        shell: loop.shell.getDiagnostics(),
      }));
    },
  };
  return layer;
}
