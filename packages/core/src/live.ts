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

/**
 * A change of the pointer, as a page asks for it. What it makes of the pointer (the overlay rules, one presentation
 * presented at a time) is the Rust core's (`liveChangeView`, crates/gp-core/src/live_state.rs).
 */
export type LivePointerChange = Partial<Omit<LivePointer, 'rev'>>;
