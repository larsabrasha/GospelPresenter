import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, OutputApp } from './App.tsx';
import { Db } from './db/db.ts';
import { DbProvider, ReaderProvider } from './db/react.tsx';
import { SharedReader, shareChannelName } from './db/share.ts';
import { LiveChannel } from './live/live.ts';
import { currentSession } from './session.ts';
import { parseRoute } from './ui/router.ts';
import './styles.css';

const session = currentSession();
const root = createRoot(document.getElementById('root')!);

if (parseRoute(location.hash).page === 'output') {
  // The output opens no database: it reads the operator window's, which works
  // whether that one is on OPFS or only in memory.
  const live = new LiveChannel(session.orgId, 'output');
  root.render(
    <StrictMode>
      <ReaderProvider reader={new SharedReader(shareChannelName(session))}>
        <OutputApp live={live} />
      </ReaderProvider>
    </StrictMode>,
  );
} else {
  const db = new Db();
  await db.open(session);
  // One live channel per window, for the window's lifetime.
  const live = new LiveChannel(session.orgId, 'operator');
  root.render(
    <StrictMode>
      <DbProvider db={db}>
        <App session={session} live={live} />
      </DbProvider>
    </StrictMode>,
  );
}
