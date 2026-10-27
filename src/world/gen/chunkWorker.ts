import { buildChunk, type ChunkData } from './buildChunk';
import { WorldLayout } from './layout';

export interface ChunkRequest {
  seed: number;
  i: number;
  j: number;
}

let layout: WorldLayout | null = null;

/** Chunk generation off the main thread: geometry is built here, only typed arrays cross over. */
self.onmessage = (e: MessageEvent<ChunkRequest>) => {
  const { seed, i, j } = e.data;
  if (!layout || layout.seed !== seed) layout = new WorldLayout(seed);
  const data: ChunkData = buildChunk(layout, i, j);
  const transfer: Transferable[] = [data.colliders.buffer];
  for (const s of data.surfaces) transfer.push(s.position.buffer, s.normal.buffer, s.color.buffer, s.surfUv.buffer, s.layer.buffer, s.pbr.buffer);
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(data, transfer);
};
