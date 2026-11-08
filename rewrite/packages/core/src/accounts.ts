import { z } from 'zod';
import { can, type MemberRole, type Role } from './permissions.ts';

// Accounts, sign-in, membership and pairing (spec 01, ADR 0007 decision 6).
// Users, organisations and tokens are not synced (spec 06): they live in the
// server's global tables and are changed through its HTTP API. The request
// shapes and the policy are here so the server and the UI share them.

/** The roles a membership can have (docs/accounts-and-roles.md): a Superadmin is a mark on the account, not a role. */
export const ROLES = ['user', 'admin'] as const satisfies readonly MemberRole[];

/** Limits of spec 01 (ORG-R10, AUTH-R1, AUTH-R3, AUTH-R8) and of pairing (LIVE-R28, made stricter). */
export const ACCOUNT_LIMITS = {
  /** Organisations on one server (ORG-R2). */
  orgs: 100,
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
  /** How long superadminläge stays on after a fresh sign-in turns it on. */
  superModeMs: 60 * 60_000,
  /** How long a link that confirms an e-mail address works. */
  emailLinkTtlMs: 24 * 60 * 60_000,
  /** How long an invitation a 1.x import made waits: its people come back over weeks. */
  importInviteTtlMs: 90 * 24 * 60 * 60_000,
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

/** The app's languages; a mail goes out in the language of the page that asked for it (decided on 2026-10-31). */
export const mailLanguage = z.enum(['sv', 'en']).catch('sv');

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

/** First run: the organisation and its first Admin, a Superadmin, who then links a login through the invite it answers with. */
export const setupRequest = z.object({
  setupToken: z.string().min(1).max(200),
  name: personName,
  orgName: z.string().trim().min(1).max(200),
});

export interface SetupResponse {
  /** The first Admin's invite: accepting it with Google or a passkey finishes setup. */
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
 * which says who it is (discoverable); with an invitation's `invite`, that
 * account accepts it. `register`: a new passkey, for a new account named
 * `personName` with an invitation, for the user a reset link names, else for
 * the caller's own session. With `app`, the ceremony runs in the system
 * browser (`url` in the answer) and the token goes to the app through its
 * callback scheme.
 */
export const passkeyBeginRequest = z.object({
  mode: z.enum(['signin', 'register']),
  invite: z.string().min(1).max(200).optional(),
  name: passkeyName.optional(),
  personName: z.string().trim().min(1).max(200).optional(),
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

/**
 * `POST /api/invitations` (Användare → Bjud in): a pending membership of an address. Where the server sends mail the
 * link goes only by mail, so that opening it confirms the address; elsewhere it is answered, to be copied.
 */
export const inviteRequest = z.object({ email: emailSchema, role: roleSchema, language: mailLanguage.optional() });

/**
 * `POST /api/users`, on a desktop host only: a person who is a member there and nowhere else, with a name and maybe an
 * address (unconfirmed), to pair devices as (docs/accounts-and-roles.md, "The desktop host"). A host sends no mail, and
 * only its own window signs in, so an invitation could not be accepted from another device.
 */
export const createUserRequest = z.object({ name: personName, email: emailSchema.nullable().optional(), role: roleSchema });

/**
 * `PATCH /api/users/{id}` (the user detail page): the role, for an Admin; the name and the e-mail (null clears it)
 * too, only in superadminläge. Each field is checked by its own rule.
 */
export const updateUserRequest = z
  .object({ name: personName.optional(), email: emailSchema.nullable().optional(), role: roleSchema.optional() })
  .refine((a) => a.name !== undefined || a.email !== undefined || a.role !== undefined);

/** `PATCH /api/auth/me`: your own name (Mina inställningar). */
export const updateMeRequest = z.object({ name: personName });

/** `POST /api/auth/email`: your own new address, or your address as it is to confirm it. */
export const changeEmailRequest = z.object({ email: emailSchema, language: mailLanguage.optional() });

/** `POST /api/auth/email/confirm`: the token of the link that reached the address. */
export const confirmEmailRequest = z.object({ token: z.string().min(1).max(200) });

/** `POST /api/auth/superadmin`: turns superadminläge on (after a fresh sign-in) or off. */
export const superModeRequest = z.object({ on: z.boolean() });

/** `POST /api/orgs` and `PATCH /api/orgs/{id}`: an organisation's name (ORG-R1). */
export const orgNameRequest = z.object({ name: z.string().trim().min(1).max(200) });

/** `POST /api/auth/switch`: the organisation to act in from now on (spec 01 switcher). */
export const switchOrgRequest = z.object({ orgId: z.string().min(1).max(200) });

/** A row of `/admin/organizations`. */
export interface OrgRow {
  id: string;
  name: string;
  members: number;
}

/** A pairing code signs the device in as `userId` (the caller when absent), a member of the caller's organisation. */
export const pairCodeRequest = z.object({ userId: z.string().min(1).max(200).optional() });

export const pairClaimRequest = z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(200) });
export const pairDevRequest = pairClaimRequest.pick({ name: true });

/** The signed-in user, as `GET /auth/me` answers, read fresh from the server's tables. */
export interface Me {
  userId: string;
  name: string;
  email: string | null;
  /** The address reached them by a link, or Google vouches for it. */
  emailConfirmed: boolean;
  /** The role they act with now: their membership's, or `superAdmin` in superadminläge. */
  role: Role;
  /** The account has the Superadmin mark, whether or not superadminläge is on. */
  superAdmin: boolean;
  /** When superadminläge turns itself off; null while it is off. */
  superUntil: number | null;
  orgId: string;
  orgName: string;
  sessionId: string;
}

export interface SignInResponse {
  token: string;
  me: Me;
}

/** `POST /api/auth/superadmin`: who you are now, and a new token when turning it off left an organisation you are not a member of. */
export interface SuperModeResponse {
  token?: string;
  me: Me;
}

/** `POST /api/auth/email`: `sent` when a link went to the address; without mail (a desktop host) the address is set, unconfirmed. */
export type ChangeEmailResponse = { sent: true } | { changed: true };

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
  /** The server can send e-mail (a Resend key, a sender and the app's address): invites by mail, and "Glömt hur du loggar in?". */
  mail: boolean;
}


/** "Glömt hur du loggar in?": the confirmed address to send a recovery link to. */
export const recoverRequest = z.object({ email: emailSchema, language: mailLanguage.optional() });

/** A Superadmin's "Skicka via e-post" of a reset link: the language to write the mail in. */
export const mailInviteRequest = z.object({ language: mailLanguage.optional() });

/**
 * What an invite link is: `join`, an invitation to an organisation, accepted with an account one has or a new one;
 * `reset`, a link that replaces a person's logins (setup, "Glömt hur du loggar in?", a Superadmin's reset).
 */
export type InviteState =
  | { state: 'valid'; kind: 'join'; orgName: string; email: string }
  | { state: 'valid'; kind: 'reset'; name: string; orgName: string; email: string | null }
  | { state: 'expired' }
  | { state: 'invalid' };

/** An invitation not yet accepted, as Användare lists it (Inbjuden). */
export interface InvitationRow {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: number;
  expired: boolean;
}

/** `POST /api/invitations`: the link, unless it went by mail (`mailed`). */
export type InvitationResponse = { id: string; mailed: true } | { id: string; mailed: false; inviteToken: string };

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: MemberRole;
  /** Whether the user has a linked login (accepted an invite). */
  active: boolean;
  /** The newest unused reset link, if any. */
  invite: { expiresAt: number; expired: boolean } | null;
  /** This is their only membership: on a desktop host an Admin may reset them (`accountRefusal`). */
  onlyHere: boolean;
  /** The account has the Superadmin mark. */
  superAdmin: boolean;
}

