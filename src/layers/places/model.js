/**
 * @module layers/places/model
 *
 * Places of interest for Victoria, Australia: heritage places, landmarks,
 * cultural venues, parks and outdoor sites, Gunaikurnai Country, and
 * Google's top-rated attractions. Pure — no Cesium, no network. The server
 * proxy and the layer share it.
 */
// A portable export: no i18n here. Labels stay English data; the layer card
// shows them translated.
const msg = (text) => text;

/** Categories in drawing order, with marker colours and legend labels. */
export const PLACE_CATEGORIES = Object.freeze(
  [
    { id: 'heritage', label: msg('Heritage'), color: '#e0b04a' },
    { id: 'landmark', label: msg('Landmarks and lookouts'), color: '#f4f1de' },
    { id: 'culture', label: msg('Museums and galleries'), color: '#c77dff' },
    { id: 'outdoors', label: msg('Parks and outdoors'), color: '#80ed99' },
    { id: 'country', label: msg('Gunaikurnai Country'), color: '#ff8c42' },
    { id: 'top-rated', label: msg('Top rated on Google'), color: '#4cc9f0' },
  ].map(Object.freeze),
);
const CATEGORY_BY_ID = new Map(PLACE_CATEGORIES.map((c) => [c.id, c]));

export function placeCategory(id) {
  return CATEGORY_BY_ID.get(id) ?? null;
}

export const PLACES_OVERLAY_SOURCE_ID = 'local-places';
export const PLACES_OVERLAY_COHORT_LIMIT = 48;
export const PLACES_OVERLAY_COLLISION_CAPACITY = 32;

/** The layer is built for Victoria; requests outside it are refused. */
export const VICTORIA_BOUNDS = Object.freeze({
  west: 140.9,
  south: -39.25,
  east: 150.1,
  north: -33.9,
});

/** Widest request window, in degrees: about a region, not the whole state. */
export const PLACES_MAX_SPAN_DEG = 1.5;

/** Google ratings the layer counts as top rated. */
export const TOP_RATED_MIN_RATING = 4.0;
export const TOP_RATED_MIN_REVIEWS = 50;

/**
 * Vicmap Features of Interest kept by the layer: `feature_type` →
 * `feature_subtype` → category. Schools, churches, playgrounds, towers and
 * the like are left out; this layer is for places worth visiting.
 */
export const FOI_CATEGORIES = Object.freeze({
  // Most `landmark` features are broadcast towers; only these subtypes count.
  landmark: Object.freeze({
    monument: 'landmark',
    lookout: 'landmark',
    'tourist attraction': 'landmark',
  }),
  place: Object.freeze({ 'historic site': 'heritage' }),
  'cultural centre': Object.freeze({
    museum: 'culture',
    'art gallery': 'culture',
  }),
  'community space': Object.freeze({ 'camp ground': 'outdoors' }),
  'recreational resource': Object.freeze({
    'picnic site': 'outdoors',
    'day visitor area': 'outdoors',
  }),
  'admin facility': Object.freeze({ 'tourist information centre': 'landmark' }),
});

/** ArcGIS `where` clause selecting exactly the kept feature types. */
export function foiWhereClause() {
  const quote = (text) => `'${text.replace(/'/g, "''")}'`;
  return Object.entries(FOI_CATEGORIES)
    .map(
      ([type, subtypes]) =>
        `(feature_type=${quote(type)} AND feature_subtype IN (${Object.keys(
          subtypes,
        )
          .map(quote)
          .join(',')}))`,
    )
    .join(' OR ');
}

/**
 * Places published by the State and GLaWAC under their Gunaikurnai names.
 * Kept deliberately small: only names Gunaikurnai have made public.
 */
export const GUNAIKURNAI_PLACES = Object.freeze(
  [
    {
      id: 'durt-yowan',
      name: 'Durt-Yowan',
      english: 'Latrobe River',
      lat: -38.165,
      lon: 146.46,
      note: msg('Gunaikurnai name for the Latrobe River'),
      source: 'https://www.water.vic.gov.au/',
    },
  ].map(Object.freeze),
);

/**
 * Parks and reserves held as Aboriginal Title and jointly managed by
 * Gunaikurnai and the State, from gunaikurnai.org/our-country/joint-management.
 * Matched case-insensitively against park names.
 */
