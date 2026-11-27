// The corners of a slide's triangle and arrow (docs/custom-slides.md), for an SVG polygon: the slide draws them at
// their box's size, the shapes menu and Lager small.

type Direction = 'right' | 'left' | 'up' | 'down';

const asPoints = (corners: [number, number][]) => corners.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ');

/**
 * A triangle's or an arrow's corners in a box `w` × `h`. A triangle points up, its base the box's foot. An arrow is a
 * shaft half as thick as the box and a head as long as the box is thick, at most half its length, pointing `direction`.
 */
export function shapePoints(kind: 'triangle' | 'arrow', w: number, h: number, direction: Direction = 'right'): string {
  if (kind === 'triangle')
    return asPoints([
      [w / 2, 0],
      [w, h],
      [0, h],
    ]);
  // Worked out pointing right, along its length (u) and across its thickness (v), then laid the way it points.
  const across = direction === 'up' || direction === 'down';
  const length = across ? h : w;
  const thick = across ? w : h;
  const head = Math.min(length / 2, thick);
  const right: [number, number][] = [
    [0, thick / 4],
    [length - head, thick / 4],
    [length - head, 0],
    [length, thick / 2],
    [length - head, thick],
    [length - head, (thick * 3) / 4],
    [0, (thick * 3) / 4],
  ];
  const laid = ([u, v]: [number, number]): [number, number] =>
    direction === 'right' ? [u, v] : direction === 'left' ? [length - u, v] : direction === 'down' ? [v, u] : [v, length - u];
  return asPoints(right.map(laid));
}
