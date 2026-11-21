// The core names every button and action it lays out (`pageButtonsView`, `presentationActionsView`,
// `itemActionsView`), and each shell names its control by that id, so a test or an assistive tool finds the same
// button on every platform (docs/view-models.md, "Ids"; Lars, 2026-11-21). The Mac and iOS app: a Swift file that
// draws what one of those views gives sets an accessibility identifier.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './source.ts';

/** The views whose entries are controls named by the core's ids. */
const ACTION_VIEWS = ['pageButtonsView', 'presentationActionsView', 'itemActionsView'];

const swift = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'apps/mac/Sources'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((path) => path.endsWith('.swift'))
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));

describe('action ids', () => {
  it('names the controls of the core action views in every Swift file that draws them', () => {
    const drawing = swift.filter((f) => ACTION_VIEWS.some((view) => f.text.includes(`"${view}"`)));

    const unnamed = drawing.filter((f) => !f.text.includes('.accessibilityIdentifier(')).map((f) => f.path);

    expect(unnamed).toEqual([]);
  });

  // The file check above passes a file with one identifier among several controls; these are named one by one. The
  // ids drawn from a view's entries (`b.id`, `a.id`) and those built from a place (`runningOrder.fold`) are not.
  it('names each of the core page buttons a shell draws by its own id', () => {
    const named = (id: string) => swift.some((f) => f.text.includes(`.accessibilityIdentifier("${id}")`));

    const missing = ['back', 'new', 'add', 'black'].filter((id) => !named(id));

    expect(missing).toEqual([]);
  });

  it('finds the Swift files that draw the action views', () => {
    const drawing = swift.filter((f) => ACTION_VIEWS.some((view) => f.text.includes(`"${view}"`)));

    expect(drawing.length).toBeGreaterThan(0);
  });
});
