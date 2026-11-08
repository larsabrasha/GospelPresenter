// "Rapportera fel" (docs/bug-reports.md): the reports, newest first, for the Superadmin; each one's thread between the
// Superadmin and the one who reported; and a user's own reports, for Mina felrapporter.
import { BUG_REPORT_LIMITS, type BugReport, type BugReporter, type BugReportInput, type BugReportMessage, type BugReportRow, type MyBugReport, type MyBugReportRow } from '@gp/core';
import type { GlobalSql, Row } from './sql.ts';

/** A report as stored: what was sent, and who sent it. */
interface NewBugReport extends BugReportInput {
  id: string;
  createdAt: number;
  reporter: BugReporter;
}

/** The thread's messages from the other side than `side`, newer than `side` last read it. */
const UNREAD = (side: 'admin' | 'reporter') =>
  `(SELECT count(*) FROM bug_report_messages m WHERE m.report_id = bug_reports.id AND m.from_admin = ${side === 'admin' ? 0 : 1}
     AND m.created_at > coalesce(${side}_read_at, 0)) AS unread`;

const ROW_COLUMNS = `id, created_at, text, user_name, org_name, shot IS NOT NULL AS has_shot, done_at, ${UNREAD('admin')}`;
const MINE_COLUMNS = `id, created_at, text, done_at, ${UNREAD('reporter')}`;

function row(r: Row): BugReportRow {
  return {
    id: String(r.id),
    createdAt: Number(r.created_at),
    text: String(r.text),
    userName: String(r.user_name),
    orgName: String(r.org_name),
    hasShot: Boolean(Number(r.has_shot)),
    done: r.done_at !== null,
    unread: Number(r.unread),
  };
}

function mine(r: Row): MyBugReportRow {
  return { id: String(r.id), createdAt: Number(r.created_at), text: String(r.text), done: r.done_at !== null, unread: Number(r.unread) };
}

function message(r: Row): BugReportMessage {
  return { id: String(r.id), createdAt: Number(r.created_at), fromAdmin: Boolean(Number(r.from_admin)), userName: String(r.user_name), text: String(r.text) };
}

/** Who reported, for the mail a reply sends them. */
export interface Reporter {
  userName: string;
  userEmail: string | null;
  /** The app's language when they reported ('sv-SE', 'en-GB'). */
  language: string;
}

