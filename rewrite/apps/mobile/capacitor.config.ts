import type { CapacitorConfig } from '@capacitor/cli';

// The phone app (ADR 0007 (7), docs/phone-app.md): the web app, unchanged, in a thin shell. Its pages come from
// capacitor://localhost on iOS, which the server lets in (apps/server/src/cors.ts).
const config: CapacitorConfig = {
  appId: 'com.gospelpresenter.app',
  appName: 'Gospel Presenter',
  webDir: 'www',
  ios: { contentInset: 'never' },
};

export default config;
