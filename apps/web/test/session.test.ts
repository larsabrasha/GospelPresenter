import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@gp/core';
import { saveSession, storedSession, updateMe } from '../src/auth/session.ts';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
});

const anna: Me = { userId: 'anna', name: 'Anna', role: 'admin', orgId: 'org-1', orgName: 'Lilla Kyrkan' } as Me;

describe('the stored identity', () => {
  beforeEach(() => {
    stored.clear();
    saveSession({ token: 't', me: anna } as never);
  });

  it('takes a new name from the server', () => {
    updateMe({ ...anna, name: 'Anna A' });

    expect(storedSession()?.me.name).toBe('Anna A');
  });

  it('keeps the session when an answer without its body is given as the identity', () => {
    updateMe(null);

    expect(storedSession()?.me).toEqual(anna);
  });

  it('keeps the session when the identity has no organisation', () => {
    updateMe({ ...anna, orgId: '' });

    expect(storedSession()?.me).toEqual(anna);
  });
});
