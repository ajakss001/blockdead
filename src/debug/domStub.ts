/** Minimal canvas stand-in so render-side modules can be constructed in Node (no drawing happens). */
const ctx2d: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'canvas' ? fakeCanvas() : k === 'getImageData' || k === 'createImageData' ? (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }) : ctx2d),
  apply: () => ctx2d,
  set: () => true,
});
function fakeCanvas(): any {
  return { width: 1, height: 1, style: {}, getContext: () => ctx2d, toDataURL: () => '', addEventListener() {} };
}
const g = globalThis as any;
g.document ??= { createElement: () => fakeCanvas(), createElementNS: () => fakeCanvas() };
