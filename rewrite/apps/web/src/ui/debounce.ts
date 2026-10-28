// Saving while the user types, 500 ms after the last change (Utils/Debouncer.cs in
// the current app). Unlike the current app, a pending save is never dropped:
// it is written at once when the field loses focus, the page goes away or the
// window closes (spec 02, "500 ms debounced auto-save").

/** How a save ended: written, not needed (`run` returned nothing), or refused. */
export type SaveResult = 'saved' | 'skipped' | 'failed';

/**
 * Runs `run` with the latest scheduled value once `delay` ms have passed
 * without a new one. Saves run one after another, in the order they were
 * flushed, and `settled` hears how each ended. `run` returns undefined when
 * there was nothing to write (a blank name, say).
 */
export class Debounced<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private next: { value: T } | undefined;
  private running = 0;
  private chain: Promise<void> = Promise.resolve();
  private run: (value: T) => Promise<unknown> | undefined;
  private settled: (result: SaveResult) => void;
  private readonly delay: number;

  constructor(run: (value: T) => Promise<unknown> | undefined = () => undefined, settled: (result: SaveResult) => void = () => {}, delay = 500) {
    this.run = run;
    this.settled = settled;
    this.delay = delay;
  }

  /** Swaps the functions, for a component whose callbacks change at each render; a waiting value then goes to the new `run`. */
  use(run: (value: T) => Promise<unknown> | undefined, settled: (result: SaveResult) => void): void {
    this.run = run;
    this.settled = settled;
  }

  /** Remembers `value` and starts the wait again. */
  schedule(value: T): void {
    this.next = { value };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Saves the waiting value now, if there is one; resolves when every save so far has ended. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const next = this.next;
    this.next = undefined;
    if (next) {
      this.running++;
      this.chain = this.chain.then(async () => {
        let result: SaveResult;
        try {
          const write = this.run(next.value);
          if (write) await write;
          result = write ? 'saved' : 'skipped';
        } catch (e) {
          console.error('save failed', e);
          result = 'failed';
        }
        this.running--;
        this.settled(result);
      });
    }
    return this.chain;
  }

  /** True while a value waits or a save runs. */
  get busy(): boolean {
    return this.next !== undefined || this.running > 0;
  }
}

/**
 * Tells whether a field's value differs from what is stored, counting the
 * field's own last write until the stored value moves: a save queued behind
 * another one sees the stored value from before the first, so typing "ab" and
 * back to "a" would otherwise look like nothing to write and leave "ab".
 */
export class SaveBaseline {
  private last: { value: string; over: string } | undefined;

  /** True when `value` is what is stored, or what was last written while `stored` has not moved since. */
  unchanged(value: string, stored: string): boolean {
    return value === (this.last && this.last.over === stored ? this.last.value : stored);
  }

  /** Remembers a write of `value` made while `stored` was the stored value. */
  wrote(value: string, stored: string): void {
    this.last = { value, over: stored };
  }
}

