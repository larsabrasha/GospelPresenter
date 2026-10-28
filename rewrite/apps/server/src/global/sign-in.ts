// Sign-in with Google, and accepting an invite with a Google account or a new passkey.
import type { AuthError } from '@gp/core';
import { newRowId, newSecret, sha256 } from '../crypto.ts';
import type { GoogleIdentity } from '../google.ts';
import type { NewPasskey } from '../webauthn.ts';
import type { GlobalSql } from './sql.ts';

/** A sign-in that left for Google, as the callback finds it. */
export interface LoginFlow {
  nonce: string;
  verifier: string;
  inviteHash: string | null;
  deviceName: string;
  /** Set when a desktop app gets the token through its callback scheme; null for this browser. */
  callbackScheme: string | null;
  /** Set when the flow links the Google account to this user's session rather than signing in. */
  link: { userId: string; sessionId: string } | null;
}

/** How long a sign-in may take from start to callback, and the most one address may have open. */
export const LOGIN_FLOW = { ttlMs: 10 * 60_000, perAddress: 20 } as const;

/** A login to link: a Google account, or a passkey that registration verified. */
export type NewLogin = { provider: 'google'; subject: string; name: string | null } | { provider: 'passkey'; passkey: NewPasskey; name: string };

export function loginValues(l: NewLogin): [provider: string, subject: string, name: string | null, publicKey: string | null, signCount: number | null, transports: string | null] {
  return l.provider === 'google'
    ? ['google', l.subject, l.name, null, null, null]
    : ['passkey', l.passkey.id, l.name, l.passkey.publicKey, l.passkey.signCount, JSON.stringify(l.passkey.transports)];
}

