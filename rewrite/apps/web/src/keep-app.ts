/**
 * Registers the service worker that keeps this build of the app, so a device
 * can reload and start with the host gone (README, "Starting the app without
 * the host"). Only a built app in a browser's secure context: over plain http
 * on the LAN a browser allows none, and the desktop app's windows load their
 * page from their own server, so they need none. Every start asks the host
 * for a newer worker.
 */
export function keepApp() {
  if (!import.meta.env.PROD || window.gpDesktop || !isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
    // Without the host, or refused: the app runs as before, from the network.
  });
}