export const GUNAIKURNAI_JOINT_MANAGED = Object.freeze([
  'the knob reserve',
  'new guinea cave',
  'tarra-bulga national park',
  'lake tyers',
  'mitchell river national park',
  'buchan caves reserve',
  'the lakes national park',
  'raymond island',
  'gippsland lakes coastal park',
  'corringle foreshore reserve',
]);

export function isJointlyManaged(name) {
  const text = String(name ?? '').toLowerCase();
  return GUNAIKURNAI_JOINT_MANAGED.some((park) => text.includes(park));
}

const finite = (value) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number)
    ? number
    : null;
};
const cleanText = (value, max = 120) =>
  typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : null;

/** Parse and bound a `west,south,east,north` request window inside Victoria. */
export function parsePlacesBbox(raw) {
  const parts = String(raw ?? '')
    .split(',')
    .map((part) => (part.trim() ? Number(part) : NaN));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  if (east - west > PLACES_MAX_SPAN_DEG || north - south > PLACES_MAX_SPAN_DEG)
    return null;
  const v = VICTORIA_BOUNDS;
  if (east < v.west || west > v.east || north < v.south || south > v.north)
    return null;
  return { west, south, east, north };
}

/** Round a window outwards to a 0.25° grid so nearby views share a cache key. */
export function snapPlacesBbox({ west, south, east, north }) {
  const step = 0.25;
  const down = (value) => Math.floor(value / step) * step;
  const up = (value) => Math.ceil(value / step) * step;
  return {
    west: down(west),
    south: down(south),
    east: up(east),
    north: up(north),
  };
}

/** Normalize Vicmap FOI GeoJSON features into places. */
export function normalizeFoiFeatures(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const places = [];
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const [lon, lat] = feature?.geometry?.coordinates ?? [];
    const category =
      FOI_CATEGORIES[props.feature_type]?.[props.feature_subtype] ?? null;
    const name = cleanText(props.name_label) ?? cleanText(props.name);
    if (!category || !name || finite(lat) === null || finite(lon) === null)
      continue;
    places.push({
      id: `foi:${props.pfi ?? props.feature_id ?? props.OBJECTID}`,
      category,
      name,
      kind: cleanText(props.feature_subtype, 60),
      lat: Number(lat),
      lon: Number(lon),
      source: 'Vicmap Features of Interest',
    });
  }
  return places;
}

/** Heritage authorities whose records are not shown: VHI holds mostly
 * archaeological sites, whose locations are kept vague on purpose. */
const HIDDEN_HERITAGE_AUTHORITIES = new Set(['VHI']);

/** Normalize Victorian Heritage Database `/v1/places` results. */
export function normalizeHeritagePlaces(payload) {
  const rows = Array.isArray(payload?._embedded?.places)
    ? payload._embedded.places
    : [];
  const places = [];
  for (const row of rows) {
    const authority = cleanText(row?.heritage_authority_brief, 20);
    if (!authority || HIDDEN_HERITAGE_AUTHORITIES.has(authority)) continue;
    const [lat, lon] = String(row?.latlon ?? '')
      .split(',')
      .map((part) => finite(part.trim()));
    const name = cleanText(row?.name);
    if (!name || lat == null || lon == null) continue;
    const url = cleanText(row?.url, 300);
    places.push({
      id: `vhd:${row.id}`,
      category: 'heritage',
      // The database keeps names in capitals; show them as titles.
      name: name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
      kind: cleanText(row?.heritage_authority_name, 80),
      register: cleanText(row?.vhr_number, 20),
      lat,
      lon,
      url:
        url && /^https:\/\/vhd\.heritagecouncil\.vic\.gov\.au\//.test(url)
          ? url
          : `https://vhd.heritagecouncil.vic.gov.au/places/${encodeURIComponent(row.id)}`,
      source: 'Victorian Heritage Database',
    });
  }
  return places;
}

/** A polygon or multipolygon's label point: the centre of its largest ring's box. */
function labelPoint(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  let best = null;
  for (const polygon of polygons) {
    const ring = polygon?.[0];
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity;
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    const area = (e - w) * (n - s);
    if (Number.isFinite(area) && (!best || area > best.area))
      best = { area, lon: (w + e) / 2, lat: (s + n) / 2 };
  }
  return best;
}

