// The Rust core in workerd: a Durable Object with SQLite storage loads the core's WASM and answers its SQL with
// `sql.exec`, which is synchronous there, inside `transactionSync`, so a refused mutation leaves nothing behind.
import { DurableObject } from 'cloudflare:workers';
import core from './gp_core.wasm';
import { migrateOrgSchemaSync } from 'gp-org-schema';

class Refused extends Error {}

export class Org extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.w = new WebAssembly.Instance(core, { env: { now_ms: () => Date.now() } }).exports;
  }

  /** One call of the core to its end: [status, what it said]. */
  call(input) {
    const w = this.w;
    const pass = (s) => {
      const b = new TextEncoder().encode(s);
      const p = w.gp_alloc(b.length);
      new Uint8Array(w.memory.buffer, p, b.length).set(b);
      return [p, b.length];
    };
    const out = () => new TextDecoder().decode(new Uint8Array(w.memory.buffer, w.gp_out_ptr(), w.gp_out_len()));
    let st = w.gp_start(...pass(JSON.stringify(input)));
    while (st === 2) {
      const req = JSON.parse(out());
      st = w.gp_resume(...pass(JSON.stringify(this.ctx.storage.sql.exec(req.sql, ...req.params).raw().toArray())));
    }
    return [st, out()];
  }

  mutate(input) {
    try {
      return this.ctx.storage.transactionSync(() => {
        const [st, said] = this.call(input);
        if (st !== 0) throw new Refused(said);
        return 'ok';
      });
    } catch (e) {
      if (e instanceof Refused) return e.message;
      throw e;
    }
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === 'POST' ? await request.json() : null;
    const sql = this.ctx.storage.sql;
    if (path === '/setup') {
      this.ctx.storage.transactionSync(() => {
        migrateOrgSchemaSync((q) => sql.exec(q).toArray(), (fn) => fn());
        for (const q of body) sql.exec(q);
      });
      return Response.json('ok');
    }
    if (path === '/run') {
      const t = Date.now();
      const outcomes = body.map((input) => this.mutate(input));
      return Response.json({ outcomes, ms: Date.now() - t });
    }
    if (path === '/view') return Response.json(this.call(body));
    return Response.json([sql.exec('SELECT * FROM presentations ORDER BY id').toArray(), sql.exec('SELECT * FROM presentation_items ORDER BY id').toArray()]);
  }
}

export default {
  fetch(request, env) {
    const org = new URL(request.url).searchParams.get('org');
    return env.ORG.get(env.ORG.idFromName(org)).fetch(request);
  },
};
