import { createContext, useContext } from 'react';

// Where a page's "✓ Sparad" goes in Inställningar's bar on a phone (ui/Dialog.tsx PageDialog), as it goes in the
// content column's bar from `lg` (Lars, 2026-11-04: in the bar on every page, never in the page).

const PhoneBarSlot = createContext<HTMLElement | null>(null);

export const PagePhoneBarSlot = PhoneBarSlot.Provider;

export function usePhoneBarSlot() {
  return useContext(PhoneBarSlot);
}
