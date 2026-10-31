import { msg } from '../../i18n/index.js';

/**
 * Skins change the whole interface: palette, fonts, shapes, symbol and the
 * restart sequence. Visual presets (src/styles) only change the globe.
 * A skin without `available` is listed in the picker as coming later.
 */
export const SKINS = Object.freeze([
  {
    id: 'atomic-deco-y2k',
    name: msg('Atomic Deco Y2K'),
    description: msg(
      'Brass and walnut, ivory cards, a Deco face and the starburst.',
    ),
    preview: '/skins/atomic-deco-y2k.jpg',
    available: true,
  },
  {
    id: 'phosphor',
    name: msg('Phosphor'),
    description: msg(
      'One-colour CRT terminal. Restarts with a full boot and login.',
    ),
    preview: '/skins/phosphor.jpg',
    available: true,
  },
  {
    id: 'decopunk',
    name: msg('Decopunk'),
    swatch: ['#c9a24a', '#d2412f', '#3b2416'],
  },
  {
    id: 'streamline-moderne',
    name: msg('Streamline Moderne'),
    swatch: ['#c46a5c', '#cfd3d6', '#8a9096'],
  },
  {
    id: 'atompunk',
    name: msg('Atompunk'),
    swatch: ['#2f5bd3', '#7fe3dc', '#e8242b'],
  },
  {
    id: 'atomic-age',
    name: msg('Atomic Age'),
    swatch: ['#efe6cf', '#3aa6a0', '#8a5a35'],
  },
  {
    id: 'neo-y2k',
    name: msg('Neo-Y2K'),
    swatch: ['#f2b6f0', '#a6ecff', '#111111'],
  },
  {
    id: 'metalheart',
    name: msg('Metalheart'),
    swatch: ['#0b0f10', '#4a6b6a', '#9fb8b5'],
  },
  {
    id: 'dark-aero',
    name: msg('Dark Aero'),
    swatch: ['#05080c', '#1aa3ff', '#3a4652'],
  },
  {
    id: 'skeuomorphism',
    name: msg('Skeuomorphism'),
    swatch: ['#d9dadb', '#4a3a2c', '#f08a24'],
  },
]);

export const DEFAULT_SKIN = 'atomic-deco-y2k';

/**
 * Phosphor colour presets: the four brightness tiers of one hue, and the
 * matching `tint` uniform of the phosphor globe filter (src/styles/phosphor.js).
 */
export const PHOSPHOR_COLOURS = Object.freeze([
  {
    id: 'green',
    label: msg('GREEN'),
    tint: 0.125,
    tiers: ['#00ff00', '#00be00', '#007f00', '#003f00'],
  },
  {
    id: 'amber',
    label: msg('AMBER'),
    tint: 0.375,
    tiers: ['#ffbf00', '#be8e00', '#7f5f00', '#3f2f00'],
  },
  {
    id: 'blue',
    label: msg('BLUE'),
    tint: 0.625,
    tiers: ['#007fff', '#005fbe', '#003f7f', '#001f3f'],
  },
  {
    id: 'white',
    label: msg('WHITE'),
    tint: 0.875,
    tiers: ['#ffffff', '#bebebe', '#7f7f7f', '#3f3f3f'],
  },
]);

export const SKIN_STORAGE_KEY = 'gev:skin:v1';

export function skinById(id) {
  return SKINS.find((skin) => skin.id === id && skin.available) || null;
}

export function phosphorColour(id) {
  return (
    PHOSPHOR_COLOURS.find((colour) => colour.id === id) || PHOSPHOR_COLOURS[0]
  );
}

/**
 * Read the saved skin preferences. Storage can be missing or throw (private
 * windows, blocked site data); the defaults always apply then.
 * @param {Storage} [storage]
 * @returns {{skin: string, bootAnimation: boolean, welcomeSeen: boolean}}
 */
export function readSkinPreferences(storage = globalThis.localStorage) {
  const defaults = {
    skin: DEFAULT_SKIN,
    bootAnimation: true,
    welcomeSeen: false,
  };
  try {
    const saved = JSON.parse(storage?.getItem(SKIN_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      skin: skinById(saved.skin)?.id || DEFAULT_SKIN,
      bootAnimation: saved.bootAnimation !== false,
      welcomeSeen: saved.welcomeSeen === true,
    };
  } catch {
    return defaults;
  }
}

export function writeSkinPreferences(
  preferences,
  storage = globalThis.localStorage,
) {
  try {
    storage?.setItem(
      SKIN_STORAGE_KEY,
      JSON.stringify({
        skin: preferences.skin,
        bootAnimation: preferences.bootAnimation !== false,
        welcomeSeen: preferences.welcomeSeen === true,
      }),
    );
  } catch {
    /* Preferences are a convenience; the session keeps working without them. */
  }
}