/** Normalize Parks and Conservation Reserves (PARKRES) features, one per name. */
export function normalizeParkFeatures(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const byName = new Map();
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const name = cleanText(
      props.NAME ?? props.name ?? props.NAME_LABEL ?? props.name_label,
    );
    const point = labelPoint(feature?.geometry);
    if (!name || !point) continue;
    const previous = byName.get(name);
    if (previous && previous.area >= point.area) continue;
    byName.set(name, {
      id: `park:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: isJointlyManaged(name) ? 'country' : 'outdoors',
      name: name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
      kind: isJointlyManaged(name)
        ? msg('Jointly managed with Gunaikurnai')
        : cleanText(props.AREA_TYPE ?? props.area_type ?? props.TYPE, 60),
      lat: point.lat,
      lon: point.lon,
      area: point.area,
      source: 'Parks and Conservation Reserves (DEECA)',
    });
  }
  return [...byName.values()]
    .sort((a, b) => b.area - a.area)
    .map(({ area, ...place }) => place);
}

/** The Registered Aboriginal Party names covering a window, from RAP features. */
export function normalizeRapNames(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const names = new Set();
  for (const feature of features) {
    // Only the corporation's name is read: the layer also carries contacts.
    const name = cleanText(
      feature?.properties?.NAME ?? feature?.properties?.name,
    );
    if (name) names.add(name);
  }
  return [...names];
}

/** Normalize a Google Places (New) text-search response to top-rated places. */
export function normalizeGooglePlaces(payload) {
  const rows = Array.isArray(payload?.places) ? payload.places : [];
  const places = [];
  for (const row of rows) {
    const rating = finite(row?.rating);
    const reviews = finite(row?.userRatingCount);
    const lat = finite(row?.location?.latitude);
    const lon = finite(row?.location?.longitude);
    const name = cleanText(row?.displayName?.text);
    if (
      !name ||
      lat === null ||
      lon === null ||
      rating === null ||
      rating < TOP_RATED_MIN_RATING ||
      (reviews ?? 0) < TOP_RATED_MIN_REVIEWS
    )
      continue;
    const uri = cleanText(row?.googleMapsUri, 300);
    places.push({
      id: `google:${cleanText(row?.id, 200) ?? name}`,
      category: 'top-rated',
      name,
      kind: cleanText(row?.primaryTypeDisplayName?.text, 60),
      lat,
      lon,
      rating,
      reviews,
      url: uri && /^https:\/\/maps\.google\.com\//.test(uri) ? uri : null,
      source: 'Google Maps',
    });
  }
  return places;
}

/** Validate a proxy places snapshot before the layer draws it. */
export function validatePlacesSnapshot(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.places))
    return null;
  const places = value.places.filter(
    (place) =>
      place &&
      typeof place.id === 'string' &&
      typeof place.name === 'string' &&
      CATEGORY_BY_ID.has(place.category) &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lon),
  );
  return {
    places,
    country: Array.isArray(value.country)
      ? value.country.filter((name) => typeof name === 'string').slice(0, 8)
      : [],
    errors: Array.isArray(value.errors)
      ? value.errors.filter((e) => typeof e === 'string')
      : [],
    googleConfigured: value.googleConfigured !== false,
  };
}

/** One place label for the overlay host. Top-rated and heritage win space. */
export function createPlaceOverlayEntry({
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
    gapPx: 10,
    verticalOnly: true,
    placement: 'above',
  };
}

const CATEGORY_PRIORITY = Object.freeze({
  country: 6,
  heritage: 5,
  'top-rated': 4,
  landmark: 3,
  culture: 2,
  outdoors: 1,
});

export function placePriority(place) {
  return (
    (CATEGORY_PRIORITY[place.category] ?? 0) * 1000 +
    Math.min(999, Math.round((place.reviews ?? 0) / 10))
  );
}

/** JSON-safe record for the analyst query engine. */
export function mapPlaceAnalystRecord(place, index = 0) {
  return {
    id: place.id || `PLACE-${String(index).padStart(4, '0')}`,
    name: place.name,
    category: place.category,
    kind: place.kind ?? null,
    rating: place.rating ?? null,
    reviews: place.reviews ?? null,
    lat: place.lat,
    lon: place.lon,
  };
}
