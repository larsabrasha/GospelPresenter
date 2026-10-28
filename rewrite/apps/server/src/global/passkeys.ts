// Passkey ceremonies and the stored passkeys they check.
import type { AuthError } from '@gp/core';
import { newSecret, sha256 } from '../crypto.ts';
import type { StoredPasskey } from '../webauthn.ts';
import { LoginAccounts } from './logins.ts';

function parseTransports(v: unknown): string[] {
  try {
    const t = JSON.parse(String(v ?? '[]')) as unknown;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** How long a passkey ceremony may take from its begin to its credential, and the most one address may have open. */
export const PASSKEY_FLOW = { ttlMs: 5 * 60_000, perAddress: 20 } as const;

/** A passkey ceremony, as its start and its finish find it. */
export interface PasskeyFlow {
  kind: 'register' | 'authenticate';
  /** Registration from a signed-in session: whose, and that session (which must still be valid at the end). */
  userId: string | null;
  sessionId: string | null;
  /** Registration that accepts an invite. */
  inviteHash: string | null;
  /** The new passkey's name. */
  name: string | null;
  deviceName: string;
  callbackScheme: string | null;
}

export class PasskeyAccounts extends LoginAccounts {
  // ------------------------------------------------------------ passkeys

  /**
   * A passkey ceremony about to start. Its `state` is the returned secret;
   * only its hash is kept. At most PASSKEY_FLOW.perAddress unfinished per
   * address; old ones are swept here.
   */
  async createPasskeyFlow(a: {
    kind: PasskeyFlow['kind'];
    address: string;
    userId?: string;
    sessionId?: string;
    inviteToken?: string;
    name?: string;
    deviceName: string;
    callbackScheme: string | null;
  }): Promise<string | 'limit'> {
    const state = newSecret('');
    const now = this.now();
    const [, inserted] = await this.sql.batch([
      ['DELETE FROM passkey_flows WHERE expires_at < ?', [now - 24 * 60 * 60_000]],
      [
        `INSERT INTO passkey_flows (state_hash, kind, address, user_id, session_id, invite_hash, name, device_name, callback_scheme, created_at, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT count(*) FROM passkey_flows WHERE address = ? AND used_at IS NULL AND expires_at > ?) < ?`,
        [
          await sha256(state),
          a.kind,
          a.address,
          a.userId ?? null,
          a.sessionId ?? null,
          a.inviteToken ? await sha256(a.inviteToken) : null,
          a.name ?? null,
          a.deviceName.slice(0, 200) || 'App',
          a.callbackScheme,
          now,
          now + PASSKEY_FLOW.ttlMs,
          a.address,
          now,
          PASSKEY_FLOW.perAddress,
        ],
      ],
    ]);
    return inserted === 1 ? state : 'limit';
  }

  /** Binds a flow to the browser that opens it first and gives it its `challenge`. A flow starts once. */
  async startPasskeyFlow(state: string, browser: string, challenge: string): Promise<PasskeyFlow | null> {
    const hash = await sha256(state);
    const n = await this.sql.run(
      'UPDATE passkey_flows SET browser_hash = ?, challenge_hash = ? WHERE state_hash = ? AND browser_hash IS NULL AND used_at IS NULL AND expires_at > ?',
      [await sha256(browser), await sha256(challenge), hash, this.now()],
    );
    return n === 1 ? this.passkeyFlowRow('state_hash', hash) : null;
  }

  /**
   * The flow a credential answers: the one its challenge names, of this
   * kind, in the browser that started it, not expired and not used before.
   * Taking it uses it, so a replayed credential finds nothing.
   */
  async takePasskeyFlow(challenge: string, browser: string, kind: PasskeyFlow['kind']): Promise<PasskeyFlow | null> {
    const hash = await sha256(challenge);
    const now = this.now();
    const n = await this.sql.run(
      'UPDATE passkey_flows SET used_at = ? WHERE challenge_hash = ? AND browser_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?',
      [now, hash, await sha256(browser), kind, now],
    );
    return n === 1 ? this.passkeyFlowRow('challenge_hash', hash) : null;
  }

  private async passkeyFlowRow(column: 'state_hash' | 'challenge_hash', hash: string): Promise<PasskeyFlow | null> {
    const [r] = await this.sql.all(
      `SELECT kind, user_id, session_id, invite_hash, name, device_name, callback_scheme FROM passkey_flows WHERE ${column} = ?`,
      [hash],
    );
    if (!r) return null;
    return {
      kind: r.kind as PasskeyFlow['kind'],
      userId: (r.user_id as string | null) ?? null,
      sessionId: (r.session_id as string | null) ?? null,
      inviteHash: (r.invite_hash as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      deviceName: String(r.device_name),
      callbackScheme: (r.callback_scheme as string | null) ?? null,
    };
  }

  /**
   * Who a registration flow makes a passkey for: the invited user, or the
   * owner of the session that began it while it is still valid. With the
   * user's passkeys to exclude (none for an invite, which replaces them).
   */
  async registrant(flow: PasskeyFlow): Promise<{ userId: string; name: string; email: string | null; exclude: { id: string; transports: string[] }[] } | AuthError> {
    if (flow.inviteHash) {
      const [r] = await this.sql.all(
        `SELECT i.user_id, i.expires_at, i.used_at, u.name, u.email FROM invites i JOIN users u ON u.id = i.user_id
         JOIN memberships m ON m.user_id = i.user_id AND m.org_id = i.org_id WHERE i.token_hash = ?`,
        [flow.inviteHash],
      );
      if (!r || r.used_at !== null) return 'invite-invalid';
      if (Number(r.expires_at) <= this.now()) return 'invite-expired';
      return { userId: String(r.user_id), name: String(r.name), email: (r.email as string | null) ?? null, exclude: [] };
    }
    const [r] = await this.sql.all(
      `SELECT u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL`,
      [flow.sessionId, flow.userId],
    );
    if (!r || !flow.userId) return 'unauthenticated';
    const mine = await this.sql.all("SELECT subject, transports FROM user_logins WHERE user_id = ? AND provider = 'passkey'", [flow.userId]);
    return {
      userId: flow.userId,
      name: String(r.name),
      email: (r.email as string | null) ?? null,
      exclude: mine.map((p) => ({ id: String(p.subject), transports: parseTransports(p.transports) })),
    };
  }

  /** A stored passkey by its credential id. */
  async passkey(id: string): Promise<StoredPasskey | null> {
    const [r] = await this.sql.all("SELECT user_id, public_key, sign_count FROM user_logins WHERE provider = 'passkey' AND subject = ?", [id]);
    return r && r.public_key !== null ? { userId: String(r.user_id), publicKey: String(r.public_key), signCount: Number(r.sign_count ?? 0) } : null;
  }

  /**
   * Records a sign-in with a passkey: its new counter, only if the counter is
   * still the one that was checked, so of two sign-ins racing with the same
   * counter at most one passes where the counter matters.
   */
  async usePasskey(id: string, checked: number, signCount: number): Promise<boolean> {
    return (
      (await this.sql.run("UPDATE user_logins SET sign_count = ?, last_used_at = ? WHERE provider = 'passkey' AND subject = ? AND sign_count = ?", [
        signCount,
        this.now(),
        id,
        checked,
      ])) === 1
    );
  }
}
