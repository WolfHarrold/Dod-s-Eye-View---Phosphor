import { msg } from '../i18n/index.js';

/**
 * Phosphor — single-hue CRT terminal look from the Phosphor design system
 * One hue on black at four brightness tiers (255/190/127/63) + glow +
 * 1-in-2 scanlines + rolling band + tube vignette. State is brightness,
 * never a second hue.
 *
 * Exposed uniforms:
 *   tint (0-1)      — preset base colour: Green, Amber, Blue, White
 *   tiers (0-1)     — snap brightness to the four tiers (0 = smooth)
 *   scanlines (0-1) — scanline, rolling band and vignette strength
 */
export const phosphorShader = {
  name: 'phosphor',
  uniforms: {
    tint: { default: 0, min: 0, max: 1, label: msg('Tint') },
    tiers: { default: 0.5, min: 0, max: 1, label: msg('Tiers') },
    scanlines: { default: 1, min: 0, max: 1, label: msg('Scanlines') },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform vec2 colorTextureDimensions;
    uniform float intensity;
    uniform float tint;
    uniform float tiers;
    uniform float scanlines;
    uniform float time;
    in vec2 v_textureCoordinates;

    // Preset t1 colours: Green #00ff00, Amber #ffbf00, Blue #007fff, White #ffffff
    vec3 baseColour(float t) {
      if (t < 0.25) return vec3(0.0, 1.0, 0.0);
      if (t < 0.5) return vec3(1.0, 0.749, 0.0);
      if (t < 0.75) return vec3(0.0, 0.498, 1.0);
      return vec3(1.0);
    }

    float luma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    // Snap to black + the four tiers t4..t1 (63, 127, 190, 255 of 255)
    float snapTier(float l) {
      if (l < 0.124) return 0.0;
      if (l < 0.373) return 0.247;
      if (l < 0.622) return 0.498;
      if (l < 0.873) return 0.745;
      return 1.0;
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec2 texel = 1.0 / colorTextureDimensions;
      vec3 src = texture(colorTexture, uv).rgb;
      vec3 base = baseColour(tint);

      // ── Brightness → tier ───────────────────────────────
      float l = luma(src);
      float level = mix(l, snapTier(l), tiers);

      // ── Glow: soft halo from a 3x3 ring at 2px (glow token) ──
      float halo = 0.0;
      for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
          halo += luma(texture(colorTexture, uv + vec2(x, y) * texel * 2.0).rgb);
      halo /= 9.0;
      level = max(level, halo * 0.6) + halo * 0.12;

      vec3 result = base * level;

      // ── Device bloom: faint t1 wash (fx-bloom) ──────────
      result += base * 0.04;

      // ── Scanlines: black at 35% on 1px of every 2px ─────
      float row = mod(floor(uv.y * colorTextureDimensions.y), 2.0);
      result *= 1.0 - row * 0.35 * scanlines;

      // ── Rolling band: t1 at 6%, 8 s loop, moving down ───
      float bandY = 1.0 - fract(time / 8.0);
      float band = exp(-pow((uv.y - bandY) / 0.06, 2.0));
      result += base * band * 0.06 * scanlines;

      // ── Vignette: dark tube edge with a 25% t1 rim ──────
      vec2 vigUV = uv * (1.0 - uv);
      float vig = clamp(pow(vigUV.x * vigUV.y * 16.0, 0.3), 0.0, 1.0);
      result *= mix(1.0, vig, 0.31 * scanlines);
      result += base * (1.0 - vig) * 0.25 * 0.25 * scanlines;

      out_FragColor = vec4(mix(src, clamp(result, 0.0, 1.0), intensity), 1.0);
    }
  `,
};
