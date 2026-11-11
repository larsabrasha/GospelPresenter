// Trial: live and poke sockets on a hosted Durable Object that hibernates between messages.
import { expect, it } from 'vitest';
import { api, device, pokeProtocols, pokeUrl, setRole, startAdapter, type Harness } from '../../../apps/server/test/harness.ts';
import { ownState, Window } from '../../../apps/server/test/live-window.ts';

const IDLE_S = Number(process.env.TRIAL_IDLE_S ?? 70);
const born = async (h: Harness, org: string) => (await api<{ bornAt: number; now: number }>(h, 'GET', '/api/debug/trial-born?org=' + org)).body;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it(`live and poke sockets survive ${IDLE_S} s idle; the object was constructed again`, async () => {
  const h = await startAdapter('remote');
  const org = 'org-hib-' + crypto.randomUUID();
  await setRole(h, 'anna', org, 'admin');
  await setRole(h, 'bo', org, 'user');
  const owner = await Window.open(h, org, 'anna');
  const phone = await Window.open(h, org, 'bo');
  const pokes: unknown[] = [];
  const poke = new WebSocket(pokeUrl(h) + '?clientId=bo-poke', pokeProtocols(h, org, 'bo'));
  poke.addEventListener('message', (e) => pokes.push(JSON.parse(String(e.data))));
  await new Promise<void>((res, rej) => { poke.addEventListener('open', () => res()); poke.addEventListener('error', () => rej(new Error('poke refused'))); });
  owner.send({ type: 'own', state: ownState('S1') });
  await phone.sessions((s) => s.length === 1);

  // Warm: a command round trip phone -> server -> owner.
  let t = performance.now();
  phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 1, black: false } });
  await owner.next((m) => m.type === 'command');
  const warmMs = performance.now() - t;
  const before = await born(h, org);
  const closed: string[] = [];
  for (const [n, ws] of [['owner', owner.ws], ['phone', phone.ws], ['poke', poke]] as const) ws.addEventListener('close', (e) => closed.push(`${n}:${(e as CloseEvent).code}`));

  await sleep(IDLE_S * 1000);

  t = performance.now();
  phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 2, black: false } });
  const fromPhone = phone.messages.length;
  let cmd;
  try {
    cmd = await owner.next((m) => m.type === 'command' && (m as { change: { partIndex: number } }).change.partIndex === 2);
  } catch (e) {
    const b = await born(h, org);
    console.log('[diag] closed', closed, 'phone got', JSON.stringify(phone.messages.slice(fromPhone)), 'readyState', owner.ws.readyState, phone.ws.readyState, poke.readyState, 'born before', before.bornAt, 'now', b.bornAt, b.now);
    throw e;
  }
  const wakeMs = performance.now() - t;
  expect(cmd).toMatchObject({ sessionId: 'S1' });
  const after = await born(h, org);
  // The session survives in the object's SQLite; the sockets' attachments say who owns it.
  // The owner echoes; every member gets the new pointer from the woken object.
  owner.send({ type: 'own', state: ownState('S1', { pointer: { itemId: 'I1', partIndex: 2, black: false, overlayId: null, rev: 2 } }) });
  const [s] = await phone.sessions((x) => x[0]?.pointer.partIndex === 2);
  expect(s).toMatchObject({ id: 'S1', ownerOnline: true });

  // A push from another device pokes the sleeping-and-woken poke socket.
  const anna = await device(h, org, 'anna', 'admin');
  await anna.client.mutate('createSong', { id: 'HS1', name: 'Efter vilan' });
  t = performance.now();
  await anna.client.sync();
  for (let i = 0; i < 100 && pokes.length === 0; i++) await sleep(50);
  const pokeMs = performance.now() - t;
  console.log(`[measure] hibernation: idle ${IDLE_S} s; constructed before idle at +${before.bornAt - before.now} ms, after: ${after.bornAt > before.bornAt ? 'again, ' + Math.round((after.now - after.bornAt) / 1000) + ' s before the check' : 'not again'}; command warm ${Math.round(warmMs)} ms, after idle ${Math.round(wakeMs)} ms; poke after push ${Math.round(pokeMs)} ms (${pokes.length}); closed: ${closed.join(',') || 'none'}`);
  expect(closed).toEqual([]);
  expect(pokes.length).toBeGreaterThan(0);
  expect(after.bornAt).toBeGreaterThan(before.bornAt);
  owner.close(); phone.close(); poke.close(); await anna.client.close();
}, 600_000);
