import * as Cesium from 'cesium';
import { msg, t } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import {
  PLACES_MAX_SPAN_DEG,
  PLACES_OVERLAY_COHORT_LIMIT,
  PLACES_OVERLAY_COLLISION_CAPACITY,
  PLACES_OVERLAY_SOURCE_ID,
  PLACE_CATEGORIES,
  VICTORIA_BOUNDS,
  createPlaceOverlayEntry,
  mapPlaceAnalystRecord,
  placeCategory,
  placePriority,
} from './model.js';
export * from './model.js';
export { createPlacesSource } from './source.js';

const LIST_LIMIT = 6;
/** Above this the view is a state, not a region: places would be noise. */
const MAX_CAMERA_HEIGHT_M = 250_000;
const MOVE_DEBOUNCE_MS = 800;

const SOURCE_NAMES = Object.freeze({
  landmarks: msg('Vicmap landmarks'),
  heritage: msg('Heritage Database'),
  parks: msg('Parks'),
  country: msg('Country boundaries'),
  topRated: msg('Google ratings'),
});

/** Heritage, landmarks, parks, Gunaikurnai places and top-rated attractions. */
export function createPlacesLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Places requires a snapshot source');
  if (!overlayHost) throw new TypeError('Places requires an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  let _places = [];
  let _country = [];
  let _partial = [];
  let _googleConfigured = true;
  let _lastUpdate = null;
  let _lastError = null;
  let _outOfRange = null;
  let _moveRemove = null;
  let _moveTimer = null;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  /** The request window: the view, clipped to a region around its centre. */
  function requestWindow() {
    const camera = _viewer?.camera;
    const height = camera?.positionCartographic?.height;
    if (!(height > 0) || height > MAX_CAMERA_HEIGHT_M) return 'too-high';
    const rectangle = camera.computeViewRectangle?.();
    if (!rectangle) return null;
    const toDeg = Cesium.Math.toDegrees;
    let west = toDeg(rectangle.west);
    let east = toDeg(rectangle.east);
    let south = toDeg(rectangle.south);
    let north = toDeg(rectangle.north);
    const half = PLACES_MAX_SPAN_DEG / 2 - 0.3;
    const lon = (west + east) / 2;
    const lat = (south + north) / 2;
    west = Math.max(west, lon - half);
    east = Math.min(east, lon + half);
    south = Math.max(south, lat - half);
    north = Math.min(north, lat + half);
    const v = VICTORIA_BOUNDS;
    if (east < v.west || west > v.east || north < v.south || south > v.north)
      return 'outside';
    return { west, south, east, north };
  }

  function scheduleUpdate() {
    if (!_enabled) return;
    clearTimeout(_moveTimer);
    _moveTimer = setTimeout(() => void layer.update(), MOVE_DEBOUNCE_MS);
  }

  function titleFor(place) {
    if (place.category === 'top-rated')
      return `★${place.rating.toFixed(1)} ${place.name}`;
    if (place.category === 'country' && place.kind)
      return `${place.name} (${place.kind})`;
    return place.name;
  }

  function render() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    const entries = [];
    for (const place of _places) {
      const category = placeCategory(place.category);
      const position = Cesium.Cartesian3.fromDegrees(place.lon, place.lat);
      const color = Cesium.Color.fromCssColorString(category.color);
      _dataSource.entities.add(
        new Cesium.Entity({
          id: `local-places:${place.id}`,
          position,
          point: {
            pixelSize: place.category === 'top-rated' ? 9 : 7,
            color: color.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { ...mapPlaceAnalystRecord(place) },
        }),
      );
      entries.push(
        createPlaceOverlayEntry({
          id: place.id,
          position,
          title: titleFor(place),
          accent: category.color,
          priority: placePriority(place),
        }),
      );
    }
    if (_enabled)
      overlayHost.setEntries(
        PLACES_OVERLAY_SOURCE_ID,
        entries
          .sort((a, b) => b.priority - a.priority)
          .slice(0, PLACES_OVERLAY_COHORT_LIMIT),
        {
          cohortLimit: PLACES_OVERLAY_COHORT_LIMIT,
          collisionCapacity: PLACES_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
    _viewer?.scene?.requestRender?.();
  }

  const layer = {
    id: 'local-places',
    name: 'Places of interest',
    icon: '✦',
    source: 'Vicmap · Heritage Council · Google',
    updateInterval: 0,

    init(viewer) {
      if (_viewer) throw new Error('Places layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('local-places');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _moveRemove = viewer.camera.moveEnd.addEventListener(scheduleUpdate);
      overlayHost.setVisible(PLACES_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(PLACES_OVERLAY_SOURCE_ID, true);
      notify();
    },

    disable() {
      _enabled = false;
      clearTimeout(_moveTimer);
      _request?.abort();
      _request = null;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(PLACES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PLACES_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      const bbox = requestWindow();
      if (typeof bbox === 'string' || bbox === null) {
        _outOfRange = bbox ?? 'too-high';
        _places = [];
        _country = [];
        render();
        notify();
        // Nothing to show here is still a good answer, not a failed refresh.
        return true;
      }
      _outOfRange = null;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({
          bbox,
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _places = snapshot.places;
        _country = snapshot.country;
        _partial = snapshot.errors;
        _googleConfigured = snapshot.googleConfigured;
        _lastUpdate = Date.now();
        _lastError = null;
        render();
        notify();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Places unavailable');
        console.warn('[Data:Places] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      this.disable();
      _moveRemove?.();
      _moveRemove = null;
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _places = [];
      _country = [];
      rowControlsListener = null;
    },

    /** Layer row: legend, whose Country this is, and the leading places. */
    getRowControls() {
      const counts = new Map();
      for (const place of _places)
        counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
      const notes = [];
      if (_outOfRange === 'too-high')
        notes.push(t('Zoom in to a region to see places'));
      else if (_outOfRange === 'outside')
        notes.push(t('Places cover Victoria, Australia'));
      if (_country.length)
        notes.push(
          t('You are on {names} Country', {
            names: _country
              .map((name) =>
                name.replace(/ Land and Waters Aboriginal Corporation$/i, ''),
              )
              .join(', '),
          }),
        );
      if (!_googleConfigured)
        notes.push(t('Add a Google key for top-rated attractions'));
      if (_partial.length)
        notes.push(
          t('Unavailable: {sources}', {
            sources: _partial
              .map((name) => t(SOURCE_NAMES[name] ?? name))
              .join(', '),
          }),
        );
      const leading = _places
        .slice()
        .sort((a, b) => placePriority(b) - placePriority(a))
        .slice(0, LIST_LIMIT);
      return {
        legend: PLACE_CATEGORIES.filter((category) =>
          counts.has(category.id),
        ).map((category) => ({
          color: category.color,
          label: t(category.label),
          count: counts.get(category.id),
        })),
        info: notes.join(' · '),
        list: leading.length
          ? {
              ariaLabel: t('Places in view'),
              items: leading.map((place, index) => ({
                id: place.id,
                ordinal: index + 1,
                lead:
                  place.category === 'top-rated'
                    ? `★${place.rating.toFixed(1)}`
                    : t(placeCategory(place.category).label),
                text: place.kind ? `${place.name} · ${place.kind}` : place.name,
                accent: placeCategory(place.category).color,
              })),
            }
          : null,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_places.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _places.slice(0, limit).map(mapPlaceAnalystRecord);
    },

    getStats() {
      return {
        count: _places.length,
        lastUpdate: _lastUpdate,
        error: _lastError ? translateFeedError(_lastError) : null,
        stale: false,
      };
    },
  };
  return layer;
}
