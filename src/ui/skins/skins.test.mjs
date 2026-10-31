import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SKIN,
  PHOSPHOR_COLOURS,
  SKINS,
  readSkinPreferences,
  writeSkinPreferences,
} from './skinCatalog.js';
import { BOOT_LOGIN_MASK, BOOT_PASSWORD } from './skinBoot.js';
import { buildMenuTree, nodeMatches, walkTree } from './skinMenuModel.js';
import {
  distanceBand,
  distanceKm,
  pickLuckyStation,
  stationGenre,
  stationName,
  GENRE_NAMES,
} from './skinRadio.js';
import { STATION_GENRES } from './stationGenres.js';
import { logTime } from './skinNotices.js';
import { PICTURE_QUALITIES } from './skinCatalog.js';
import { PICTURE_PRESETS, applyPictureQuality } from './skinPicture.js';
import { favouriteNodes, toggleFavourite } from './skinFavourites.js';
import { WINDOW_MIN, clampToBounds } from './skinWindows.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test('only the finished skins can be chosen; the rest are listed for later', () => {
  const available = SKINS.filter((skin) => skin.available).map(
    (skin) => skin.id,
  );
  assert.deepEqual(available, ['atomic-deco-y2k', 'phosphor']);
  for (const skin of SKINS) {
    if (skin.available) assert.ok(skin.preview && skin.description, skin.id);
    else assert.equal(skin.swatch.length, 3, skin.id);
  }
});

test('Phosphor colours keep four tiers and map onto the globe filter tint bands', () => {
  assert.deepEqual(
    PHOSPHOR_COLOURS.map((colour) => colour.id),
    ['green', 'amber', 'blue', 'white'],
  );
  PHOSPHOR_COLOURS.forEach((colour, index) => {
    assert.equal(colour.tiers.length, 4);
    // src/styles/phosphor.js picks the hue in quarter bands of `tint`.
    assert.ok(colour.tint > index * 0.25 && colour.tint < (index + 1) * 0.25);
  });
});

test('skin preferences fall back to defaults and survive a round trip', () => {
  const defaults = {
    skin: DEFAULT_SKIN,
    bootAnimation: true,
    welcomeSeen: false,
    crtOverlay: false,
    pictureQuality: 'sharp',
    favourites: [],
    favouritesCollapsed: false,
    favouritesPos: null,
  };
  assert.deepEqual(readSkinPreferences(memoryStorage()), defaults);
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readSkinPreferences(throwing).skin, DEFAULT_SKIN);
  assert.doesNotThrow(() =>
    writeSkinPreferences({ skin: 'phosphor' }, throwing),
  );

  const storage = memoryStorage();
  writeSkinPreferences(
    {
      skin: 'phosphor',
      bootAnimation: false,
      welcomeSeen: true,
      crtOverlay: true,
      pictureQuality: 'fast',
      favourites: ['bloom', 'layer:flights', 'bloom', 7],
      favouritesCollapsed: true,
      favouritesPos: { x: 40, y: 'nope' },
    },
    storage,
  );
  assert.deepEqual(readSkinPreferences(storage), {
    skin: 'phosphor',
    bootAnimation: false,
    welcomeSeen: true,
    crtOverlay: true,
    pictureQuality: 'fast',
    favourites: ['bloom', 'layer:flights'],
    favouritesCollapsed: true,
    favouritesPos: null,
  });
  writeSkinPreferences({ skin: 'phosphor', pictureQuality: 'ultra' }, storage);
  assert.equal(readSkinPreferences(storage).pictureQuality, 'sharp');
  writeSkinPreferences({ skin: 'decopunk' }, storage);
  assert.equal(
    readSkinPreferences(storage).skin,
    DEFAULT_SKIN,
    'a later skin cannot be restored',
  );
});

test('the login types eight masked characters and a 23-character password', () => {
  assert.equal(BOOT_LOGIN_MASK, '********');
  assert.equal(BOOT_PASSWORD.length, 'Godseyeviewaccessportal'.length);
});

