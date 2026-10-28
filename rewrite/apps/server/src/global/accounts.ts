// `Accounts`: the global tables' services, built in dependency order.
import { ACCOUNT_LIMITS } from '@gp/core';
import { DebugService } from './debug.ts';
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
}

/**
 * Every read and write of the global tables, one service per concern, all on
 * one database and one clock. Methods return an error code instead of throwing
 * for expected refusals.
 */
export class Accounts {
  readonly now: () => number;
  readonly members: MemberService;
  readonly signIn: SignInService;
  readonly logins: LoginService;
  readonly passkeys: PasskeyService;
  readonly throttle: ThrottleService;
  readonly pairing: PairingService;
  /** Debug servers and tests only. */
  readonly debug: DebugService;

  constructor(
    readonly sql: GlobalSql,
    opts: AccountOptions = {},
  ) {
    const now = (this.now = opts.now ?? Date.now);
    this.members = new MemberService(sql, now, opts.sessionIdleMs ?? ACCOUNT_LIMITS.sessionIdleMs);
    this.signIn = new SignInService(sql, now);
    this.logins = new LoginService(sql, now);
    this.passkeys = new PasskeyService(sql, now);
    this.throttle = new ThrottleService(sql, now);
    this.pairing = new PairingService(sql, now);
    this.debug = new DebugService(sql, now, this.members);
  }
}
