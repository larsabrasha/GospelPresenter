import { useEffect, useState } from 'react';

/**
 * Puts `text` on the clipboard; true once it is there. The clipboard API where the page is secure; else the older copy
 * command on a hidden field, which a LAN address over plain http still allows, Safari on an iPhone too (Lars,
 * 2026-11-03: a link must be copyable there). Call it from the click itself: the old command runs before any wait.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (an app view, an old browser): the old command below may still do it.
    }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  // Out of sight, and 16 px so an iPhone does not zoom to it.
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}

/** A copy row's "copied": true for two seconds once `copy` has put the text on the clipboard, as a web page's copy button says it. */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return [copied, (text) => void copyText(text).then(setCopied)];
}
