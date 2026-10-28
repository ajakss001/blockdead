import { mulberry32 } from '../../core/random';
import type { DecalKind } from './surfaces';

/**
 * Alpha-cut overlay textures on a transparent background: scorch marks, oil leaks, tyre skid marks,
 * bullet-hole clusters, broken glass, paper litter. They sit on top of other surfaces as thin quads,
 * so a street can carry its own story without a single unique texture.
 */
export function generateDecalCanvas(kind: DecalKind, size = 128, seed = 1): HTMLCanvasElement {
  const rand = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  switch (kind) {
    case 'soot': {
      // Scorch mark of a burnt-out fire: grey ash rim, black core, flecks of char.
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `rgba(${40 + rand() * 20}, ${40 + rand() * 18}, ${38 + rand() * 16}, 0.55)`;
        g.beginPath();
        g.ellipse(c + (rand() - 0.5) * size * 0.3, c + (rand() - 0.5) * size * 0.3, size * (0.14 + rand() * 0.14), size * (0.1 + rand() * 0.12), rand() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(14, 13, 12, 0.92)';
      g.beginPath();
      g.ellipse(c, c, size * 0.16, size * 0.12, rand() * 3, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 30; i++) {
        const a = rand() * Math.PI * 2;
        const d = size * (0.1 + rand() * 0.3);
        g.fillStyle = rand() < 0.5 ? 'rgba(20, 19, 18, 0.9)' : 'rgba(120, 116, 108, 0.6)';
        g.fillRect(c + Math.cos(a) * d, c + Math.sin(a) * d, 1 + rand() * 3, 1 + rand() * 2);
      }
      break;
    }
    case 'oil': {
      // Engine oil leaked from a wreck: near-black puddle with a dull grey rim.
      g.fillStyle = 'rgba(70, 72, 74, 0.5)';
      g.beginPath();
      g.ellipse(c, c, size * 0.34, size * 0.24, rand() * 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(12, 13, 14, 0.95)';
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.ellipse(c + (rand() - 0.5) * size * 0.25, c + (rand() - 0.5) * size * 0.2, size * (0.08 + rand() * 0.12), size * (0.06 + rand() * 0.08), rand() * 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'skid': {
      // Two tyre tracks along U, fading in and out, with tread noise.
      for (const ty of [0.3, 0.7]) {
        for (let x = 0; x < size; x++) {
          const fade = Math.sin((x / size) * Math.PI);
          for (let y = -7; y <= 7; y++) {
            const a = fade * (0.55 + rand() * 0.35) * (1 - Math.abs(y) / 8);
            g.fillStyle = `rgba(12, 12, 12, ${a.toFixed(3)})`;
            g.fillRect(x, ty * size + y, 1, 1);
          }
        }
      }
      break;
    }
    case 'bullets': {
      for (let i = 0; i < 11; i++) {
        const x = c + (rand() - 0.5) * size * 0.7;
        const y = c + (rand() - 0.5) * size * 0.6;
        g.fillStyle = 'rgba(190, 185, 175, 0.6)';
        g.beginPath();
        g.arc(x, y, 4 + rand() * 2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(10, 10, 10, 0.95)';
        g.beginPath();
        g.arc(x, y, 1.8 + rand(), 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'shards': {
      for (let i = 0; i < 40; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = 2 + rand() * 5;
        g.fillStyle = rand() < 0.5 ? 'rgba(170, 185, 195, 0.9)' : 'rgba(110, 125, 135, 0.9)';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + r, y + rand() * r);
        g.lineTo(x + rand() * r, y + r * 1.4);
        g.fill();
      }
      break;
    }
    case 'litter': {
      for (let i = 0; i < 7; i++) {
        g.save();
        g.translate(rand() * size, rand() * size);
        g.rotate(rand() * Math.PI);
        g.fillStyle = ['rgba(196, 190, 172, 0.95)', 'rgba(170, 164, 150, 0.95)', 'rgba(120, 112, 96, 0.9)'][Math.floor(rand() * 3)];
        g.fillRect(-9, -12, 18 + rand() * 6, 24);
        g.fillStyle = 'rgba(60, 58, 54, 0.5)';
        for (let l = -8; l < 10; l += 4) g.fillRect(-6, l, 12, 1);
        g.restore();
      }
      g.fillStyle = 'rgba(40, 40, 38, 0.9)';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(rand() * size, rand() * size, 4 + rand() * 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
  }
  return canvas;
}
