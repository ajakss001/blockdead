/** Generic object pool: avoids GC spikes for frequently spawned objects (zombies, bullets, chunk meshes). */
export class Pool<T> {
  private readonly free: T[] = [];
  private created = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset?: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(this.create());
  }

  acquire(): T {
    return this.free.length > 0 ? this.free.pop()! : this.create();
  }

  release(item: T): void {
    this.reset?.(item);
    this.free.push(item);
  }

  get freeCount(): number {
    return this.free.length;
  }

  get totalCreated(): number {
    return this.created;
  }

  private create(): T {
    this.created++;
    return this.factory();
  }
}
