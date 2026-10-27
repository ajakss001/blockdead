type Handler<T> = (payload: T) => void;

/**
 * Typed pub/sub. Handler arrays are copy-on-write, so emit() iterates without
 * allocating and handlers may safely unsubscribe during dispatch.
 */
export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Handler<never>[]>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const list = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...list, handler as Handler<never>]);
    return () => this.off(type, handler);
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    const list = this.handlers.get(type);
    if (!list) return;
    this.handlers.set(type, list.filter((h) => h !== (handler as Handler<never>)));
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.handlers.get(type) as Handler<E[K]>[] | undefined;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}