/** Sign-in with Google, and accepting invites. */
export class SignInService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
  ) {}

  /**
   * A sign-in about to leave for Google. Its `state` is the returned secret;
   * only its hash is kept. At most LOGIN_FLOW.perAddress unfinished per address,
   * so a stranger cannot fill the table; old ones are swept here.
   */
  async createFlow(a: {
    address: string;
    inviteToken: string | null;
    deviceName: string;
    callbackScheme: string | null;
    link?: { userId: string; sessionId: string };
  }): Promise<string | 'limit'> {
    const state = newSecret('');
    const now = this.now();
    const [, inserted] = await this.sql.batch([
      ['DELETE FROM login_flows WHERE expires_at < ?', [now - 24 * 60 * 60_000]],
      [
        `INSERT INTO login_flows (state_hash, address, nonce, verifier, invite_hash, device_name, callback_scheme, created_at, expires_at,
           link_user_id, link_session_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT count(*) FROM login_flows WHERE address = ? AND used_at IS NULL AND expires_at > ?) < ?`,
        [
          await sha256(state),
          a.address,
          newSecret(''),
          newSecret(''), // the PKCE verifier: 43 characters of [A-Za-z0-9_-], as RFC 7636 asks
          a.inviteToken ? await sha256(a.inviteToken) : null,
          a.deviceName.slice(0, 200) || 'App',
          a.callbackScheme,
          now,
          now + LOGIN_FLOW.ttlMs,
          a.link?.userId ?? null,
          a.link?.sessionId ?? null,
          a.address,
          now,
          LOGIN_FLOW.perAddress,
        ],
      ],
    ]);
    return inserted === 1 ? state : 'limit';
  }

  /**
   * Binds a flow to the browser that opens it first (its hash of `browser`,
   * a secret in that browser's cookie) and gives what the authorization
   * request needs. A flow starts once.
   */
  async startFlow(state: string, browser: string): Promise<{ nonce: string; verifier: string } | null> {
    const hash = await sha256(state);
    const n = await this.sql.run('UPDATE login_flows SET browser_hash = ? WHERE state_hash = ? AND browser_hash IS NULL AND used_at IS NULL AND expires_at > ?', [
      await sha256(browser),
      hash,
      this.now(),
    ]);
    if (n !== 1) return null;
    const [r] = await this.sql.all('SELECT nonce, verifier FROM login_flows WHERE state_hash = ?', [hash]);
    return r ? { nonce: String(r.nonce), verifier: String(r.verifier) } : null;
  }

  /**
   * The callback's flow: the one `state` names, in the browser that started
   * it, not expired, and not used before. Taking it uses it, so a replayed
   * callback finds nothing.
   */
  async takeFlow(state: string, browser: string): Promise<LoginFlow | null> {
    const hash = await sha256(state);
    const now = this.now();
    const n = await this.sql.run('UPDATE login_flows SET used_at = ? WHERE state_hash = ? AND browser_hash = ? AND used_at IS NULL AND expires_at > ?', [
      now,
      hash,
      await sha256(browser),
      now,
    ]);
    if (n !== 1) return null;
    const [r] = await this.sql.all('SELECT nonce, verifier, invite_hash, device_name, callback_scheme, link_user_id, link_session_id FROM login_flows WHERE state_hash = ?', [
      hash,
    ]);
    if (!r) return null;
    return {
      nonce: String(r.nonce),
      verifier: String(r.verifier),
      inviteHash: (r.invite_hash as string | null) ?? null,
      deviceName: String(r.device_name),
      callbackScheme: (r.callback_scheme as string | null) ?? null,
      link: r.link_user_id === null ? null : { userId: String(r.link_user_id), sessionId: String(r.link_session_id) },
    };
  }

  /** After a web sign-in: who signed in, waiting for the page to collect it with `handoff` (a secret in its cookie). */
  async setHandoff(state: string, handoff: string, userId: string, orgId: string): Promise<void> {
    await this.sql.run('UPDATE login_flows SET handoff_hash = ?, user_id = ?, org_id = ? WHERE state_hash = ?', [await sha256(handoff), userId, orgId, await sha256(state)]);
  }

  /** Collects a web sign-in, once, before its flow expires. */
  async takeHandoff(handoff: string): Promise<{ userId: string; orgId: string } | null> {
    const hash = await sha256(handoff);
    const now = this.now();
    const [r] = await this.sql.all('SELECT state_hash, user_id, org_id FROM login_flows WHERE handoff_hash = ? AND expires_at > ?', [hash, now]);
    if (!r || r.user_id === null) return null;
    const n = await this.sql.run('UPDATE login_flows SET handoff_hash = NULL WHERE state_hash = ? AND handoff_hash = ?', [r.state_hash, hash]);
    return n === 1 ? { userId: String(r.user_id), orgId: String(r.org_id) } : null;
  }

  /**
   * Who a verified Google identity signs in as (spec 01 callback rules).
   * Without an invite: the user its `sub` is linked to, or no one (AUTH-R4:
   * no self-registration, and never a match by email). With an invite: the
   * invited user, whose logins this one replaces (`acceptInvite`).
   */
  async signInWithGoogle(id: GoogleIdentity, inviteHash: string | null): Promise<{ userId: string; orgId: string } | AuthError> {
    if (inviteHash) return this.acceptInvite(inviteHash, { provider: 'google', subject: id.sub, name: id.email }, id.email);
    const [linked] = await this.sql.all("SELECT user_id FROM user_logins WHERE provider = 'google' AND subject = ?", [id.sub]);
    if (!linked) return 'not-linked';
    await this.sql.run("UPDATE user_logins SET last_used_at = ? WHERE provider = 'google' AND subject = ?", [this.now(), id.sub]);
    return this.signedInAs(String(linked.user_id));
  }

  /** The organisation a user signs in to: their only one, for now (D1). */
  async signedInAs(userId: string): Promise<{ userId: string; orgId: string } | 'not-a-member'> {
    const [m] = await this.sql.all('SELECT org_id FROM memberships WHERE user_id = ? ORDER BY org_id LIMIT 1', [userId]);
    return m ? { userId, orgId: String(m.org_id) } : 'not-a-member';
  }

  /**
   * Accepts an invite with `login`, a Google account or a new passkey. It
   * replaces every login the user had and revokes their sessions, since a new
   * invite is also how an admin resets a lost account: whoever held the old
   * passkey or Google account is out. A login already linked to another user
   * is refused (spec 01 E4 says otherwise; docs/assumptions.md). The invite is
   * used in the same batch, so it is spent only by a link that succeeds.
   */
  async acceptInvite(inviteHash: string, login: NewLogin, email: string | null = null): Promise<{ userId: string; orgId: string } | AuthError> {
    const now = this.now();
    const [inv] = await this.sql.all(
      `SELECT i.user_id, i.expires_at, i.used_at FROM invites i JOIN memberships m ON m.user_id = i.user_id AND m.org_id = i.org_id
       WHERE i.token_hash = ?`,
      [inviteHash],
    );
    if (!inv || inv.used_at !== null) return 'invite-invalid';
    if (Number(inv.expires_at) <= now) return 'invite-expired';
    const userId = String(inv.user_id);
    const [provider, subject, name, publicKey, signCount, transports] = loginValues(login);
    const [linked] = await this.sql.all('SELECT user_id FROM user_logins WHERE provider = ? AND subject = ?', [provider, subject]);
    if (linked && String(linked.user_id) !== userId) return 'login-taken';
    const nonce = newRowId();
    const used = `(SELECT user_id FROM invites WHERE token_hash = ? AND use_nonce = ?)`;
    let claimed: number | undefined;
    try {
      [claimed] = await this.sql.batch([
        [`UPDATE invites SET used_at = ?, use_nonce = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, [now, nonce, inviteHash, now]],
        [`DELETE FROM user_logins WHERE user_id = ${used}`, [inviteHash, nonce]],
        [
          `INSERT INTO user_logins (provider, subject, user_id, created_at, last_used_at, name, public_key, sign_count, transports)
           SELECT ?, ?, user_id, ?, ?, ?, ?, ?, ? FROM invites WHERE token_hash = ? AND use_nonce = ?`,
          [provider, subject, now, now, name, publicKey, signCount, transports, inviteHash, nonce],
        ],
        // Spec 01: an empty email is filled from Google's, unless another user has that address.
        [
          `UPDATE users SET email = ? WHERE id = ${used} AND email IS NULL AND ? IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
          [email, inviteHash, nonce, email, email],
        ],
        [`UPDATE sessions SET revoked_at = ? WHERE user_id = ${used} AND revoked_at IS NULL`, [now, inviteHash, nonce]],
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return 'login-taken'; // linked to someone else meanwhile; the batch rolled back
      throw e;
    }
    if (claimed !== 1) return 'invite-invalid';
    return this.signedInAs(userId);
  }
}
