import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Euler,
  type Intersection,
  type Material,
  Mesh,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  type Scene,
  Vector2,
  Vector3,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { MODEL_LAYER_BASE } from '../render/look/surfaces';
import { worldMaterials } from '../render/look/worldMaterials';
import { loadModelLibrary, modelGeometry, type ModelInfo, type ModelLibrary } from '../world/models';

export interface SavedEdit {
  id: string;
  model?: string;
  name: string;
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
}

const STORAGE_KEY = 'blockdead_world_edits';

/**
 * In-game 3D World Editor (toggle with F4 or ?editor=1):
 * - Free-fly camera (WASD + Q/E + Right-drag look + Shift boost)
 * - Click ANY object in the world (standalone meshes OR individual connected islands
 *   extracted from merged chunk/interior StaticBatch geometry!)
 * - 3D TransformControls gizmo (Translate / Rotate / Scale) + exact numeric inputs
 * - Spawn any of the 84 models from public/models/models.json, duplicate, delete, export JSON.
 */
export class WorldEditor {
  active = false;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly gizmo: TransformControls;
  private readonly gizmoHelper: Object3D;
  private readonly root: HTMLDivElement;
  private readonly spawned: Mesh[] = [];
  private readonly keys = new Set<string>();
  private selected: Object3D | null = null;
  private lib: ModelLibrary | null = null;
  private looking = false;
  private lookButton = -1;
  private downMouse = { x: 0, y: 0 };
  private lastMouse = { x: 0, y: 0 };
  private movedWhileDown = false;
  private yaw = 0;
  private pitch = 0;
  private draggingGizmo = false;
  private onToggle?: (active: boolean) => void;