export class BugReportService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
  ) {}

  /** Stores a report. Past `BUG_REPORT_LIMITS.kept`, the oldest go with their threads, so reports cannot fill the disk. */
  async add(r: NewBugReport): Promise<void> {
    const p = r.reporter;
    const kept = `SELECT id FROM bug_reports ORDER BY created_at DESC LIMIT ${BUG_REPORT_LIMITS.kept}`;
    await this.sql.batch([
      [
        `INSERT INTO bug_reports (id, created_at, text, shot, state, user_id, user_name, user_email, role, org_id, org_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.createdAt, r.text, r.shot, JSON.stringify(r.state), p.userId, p.userName, p.userEmail, p.role, p.orgId, p.orgName],
      ],
      [`DELETE FROM bug_report_messages WHERE report_id NOT IN (${kept})`, []],
      [`DELETE FROM bug_reports WHERE id NOT IN (${kept})`, []],
    ]);
  }

  async list(): Promise<BugReportRow[]> {
    return (await this.sql.all(`SELECT ${ROW_COLUMNS} FROM bug_reports ORDER BY created_at DESC`)).map(row);
  }

  private async messages(id: string): Promise<BugReportMessage[]> {
    return (await this.sql.all('SELECT * FROM bug_report_messages WHERE report_id = ? ORDER BY created_at, rowid', [id])).map(message);
  }

  /** One report whole, for the Superadmin, who has then read its thread. */
  async get(id: string): Promise<BugReport | null> {
    const [r] = await this.sql.all(`SELECT *, ${ROW_COLUMNS} FROM bug_reports WHERE id = ?`, [id]);
    if (!r) return null;
    await this.sql.run('UPDATE bug_reports SET admin_read_at = ? WHERE id = ?', [this.now(), id]);
    return {
      ...row(r),
      userId: String(r.user_id),
      userEmail: r.user_email === null ? null : String(r.user_email),
      role: String(r.role),
      orgId: String(r.org_id),
      shot: r.shot === null ? null : String(r.shot),
      state: JSON.parse(String(r.state)) as Record<string, unknown>,
      messages: await this.messages(id),
    };
  }

  /** The user's own reports, newest first. */
  async listMine(userId: string): Promise<MyBugReportRow[]> {
    return (await this.sql.all(`SELECT ${MINE_COLUMNS} FROM bug_reports WHERE user_id = ? ORDER BY created_at DESC`, [userId])).map(mine);
  }

  /** How many of the Superadmin's messages to the user's reports the user has not read. */
  async unreadMine(userId: string): Promise<number> {
    const rows = await this.sql.all(`SELECT ${UNREAD('reporter')} FROM bug_reports WHERE user_id = ?`, [userId]);
    return rows.reduce((n, r) => n + Number(r.unread), 0);
  }

  /** One of the user's own reports with its thread, which the user has then read; null when it is not theirs. */
  async getMine(id: string, userId: string): Promise<MyBugReport | null> {
    const [r] = await this.sql.all(`SELECT shot, ${MINE_COLUMNS} FROM bug_reports WHERE id = ? AND user_id = ?`, [id, userId]);
    if (!r) return null;
    await this.sql.run('UPDATE bug_reports SET reporter_read_at = ? WHERE id = ?', [this.now(), id]);
    return { ...mine(r), shot: r.shot === null ? null : String(r.shot), messages: await this.messages(id) };
  }

  /**
   * Adds a message to a report's thread: from the Superadmin, or from the one who reported (`reporterId`, who must be
   * them), which opens a report marked done again. The writer has then read the thread. Null when there is no such
   * report (of theirs), 'limit' at `BUG_REPORT_LIMITS.messages`; else who reported, for the mail a reply sends.
   */
  async addMessage(id: string, m: { fromAdmin: boolean; userName: string; text: string; reporterId?: string }): Promise<Reporter | null | 'limit'> {
    const [r] = await this.sql.all(
      'SELECT user_id, user_name, user_email, state, (SELECT count(*) FROM bug_report_messages WHERE report_id = bug_reports.id) AS n FROM bug_reports WHERE id = ?',
      [id],
    );
    if (!r || (!m.fromAdmin && r.user_id !== m.reporterId)) return null;
    if (Number(r.n) >= BUG_REPORT_LIMITS.messages) return 'limit';
    const now = this.now();
    const read = m.fromAdmin ? 'admin_read_at = ?' : 'reporter_read_at = ?, done_at = NULL';
    await this.sql.batch([
      ['INSERT INTO bug_report_messages (id, report_id, created_at, from_admin, user_name, text) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), id, now, m.fromAdmin ? 1 : 0, m.userName, m.text]],
      [`UPDATE bug_reports SET ${read} WHERE id = ?`, [now, id]],
    ]);
    const device = (JSON.parse(String(r.state)) as { device?: { appLanguage?: unknown } }).device;
    return { userName: String(r.user_name), userEmail: r.user_email === null ? null : String(r.user_email), language: String(device?.appLanguage ?? 'sv-SE') };
  }

  /** Marks it done, or not; false when there is no such report. */
  async setDone(id: string, done: boolean): Promise<boolean> {
    return (await this.sql.run('UPDATE bug_reports SET done_at = ? WHERE id = ?', [done ? this.now() : null, id])) > 0;
  }

  /** Deletes it with its thread; false when there is no such report. */
  async remove(id: string): Promise<boolean> {
    const [, n] = await this.sql.batch([
      ['DELETE FROM bug_report_messages WHERE report_id = ?', [id]],
      ['DELETE FROM bug_reports WHERE id = ?', [id]],
    ]);
    return (n ?? 0) > 0;
  }
}
