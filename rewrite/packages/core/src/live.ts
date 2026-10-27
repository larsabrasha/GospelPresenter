// Live state (ADR 0007, decision 4): a small pointer. Outputs render from their
// own local content plus this pointer, so only the pointer travels.

export interface LivePointer {
  /** The presentation being shown, or null when the session is not presenting. */
  presentationId: string | null;
  itemId: string | null;
  /** 0-based index of the slide within the item. */
  partIndex: number;
  /** The black screen ("Rensa"): outputs show nothing, the selection is kept. */
  black: boolean;
  /** The overlay shown above the slide (LIVE-R15), or null. */
  overlayId: string | null;
  /** Increases with every change, so a late message never undoes a newer one. */
  rev: number;
}

export const IDLE: LivePointer = { presentationId: null, itemId: null, partIndex: 0, black: false, overlayId: null, rev: 0 };

/** The newer of two pointers. */
export function newer(a: LivePointer, b: LivePointer): LivePointer {
  return b.rev > a.rev ? b : a;
}

/** Spec 03 PRES-R9, R10: at most 200 overlays per organisation, their text at most 2 000 characters. */
export const OVERLAY_LIMITS = { overlays: 200, content: 2000 } as const;

export type LivePointerChange = Partial<Omit<LivePointer, 'rev'>>;

/**
 * The pointer after a change, with the overlay rules (LIVE-R15, and the
 * changes to R16 in TODO.md "Overlays"):
 *
 * - A change that names `overlayId` is a manual toggle: it sets the overlay,
 *   and showing one ends the black screen, as selecting a slide does (LIVE-R11).
 * - The black screen ("Rensa") and stopping switch the overlay off.
 * - Moving to another item switches off the overlay the item left carries,
 *   if that is still the one shown, and switches on the one the new item
 *   carries. A manual choice made meanwhile stays until the item changes;
 *   one that is not the left item's own stays after it too.
 *
 * `overlayOf` names the overlay an item carries, or null.
 */
export function applyLiveChange(prev: LivePointer, change: LivePointerChange, overlayOf: (itemId: string) => string | null): Omit<LivePointer, 'rev'> {
  const next: Omit<LivePointer, 'rev'> = {
    presentationId: prev.presentationId,
    itemId: prev.itemId,
    partIndex: prev.partIndex,
    black: prev.black,
    overlayId: prev.overlayId,
    ...change,
  };
  if (change.overlayId !== undefined) return { ...next, black: change.overlayId ? false : next.black };
  if (!next.presentationId || next.black) return { ...next, overlayId: null };
  if (next.itemId === prev.itemId) return next;
  const left = prev.itemId ? overlayOf(prev.itemId) : null;
  const entered = next.itemId ? overlayOf(next.itemId) : null;
  const kept = left && prev.overlayId === left ? null : prev.overlayId;
  return { ...next, overlayId: entered ?? kept };
}
