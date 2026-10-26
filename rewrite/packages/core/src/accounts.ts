import { z } from 'zod';
import { can, type Role } from './permissions.ts';

// Accounts, sign-in, membership and pairing (spec 01, ADR 0007 decision 6).
// Users, organisations and tokens are not synced (spec 06): they live in the
// server's global tables and are changed through its HTTP API. The request
// shapes and the policy are here so the server and the UI share them.

export const ROLES = ['user', 'admin', 'superAdmin'] as const satisfies readonly Role[];

/** Limits of spec 01 (ORG-R10, AUTH-R1, AUTH-R3, AUTH-R8) and of pairing (LIVE-R28, made stricter). */
export const ACCOUNT_LIMITS = {
  usersPerOrg: 100,
  unusedInvitesPerUser: 20,
  inviteTtlMs: 7 * 24 * 60 * 60_000,
  activeSessionsPerUser: 10,
  /** A session not used for this long is refused; any use renews it. */
  sessionIdleMs: 90 * 24 * 60 * 60_000,
  pairCodeTtlMs: 10 * 60_000,
  /** Wrong codes before the code on the host stops working. */
  pairCodeAttempts: 5,
  /** Linked logins per user, Google and passkeys together (ORG-R13). */
  loginsPerUser: 5,
  /**
   * Adding a way to sign in needs a session this young: a stolen session
   * that has been around for a while cannot plant a passkey of its own.
   */
  freshSignInMs: 10 * 60_000,
} as const;

export const roleSchema = z.enum(ROLES);
const personName = z.string().trim().min(1).max(200);
/** Lower-cased: one address, one account, whatever the case it is typed in. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'invalid-email');
const deviceName = z.string().trim().max(200).default('');

/**
 * Where a desktop app may be handed its token after a sign-in in the system
 * browser (spec 01 device sign-in, ADR 0005 (5)–(7)). Compared exactly and
 * case-sensitively; anything else is refused before a token is minted (AUTH-R10).
 */
export const CALLBACK_SCHEMES = ['gospelpresenter', 'gospelpresenter-test', 'gospelpresenter-local'] as const;
export type CallbackScheme = (typeof CALLBACK_SCHEMES)[number];

export function isCallbackScheme(s: unknown): s is CallbackScheme {
  return typeof s === 'string' && (CALLBACK_SCHEMES as readonly string[]).includes(s);
}

/**
 * How a user signs in: a linked login (spec 01 `UserLogin`), a Google
 * account or a passkey. A user may have both kinds, several passkeys, and
 * never no login at all once they have accepted their invite.
 */
export const LOGIN_PROVIDERS = ['google', 'passkey'] as const;
export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];

/** First run: the organisation and its SuperAdmin, who then links a Google account through the invite it answers with. */
export const setupRequest = z.object({
  setupToken: z.string().min(1).max(200),
  name: personName,
  orgName: z.string().trim().min(1).max(200),
});

export interface SetupResponse {
  /** The SuperAdmin's invite: accepting it with Google finishes setup. */
  inviteToken: string;
}

/**
 * Starts a sign-in with Google. With `invite`, the Google account that
 * signs in is linked to the invited user. With `app`, the token goes to a
 * desktop app through its callback scheme instead of to this page.
 */
export const googleBeginRequest = z.object({
  invite: z.string().min(1).max(200).optional(),
  /** Link the Google account to the caller's session instead of signing in. */
  link: z.literal(true).optional(),
  app: z.object({ deviceName, callbackScheme: z.string().max(100) }).optional(),
});

export const passkeyName = z.string().trim().min(1).max(100);

/**
 * Starts a passkey ceremony. `signin`: any passkey of this server's RP ID,
 * which says who it is (discoverable). `register`: a new passkey, for the
 * invited user with `invite`, else for the caller's own session. With
 * `app`, the ceremony runs in the system browser (`url` in the answer) and
 * the token goes to the app through its callback scheme.
 */
export const passkeyBeginRequest = z.object({
  mode: z.enum(['signin', 'register']),
  invite: z.string().min(1).max(200).optional(),
  name: passkeyName.optional(),
  app: z.object({ deviceName, callbackScheme: z.string().max(100) }).optional(),
});

const b64urlField = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9_-]*$/);

/** A credential as the browser gave it, its binary fields base64url (WebAuthn's `toJSON()` shape). */
export const passkeyCredential = z.object({
  id: b64urlField(1400).min(1),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64urlField(4000),
    attestationObject: b64urlField(20_000).optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    authenticatorData: b64urlField(4000).optional(),
    signature: b64urlField(2000).optional(),
    userHandle: b64urlField(200).nullable().optional(),
  }),
});
export type PasskeyCredentialJson = z.infer<typeof passkeyCredential>;

export const passkeyFinishRequest = z.object({ credential: passkeyCredential, deviceName });

export const renameLoginRequest = z.object({ name: passkeyName });

/** `PublicKeyCredentialCreationOptions` with its binary fields base64url. */
export interface PasskeyCreationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  authenticatorSelection: { residentKey: 'required'; requireResidentKey: true; userVerification: 'required' };
  excludeCredentials: { type: 'public-key'; id: string; transports?: string[] }[];
}

/** `PublicKeyCredentialRequestOptions` with its binary fields base64url. */
export interface PasskeyRequestOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'required';
  allowCredentials: [];
}

export type PasskeyOptions = { create: PasskeyCreationOptions } | { get: PasskeyRequestOptions };

/** `POST /auth/passkey/begin`: the options for this page, or where the system browser goes. */
export type PasskeyBeginResponse = { options: PasskeyOptions } | { url: string };

