/**
 * Whether this is a desktop host's own window (docs/media-and-files.md, "The
 * host's own window"). Its server, on the same machine, holds every row and
 * file, so the window keeps its database in memory and no files: it shows no
 * memory warning, every picture, audio file and Bible text counts as there,
 * and there is nothing to keep offline. The worker learns it from the session.
 */
export function isHostWindow(): boolean {
  return !!window.gpDesktop?.isHost;
}
