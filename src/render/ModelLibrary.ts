import { LOD, type Object3D, type WebGLRenderer } from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

interface ManifestEntry {
  lods: string[];
  distances: number[];
  ktx2: boolean;
}

/**
 * Third-party models (see assets/CREDITS.md, tools/optimize-models.mjs), loaded lazily the first
 * time a scene asks for one: meshopt geometry, KTX2 or WebP textures, three LOD levels. Nothing is
 * fetched until then, so a game session that never meets a crashed helicopter never downloads it.
 * Each model is one LOD object; scenes clone it (geometry and materials are shared).
 */
export class ModelLibrary {
  private manifest: Promise<Record<string, ManifestEntry>> | null = null;
  private readonly cache = new Map<string, Promise<LOD | null>>();
  private readonly loader = new GLTFLoader();
  private readonly base: string;

  constructor(renderer: WebGLRenderer, base = `${import.meta.env.BASE_URL}models/`) {
    this.base = base;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    const ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
    this.loader.setKTX2Loader(ktx2);
  }

  /** A fresh instance (clone) of a model, or null if it is not installed. */
  async get(name: string): Promise<Object3D | null> {
    let p = this.cache.get(name);
    if (!p) {
      p = this.load(name);
      this.cache.set(name, p);
    }
    const lod = await p;
    return lod ? lod.clone() : null;
  }

  private async load(name: string): Promise<LOD | null> {
    this.manifest ??= fetch(`${this.base}manifest.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    const entry = (await this.manifest)[name];
    if (!entry) return null;
    const lod = new LOD();
    const levels = await Promise.all(entry.lods.map((f) => this.loader.loadAsync(`${this.base}${name}/${f}`) as Promise<GLTF>));
    levels.forEach((g, i) => lod.addLevel(g.scene, entry.distances[i] ?? i * 20));
    return lod;
  }
}
