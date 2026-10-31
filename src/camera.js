import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * Default start: fly in over Port Phillip Bay to the Melbourne skyline.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Where the app opens: up over the bay side of Port Melbourne, looking
 * north-east at a 35° tilt across Docklands to the Melbourne CBD (the
 * owner's chosen target, -37.8136, 144.9631, and their reference
 * screenshot). Heading and pitch are worked out from the two points.
 */
export const START_TARGET = Object.freeze({ lat: -37.8136, lon: 144.9631 });
const START_FROM = Object.freeze({ lat: -37.8367, lon: 144.9283, alt: 2800 });
export const START_VIEW = Object.freeze({
  ...START_FROM,
  ...aimAt(START_FROM, START_TARGET),
});

/**
 * Heading and pitch, in degrees, that point a camera at a ground target a
 * few kilometres away (flat-earth approximation, fine at city scale).
 */
export function aimAt(from, target) {
  const metresPerDegree = 111320;
  const north = (target.lat - from.lat) * metresPerDegree;
  const east =
    (target.lon - from.lon) *
    metresPerDegree *
    Math.cos((from.lat * Math.PI) / 180);
  const ground = Math.hypot(north, east);
  const heading = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  const pitch = (-Math.atan2(from.alt || 0, ground) * 180) / Math.PI;
  return { heading, pitch };
}

/**
 * Set the camera over Melbourne on load with a cinematic fly-in.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToStartView(viewer) {
  // Start from a high altitude over the city, then fly down onto the bay
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      START_TARGET.lon,
      START_TARGET.lat,
      25000,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        START_VIEW.lon,
        START_VIEW.lat,
        START_VIEW.alt,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(START_VIEW.heading),
        pitch: Cesium.Math.toRadians(START_VIEW.pitch),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}
