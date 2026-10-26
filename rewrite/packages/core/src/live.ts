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
  /** Increases with every change, so a late message never undoes a newer one. */
  rev: number;
}

export const IDLE: LivePointer = { presentationId: null, itemId: null, partIndex: 0, black: false, rev: 0 };

/** The newer of two pointers. */
export function newer(a: LivePointer, b: LivePointer): LivePointer {
  return b.rev > a.rev ? b : a;
}