function fakeContext(overrides = {}) {
  const exists = new Set([
    'radio-panel',
    'scene-panel',
    'cctv-panel',
    'gev-voice-button',
  ]);
  return {
    sm: {},
    dom: {
      exists: (id) => exists.has(id),
      click: () => true,
      pressed: () => false,
      byId: () => null,
      setValue: () => true,
    },
    layers: () => [
      {
        id: 'flights',
        name: 'Flights',
        showInTogglePanel: true,
        enabled: true,
        stats: {},
      },
      {
        id: 'cctv',
        name: 'CCTV',
        showInTogglePanel: true,
        enabled: false,
        stats: {},
      },
      {
        id: 'radio',
        name: 'Radio',
        showInTogglePanel: true,
        enabled: false,
        stats: {},
      },
      {
        id: 'mystery',
        name: 'Mystery Feed',
        showInTogglePanel: true,
        enabled: false,
        stats: {},
      },
      {
        id: 'hidden',
        name: 'Hidden',
        showInTogglePanel: false,
        enabled: false,
        stats: {},
      },
    ],
    layer: () => null,
    liveCount: () => 1,
    controlState: () => ({ style: 'normal', hud: {}, models3d: {} }),
    skin: () => 'atomic-deco-y2k',
    mapStacks: () => [],
    radioState: () => null,
    ...overrides,
  };
}

test('every menu leaf says what it does and what happens, with a unique id', () => {
  const tree = buildMenuTree(fakeContext());
  const ids = new Set();
  walkTree(tree, (node) => {
    assert.ok(node.label, 'label');
    assert.ok(node.desc, `${node.label} needs a description`);
    if (node.type === 'folder') return;
    assert.ok(node.result, `${node.label} needs a result`);
    assert.ok(node.id && !ids.has(node.id), `${node.label} needs a unique id`);
    ids.add(node.id);
    if (node.type === 'action') assert.equal(typeof node.run, 'function');
    if (node.type === 'toggle' || node.type === 'select')
      assert.equal(typeof node.set, 'function', node.id);
  });
  assert.equal(tree[0].id, 'quick-start', 'Quick Start is pinned first');
  assert.equal(tree[1].label, 'System', 'system settings come next');
});

test('live layers are grouped, hidden layers stay out, unknown layers keep their name', () => {
  const tree = buildMenuTree(fakeContext());
  const ids = [];
  walkTree(tree, (node) => node.layerId && ids.push(node.layerId));
  assert.deepEqual(ids.sort(), ['cctv', 'flights', 'mystery', 'radio']);
  let mystery;
  walkTree(tree, (node) => {
    if (node.layerId === 'mystery') mystery = node;
  });
  assert.equal(mystery.label, 'Mystery Feed');
  assert.ok(
    nodeMatches(
      tree.find((node) => node.label === 'Live Data'),
      'aircraft',
    ),
  );
  assert.ok(!nodeMatches(tree[0], 'zzz'));
});

test('the Phosphor skin leaves the globe filter alone and keeps CRT lines opt-in', () => {
  const find = (tree, id) => {
    let found;
    walkTree(tree, (node) => {
      if (node.id === id) found = node;
    });
    return found;
  };
  const phosphor = buildMenuTree(fakeContext({ skin: () => 'phosphor' }));
  assert.equal(find(phosphor, 'filter').warn, undefined);
  assert.equal(find(phosphor, 'crt-overlay').available(), true);
  const deco = buildMenuTree(fakeContext());
  assert.equal(find(deco, 'crt-overlay').available(), false);
});

test('API keys sit at the bottom of the menu and every classic panel has a window', () => {
  const tree = buildMenuTree(fakeContext());
  const last = tree.at(-1);
  assert.equal(last.id, 'keys');
  assert.equal(last.pinned, true);
  const windows = tree.find((node) => node.label === 'Tool Windows');
  assert.deepEqual(
    windows.children.map((node) => node.id),
    ['window:radio-panel', 'window:cctv-panel', 'window:scene-panel'],
    'only panels that exist are listed',
  );
});

