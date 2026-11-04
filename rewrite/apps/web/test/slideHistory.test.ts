import { describe, expect, it } from 'vitest';
import { record, redo, startHistory, undo } from '../src/pages/custom-slides/history.ts';

describe('undo in the custom slide editor', () => {
  it('undoes and redoes a change', () => {
    const h = record(startHistory('a'), 'b', 'move', 1000);

    expect([undo(h).present, redo(undo(h)).present]).toEqual(['a', 'b']);
  });

  it('makes quick changes of one kind one step', () => {
    const h = record(record(startHistory('a'), 'b', 'size', 1000), 'c', 'size', 1200);

    expect(undo(h).present).toBe('a');
  });

  it('makes a change of another kind a step of its own', () => {
    const h = record(record(startHistory('a'), 'b', 'size', 1000), 'c', 'color', 1200);

    expect(undo(h).present).toBe('b');
  });

  it('keeps quick changes without a kind (two elements added) as steps of their own', () => {
    const h = record(record(startHistory('a'), 'b', '', 1000), 'c', '', 1100);

    expect(undo(h).present).toBe('b');
  });

  it('forgets what was undone once something else is changed', () => {
    const h = record(undo(record(startHistory('a'), 'b', 'move', 1000)), 'c', 'move', 5000);

    expect(redo(h).present).toBe('c');
  });
});
