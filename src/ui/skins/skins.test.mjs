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
} from './skinRadio.js';
import { logTime } from './skinNotices.js';

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
  assert.deepEqual(readSkinPreferences(memoryStorage()), {
    skin: DEFAULT_SKIN,
    bootAnimation: true,
    welcomeSeen: false,
  });
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
    { skin: 'phosphor', bootAnimation: false, welcomeSeen: true },
    storage,
  );
  assert.deepEqual(readSkinPreferences(storage), {
    skin: 'phosphor',
    bootAnimation: false,
    welcomeSeen: true,
  });
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

test('the Phosphor skin warns when another globe filter would clash', () => {
  const find = (tree) => {
    let found;
    walkTree(tree, (node) => {
      if (node.id === 'filter') found = node;
    });
    return found;
  };
  assert.equal(find(buildMenuTree(fakeContext())).warn(), null);
  const phosphor = fakeContext({ skin: () => 'phosphor' });
  assert.match(find(buildMenuTree(phosphor)).warn(), /Phosphor/);
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
  assert.equal(genre('dancehall'), 'Reggae');
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
