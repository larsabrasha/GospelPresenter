import { CLIENT_ERROR_LIMITS, type ClientErrorReport } from '@gp/core';
import { api } from './auth/api.ts';
import { storedSession } from './auth/session.ts';
import { appCommit } from './version.ts';
import { note } from './report/trail.ts';

// An error nothing caught, sent to the server's log so it can be seen later (docs/cloudflare.md, "Logs"), and not
// only in the device's console. Only while signed in (the server asks for a session); each message once, and at
// most a few in a page's life, so a loop of errors does not flood the log. Its sending fails quietly.

const sent = new Set<string>();

/** The report for an error: its message and stack cut to the limits, and the page's path. */
export function reportOf(error: unknown, where: string, version: string | null): ClientErrorReport {
  const e = error instanceof Error ? error : null;
  const message = e ? `${e.name}: ${e.message}` : String(error);
  return {
    message: message.slice(0, CLIENT_ERROR_LIMITS.message),
    stack: e?.stack?.slice(0, CLIENT_ERROR_LIMITS.stack) ?? null,
    where: where.slice(0, CLIENT_ERROR_LIMITS.where),
    version: version?.slice(0, CLIENT_ERROR_LIMITS.version) ?? null,
  };
}

/** Sends `error` to the server's log, once per message and at most `perLoad` in this page's life. */
export function reportClientError(error: unknown) {
  const report = reportOf(error, location.pathname, appCommit());
  note('error', report.message); // for a bug report's steps (docs/bug-reports.md), signed in or not
  if (!storedSession()) return;
  if (sent.has(report.message) || sent.size >= CLIENT_ERROR_LIMITS.perLoad) return;
  sent.add(report.message);
  void api('POST', '/api/client-errors', report).catch(() => undefined);
}