test('picture quality offers three presets with Sharp drawing at native pixels', () => {
  assert.deepEqual(Object.keys(PICTURE_PRESETS), PICTURE_QUALITIES);
  assert.equal(PICTURE_PRESETS.sharp.nativePixels, true);
  assert.ok(
    PICTURE_PRESETS.sharp.tileError < PICTURE_PRESETS.balanced.tileError,
  );
  const tileset = {
    maximumScreenSpaceError: 16,
    tileLoadProgressEvent: {},
  };
  let listener;
  const viewer = {
    scene: {
      postProcessStages: { fxaa: { enabled: true } },
      globe: { maximumScreenSpaceError: 2 },
      primitives: {
        length: 1,
        get: () => tileset,
        primitiveAdded: {
          addEventListener(fn) {
            listener = fn;
            return () => (listener = null);
          },
        },
      },
    },
  };
  const stop = applyPictureQuality(viewer, 'sharp');
  assert.equal(viewer.useBrowserRecommendedResolution, false);
  assert.equal(viewer.scene.msaaSamples, 4);
  assert.equal(viewer.scene.postProcessStages.fxaa.enabled, false);
  assert.equal(tileset.maximumScreenSpaceError, 8);
  const later = { maximumScreenSpaceError: 16, tileLoadProgressEvent: {} };
  listener(later);
  assert.equal(later.maximumScreenSpaceError, 8);
  stop();
  assert.equal(listener, null);
  applyPictureQuality(viewer, 'fast');
  assert.equal(viewer.useBrowserRecommendedResolution, true);
  assert.equal(tileset.maximumScreenSpaceError, 24);
});

test('favourites keep the order they were starred and skip settings that are gone', () => {
  const tree = buildMenuTree(fakeContext());
  let ids = [];
  ids = toggleFavourite(ids, 'bloom');
  ids = toggleFavourite(ids, 'layer:flights');
  ids = toggleFavourite(ids, 'gone');
  assert.deepEqual(
    favouriteNodes(tree, ids).map((node) => node.id),
    ['bloom', 'layer:flights'],
  );
  assert.deepEqual(toggleFavourite(ids, 'bloom'), ['layer:flights', 'gone']);
});

test('windows stay reachable inside the area between the bars', () => {
  const bounds = { left: 0, top: 60, right: 1000, bottom: 800 };
  assert.deepEqual(
    clampToBounds({ x: -900, y: 10, width: 400, height: 50 }, bounds),
    { x: -320, y: 60, width: 400, height: WINDOW_MIN.height },
  );
  assert.deepEqual(
    clampToBounds({ x: 5000, y: 5000, width: 400, height: 300 }, bounds),
    { x: 920, y: 768, width: 400, height: 300 },
  );
});

test('Feeling Lucky walks outward from the nearest unheard station, then wraps', () => {
  const anchor = { lat: 30.27, lon: -97.74 };
  const stations = [
    { id: 'far', lat: 51.5, lon: -0.12 },
    { id: 'near', lat: 30.28, lon: -97.73 },
    { id: 'mid', lat: 29.42, lon: -98.49 },
  ];
  const ranked = stations
    .map((station) => ({ station, km: distanceKm(anchor, station) }))
    .sort((a, b) => a.km - b.km);
  const heard = new Set();
  const order = [];
  for (let index = 0; index < 3; index += 1) {
    const { station, wrapped } = pickLuckyStation(ranked, heard);
    assert.equal(wrapped, false);
    heard.add(station.id);
    order.push(station.id);
  }
  assert.deepEqual(order, ['near', 'mid', 'far']);
  assert.deepEqual(pickLuckyStation(ranked, heard), {
    station: stations[1],
    wrapped: true,
  });
  assert.deepEqual(pickLuckyStation([], heard), {
    station: null,
    wrapped: false,
  });
});

test('Feeling Lucky skips stations that failed to play', () => {
  const ranked = ['a', 'b', 'c'].map((id, km) => ({ station: { id }, km }));
  const failed = new Set(['a']);
  assert.equal(pickLuckyStation(ranked, new Set(), failed).station.id, 'b');
  assert.deepEqual(
    pickLuckyStation(ranked, new Set(['b', 'c']), failed).station.id,
    'b',
  );
  assert.deepEqual(
    pickLuckyStation(ranked, new Set(), new Set(['a', 'b', 'c'])),
    {
      station: null,
      wrapped: false,
    },
  );
});

