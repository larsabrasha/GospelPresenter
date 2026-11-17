import { Component, type ReactNode } from 'react';
import { t } from './i18n.ts';
import { AUTH_TEXT, AuthCard } from './pages/AuthCard.tsx';
import { reportClientError } from './clientErrors.ts';
import { signOut } from './Shell.tsx';
import { AppButton } from './ui/AppButton.tsx';

// The way out when the app cannot go on: a start that fails or waits on the database, or an error while drawing a
// page. Without it the page stays blank, with nothing to press (Lars, 2026-11-04).

/** Why the app stopped: it waits on the database (`slow`, and goes on by itself once it opens), it failed to start with `error`, or it crashed while drawing. */
type Why = { kind: 'slow' } | { kind: 'failed' | 'crashed'; error: string };

export function Stopped({ why }: { why: Why }) {
  const crashed = why.kind === 'crashed';
  const [title, text] =
    why.kind === 'crashed' ? [t('start.crashed'), t('start.crashedText')] : why.kind === 'failed' ? [t('start.failed'), t('start.failedText')] : [t('start.slow'), t('start.slowText')];
  return (
    <AuthCard title={title} centered>
      <p className={AUTH_TEXT}>{text}</p>
      {why.kind !== 'slow' && <p className="text-xs text-stone-400 text-center break-words select-text">{why.error}</p>}
      <div className="flex justify-center gap-3">
        {crashed ? <AppButton onClick={() => location.assign('/')}>{t('start.home')}</AppButton> : <AppButton onClick={() => location.reload()}>{t('auth.retry')}</AppButton>}
        <AppButton onClick={() => void signOut()}>{t('auth.signOut')}</AppButton>
      </div>
    </AuthCard>
  );
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Shows `Stopped` in place of the app when drawing it throws, as nothing else catches that. */
export class CrashGuard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: errorMessage(e) };
  }

  componentDidCatch(e: unknown) {
    reportClientError(e);
  }

  render() {
    return this.state.error === null ? this.props.children : <Stopped why={{ kind: 'crashed', error: this.state.error }} />;
  }
}
