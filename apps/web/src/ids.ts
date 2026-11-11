import { randomId } from '@gp/core';

/** A new random id: also over plain http on the LAN, where crypto.randomUUID is missing (see `randomId`). */
export function newId(): string {
  return randomId();
}
