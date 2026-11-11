type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Asks for full screen, with Safari's prefixed call where the standard one is missing (Display.razor). A refusal is ignored. */
export function askFullScreen() {
  const root = document.documentElement as WebkitElement;
  if (root.requestFullscreen) void root.requestFullscreen().catch(() => undefined);
  else root.webkitRequestFullscreen?.();
}