export interface PairStatus {
  /** The server refuses devices it has not paired (the desktop host). */
  required: boolean;
  paired: boolean;
  /** The request came from the host's own window. */
  host: boolean;
  /** A development host lets a device in without a code (`GP_DEV_PAIR=1`): it asks `/api/pair/dev`. */
  dev: boolean;
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
  | 'pair-code-invalid'
  | 'mail-disabled'
  | 'mail-failed'
  | 'no-email'
  | 'super-admin-home'
  | 'last-admin';

export interface Actor {
  id: string;
  role: Role;
}

/** A member as a policy sees them: their role in the caller's organisation. */
export interface MemberActor {
  id: string;
  role: MemberRole;
}

/**
 * Why `actor` may not give `target` the role `role`, or null if it may. PERM-R5: never your own role. An
 * organisation always has at least one Admin (`admins`, how many it has): the last one stays one. Making someone
 * Admin also asks for a fresh sign-in, which the server checks.
 */
export function roleChangeRefusal(actor: Actor, target: MemberActor, role: MemberRole, admins: number): AuthError | null {
  if (!can(actor.role, 'ManageUsers')) return 'forbidden';
  if (actor.id === target.id) return 'own-role';
  if (target.role === 'admin' && role !== 'admin' && admins <= 1) return 'last-admin';
  return null;
}

/** Why `actor` may not remove `target`, or null. PERM-R6: never yourself; never the organisation's last Admin. */
export function removeUserRefusal(actor: Actor, target: MemberActor, admins: number): AuthError | null {
  if (!can(actor.role, 'ManageUsers')) return 'forbidden';
  if (actor.id === target.id) return 'own-account';
  if (target.role === 'admin' && admins <= 1) return 'last-admin';
  return null;
}

/**
 * Why `actor` may not change another person's account (their name, address or logins, or a link that replaces
 * their logins), or null (docs/accounts-and-roles.md): the account is the person's, so only a Superadmin in
 * superadminläge may. On a desktop host an Admin may also reset someone whose only membership is the host's
 * organisation (`hostOnly`), and pair a device as them, unless that person is a Superadmin.
 */
export function accountRefusal(actor: Actor, target: { hostOnly: boolean; superAdmin: boolean }): AuthError | null {
  if (actor.role === 'superAdmin') return null;
  if (!can(actor.role, 'ManageUsers')) return 'forbidden';
  return target.hostOnly && !target.superAdmin ? null : 'super-admin-only';
}