  // UI refs
  private selLabel!: HTMLDivElement;
  private numInputs: Record<'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz', HTMLInputElement> = {} as never;
  private modelSelect!: HTMLSelectElement;
  private modeBtns: Record<'translate' | 'rotate' | 'scale', HTMLButtonElement> = {} as never;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    onToggle?: (active: boolean) => void,
  ) {
    this.onToggle = onToggle;
    this.gizmo = new TransformControls(camera, dom);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.visible = false;
    this.gizmoHelper.userData.editorIgnore = true;
    this.scene.add(this.gizmoHelper);

    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.draggingGizmo = Boolean((e as { value?: unknown }).value);
    });
    this.gizmo.addEventListener('objectChange', () => this.syncInputsFromSelected());

    this.root = this.buildUi();
    document.body.appendChild(this.root);

    void loadModelLibrary(`${import.meta.env.BASE_URL}models/`).then((lib) => {
      this.lib = lib;
      if (!lib) return;
      this.modelSelect.innerHTML = '';
      for (const m of lib.models) {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.group}: ${m.name}`;
        this.modelSelect.appendChild(opt);
      }
      this.restoreSavedSpawns();
    });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.dom.addEventListener('wheel', this.onWheel, { passive: false });
    this.dom.addEventListener('contextmenu', this.onContextMenu);
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.active;
    if (next === this.active) return;
    this.active = next;
    this.root.style.display = next ? 'flex' : 'none';
    this.gizmoHelper.visible = next && !!this.selected;
    if (next) {
      if (document.pointerLockElement) document.exitPointerLock();
      const euler = new Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = euler.y;
      this.pitch = euler.x;
    } else {
      this.looking = false;
      this.keys.clear();
      this.select(null);
    }
    this.onToggle?.(next);
  }

  update(dt: number): void {
    if (!this.active) return;
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 24 : 8) * dt;
    const fwd = new Vector3(0, 0, -1).applyEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const right = new Vector3(1, 0, 0).applyEuler(new Euler(0, this.yaw, 0, 'YXZ'));
    if (this.keys.has('KeyW')) this.camera.position.addScaledVector(fwd, speed);
    if (this.keys.has('KeyS')) this.camera.position.addScaledVector(fwd, -speed);
    if (this.keys.has('KeyD')) this.camera.position.addScaledVector(right, speed);
    if (this.keys.has('KeyA')) this.camera.position.addScaledVector(right, -speed);
    if (this.keys.has('KeyE') || this.keys.has('Space')) this.camera.position.y += speed;
    if (this.keys.has('KeyQ') || this.keys.has('KeyC')) this.camera.position.y -= speed;
    this.camera.quaternion.setFromEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.updateMatrixWorld();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.gizmoHelper.removeFromParent();
    this.root.remove();
  }

  private onContextMenu = (e: MouseEvent): void => {
    if (this.active) e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F4' && !e.repeat) {
      e.preventDefault();
      this.toggle();
      return;
    }
    if (!this.active) return;
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;
    this.keys.add(e.code);
    if (e.code === 'Digit1') this.setMode('translate');
    else if (e.code === 'Digit2') this.setMode('rotate');
    else if (e.code === 'Digit3') this.setMode('scale');
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSelected();
    else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.duplicateSelected();
    } else if (e.code === 'Escape') {
      this.select(null);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.active) return;
    if (e.button === 2 || e.button === 1) {
      this.looking = true;
      this.lookButton = e.button;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 || this.draggingGizmo) return;
    this.looking = true;
    this.lookButton = 0;
    this.downMouse = { x: e.clientX, y: e.clientY };
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.movedWhileDown = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active || !this.looking || this.draggingGizmo) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    if (this.lookButton === 0 && !this.movedWhileDown) {
      if (Math.hypot(e.clientX - this.downMouse.x, e.clientY - this.downMouse.y) < 5) return;
      this.movedWhileDown = true;
    }
    this.yaw -= dx * 0.0035;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch - dy * 0.0035));
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.active) return;
    if (this.looking && e.button === this.lookButton) {
      this.looking = false;
      const wasClick = e.button === 0 && !this.movedWhileDown && !this.draggingGizmo;
      this.lookButton = -1;
      if (wasClick) {
        const rect = this.dom.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.scene.children, true);
        const hit = this.pickHit(hits);
        if (!hit) {
          this.select(null);
          return;
        }
        const obj = hit.object;
        if (obj instanceof Mesh && obj.geometry.getAttribute('aSurfUv') && !obj.userData.editorStandalone && hit.faceIndex !== undefined && hit.faceIndex !== null) {
          const extracted = this.extractIsland(obj, hit.faceIndex);
          if (extracted) {
            this.select(extracted);
            return;
          }
        }
        this.select(obj);
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    const step = e.deltaY > 0 ? -1.8 : 1.8;
    const fwd = new Vector3(0, 0, -1).applyEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.position.addScaledVector(fwd, step * (e.shiftKey ? 2.5 : 1));
  };

  private pickHit(hits: Intersection[]): Intersection | null {
    for (const h of hits) {
      let cur: Object3D | null = h.object;
      let ignore = false;
      while (cur) {
        if (cur === this.gizmoHelper || cur.userData.editorIgnore) {
          ignore = true;
          break;
        }
        cur = cur.parent;
      }
      if (!ignore && h.object instanceof Mesh && h.object.visible) return h;
    }
    return null;
  }

  /**
   * Extracts a connected triangle island from a merged chunk/interior StaticBatch mesh
   * so any individual car, table, chair, door, tree, or prop can be moved/rotated/deleted!
   */
  private extractIsland(mesh: Mesh, faceIndex: number): Mesh | null {
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute('position') as BufferAttribute | undefined;
    if (!pos) return null;
    const idxAttr = geo.index;
    const totalIndices = idxAttr ? idxAttr.count : pos.count;
    const rangeStart = Math.max(0, geo.drawRange.start);
    const rangeEnd = geo.drawRange.count === Infinity ? totalIndices : Math.min(totalIndices, rangeStart + geo.drawRange.count);
    const triStart = Math.floor(rangeStart / 3);
    const triEnd = Math.floor(rangeEnd / 3);
    if (faceIndex < triStart || faceIndex >= triEnd) return null;

    const vertAt = (t: number, k: number) => (idxAttr ? idxAttr.getX(t * 3 + k) : t * 3 + k);

    // Build vertex-position hash -> triangle list within this mesh's drawRange
    const vertMap = new Map<string, number[]>();
    const keyOf = (vi: number) => `${Math.round(pos.getX(vi) * 200)}_${Math.round(pos.getY(vi) * 200)}_${Math.round(pos.getZ(vi) * 200)}`;
    for (let t = triStart; t < triEnd; t++) {
      const i0 = vertAt(t, 0);
      const i1 = vertAt(t, 1);
      const i2 = vertAt(t, 2);
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      if (pos.getX(i0) === pos.getX(i1) && pos.getY(i0) === pos.getY(i1) && pos.getZ(i0) === pos.getZ(i1)) continue;
      for (const vi of [i0, i1, i2]) {
        const key = keyOf(vi);
        let arr = vertMap.get(key);
        if (!arr) {
          arr = [];
          vertMap.set(key, arr);
        }
        arr.push(t);
      }
    }

    const triSpan = triEnd - triStart;
    const visited = new Uint8Array(triSpan);
    const queue: number[] = [faceIndex];
    visited[faceIndex - triStart] = 1;
    const island: number[] = [];
    const MAX_ISLAND_TRIS = 35000;

    while (queue.length > 0 && island.length < MAX_ISLAND_TRIS) {
      const t = queue.pop()!;
      island.push(t);
      for (let k = 0; k < 3; k++) {
        const neighbors = vertMap.get(keyOf(vertAt(t, k)));
        if (!neighbors) continue;
        for (const nt of neighbors) {
          const ni = nt - triStart;
          if (!visited[ni]) {
            visited[ni] = 1;
            queue.push(nt);
          }
        }
      }
    }
    if (island.length === 0) return null;

    const newGeo = new BufferGeometry();
    const attrNames = Object.keys(geo.attributes);
    const newVerts = island.length * 3;
    const srcAttrs = attrNames.map((name) => ({ name, attr: geo.getAttribute(name) as BufferAttribute }));

    // Compute world bounds of the extracted island so pivot sits at bottom-center
    const box = new Box3();
    const tmp = new Vector3();
    for (const t of island) {
      for (let k = 0; k < 3; k++) {
        tmp.fromBufferAttribute(pos, vertAt(t, k)).applyMatrix4(mesh.matrixWorld);
        box.expandByPoint(tmp);
      }
    }
    const center = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);

    for (const { name, attr } of srcAttrs) {
      const itemSize = attr.itemSize;
      const out = new Float32Array(newVerts * itemSize);
      for (let i = 0; i < island.length; i++) {
        const t = island[i];
        for (let k = 0; k < 3; k++) {
          const sv = vertAt(t, k);
          const dv = (i * 3 + k) * itemSize;
          if (name === 'position') {
            tmp.fromBufferAttribute(attr, sv).applyMatrix4(mesh.matrixWorld).sub(center);
            out[dv] = tmp.x;
            out[dv + 1] = tmp.y;
            out[dv + 2] = tmp.z;
          } else {
            out[dv] = attr.getX(sv);
            if (itemSize > 1) out[dv + 1] = attr.getY(sv);
            if (itemSize > 2) out[dv + 2] = attr.getZ(sv);
            if (itemSize > 3) out[dv + 3] = attr.getW(sv);
          }
        }
      }
      newGeo.setAttribute(name, new BufferAttribute(out, itemSize));
    }

    // Collapse extracted triangles in source chunk mesh so it disappears from original batch
    if (idxAttr) {
      const arr = idxAttr.array as Uint16Array | Uint32Array;
      for (const t of island) {
        const b = t * 3;
        arr[b] = 0;
        arr[b + 1] = 0;
        arr[b + 2] = 0;
      }
      idxAttr.needsUpdate = true;
    } else {
      for (const t of island) {
        const b = t * 3;
        for (let k = 0; k < 3; k++) pos.setXYZ(b + k, 0, -9999, 0);
      }
      pos.needsUpdate = true;
    }

    const extracted = new Mesh(newGeo, mesh.material as Material);
    extracted.position.copy(center);
    extracted.castShadow = mesh.castShadow;
    extracted.receiveShadow = mesh.receiveShadow;
    extracted.frustumCulled = false;
    extracted.userData.editorStandalone = true;
    extracted.userData.editorName = `Объект (${island.length} трис.)`;
    this.scene.add(extracted);
    this.spawned.push(extracted);
    return extracted;
  }

  private select(obj: Object3D | null): void {
    this.selected = obj;
    if (obj) {
      this.gizmo.attach(obj);
      this.gizmoHelper.visible = this.active;
      this.selLabel.textContent = obj.userData.editorName || obj.name || obj.type || 'Объект';
      this.syncInputsFromSelected();
    } else {
      this.gizmo.detach();
      this.gizmoHelper.visible = false;
      this.selLabel.textContent = 'Ничего не выбрано (кликните по объекту)';
    }
  }

  private setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.gizmo.setMode(mode);
    for (const [k, btn] of Object.entries(this.modeBtns)) {
      btn.style.background = k === mode ? '#d98a2b' : '#2a2d32';
      btn.style.color = k === mode ? '#111' : '#eee';
    }
  }

  private syncInputsFromSelected(): void {
    const o = this.selected;
    if (!o) return;
    this.numInputs.px.value = o.position.x.toFixed(2);
    this.numInputs.py.value = o.position.y.toFixed(2);
    this.numInputs.pz.value = o.position.z.toFixed(2);
    this.numInputs.rx.value = ((o.rotation.x * 180) / Math.PI).toFixed(1);
    this.numInputs.ry.value = ((o.rotation.y * 180) / Math.PI).toFixed(1);
    this.numInputs.rz.value = ((o.rotation.z * 180) / Math.PI).toFixed(1);
    this.numInputs.sx.value = o.scale.x.toFixed(2);
    this.numInputs.sy.value = o.scale.y.toFixed(2);
    this.numInputs.sz.value = o.scale.z.toFixed(2);
    this.saveEdits();
  }

  private applyInputsToSelected(): void {
    const o = this.selected;
    if (!o) return;
    o.position.set(
      parseFloat(this.numInputs.px.value) || 0,
      parseFloat(this.numInputs.py.value) || 0,
      parseFloat(this.numInputs.pz.value) || 0,
    );
    o.rotation.set(
      ((parseFloat(this.numInputs.rx.value) || 0) * Math.PI) / 180,
      ((parseFloat(this.numInputs.ry.value) || 0) * Math.PI) / 180,
      ((parseFloat(this.numInputs.rz.value) || 0) * Math.PI) / 180,
    );
    o.scale.set(
      Math.max(0.05, parseFloat(this.numInputs.sx.value) || 1),
      Math.max(0.05, parseFloat(this.numInputs.sy.value) || 1),
      Math.max(0.05, parseFloat(this.numInputs.sz.value) || 1),
    );
    this.saveEdits();
  }

  private spawnModel(modelName: string, at?: Vector3, rot?: [number, number, number], scale?: [number, number, number]): Mesh | null {
    if (!this.lib) return null;
    const m: ModelInfo | undefined = this.lib.models.find((x) => x.name === modelName);
    if (!m) return null;
    const g = modelGeometry(this.lib, m).toNonIndexed();
    const n = g.attributes.position.count;
    const uv = g.attributes.uv;
    const surfUv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      surfUv[i * 2] = uv.getX(i);
      surfUv[i * 2 + 1] = uv.getY(i);
    }
    const layers = new Float32Array(n).fill(MODEL_LAYER_BASE + m.layer);
    const pbr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pbr[i * 2] = 0.78;
      pbr[i * 2 + 1] = 0.12;
    }
    g.setAttribute('aSurfUv', new BufferAttribute(surfUv, 2));
    g.setAttribute('aLayer', new BufferAttribute(layers, 1));
    g.setAttribute('aPbr', new BufferAttribute(pbr, 2));
    const mesh = new Mesh(g, worldMaterials().cast);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (at) {
      mesh.position.copy(at);
    } else {
      const dir = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      mesh.position.copy(this.camera.position).addScaledVector(dir, 4);
      mesh.position.y = Math.max(0, mesh.position.y - 0.8);
    }
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.userData.editorStandalone = true;
    mesh.userData.editorModel = m.name;
    mesh.userData.editorName = m.name;
    mesh.userData.editorId = `spawn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.scene.add(mesh);
    this.spawned.push(mesh);
    return mesh;
  }

  private duplicateSelected(): void {
    const o = this.selected;
    if (!o || !(o instanceof Mesh)) return;
    if (o.userData.editorModel) {
      const copy = this.spawnModel(
        o.userData.editorModel as string,
        o.position.clone().add(new Vector3(0.8, 0, 0.8)),
        [o.rotation.x, o.rotation.y, o.rotation.z],
        [o.scale.x, o.scale.y, o.scale.z],
      );
      if (copy) {
        this.select(copy);
        this.saveEdits();
      }
      return;
    }
    const copy = new Mesh(o.geometry.clone(), o.material);
    copy.position.copy(o.position).add(new Vector3(0.8, 0, 0.8));
    copy.rotation.copy(o.rotation);
    copy.scale.copy(o.scale);
    copy.castShadow = o.castShadow;
    copy.receiveShadow = o.receiveShadow;
    copy.frustumCulled = false;
    copy.userData.editorStandalone = true;
    copy.userData.editorName = `${o.userData.editorName ?? 'Объект'} (копия)`;
    this.scene.add(copy);
    this.spawned.push(copy);
    this.select(copy);
  }

  private deleteSelected(): void {
    const o = this.selected;
    if (!o) return;
    this.select(null);
    o.visible = false;
    if (o.userData.editorStandalone) {
      o.removeFromParent();
      const idx = this.spawned.indexOf(o as Mesh);
      if (idx >= 0) this.spawned.splice(idx, 1);
      if (o instanceof Mesh) o.geometry.dispose();
    }
    this.saveEdits();
  }

  private saveEdits(): void {
    const edits: SavedEdit[] = this.spawned
      .filter((m) => !!m.userData.editorModel)
      .map((m) => ({
        id: String(m.userData.editorId ?? ''),
        model: String(m.userData.editorModel),
        name: String(m.userData.editorName ?? m.userData.editorModel),
        pos: [m.position.x, m.position.y, m.position.z],
        rot: [m.rotation.x, m.rotation.y, m.rotation.z],
        scale: [m.scale.x, m.scale.y, m.scale.z],
      }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
    } catch {
      // ignore storage quota errors
    }
  }

  private restoreSavedSpawns(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as SavedEdit[];
      for (const e of list) {
        if (!e.model) continue;
        const m = this.spawnModel(e.model, new Vector3(...e.pos), e.rot, e.scale);
        if (m && e.id) m.userData.editorId = e.id;
      }
    } catch {
      // ignore corrupt storage
    }
  }

  private exportJson(): void {
    const edits: SavedEdit[] = this.spawned.map((m, i) => ({
      id: String(m.userData.editorId ?? `obj_${i}`),
      model: m.userData.editorModel as string | undefined,
      name: String(m.userData.editorName ?? 'object'),
      pos: [+m.position.x.toFixed(3), +m.position.y.toFixed(3), +m.position.z.toFixed(3)],
      rot: [+m.rotation.x.toFixed(3), +m.rotation.y.toFixed(3), +m.rotation.z.toFixed(3)],
      scale: [+m.scale.x.toFixed(3), +m.scale.y.toFixed(3), +m.scale.z.toFixed(3)],
    }));
    const blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'world-edits.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private buildUi(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;top:12px;right:12px;width:290px;background:rgba(16,18,22,0.92);color:#e6e8ec;border:1px solid #3c424d;border-radius:8px;padding:12px;font-family:system-ui,sans-serif;font-size:12px;z-index:9999;display:none;flex-direction:column;gap:8px;backdrop-filter:blur(6px);box-shadow:0 8px 28px rgba(0,0,0,0.5);user-select:none;';

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:13px;color:#f3b562;';
    title.innerHTML = '<span>РЕДАКТОР МИРА (F4)</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:#2a2d32;color:#eee;border:1px solid #444;border-radius:4px;cursor:pointer;padding:2px 7px;';
    closeBtn.onclick = () => this.toggle(false);
    title.appendChild(closeBtn);
    wrap.appendChild(title);

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#9aa2b0;font-size:11px;line-height:1.35;';
    hint.textContent = 'ПКМ + мышь: обзор · WASD + Q/E: полёт · Shift: быстрее · ЛКМ: выбрать любой объект (машины, мебель, двери, здания)';
    wrap.appendChild(hint);

    this.selLabel = document.createElement('div');
    this.selLabel.style.cssText = 'background:#1c1f24;padding:6px 8px;border-radius:4px;border:1px solid #323741;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    this.selLabel.textContent = 'Ничего не выбрано (кликните по объекту)';
    wrap.appendChild(this.selLabel);

    // Mode buttons
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;';
    for (const [mode, label] of [
      ['translate', '1: Двигать'],
      ['rotate', '2: Вращать'],
      ['scale', '3: Масштаб'],
    ] as const) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'padding:5px 4px;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;';
      btn.onclick = () => this.setMode(mode);
      modeRow.appendChild(btn);
      this.modeBtns[mode] = btn;
    }
    this.setMode('translate');
    wrap.appendChild(modeRow);

    // Numeric transform inputs
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:46px 1fr 1fr 1fr;gap:4px;align-items:center;';
    const makeRow = (label: string, keys: ['px' | 'py' | 'pz', 'rx' | 'ry' | 'rz', 'sx' | 'sy' | 'sz'] | [string, string, string]) => {
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.color = '#9aa2b0';
      grid.appendChild(lbl);
      for (const k of keys) {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = label === 'Поз' ? '0.1' : label === 'Пов' ? '5' : '0.1';
        inp.style.cssText = 'width:100%;box-sizing:border-box;background:#16181c;color:#fff;border:1px solid #383e48;border-radius:3px;padding:3px 4px;font-size:11px;';
        inp.onchange = () => this.applyInputsToSelected();
        grid.appendChild(inp);
        this.numInputs[k as keyof typeof this.numInputs] = inp;
      }
    };
    makeRow('Поз', ['px', 'py', 'pz']);
    makeRow('Пов', ['rx', 'ry', 'rz']);
    makeRow('Разм', ['sx', 'sy', 'sz']);
    wrap.appendChild(grid);

    // Actions row
    const actRow = document.createElement('div');
    actRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;';
    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Дублировать (Ctrl+D)';
    dupBtn.style.cssText = 'background:#2b313a;color:#eee;border:1px solid #444;border-radius:4px;padding:5px;cursor:pointer;font-size:11px;';
    dupBtn.onclick = () => this.duplicateSelected();
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Удалить (Del)';
    delBtn.style.cssText = 'background:#5a2323;color:#fff;border:1px solid #7a3333;border-radius:4px;padding:5px;cursor:pointer;font-size:11px;';
    delBtn.onclick = () => this.deleteSelected();
    actRow.append(dupBtn, delBtn);
    wrap.appendChild(actRow);

    // Model spawner
    const spawnLbl = document.createElement('div');
    spawnLbl.textContent = 'Добавить модель:';
    spawnLbl.style.cssText = 'color:#9aa2b0;margin-top:2px;';
    wrap.appendChild(spawnLbl);

    this.modelSelect = document.createElement('select');
    this.modelSelect.style.cssText = 'background:#16181c;color:#fff;border:1px solid #383e48;border-radius:4px;padding:5px;font-size:11px;';
    wrap.appendChild(this.modelSelect);

    const spawnBtn = document.createElement('button');
    spawnBtn.textContent = '+ Поставить перед камерой';
    spawnBtn.style.cssText = 'background:#2d5a3b;color:#fff;border:1px solid #3d7a4f;border-radius:4px;padding:6px;cursor:pointer;font-weight:600;font-size:11px;';
    spawnBtn.onclick = () => {
      const m = this.spawnModel(this.modelSelect.value);
      if (m) {
        this.select(m);
        this.saveEdits();
      }
    };
    wrap.appendChild(spawnBtn);

    // Export / Clear
    const ioRow = document.createElement('div');
    ioRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:2px;';
    const expBtn = document.createElement('button');
    expBtn.textContent = 'Экспорт JSON';
    expBtn.style.cssText = 'background:#2b313a;color:#eee;border:1px solid #444;border-radius:4px;padding:5px;cursor:pointer;font-size:11px;';
    expBtn.onclick = () => this.exportJson();
    const clrBtn = document.createElement('button');
    clrBtn.textContent = 'Сброс спавна';
    clrBtn.style.cssText = 'background:#2b313a;color:#eee;border:1px solid #444;border-radius:4px;padding:5px;cursor:pointer;font-size:11px;';
    clrBtn.onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      for (const m of this.spawned) {
        if (m === this.selected) this.select(null);
        m.removeFromParent();
        m.geometry.dispose();
      }
      this.spawned.length = 0;
    };
    ioRow.append(expBtn, clrBtn);
    wrap.appendChild(ioRow);

    return wrap;
  }
}
