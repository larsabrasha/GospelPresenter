import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

// The phone app (ADR 0007 (7), docs/phone-app.md): the web app, unchanged, in a thin shell. Its pages come from
// capacitor://localhost on iOS, which the server lets in (apps/server/src/cors.ts).
const config: CapacitorConfig = {
  appId: 'com.gospelpresenter.app',
  appName: 'Gospel Presenter',
  webDir: 'www',
  ios: { contentInset: 'never' },
  plugins: {
    // The keyboard makes the web view shorter rather than pushing the page up under the status bar, so the page's
    // layout (the shell's 100dvh, a dialog fixed over the screen) keeps within what stays visible.
    Keyboard: { resize: KeyboardResize.Native },
  },
};

export default config;
