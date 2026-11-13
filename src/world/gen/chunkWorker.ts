import { type Lang, setLang } from '../../core/i18n';
import { buildChunk, buildInterior, type ChunkData, type InteriorData } from './buildChunk';
import type { BodyMode } from './chaos';
import type { BuildingDesc } from './highrise';
import { WorldLayout } from './layout';
import { loadModelLibrary } from '../models';
import { setModelLibrary } from '../props/car';

export type WorkerRequest =
  | { type: 'chunk'; seed: number; i: number; j: number; bodies: BodyMode; lang?: Lang }
  | { type: 'interior'; seed: number; building: BuildingDesc; focus: number; lang?: Lang };
export type WorkerResponse = ({ type: 'chunk' } & ChunkData) | ({ type: 'interior' } & InteriorData);

let layout: WorldLayout | null = null;
// Vehicle and prop models; chunks wait for them (once), then fall back to procedural if absent.
const models = loadModelLibrary(new URL(`${import.meta.env.BASE_URL}models/`, self.location.origin).href).then(setModelLibrary);

/** Generation off the main thread: geometry is built here, only typed arrays cross over. */
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  await models;
  const req = e.data;
  if (req.lang) setLang(req.lang);
  if (!layout || layout.seed !== req.seed) layout = new WorldLayout(req.seed);
  const data: WorkerResponse =
    req.type === 'chunk' ? { type: 'chunk', ...buildChunk(layout, req.i, req.j, req.bodies) } : { type: 'interior', ...buildInterior(req.building, req.focus) };
  const transfer: Transferable[] = [data.colliders.buffer, data.ambient.buffer];
  for (const s of data.surfaces) transfer.push(s.position.buffer, s.normal.buffer, s.color.buffer, s.surfUv.buffer, s.layer.buffer, s.pbr.buffer);
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(data, transfer);
};
