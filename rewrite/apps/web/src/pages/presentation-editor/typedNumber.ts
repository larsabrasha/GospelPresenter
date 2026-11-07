import { useEffect, useState } from 'react';

/** How long typed digits wait for ↵ before they are forgotten. */
const TYPED_MS = 3000;

/**
 * The digits of a slide's number typed while presenting, until ↵ takes them or Escape or a pause of TYPED_MS lets them
 * go; at most three, the last typed.
 */
export function useTypedNumber() {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!typed) return;
    const timer = setTimeout(() => setTyped(''), TYPED_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  return { typed, set: setTyped, clear: () => setTyped('') };
}
