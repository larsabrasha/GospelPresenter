import { useEffect, useState } from 'react';
import type { LivePointer } from '@gp/core';
import type { LiveChannel } from './live.ts';

export function useLivePointer(live: LiveChannel): LivePointer {
  const [pointer, setPointer] = useState(live.pointer);
  useEffect(() => live.subscribe(setPointer), [live]);
  return pointer;
}

/** Opens the output: on the second display in the desktop app, in a new window in a browser. */
export function openOutput() {
  const desktop = window.gpDesktop;
  if (desktop) desktop.openOutput();
  else window.open(`${location.pathname}${location.search}#/output`, 'gp-output', 'popup');
}