test('live directory tags fold into a short list of genres', () => {
  const genre = (...tags) => stationGenre({ tags });
  // Spellings seen side by side in the live directory.
  for (const tag of ['80s', '80er', "80's", '1930', '78', 'classic vinyl'])
    assert.equal(genre(tag), 'Oldies', tag);
  // A network or band tag first falls through to the next tag.
  assert.equal(genre('dab', 'capital', 'pop'), 'Pop');
  assert.equal(genre('#', 'anthems'), 'Dance & Electronic');
  assert.equal(genre('noaa weather radio'), 'Weather');
  assert.equal(genre('k pop'), 'World');
  assert.equal(genre('dancehall'), 'Reggae & Caribbean');
  assert.equal(genre('classic rock'), 'Rock');
  assert.equal(genre('choral'), 'Classical');
  assert.equal(genre('dab', 'capital'), '');
  // With no usable tag, the name is tried.
  const named = (name, ...tags) => stationGenre({ name, tags });
  assert.equal(named('Adroit Jazz Underground'), 'Jazz');
  assert.equal(named('100 BEST IBIZA DEEP HOUSE', 'dab'), 'Dance & Electronic');
  assert.equal(named('Rock Antenne', 'pop'), 'Pop');
  assert.equal(named('Radio 1'), '');
  assert.equal(genre(), '');
});

test('hand-checked station genres use the finder genre names and win over tags', () => {
  const unknown = Object.entries(STATION_GENRES).filter(
    ([, genre]) => !GENRE_NAMES.includes(genre),
  );
  assert.deepEqual(unknown, []);
  for (const id of Object.keys(STATION_GENRES))
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  assert.equal(
    stationGenre({
      id: '399ca326-0f67-4015-a51b-d7ba2bd4ebbe',
      name: 'KEXP',
      tags: ['news'],
    }),
    'Rock',
  );
});

test('tags seen on untagged live stations now find a genre', () => {
  const genre = (...tags) => stationGenre({ tags });
  assert.equal(genre('police scanner'), 'Emergency & Traffic');
  assert.equal(genre('traffic'), 'Emergency & Traffic');
  assert.equal(genre('campursari', 'dangdut'), 'World');
  assert.equal(genre('manele'), 'World');
  assert.equal(genre('hardcore', 'hardstyle'), 'Dance & Electronic');
  assert.equal(genre('idm'), 'Dance & Electronic');
  assert.equal(genre('zouk'), 'Reggae & Caribbean');
  assert.equal(genre('soca', 'various'), 'Reggae & Caribbean');
  assert.equal(genre('mpb', 'romantica'), 'Latin');
  assert.equal(genre('bhakti', 'devotional'), 'Religious');
  assert.equal(genre('info'), 'News');
  assert.equal(genre('economics'), 'News');
  assert.equal(genre('california', 'eclectic'), 'Eclectic');
  assert.equal(genre('composer', 'contemporary', 'experimental'), 'Classical');
  assert.equal(genre('main', 'mainstream'), 'Pop');
});

test('station names decode the HTML entities the directory sends', () => {
  assert.equal(
    stationName({ name: 'KISS - The Best Vibes &amp; Energy' }),
    'KISS - The Best Vibes & Energy',
  );
  assert.equal(
    stationName({ name: 'Rock &#39;n&#x27; Roll' }),
    "Rock 'n' Roll",
  );
  assert.equal(stationName({ name: 'Fish &chips; &#1;' }), 'Fish &chips; &#1;');
});

test('station distances fall into the finder bands', () => {
  assert.ok(
    Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.2) < 0.5,
  );
  assert.equal(distanceBand(3), 'NEAR YOU');
  assert.equal(distanceBand(300), 'IN YOUR REGION');
  assert.equal(distanceBand(2000), 'FURTHER OUT');
  assert.equal(distanceBand(8000), 'OVERSEAS');
});

test('Action Log times are HH:MM:SS', () => {
  assert.equal(logTime(new Date(2026, 9, 30, 7, 5, 9)), '07:05:09');
});
