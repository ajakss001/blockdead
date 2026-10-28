import { PerspectiveCamera } from 'three';
import type { GameContext } from '../GameContext';
import type { WorldScene } from '../scenes/WorldScene';

/**
 * Dev-only helpers for visual checks from the browser console (never in the production build):
 * - `__fp(opts)`  render a first-person frame through the real post chain, return a JPEG data URL;
 * - `__look(...)` render the world from a free camera (no post), return a data URL;
 * - `__grid(shots, labels, cols)` lay frames out over the page for one screenshot;
 * - `__ui(visible)` hide/show the HUD.
 */
export function installDevHarness(ctx: GameContext, scene: WorldScene, draw: (alpha: number, dt: number) => void): void {
  const s = scene as unknown as {
    player: { controller: Record<string, unknown> & { position: { set(x: number, y: number, z: number): void }; prevPosition: { copy(v: unknown): void } }; flashlightOn: boolean; setFlashlight(on: boolean): void };
    chunks: { update(x: number, z: number, dx: number, dz: number): void };
    interiors: { update(dt: number, x: number, z: number, y?: number): void };
    fixedUpdate(dt: number): void;
    scene: import('three').Scene;
  };
  const gl = ctx.renderer.gl;
  const cam = new PerspectiveCamera(55, 4 / 3, 0.05, 300);
  const stream = async (x: number, z: number, n = 25, y = 0) => {
    for (let k = 0; k < n; k++) {
      s.chunks.update(x, z, 0, 1);
      s.interiors.update(0.3, x, z, y);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__fp = async (o: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; move?: number; crouch?: boolean; frames?: number; light?: boolean; before?: () => void } = {}) => {
    const c = s.player.controller as unknown as { position: { set(x: number, y: number, z: number): void; x: number; z: number }; prevPosition: { copy(v: unknown): void }; yaw: number; pitch: number; crouched: boolean };
    const { x = 14, y = 0.02, z = -1.5, yaw = -Math.PI / 2, pitch = -1.35, move = 0, crouch = false, frames = 40, light = true } = o;
    c.position.set(x, y, z);
    c.prevPosition.copy(c.position);
    c.yaw = yaw;
    if (c.crouched !== crouch) {
      ctx.input.press('crouch');
      ctx.input.release('crouch');
    }
    s.player.flashlightOn = false;
    if (light) s.player.setFlashlight(true);
    await stream(x, z, 5, y);
    o.before?.();
    ctx.input.setMove(0, move);
    for (let k = 0; k < frames; k++) {
      s.fixedUpdate(1 / 60);
      c.pitch = pitch;
      draw(1, 1 / 60);
    }
    ctx.input.setMove(0, 0);
    return gl.domElement.toDataURL('image/jpeg', 0.8);
  };
  w.__look = async (px: number, py: number, pz: number, tx: number, ty: number, tz: number, aspect = 4 / 3) => {
    await stream(px, pz, 25, py);
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.position.set(px, py, pz);
    cam.lookAt(tx, ty, tz);
    cam.updateMatrixWorld();
    gl.setRenderTarget(null);
    gl.render(s.scene, cam);
    return gl.domElement.toDataURL('image/jpeg', 0.8);
  };
  w.__grid = (shots: string[], labels: string[] = [], cols = 2) => {
    let g = document.getElementById('__grid');
    if (!g) {
      g = document.createElement('div');
      g.id = '__grid';
      document.body.append(g);
    }
    g.style.cssText = `position:fixed;inset:0;z-index:100;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:3px;align-content:start`;
    g.innerHTML = shots.map((src, i) => `<div style="position:relative"><img src="${src}" style="width:100%;display:block"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:12px sans-serif">${labels[i] ?? ''}</span></div>`).join('');
  };
  w.__ui = (visible: boolean) => {
    document.querySelectorAll<HTMLElement>('#ui > *').forEach((e) => (e.style.visibility = visible ? '' : 'hidden'));
    document.getElementById('__grid')?.remove();
  };
}
