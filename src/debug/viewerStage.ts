import { Color, type DirectionalLight, Fog, FogExp2, type HemisphereLight, type Scene, type WebGLRenderer } from 'three';
import { look } from '../style/look';
import { DAY, NIGHT, VIEWER_FOG } from '../style/stage';

/**
 * The light of the viewers (tools/zombie-viewer.html) and the «до/после» switch (CLAUDE.md «Визуальный
 * стиль»): «после» — the game's light and fog (style/stage: the overcast grey day, FogExp2), the models in
 * the grim look; «до» — the old toy look and each viewer's old bright studio. URL: ?look=toy starts at «до».
 * Switching sends `look:changed`; each viewer rebuilds its meshes (the builders key their caches by look).
 */

/** A viewer's old studio light (the «до» look). */
export interface ToyStage {
  bg: number;
  hemi: [sky: number, ground: number, intensity: number];
  sun: [color: number, intensity: number];
  fog?: [near: number, far: number];
}

export interface Stage {
  scene: Scene;
  hemi: HemisphereLight;
  sun: DirectionalLight;
  renderer?: WebGLRenderer;
  toy: ToyStage;
  /** How much day in the grim light: 1 the overcast day, 0 the night (the game's). */
  day?: number;
  /** Fog density in the grim look (default the game's). */
  fog?: number;
}

const c = (a: number, b: number, k: number) => new Color(a).lerp(new Color(b), k);

/** Light the viewer for the current look. */
export function applyStage(s: Stage): void {
  const { scene, hemi, sun, toy } = s;
  let bg: Color;
  if (look.grim) {
    const k = s.day ?? 1;
    bg = c(NIGHT.sky, DAY.sky, k);
    hemi.color.copy(c(NIGHT.hemi.sky, DAY.hemi.sky, k));
    hemi.groundColor.copy(c(NIGHT.hemi.ground, DAY.hemi.ground, k));
    hemi.intensity = NIGHT.hemi.intensity + (DAY.hemi.intensity - NIGHT.hemi.intensity) * k;
    sun.color.copy(c(NIGHT.moon.color, DAY.sun.color, k));
    sun.intensity = NIGHT.moon.intensity + (DAY.sun.intensity - NIGHT.moon.intensity) * k;
    scene.fog = new FogExp2(bg, s.fog ?? VIEWER_FOG);
  } else {
    bg = new Color(toy.bg);
    hemi.color.set(toy.hemi[0]);
    hemi.groundColor.set(toy.hemi[1]);
    hemi.intensity = toy.hemi[2];
    sun.color.set(toy.sun[0]);
    sun.intensity = toy.sun[1];
    scene.fog = toy.fog ? new Fog(bg, ...toy.fog) : null;
  }
  scene.background = bg;
  s.renderer?.setClearColor(bg);
}

/** Call `fn` when the look switches (after the stage of every viewer should change). */
export function onLook(fn: () => void): void {
  addEventListener('look:changed', fn);
}

// The switch, once for all three viewers.
if (new URLSearchParams(location.search).get('look') === 'toy') look.grim = false;
const box = document.getElementById('look');
if (box && !box.dataset.ready) {
  box.dataset.ready = '1';
  const mark = () => {
    for (const b of box.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', (b.dataset.look === 'grim') === look.grim);
  };
  for (const b of box.querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      const grim = b.dataset.look === 'grim';
      if (grim === look.grim) return;
      look.grim = grim;
      mark();
      dispatchEvent(new Event('look:changed'));
    };
  mark();
}

/** Scripts: switch the look (true: «после»). */
export function setLook(grim: boolean): void {
  if (grim === look.grim) return;
  (document.querySelector<HTMLButtonElement>(`#look button[data-look="${grim ? 'grim' : 'toy'}"]`) ?? null)?.click();
}
