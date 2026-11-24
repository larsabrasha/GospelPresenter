import { createContext, useContext } from 'react';

// Inställningar's bar on a phone (ui/Dialog.tsx PageDialog): where a detail page puts its name and its "✓ Sparad",
// as it does in the content column's bar from `lg` (Lars, 2026-11-04: in the bar on every page, never twice).

interface PhoneBar {
  title: HTMLElement | null;
  saved: HTMLElement | null;
}

const PhoneBarSlots = createContext<PhoneBar | null>(null);

export const PagePhoneBarSlots = PhoneBarSlots.Provider;

export function usePhoneBarSlots() {
  return useContext(PhoneBarSlots);
}
