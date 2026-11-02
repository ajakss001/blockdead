import { Vector2 } from 'three';

/**
 * Final full-screen pass, all-in-one so phones pay for exactly one extra pass:
 * cold horror grade → soft highlight roll-off → linear→sRGB → film grain → vignette → dither.
 * `uGrade` 0 (low quality, CLAUDE.md «Визуальный стиль»: there only the fog and the palette make the look)
 * skips the grade, the grain and the vignette; the fear tunnel and dying stay (they are play, not look).
 * Grain is per-screen-pixel and changes every frame: it breaks up clean low-poly gradients and ties
 * the image together like old 16 mm stock. Dither removes banding in the near-black range.
 */
export const FilmShader = {
  name: 'FilmShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 0.75 },
    /** Anxiety 0..1 (already pulsed with the heartbeat): the edges close in. */
    uDread: { value: 0 },
    uDesaturate: { value: 0.42 },
    /** 1: the cold grade, grain and vignette (medium / high); 0: none of them (low). */
    uGrade: { value: 1 },
    /** Dying: the colour drains, the edges darken, then black (0..1 each). */
    uDeath: { value: 0 },
    uFade: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uDread;
    uniform float uDesaturate;
    uniform float uGrade;
    uniform float uDeath;
    uniform float uFade;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Interleaved gradient noise: a cheap, well-distributed dither pattern (Jimenez 2014).
    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // Cold grade in linear space: drain color, lean it to a cold grey-green, lift the blacks a hair
      // (no pure black), crush nothing.
      float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(L), mix(uDesaturate * uGrade, 0.95, uDeath));
      c *= mix(vec3(1.0), vec3(0.95, 1.0, 0.98), uGrade);
      c += vec3(0.0009, 0.0011, 0.0012) * uGrade;
      // Soft roll-off so the flashlight hotspot doesn't clip to flat white.
      c = c / (1.0 + c * 0.55);

      vec3 s = linearToOutputTexel(vec4(c, 1.0)).rgb;

      // Film grain, a touch stronger in the shadows where old film stock was noisiest.
      float lum = dot(s, vec3(0.333));
      float n = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0)) - 0.5;
      s += n * uGrain * uGrade * (1.15 - 0.6 * smoothstep(0.1, 0.7, lum));

      vec2 uv = vUv - 0.5;
      uv.x *= uResolution.x / uResolution.y;
      s *= 1.0 - dot(uv, uv) * (uVignette * uGrade + uDeath * 1.6) * 0.6;
      // Fear narrows the view: a dark tunnel that tightens with anxiety.
      float r = length(uv);
      float tunnel = smoothstep(0.8 - uDread * 0.5, 1.05, r);
      s *= 1.0 - uDread * (tunnel * 0.97 + 0.12);

      s *= 1.0 - uFade;
      s += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
    }
  `,
};
