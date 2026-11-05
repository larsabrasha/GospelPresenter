import { useState } from 'react';
import { BUG_REPORT_LIMITS, type BugReportMessage } from '@gp/core';
import { locale, t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Group } from '../ui/Group.tsx';

// A bug report's thread (docs/bug-reports.md), the same on both sides: the SuperAdmin's page of the report and the
// reporter's Mina felrapporter. One's own messages on the right in blue, the other side's on the left, as a chat.

const when = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });

/**
 * The messages and a field to write the next one. `asAdmin` says which side is this user's own. `send` resolves to
 * what went wrong, or null; the field is emptied once it went.
 */
export function ReportThread({ messages, asAdmin, send, empty }: { messages: BugReportMessage[]; asAdmin: boolean; send: (text: string) => Promise<string | null>; empty: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setSending(true);
    setError(null);
    const failed = await send(text.trim());
    setSending(false);
    if (failed) setError(failed);
    else setText('');
  };
  return (
    <Group title={t('reports.thread')}>
      <ol aria-label={t('reports.thread')} className="flex flex-col gap-2 px-4 py-3 empty:hidden">
        {messages.map((m) => {
          const own = m.fromAdmin === asAdmin;
          return (
            <li key={m.id} className={`flex flex-col max-w-[85%] ${own ? 'self-end items-end' : 'self-start items-start'}`}>
              <span className="px-1 text-xs text-stone-400 dark:text-stone-500">{`${m.userName} · ${when(m.createdAt)}`}</span>
              <span className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words select-text ${own ? 'bg-sky-500 text-white' : 'bg-stone-200 dark:bg-white/10'}`}>{m.text}</span>
            </li>
          );
        })}
      </ol>
      {!messages.length && <p className="px-4 py-3 text-sm text-stone-400 dark:text-stone-500">{empty}</p>}
      <form
        className="flex items-end gap-2 border-t-[0.5px] border-separator px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !sending) void submit();
        }}
      >
        <textarea
          aria-label={t('reports.write')}
          placeholder={t('reports.write')}
          maxLength={BUG_REPORT_LIMITS.text}
          rows={2}
          className="flex-1 min-w-0 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // ⌘↩ or Ctrl+↩ sends, as in Mail; a plain ↩ is a new line.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <AppButton type="submit" disabled={!text.trim()} loading={sending}>
          {t('report.send')}
        </AppButton>
      </form>
      {error && (
        <p className="px-4 pb-2 text-sm text-red-500 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </Group>
  );
}
