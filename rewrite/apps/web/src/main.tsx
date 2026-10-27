import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, OutputApp } from './App.tsx';
import { storedSession, workerSession } from './auth/session.ts';
import { Boot, REPAIR_KEY } from './Boot.tsx';
import { Db } from './db/db.ts';
import { DbProvider, ReaderProvider } from './db/react.tsx';
import { SharedReader, shareChannelName } from './db/share.ts';
import { socketProtocols } from '@gp/sync/client';
import { LiveChannel } from './live/live.ts';
import { LiveLink, windowSessionId } from './live/remote.ts';
import { currentRoute, installLinkHandler } from './ui/router.ts';
import './fonts.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
installLinkHandler();
const route = currentRoute();
const stored = storedSession();

if (route.page === 'output') {
  // The output opens no database: it reads the operator window's, which works
  // whether that one is on OPFS or only in memory. Signed out, it stays black.
  if (stored) {
    const session = workerSession(stored);
    const live = new LiveChannel(session.orgId, 'output');
    root.render(
      <StrictMode>
        <ReaderProvider reader={new SharedReader(shareChannelName(session))}>
          <OutputApp live={live} />
        </ReaderProvider>
      </StrictMode>,
    );
  } else root.render(<div className="output" data-testid="output" />);
} else if (stored && route.page !== 'invite' && route.page !== 'signedIn' && !sessionStorage.getItem(REPAIR_KEY)) {
  // Signed in: straight into the local database, with or without a network.
  const session = workerSession(stored);
  const db = new Db();
  await db.open(session);
  // One live channel per window, for the window's lifetime.
  const live = new LiveChannel(session.orgId, 'operator');
  // The organisation's live sessions, and this window's own (spec 04 §2).
  const link = new LiveLink(socketProtocols({ token: session.token, device: session.device }));
  root.render(
    <StrictMode>
      <DbProvider db={db}>
        <App me={stored.me} live={live} link={link} sessionId={windowSessionId()} />
      </DbProvider>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <Boot boot={route.page === 'invite' ? { invite: route.token } : route.page === 'signedIn' ? { signedIn: true } : { error: route.page === 'signIn' ? route.error : null }} />
    </StrictMode>,
  );
}
