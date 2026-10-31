import { msg } from '../../i18n/index.js';

/*
 * Picture Quality: one choice for how sharp the globe is drawn. Sharp is the
 * default: it draws at the screen's real pixel density (Cesium otherwise
 * draws at CSS pixels, which looks soft on Retina screens), loads finer 3D
 * tiles and imagery, keeps 4× MSAA and drops FXAA, which blurs text and fine
 * edges. Sharpen is eased to Low because native pixels need far less of it.
 */
export const PICTURE_PRESETS = Object.freeze({
  fast: Object.freeze({
    label: msg('Fast'),
    nativePixels: false,
    tileError: 24,
    globeError: 3,
    msaa: 1,
    fxaa: true,
    sharpenPct: 0,
  }),
  balanced: Object.freeze({
    label: msg('Balanced'),
    nativePixels: false,
    tileError: 16,
    globeError: 2,
    msaa: 4,
    fxaa: false,
    sharpenPct: 33,
  }),
  sharp: Object.freeze({
    label: msg('Sharp'),
    nativePixels: true,
    tileError: 8,
    globeError: 1.5,
    msaa: 4,
    fxaa: false,
    sharpenPct: 33,
  }),
});

/** Above 2× the GPU cost grows faster than anyone can see the difference. */
export const MAX_PIXEL_RATIO = 2;

function isTileset(primitive) {
  // Duck-typed: class names do not survive minification.
  return (
    typeof primitive?.maximumScreenSpaceError === 'number' &&
    typeof primitive?.tileLoadProgressEvent === 'object'
  );
}

/**
 * Apply a preset's render settings to the viewer and to every 3D tileset,
 * now and as tilesets are added later.
 * @param {object} viewer Cesium.Viewer
 * @param {string} id Key of PICTURE_PRESETS.
 * @returns {() => void} Stops following new tilesets.
 */
export function applyPictureQuality(viewer, id) {
  const preset = PICTURE_PRESETS[id] || PICTURE_PRESETS.sharp;
  const scene = viewer?.scene;
  if (!scene) return () => {};
  const ratio = globalThis.devicePixelRatio || 1;
  viewer.useBrowserRecommendedResolution = !preset.nativePixels;
  viewer.resolutionScale = preset.nativePixels
    ? Math.min(1, MAX_PIXEL_RATIO / ratio)
    : 1;
  try {
    scene.msaaSamples = preset.msaa;
  } catch {
    /* WebGL 1 has no MSAA; FXAA below still applies. */
  }
  if (scene.postProcessStages?.fxaa)
    scene.postProcessStages.fxaa.enabled = preset.fxaa;
  if (scene.globe) scene.globe.maximumScreenSpaceError = preset.globeError;
  const tune = (primitive) => {
    if (isTileset(primitive))
      primitive.maximumScreenSpaceError = preset.tileError;
  };
  const primitives = scene.primitives;
  for (let index = 0; index < (primitives?.length || 0); index += 1)
    tune(primitives.get(index));
  const stop = primitives?.primitiveAdded?.addEventListener?.(tune);
  scene.requestRender?.();
  return typeof stop === 'function' ? stop : () => {};
}
