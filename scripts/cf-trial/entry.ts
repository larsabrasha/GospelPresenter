// Trial only: the repo's Worker behind the debug gate (gate.ts), with one measurement added: when an
// organisation's Durable Object instance was constructed, to see hibernation (tests/hibernate.test.ts).
import worker, { OrgDurableObject as RepoOrgDurableObject } from '../../apps/server/src/worker.ts';
import { gated } from './gate.ts';

export class OrgDurableObject extends RepoOrgDurableObject {
  private bornAt = Date.now();
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/__trial/born') return Response.json({ bornAt: this.bornAt, now: Date.now() });
    return super.fetch(request);
  }
}

type Env = { ORG: DurableObjectNamespace; TRIAL_DEBUG_TOKEN?: string };
const inner = {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    // GET /api/debug/trial-born?org=<id>: when that organisation's object was last constructed (gated).
    if (url.pathname === '/api/debug/trial-born') {
      const org = url.searchParams.get('org') ?? '';
      return env.ORG.get(env.ORG.idFromName(org)).fetch('https://do/__trial/born');
    }
    return (worker as unknown as { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> }).fetch(req, env, ctx);
  },
};
export default gated(inner as never);
