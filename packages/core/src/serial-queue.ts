/**
 * Runs tasks one at a time, in order. On the server it is the per-organisation
 * serialisation point; on the client it keeps a mutation and a rebase from
 * interleaving on the one connection.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
