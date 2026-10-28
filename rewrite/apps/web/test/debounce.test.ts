import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterWrite, Debounced, SaveBaseline, type SaveResult } from '../src/ui/debounce.ts';

/** A Debounced whose writes and results are recorded; `run` may be swapped per test. */
function recorder(run?: (v: string) => Promise<unknown> | undefined) {
  const written: string[] = [];
  const results: SaveResult[] = [];
  const saver = new Debounced<string>(
    run ??
      ((v) => {
        written.push(v);
        return Promise.resolve();
      }),
    (r) => results.push(r),
  );
  return { saver, written, results };
}

describe('saving while the user types', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes nothing before 500 ms have passed since the last change', async () => {
    const { saver, written } = recorder();

    saver.schedule('a');
    await vi.advanceTimersByTimeAsync(499);

    expect(written).toEqual([]);
  });

  it('writes only the latest value once 500 ms pass after the last change', async () => {
    const { saver, written } = recorder();

    saver.schedule('a');
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule('ab');
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule('abc');
    await vi.advanceTimersByTimeAsync(500);

    expect(written).toEqual(['abc']);
  });

  it('writes a waiting value at once when flushed, and not again when the wait ends', async () => {
    const { saver, written } = recorder();

    saver.schedule('a');
    await saver.flush();
    await vi.advanceTimersByTimeAsync(1000);

    expect(written).toEqual(['a']);
  });

  it('writes nothing when flushed with nothing waiting', async () => {
    const { saver, written, results } = recorder();

    await saver.flush();

    expect(written).toEqual([]);
    expect(results).toEqual([]);
  });

  it('reports a write that succeeded as saved', async () => {
    const { saver, results } = recorder();

    saver.schedule('a');
    await saver.flush();

    expect(results).toEqual(['saved']);
  });

  it('reports a refused write as failed, not saved', async () => {
    const { saver, results } = recorder(() => Promise.reject(new Error('too long')));

    saver.schedule('a');
    await saver.flush();

    expect(results).toEqual(['failed']);
  });

  it('reports a value with nothing to write as skipped', async () => {
    const { saver, results } = recorder(() => undefined);

    saver.schedule('');
    await saver.flush();

    expect(results).toEqual(['skipped']);
  });

  it('starts a write only after the one before it has ended', async () => {
    const order: string[] = [];
    let finishFirst = () => {};
    const { saver } = recorder((v) => {
      order.push(`start ${v}`);
      return v === 'a'
        ? new Promise<void>((resolve) => {
            finishFirst = () => {
              order.push('end a');
              resolve();
            };
          })
        : Promise.resolve();
    });

    saver.schedule('a');
    void saver.flush();
    saver.schedule('b');
    const second = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    finishFirst();
    await second;

    expect(order).toEqual(['start a', 'end a', 'start b']);
  });

  it('is busy while a value waits and while it is written, and idle after', async () => {
    let finish = () => {};
    const { saver } = recorder(() => new Promise<void>((resolve) => (finish = resolve)));

    saver.schedule('a');
    const waiting = saver.busy;
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    const writing = saver.busy;
    finish();
    await flushed;

    expect([waiting, writing, saver.busy]).toEqual([true, true, false]);
  });
});

describe('telling whether a field has changed', () => {
  it('counts a value typed back to the stored one as unchanged', () => {
    const baseline = new SaveBaseline();

    expect(baseline.unchanged('a', 'a')).toBe(true);
  });

  it('counts the stored value as changed while a write of another value has not come back', () => {
    const baseline = new SaveBaseline();
    baseline.wrote('ab', 'a');

    expect(baseline.unchanged('a', 'a')).toBe(false);
  });

  it('counts the last written value as unchanged while the stored value has not caught up', () => {
    const baseline = new SaveBaseline();
    baseline.wrote('ab', 'a');

    expect(baseline.unchanged('ab', 'a')).toBe(true);
  });

  it('counts a refused write as changed again once it is forgotten', () => {
    const baseline = new SaveBaseline();
    baseline.wrote('ab', 'a');

    baseline.forget();

    expect(baseline.unchanged('ab', 'a')).toBe(false);
  });

  it('goes by the stored value again once it has moved since the write', () => {
    const baseline = new SaveBaseline();
    baseline.wrote('ab', 'a');

    expect(baseline.unchanged('ab', 'x')).toBe(false);
  });
});

describe('a write made at once', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports a write that went through', async () => {
    const onSaved = vi.fn();

    afterWrite(Promise.resolve(), onSaved, () => {});
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('does not report a write that went through as failed', async () => {
    const onFailed = vi.fn();

    afterWrite(Promise.resolve(), () => {}, onFailed);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFailed).not.toHaveBeenCalled();
  });

  it('logs a refused write as a failed save, as the fields do, and does not call it saved', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSaved = vi.fn();
    const refusal = new Error('refused');

    afterWrite(Promise.reject(refusal), onSaved, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalledWith('save failed', refusal);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports a refused write as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFailed = vi.fn();

    afterWrite(Promise.reject(new Error('refused')), () => {}, onFailed);
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
  });
});
