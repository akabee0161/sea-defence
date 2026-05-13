/** Minimum interface the pool requires from pooled objects. */
export interface Poolable {
  readonly isActive: boolean;
  destroy(): void;
}

/**
 * Generic object pool.
 * Objects are never truly discarded — they are deactivated and reused.
 * The caller must call `obj.init(...)` after `acquire()` to reset state.
 */
export class ObjectPool<T extends Poolable> {
  private readonly pool: T[] = [];
  private readonly factory: () => T;

  constructor(factory: () => T) {
    this.factory = factory;
  }

  /**
   * Return an inactive object from the pool.
   * If none are available, create a new one via the factory and add it.
   */
  acquire(): T {
    const reuse = this.pool.find((o) => !o.isActive);
    if (reuse !== undefined) return reuse;

    const fresh = this.factory();
    this.pool.push(fresh);
    return fresh;
  }

  /**
   * Deactivate an object so it can be reused on the next `acquire()` call.
   */
  release(obj: T): void {
    obj.destroy();
  }

  /** All objects in the pool (active + inactive). Iterate with isActive guard. */
  get all(): readonly T[] {
    return this.pool;
  }

  /** Deactivate every active object in the pool (used for restart/reset). */
  releaseAll(): void {
    for (const obj of this.pool) {
      if (obj.isActive) obj.destroy();
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const o of this.pool) if (o.isActive) n++;
    return n;
  }
}
