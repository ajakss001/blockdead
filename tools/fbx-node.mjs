// Loads an FBX in Node with three's FBXLoader (textures stubbed: only geometry, skeleton and animation matter).
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const fakeEl = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, getContext: () => null });
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: fakeEl, createElement: fakeEl };

const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { TextureLoader, Texture } = await import('three');
TextureLoader.prototype.load = function (url) {
  const t = new Texture();
  t.userData.url = url;
  return t;
};

export function loadFbx(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    return new FBXLoader().parse(ab, dirname(path) + '/');
  } finally {
    console.warn = origWarn;
  }
}
