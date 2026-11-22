import type { ColorblindMode, CrosshairColor, CrosshairSize, SettingsData } from '../core/Settings';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 4x5 row-major RGBA identity matrix.
const IDENTITY: readonly number[] = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * Color compensation matrices tuned for readability in low-light environments:
 * - Protanopia (red-weak): shifts reds toward bright amber/gold & cyan-blue separation so danger indicators/blood/hazards pop.
 * - Deuteranopia (green-weak): separates red/orange warnings cleanly from emerald/teal foliage and HUD bars.
 * - Tritanopia (blue-yellow): boosts crimson-vs-turquoise separation where blues/yellows collapse.
 * - Achromatopsia (monochrome): high-contrast luminance curve so UI and silhouettes separate without color cues.
 */
const MATRICES: Record<Exclude<ColorblindMode, 'off'>, readonly number[]> = {
  protanopia: [
    0.22, 0.78, 0.0, 0, 0.02,
    0.18, 0.68, 0.14, 0, 0.0,
    0.35, -0.35, 1.0, 0, 0.0,
    0, 0, 0, 1, 0,
  ],
  deuteranopia: [
    1.0, -0.26, 0.26, 0, 0.02,
    0.24, 0.62, 0.14, 0, 0.0,
    -0.25, 0.35, 0.9, 0, 0.0,
    0, 0, 0, 1, 0,
  ],
  tritanopia: [
    1.05, 0.18, -0.23, 0, 0.01,
    -0.05, 0.85, 0.2, 0, 0.0,
    -0.12, 0.58, 0.54, 0, 0.02,
    0, 0, 0, 1, 0,
  ],
  achromatopsia: [
    0.33, 0.59, 0.14, 0, -0.02,
    0.33, 0.59, 0.14, 0, -0.02,
    0.33, 0.59, 0.14, 0, -0.02,
    0, 0, 0, 1, 0,
  ],
};

const CROSSHAIR_COLORS: Record<CrosshairColor, string> = {
  white: 'rgba(235, 232, 224, 0.82)',
  yellow: 'rgba(255, 214, 58, 0.92)',
  cyan: 'rgba(70, 235, 255, 0.92)',
  magenta: 'rgba(255, 92, 220, 0.92)',
  green: 'rgba(110, 255, 118, 0.92)',
};

const CROSSHAIR_SIZES: Record<CrosshairSize, string> = {
  small: '3px',
  medium: '5px',
  large: '7px',
};

function lerpMatrix(mode: ColorblindMode, strengthPct: number): string {
  if (mode === 'off') return IDENTITY.join(' ');
  const k = Math.min(1, Math.max(0, strengthPct / 100));
  const target = MATRICES[mode];
  const out = new Array<string>(20);
  for (let i = 0; i < 20; i++) {
    const val = IDENTITY[i] + (target[i] - IDENTITY[i]) * k;
    out[i] = val.toFixed(4);
  }
  return out.join(' ');
}

function makeFilter(id: string): { filter: SVGFilterElement; matrix: SVGFEColorMatrixElement } {
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
  matrix.setAttribute('type', 'matrix');
  matrix.setAttribute('values', IDENTITY.join(' '));
  filter.append(matrix);
  return { filter, matrix };
}

/**
 * SVG color-matrix filters for colorblindness & accessibility options.
 * Zero WebGL shader recompilations; applies independently to #game, HUD overlays, and the live settings preview.
 */
export class ColorblindFilter {
  private readonly svg: SVGSVGElement;
  private readonly worldMatrix: SVGFEColorMatrixElement;
  private readonly uiMatrix: SVGFEColorMatrixElement;
  private readonly previewMatrix: SVGFEColorMatrixElement;

  constructor() {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'cb-svg');
    this.svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(SVG_NS, 'defs');

    const world = makeFilter('cb-filter-world');
    const ui = makeFilter('cb-filter-ui');
    const preview = makeFilter('cb-filter-preview');
    this.worldMatrix = world.matrix;
    this.uiMatrix = ui.matrix;
    this.previewMatrix = preview.matrix;

    defs.append(world.filter, ui.filter, preview.filter);
    this.svg.append(defs);
    document.body.append(this.svg);
  }

  apply(s: Readonly<SettingsData>): void {
    const values = lerpMatrix(s.colorblindMode, s.colorblindStrength);
    this.worldMatrix.setAttribute('values', values);
    this.uiMatrix.setAttribute('values', values);
    this.previewMatrix.setAttribute('values', values);

    const active = s.colorblindMode !== 'off';
    const worldOn = active && (s.colorblindTarget === 'both' || s.colorblindTarget === 'world');
    const uiOn = active && (s.colorblindTarget === 'both' || s.colorblindTarget === 'ui');

    const gameEl = document.getElementById('game');
    if (gameEl) gameEl.style.filter = worldOn ? 'url(#cb-filter-world)' : '';

    document.body.classList.toggle('cb-ui-active', uiOn);
    document.body.classList.toggle('high-contrast-hud', s.highContrastHud);

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--crosshair-color', CROSSHAIR_COLORS[s.crosshairColor]);
    rootStyle.setProperty('--crosshair-size', CROSSHAIR_SIZES[s.crosshairSize]);
  }
}
