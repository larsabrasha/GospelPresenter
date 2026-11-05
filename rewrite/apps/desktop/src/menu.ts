// The app's menu bar (Lars, 2026-11-02): macOS's own menus, with the app's keys in them. A choice the page already has
// a key for sends that key to the window, so the menu and the keyboard can never do different things, and the
// menu does not take the key from the page (`registerAccelerator: false`: it only shows it).
import { app, Menu, type BrowserWindow, type KeyboardInputEvent, type MenuItemConstructorOptions } from 'electron';

/** A choice that presses one of the page's own keys in the window. */
function pressing(id: string, label: string, key: string, accelerator: string, win: () => BrowserWindow | null): MenuItemConstructorOptions {
  return {
    id,
    label,
    accelerator,
    registerAccelerator: false,
    click: () => {
      const w = win();
      if (!w || w.isDestroyed()) return;
      for (const type of ['keyDown', 'char', 'keyUp'] as KeyboardInputEvent['type'][]) w.webContents.sendInputEvent({ type, keyCode: key });
    },
  };
}

/**
 * The page's commands (apps/web ui/appKeys.ts), each with its ⌘ key, which a browser keeps for itself: the page
 * has letter keys for them (`g p`, `,`, `/`, `n`).
 */
type Command = 'settings' | 'search' | 'searchAll' | 'new' | 'back' | 'start' | `go:${'p' | 's' | 'b' | 'i' | 'l' | 'v' | 'e'}`;

/** Builds the menu bar for the main window. `send` tells the page of a choice it has no key for. */
export function setAppMenu(win: () => BrowserWindow | null, send: (command: Command) => void) {
  const mac = process.platform === 'darwin';
  const command = (label: string, accelerator: string, c: Command): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(c) });
  const go = (label: string, n: number, letter: 'p' | 's' | 'b' | 'i' | 'l' | 'v' | 'e') => command(label, `CmdOrCtrl+${n}`, `go:${letter}`);
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Om Gospel Presenter' },
              { type: 'separator' },
              { id: 'settings', label: 'Inställningar…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
              { type: 'separator' },
              { role: 'services', label: 'Tjänster' },
              { type: 'separator' },
              { role: 'hide', label: 'Göm Gospel Presenter' },
              { role: 'hideOthers', label: 'Göm övriga' },
              { role: 'unhide', label: 'Visa alla' },
              { type: 'separator' },
              { role: 'quit', label: 'Avsluta Gospel Presenter' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    { label: 'Arkiv', submenu: [command('Ny', 'CmdOrCtrl+N', 'new')] },
    {
      label: 'Redigera',
      submenu: [
        { role: 'undo', label: 'Ångra' },
        { role: 'redo', label: 'Gör om' },
        { type: 'separator' },
        { role: 'cut', label: 'Klipp ut' },
        { role: 'copy', label: 'Kopiera' },
        { role: 'paste', label: 'Klistra in' },
        { role: 'selectAll', label: 'Markera allt' },
      ],
    },
    {
      label: 'Presentation',
      submenu: [
        command('Starta presentation', 'Alt+CmdOrCtrl+P', 'start'),
        { type: 'separator' },
        pressing('next-slide', 'Nästa bild', 'Right', 'Right', win),
        pressing('previous-slide', 'Föregående bild', 'Left', 'Left', win),
        pressing('next-item', 'Nästa inslag', 'Down', 'Down', win),
        pressing('previous-item', 'Föregående inslag', 'Up', 'Up', win),
        { type: 'separator' },
        pressing('black', 'Rensa', 'b', 'B', win),
      ],
    },
    {
      label: 'Visa',
      submenu: [
        { role: 'resetZoom', label: 'Verklig storlek' },
        { role: 'zoomIn', label: 'Zooma in' },
        { role: 'zoomOut', label: 'Zooma ut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Helskärm' },
      ],
    },
    {
      label: 'Gå',
      submenu: [
        go('Presentationer', 1, 'p'),
        go('Sånger', 2, 's'),
        go('Biblar', 3, 'b'),
        go('Bilder', 4, 'i'),
        go('Ljud', 5, 'l'),
        go('Videor', 6, 'v'),
        go('Bildspel', 7, 'e'),
        { type: 'separator' },
        command('Tillbaka', mac ? 'Cmd+[' : 'Alt+Left', 'back'),
        command('Sök', 'CmdOrCtrl+F', 'search'),
        // The page has ⌘K itself, also in a field: the menu only shows it.
        { ...command('Sök i allt', 'CmdOrCtrl+K', 'searchAll'), registerAccelerator: false },
      ],
    },
    { role: 'windowMenu', label: 'Fönster' },
    {
      role: 'help',
      label: 'Hjälp',
      submenu: [pressing('shortcuts', 'Kortkommandon', '?', '?', win)],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
