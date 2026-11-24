import { createContext, useContext } from 'react';

// Apart from PageContainer, so a button that floats (ui/AddButton.tsx) does not bring in the page's layout.

const FloatSlot = createContext<HTMLElement | null>(null);

/** Where a list page's + floats in Inställningar: the content column's bottom right (Lars, 2026-11-02). */
export const PageFloatSlot = FloatSlot.Provider;

export function useFloatSlot() {
  return useContext(FloatSlot);
}

const HeaderFloat = createContext<HTMLElement | null>(null);

/** Set by a heading row (PageHeader) to where its + floats, or null where it stays in the row. */
export const HeaderFloatProvider = HeaderFloat.Provider;

export function useHeaderFloat() {
  return useContext(HeaderFloat);
}