/**
 * `POST /auth/passkey/finish`: a session (a sign-in, or an invite accepted),
 * the added passkey (from a session), or for an app the link to hand back
 * (`callback`) or `done` when there is nothing to hand back.
 */
export type PasskeyFinishResponse = SignInResponse | { added: LoginMethod } | { callback: string } | { done: true };

/** One of the user's own ways to sign in, as `GET /auth/logins` lists them. */
export interface LoginMethod {
  provider: LoginProvider;
  /** The passkey's credential id, or the Google account's `sub`. */
  id: string;
  /** The passkey's name, or the Google account's email when it was linked. */
  name: string | null;
  createdAt: number;
  lastUsedAt: number;
}

/** After a web sign-in, the page trades its one-time handoff cookie for a session. */
export const googleFinishRequest = z.object({ deviceName });

export const createUserRequest = z.object({ name: personName, email: emailSchema, role: roleSchema });

export const changeRoleRequest = z.object({ role: roleSchema });

/** A pairing code signs the device in as `userId` (the caller when absent), a member of the caller's organisation. */
export const pairCodeRequest = z.object({ userId: z.string().min(1).max(200).optional() });

export const pairClaimRequest = z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(200) });

/** The signed-in user, as `GET /auth/me` answers, read fresh from the server's tables. */
export interface Me {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  orgId: string;
  orgName: string;
  sessionId: string;
}

export interface SignInResponse {
  token: string;
  me: Me;
}

/** A claimed pairing code: the device's token, and a session for the user the host chose. */
export interface PairClaimResponse {
  device: string;
  session: SignInResponse;
}

/** `GET /auth/state`. */
export interface AuthState {
  /** No user has linked a sign-in yet: the first run is not finished. */
  setupRequired: boolean;
  /** The server has a Google client configured. */
  google: boolean;
  /** The server has an RP ID and origins for passkeys. */
  passkeys: boolean;
}

export type InviteState =
  | { state: 'valid'; name: string; orgName: string; email: string | null }
  | { state: 'expired' }
  | { state: 'invalid' };

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  /** Whether the user has a linked login (accepted an invite). */
  active: boolean;
  /** The newest unused invite, if any. */
  invite: { expiresAt: number; expired: boolean } | null;
}

export interface PairStatus {
  /** The server refuses devices it has not paired (the desktop host). */
  required: boolean;
  paired: boolean;
  /** The request came from the host's own window. */
  host: boolean;
}

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
}

/** Error codes the auth API answers with, in `{ error }`. The UI has a text for each. */
export type AuthError =
  | 'unauthenticated'
  | 'not-a-member'
  | 'forbidden'
  | 'invalid-request'
  | 'google-disabled'
  | 'google-failed'
  | 'passkey-disabled'
  | 'passkey-failed'
  | 'last-login'
  | 'reauth-required'
  | 'not-linked'
  | 'login-taken'
  | 'callback-scheme'
  | 'too-many-attempts'
  | 'setup-done'
  | 'setup-token'
  | 'invite-invalid'
  | 'invite-expired'
  | 'email-taken'
  | 'limit'
  | 'not-found'
  | 'own-role'
  | 'own-account'
  | 'super-admin-only'
  | 'device-not-paired'
  | 'pair-code-invalid';

export interface Actor {
  id: string;
  role: Role;
}

/** Roles `actor` may hand out (PERM-R4): SuperAdmin only by a SuperAdmin. */
export function assignableRoles(actor: Role): Role[] {
  return ROLES.filter((r) => r !== 'superAdmin' || can(actor, 'AssignSuperAdminRole'));
}

/**
 * Why `actor` may not give `target` the role `role`, or null if it may.
 * PERM-R5: never your own role. PERM-R4: SuperAdmin only by a SuperAdmin.
 * D20: an Admin cannot demote a SuperAdmin. Together these keep at least one
 * SuperAdmin: only a SuperAdmin can demote one, and never itself.
 */
export function roleChangeRefusal(actor: Actor, target: Actor, role: Role): AuthError | null {
  if (!can(actor.role, 'ManageUsers')) return 'forbidden';
  if (actor.id === target.id) return 'own-role';
  if ((role === 'superAdmin' || target.role === 'superAdmin') && !can(actor.role, 'AssignSuperAdminRole')) return 'super-admin-only';
  return null;
}

/** Why `actor` may not remove `target`, or null. PERM-R6: never yourself. D20: a SuperAdmin only by a SuperAdmin. */
export function removeUserRefusal(actor: Actor, target: Actor): AuthError | null {
  if (!can(actor.role, 'ManageUsers')) return 'forbidden';
  if (actor.id === target.id) return 'own-account';
  if (target.role === 'superAdmin' && !can(actor.role, 'AssignSuperAdminRole')) return 'super-admin-only';
  return null;
}

/**
 * Why `actor` may not make a new invite for `target`, or null (D21). An
 * invite links the login that accepts it (a Google account or a new
 * passkey) in place of all the user's own, so it is a reset: an Admin may not reset a SuperAdmin's (D20). The
 * same holds for pairing a device as `target`, which signs it in as them.
 */
export function inviteRefusal(actor: Actor, target: Actor): AuthError | null {
  if (!can(actor.role, 'ManageUsers')) return 'forbidden';
  if (target.role === 'superAdmin' && actor.id !== target.id && !can(actor.role, 'AssignSuperAdminRole')) return 'super-admin-only';
  return null;
}

/** Why `actor` may not create a user with `role`, or null. */
export function createUserRefusal(actor: Role, role: Role): AuthError | null {
  if (!can(actor, 'ManageUsers')) return 'forbidden';
  if (role === 'superAdmin' && !can(actor, 'AssignSuperAdminRole')) return 'super-admin-only';
  return null;
}
