import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, OutputApp } from './App.tsx';
import { Db } from './db/db.ts';
import { DbProvider } from './db/react.tsx';
import { LiveChannel } from './live/live.ts';
import { currentSession } from './session.ts';
import { parseRoute } from './ui/router.ts';
import './styles.css';

const session = currentSession();
const isOutput = parseRoute(location.hash).page === 'output';
const db = new Db();
// The output only reads: the operator window syncs and tells it when the file changes.
await db.open(session, { sync: !isOutput });
// One live channel per window, for the window's lifetime.
const live = new LiveChannel(session.orgId, isOutput ? 'output' : 'operator');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DbProvider db={db}>{isOutput ? <OutputApp live={live} /> : <App session={session} live={live} />}</DbProvider>
  </StrictMode>,
);
