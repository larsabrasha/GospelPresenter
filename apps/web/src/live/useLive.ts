import { useEffect, useState } from 'react';
import type { LivePointer } from '@gp/core';
import type { LiveControl } from './remote.ts';

export function useLivePointer(live: LiveControl): LivePointer {
  const [pointer, setPointer] = useState(live.pointer);
  useEffect(() => live.subscribe(setPointer), [live]);
  return pointer;
}
