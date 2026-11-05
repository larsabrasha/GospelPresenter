import { describe as group, expect, it } from 'vitest';
import { describe, keyLabel, type ShortcutGroup } from '../src/ui/ShortcutHelp.tsx';

const page: ShortcutGroup = { title: 'Presentation', lines: [{ keys: ['a'], text: 'Lägg till i presentationen' }] };
const dialog: ShortcutGroup = { title: 'Lägg till', blocks: true, lines: [{ keys: ['Ctrl+1'], text: 'Fliken Sånger' }] };

group('the keyboard help', () => {
  it('lists the topmost group first and "Överallt" with ? last', () => {
    const shown = describe([page]);

    expect(shown.map((g) => g.title)).toEqual(['Presentation', 'Överallt']);
    expect(shown[1]!.lines.at(-1)).toEqual({ keys: ['?'], text: 'Visa kortkommandon' });
    expect(shown[1]!.lines[0]).toEqual({ keys: ['g p'], text: 'Gå till Presentationer' });
  });

  it('hides the groups under one that blocks, whose keys are off behind it', () => {
    const shown = describe([page, dialog]);

    expect(shown.map((g) => g.title)).toEqual(['Lägg till', 'Överallt']);
  });

  it('writes keys as the platform does: Ctrl+ and Alt+ elsewhere, ⌘ and ⌥ joined on a Mac', () => {
    expect([keyLabel('Ctrl+Enter', false), keyLabel('Alt+ArrowDown', false), keyLabel(' ', false), keyLabel('Delete', false)]).toEqual(['Ctrl+↵', 'Alt+↓', 'Space', 'Del']);
    expect([keyLabel('Ctrl+1', true), keyLabel('Alt+ArrowUp', true)]).toEqual(['⌘1', '⌥↑']);
  });

  it("writes a letter in capitals, macOS's modifiers as its menus order them, and a sequence a key at a time", () => {
    expect([keyLabel('n', true), keyLabel('Ctrl+Alt+P', true), keyLabel('Ctrl+Alt+P', false), keyLabel('g p', true)]).toEqual(['N', '⌥⌘P', 'Ctrl+Alt+P', 'G P']);
  });
});
