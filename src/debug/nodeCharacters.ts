import { loadCharacters } from '../characters/assets';

/** The character models for the Node tests (no textures): read from public/models/characters. */
export function loadCharactersNode(): Promise<void> {
  type Fs = { readFileSync(p: string): Uint8Array };
  const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): Fs } }).process.getBuiltinModule('node:fs');
  return loadCharacters(0, async (f) => {
    const b = fs.readFileSync(`public/models/characters/${f}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
}
