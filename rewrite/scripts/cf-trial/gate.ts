// Trial only: the repo's Worker behind a token for every debug route.
// Without the secret TRIAL_DEBUG_TOKEN, or with a wrong x-trial-token header, a debug path is a 404.
type Handler = { fetch(req: Request, env: Record<string, unknown>, ctx: unknown): Response | Promise<Response> };

export function gated(worker: Handler): Handler {
  return {
    async fetch(req, env, ctx) {
      let path: string;
      try {
        path = decodeURIComponent(new URL(req.url).pathname).toLowerCase();
      } catch {
        return new Response('bad request', { status: 400 });
      }
      if (path.includes('debug')) {
        const want = typeof env.TRIAL_DEBUG_TOKEN === 'string' ? env.TRIAL_DEBUG_TOKEN : '';
        if (!want || req.headers.get('x-trial-token') !== want) return new Response('not found', { status: 404 });
      }
      return worker.fetch(req, env, ctx);
    },
  };
}
