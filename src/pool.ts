// Abdullah Olcan Askar, 2024502180
/**
 * A small generic pool. acquire() returns an idle item or waits for one;
 * release() hands the item directly to the next waiter when possible.
 */
export class Pool<T> {
  #idle: T[];
  #waiting: ((item: T) => void)[] = [];

  constructor(items: T[]) {
    this.#idle = [...items];
  }

  acquire(): Promise<T> {
    const item = this.#idle.pop();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  release(item: T) {
    const next = this.#waiting.shift();
    if (next) next(item);
    else this.#idle.push(item);
  }

  async use<R>(fn: (item: T) => Promise<R>): Promise<R> {
    const item = await this.acquire();
    try {
      return await fn(item);
    } finally {
      this.release(item);
    }
  }
}
