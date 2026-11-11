// `Accounts`: the global tables' services, built in dependency order.
import { ACCOUNT_LIMITS } from '@gp/core';
import { BugReportService } from './bug-reports.ts';
import { DebugService } from './debug.ts';
import { EmailService } from './emails.ts';
import { InvitationService } from './invitations.ts';
import { LegacyUserService } from './legacy-users.ts';
import { LoginService } from './logins.ts';
import { MemberService } from './members.ts';
import { PairingService } from './pairing.ts';
import { PasskeyService } from './passkeys.ts';
import { SignInService } from './sign-in.ts';
import type { GlobalSql } from './sql.ts';
import { ThrottleService } from './throttle.ts';

export interface AccountOptions {
  now?: () => number;
  /** A session unused for this long is refused (ACCOUNT_LIMITS.sessionIdleMs by default). */
  sessionIdleMs?: number;
  /**
   * The Superadmins' addresses, from the server's configuration (`GP_SUPER_ADMINS`): only an account that has
   * confirmed one of them is a Superadmin. Absent: the mark in the database counts (a desktop host: whoever ran setup).
   */
  superAdmins?: readonly string[] | null;
}

/**
 * Every read and write of the global tables, one service per concern, all on
 * one database and one clock. Methods return an error code instead of throwing
 * for expected refusals.
 */
export class Accounts {
  readonly now: () => number;
  readonly members: MemberService;
  /** Invitations: pending memberships of an address. */
  readonly invitations: InvitationService;
  /** Confirming a person's own address, and the Superadmins' log. */
  readonly emails: EmailService;
  readonly signIn: SignInService;
  readonly logins: LoginService;
  readonly passkeys: PasskeyService;
  readonly throttle: ThrottleService;
  readonly pairing: PairingService;
  /** The users an import from 1.x brings along. */
  readonly legacy: LegacyUserService;
  /** "Rapportera fel" (docs/bug-reports.md). */
  readonly bugReports: BugReportService;
  /** Debug servers and tests only. */
  readonly debug: DebugService;

  constructor(
    readonly sql: GlobalSql,
    opts: AccountOptions = {},
  ) {
    const now = (this.now = opts.now ?? Date.now);
    this.members = new MemberService(sql, now, opts.sessionIdleMs ?? ACCOUNT_LIMITS.sessionIdleMs, opts.superAdmins ?? null);
    this.emails = new EmailService(sql, now);
    this.invitations = new InvitationService(sql, now, this.emails);
    this.signIn = new SignInService(sql, now, this.invitations, this.emails);
    this.logins = new LoginService(sql, now);
    this.passkeys = new PasskeyService(sql, now);
    this.throttle = new ThrottleService(sql, now);
    this.pairing = new PairingService(sql, now);
    this.legacy = new LegacyUserService(sql, now, this.members);
    this.bugReports = new BugReportService(sql, now);
    this.debug = new DebugService(sql, now, this.members);
  }
}
