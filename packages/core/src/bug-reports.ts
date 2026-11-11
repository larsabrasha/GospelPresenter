import { z } from 'zod';

// "Rapportera fel" (Lars, 2026-11-05): what the user wrote, a screenshot they may leave out, and the app's state and
// its last steps, so the Superadmin can see the error and do the same again (docs/bug-reports.md). A desktop host keeps
// its own, for its own Superadmin: nothing is sent on.

export const BUG_REPORT_LIMITS = {
  text: 4000,
  /** The screenshot as a data URL (base64 JPEG or PNG): about 1.1 MB of picture. */
  shot: 1_500_000,
  /** The state as JSON. */
  state: 60_000,
  /** The steps before the report, newest last. */
  trail: 60,
  /** Reports kept on a server; the oldest go first, with their threads. */
  kept: 500,
  /** Messages in one report's thread. */
  messages: 200,
} as const;

const SHOT = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const bugReportSchema = z.object({
  text: z.string().trim().min(1).max(BUG_REPORT_LIMITS.text),
  shot: z.string().max(BUG_REPORT_LIMITS.shot).regex(SHOT).nullable(),
  state: z.record(z.string(), z.unknown()).refine((s) => JSON.stringify(s).length <= BUG_REPORT_LIMITS.state),
});

export type BugReportInput = z.infer<typeof bugReportSchema>;

/** Who reported and where, copied in when the report is taken. */
export interface BugReporter {
  userId: string;
  userName: string;
  userEmail: string | null;
  role: string;
  orgId: string;
  orgName: string;
}

export const bugReportDoneRequest = z.object({ done: z.boolean() });

/** A message in a report's thread, from either side. */
export const bugReportMessageRequest = z.object({ text: z.string().trim().min(1).max(BUG_REPORT_LIMITS.text) });

/** A message in a report's thread: from the Superadmin (`fromAdmin`) or from the one who reported. */
export interface BugReportMessage {
  id: string;
  createdAt: number;
  fromAdmin: boolean;
  userName: string;
  text: string;
}

/** One of the user's own reports, in Mina felrapporter: `unread` is the Superadmin's messages not read yet. */
export interface MyBugReportRow {
  id: string;
  createdAt: number;
  text: string;
  done: boolean;
  unread: number;
}

/** One of the user's own reports whole, with its thread. */
export interface MyBugReport extends MyBugReportRow {
  shot: string | null;
  messages: BugReportMessage[];
}

/** A report in the Superadmin's list. */
export interface BugReportRow {
  id: string;
  createdAt: number;
  text: string;
  userName: string;
  orgName: string;
  hasShot: boolean;
  done: boolean;
  /** The reporter's messages the Superadmin has not read yet. */
  unread: number;
}

/** One report whole. */
export interface BugReport extends BugReportRow {
  userId: string;
  userEmail: string | null;
  role: string;
  orgId: string;
  shot: string | null;
  state: Record<string, unknown>;
  messages: BugReportMessage[];
}
