// A slide's triangle and arrow (ui/shapePoints.ts): their corners in their box.
import { describe, expect, it } from 'vitest';
import { shapePoints } from '../src/ui/shapePoints.ts';

describe("a slide's triangle and arrow", () => {
  it('draws a triangle pointing up, its base the foot of its box', () => {
    const points = shapePoints('triangle', 100, 80);

    expect(points).toBe('50,0 100,80 0,80');
  });

  it('draws an arrow pointing right by default, its head as long as the box is thick', () => {
    const points = shapePoints('arrow', 200, 40);

    expect(points).toBe('0,10 160,10 160,0 200,20 160,40 160,30 0,30');
  });

  it('keeps a short wide arrow’s head at half its length', () => {
    const points = shapePoints('arrow', 60, 100);

    expect(points.split(' ')[3]).toBe('60,50');
    expect(points.split(' ')[1]).toBe('30,25');
  });

  it('points an arrow up with its tip at the middle of the top', () => {
    const points = shapePoints('arrow', 40, 200, 'up');

    expect(points.split(' ')[3]).toBe('20,0');
  });

  it('points an arrow left with its tip at the middle of the left edge', () => {
    const points = shapePoints('arrow', 200, 40, 'left');

    expect(points.split(' ')[3]).toBe('0,20');
  });

  it('points an arrow down with its tip at the middle of the foot', () => {
    const points = shapePoints('arrow', 40, 200, 'down');

    expect(points.split(' ')[3]).toBe('20,200');
  });
});
