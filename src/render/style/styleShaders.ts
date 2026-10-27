/**
 * GLSL injected into every lit/unlit material. Runs in place of three's <fog_fragment>, where
 * gl_FragColor already holds the lit, sRGB-encoded color — no extra full-screen pass needed.
 */

export const STYLE_HEADER = /* glsl */ `
uniform float uTime;
uniform vec2 uJitter;
uniform float uPixelRatio;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uFog;

float styleHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float styleLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Pencil line pattern: 1 on a line, 0 between. Angle in radians, spacing in CSS px.
// A slow sine wobble keeps the lines from looking ruler-straight.
float styleHatch(vec2 p, float angle, float spacing, float seed) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  q.x += sin(q.y * 0.045 + seed) * 1.6;
  float d = abs(fract(q.x / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(0.3, 0.95, d);
}
`;

export const STYLE_FRAGMENT = /* glsl */ `
{
  vec3 col = gl_FragColor.rgb;
  float fogF = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  vec2 px = gl_FragCoord.xy / uPixelRatio;

  #ifdef STYLE_DIARY
    // Ink and watercolor on notebook paper.
    float L = styleLuma(col);
    // Dusk scenes are dim: stretch so mid-lit faces read as light paper.
    float tone = clamp(L * 1.9, 0.0, 1.0);
    // Watercolor wash: paper tinted by the surface hue and the light hue (warm flashlight, cold dusk).
    vec3 albedo = diffuseColor.rgb;
    vec3 hue = clamp(albedo / max(styleLuma(albedo), 1e-3), 0.0, 2.2);
    vec3 lightHue = clamp(col / max(L, 1e-3), 0.0, 2.0);
    vec3 wash = uPaper * mix(vec3(1.0), hue, 0.32) * mix(vec3(1.0), lightHue, 0.25);
    wash *= 0.82 + 0.18 * tone;
    // Pencil hatching: more layers the darker it gets. Jitter shifts the strokes 8 times
    // a second, so the drawing "boils" like hand-drawn animation.
    vec2 hp = px + uJitter;
    float seed = uJitter.x * 0.37;
    float ink = 0.0;
    ink = max(ink, (1.0 - smoothstep(0.42, 0.5, tone)) * styleHatch(hp, 0.785, 7.0, seed));
    ink = max(ink, (1.0 - smoothstep(0.24, 0.31, tone)) * styleHatch(hp, -0.785, 7.0, seed + 1.7));
    ink = max(ink, (1.0 - smoothstep(0.08, 0.14, tone)) * styleHatch(hp, 0.0, 4.0, seed + 3.1));
    col = mix(wash, uInk, ink * 0.7);
    // Paper fibre.
    col *= 0.95 + 0.05 * styleHash(floor(px * 0.75));
    col = mix(col, uPaper, fogF);
  #endif

  #ifdef STYLE_VHS
    // Home camcorder tape, 1993.
    col = mix(col, uFog, fogF);
    float L = styleLuma(col);
    col = mix(vec3(L), col, 0.62);
    col = col * vec3(1.04, 1.0, 0.9) + vec3(0.02, 0.04, 0.035) * (1.0 - L);
    col = clamp((col - 0.5) * 1.15 + 0.52, 0.0, 1.0);
    col *= 0.93 + 0.07 * sin(px.y * 3.14159);
    col += (styleHash(px + fract(uTime * 7.0) * 311.0) - 0.5) * 0.07;
    float band = smoothstep(0.0, 0.015, abs(fract(px.y / uResolution.y * uPixelRatio - uTime * 0.07) - 0.5));
    col *= 0.96 + 0.04 * band;
    vec2 uv = gl_FragCoord.xy / uResolution - 0.5;
    col *= 1.0 - dot(uv, uv) * 0.85;
  #endif

  gl_FragColor.rgb = col;
}
`;
