// The page: starts the database worker and exposes it as window.gp for the tests.
import type { WorkerCall, WorkerReply } from './protocol.ts';

const worker = new Worker('/db-worker.js', { type: 'module' });
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let next = 1;

worker.onmessage = (e: MessageEvent<WorkerReply>) => {
  const w = waiting.get(e.data.id);
  waiting.delete(e.data.id);
  if (e.data.ok) w?.resolve(e.data.value);
  else w?.reject(new Error(e.data.error));
};

function call(c: WorkerCall): Promise<unknown> {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, call: c });
  });
}

(window as unknown as { gp: unknown }).gp = { call };

// The manual test page (/app.html): one organisation, the user from ?user=.
if (location.pathname.endsWith('/app.html')) void runApp();

async function runApp() {
  const user = new URLSearchParams(location.search).get('user') ?? 'ipad';
  const $ = (id: string) => document.getElementById(id)!;
  $('user').textContent = user;
  await call({ op: 'open', org: 'demo', user, role: 'editor', file: `${user}-demo.db` });
  await call({ op: 'keepAlive' });
  ($('add') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('title') as HTMLInputElement;
    const title = input.value.trim() || `Sång från ${user} ${new Date().toLocaleTimeString('sv')}`;
    input.value = '';
    await call({ op: 'mutate', name: 'createSong', args: { id: crypto.getRandomValues(new Uint32Array(2)).join('-'), title } });
    void call({ op: 'sync' }).catch(() => undefined);
    void render();
  });
  async function render() {
    const s = (await call({ op: 'status' })) as { storage: string; secure: boolean; pending: number; socket: boolean };
    const d = (await call({ op: 'dump' })) as { songs: { id: string; title: string }[] };
    $('status').textContent = `Lagring: ${s.storage} · Säker kontext: ${s.secure ? 'ja' : 'nej'} · Live-anslutning: ${s.socket ? 'ja' : 'nej'} · Väntar på servern: ${s.pending}`;
    $('songs').innerHTML = '';
    for (const song of [...d.songs].sort((a, b) => a.title.localeCompare(b.title, 'sv'))) {
      const li = document.createElement('li');
      li.textContent = song.title;
      $('songs').appendChild(li);
    }
  }
  setInterval(() => void render().catch((e) => ($('status').textContent = String(e))), 1000);
  await render();
}
