import { useEffect, useState } from 'react';
import { useDbStatus } from './db/react.tsx';
import type { Session } from './db/protocol.ts';
import { t } from './i18n.ts';
import type { LiveChannel } from './live/live.ts';
import { Live } from './pages/Live.tsx';
import { Output } from './pages/Output.tsx';
import { PresentationEditor } from './pages/PresentationEditor.tsx';
import { Presentations } from './pages/Presentations.tsx';
import { SongEditor } from './pages/SongEditor.tsx';
import { Songs } from './pages/Songs.tsx';
import { Trash } from './pages/Trash.tsx';
import { href, useRoute } from './ui/router.ts';
import { ToastProvider } from './ui/Toast.tsx';

function StatusBar() {
  const s = useDbStatus();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => setError(e.reason instanceof Error ? e.reason.message : String(e.reason));
    addEventListener('unhandledrejection', on);
    return () => removeEventListener('unhandledrejection', on);
  }, []);
  if (!s) return null;
  const last = s.rejected.at(-1);
  return (
    <footer className="status" data-testid="status">
      <span className={s.connected ? 'ok' : 'warning'}>{s.connected ? t('status.connected') : t('status.offline')}</span>
      {s.pending > 0 && <span>{t('status.pending', { n: s.pending })}</span>}
      {s.storage !== 'opfs' && <span className="warning">{t('status.memory', { reason: s.storage })}</span>}
      {s.updateRequired && <span className="warning">{t('status.updateRequired')}</span>}
      {last && <span className="warning">{t('status.rejected', { error: last.error })}</span>}
      {error && (
        <span className="warning" role="alert">
          {error}
        </span>
      )}
    </footer>
  );
}

export function App({ session, live }: { session: Session; live: LiveChannel }) {
  const route = useRoute();

  return (
    <ToastProvider>
      <div className="app">
        <header className="top">
          <strong>{t('app.name')}</strong>
          <nav>
            <a href={href({ page: 'songs' })} aria-current={route.page.startsWith('song') ? 'page' : undefined}>
              {t('nav.songs')}
            </a>
            <a href={href({ page: 'presentations' })} aria-current={route.page.startsWith('presentation') ? 'page' : undefined}>
              {t('nav.presentations')}
            </a>
          </nav>
          <span className="muted">{session.userId}</span>
        </header>
        <main>
          {route.page === 'songs' && <Songs />}
          {route.page === 'song' && <SongEditor id={route.id} />}
          {route.page === 'presentations' && <Presentations />}
          {route.page === 'presentation' && <PresentationEditor id={route.id} />}
          {route.page === 'live' && <Live id={route.id} live={live} />}
          {route.page === 'trash' && <Trash key={route.kind ?? 'all'} kind={route.kind} role={session.role} />}
        </main>
        <StatusBar />
      </div>
    </ToastProvider>
  );
}

/** The output window has no chrome; its live channel only listens. */
export function OutputApp({ live }: { live: LiveChannel }) {
  return <Output live={live} />;
}
