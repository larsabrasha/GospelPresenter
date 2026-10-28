// Sign-in, sessions, membership and pairing over HTTP (spec 01, ADR 0007
// decisions 6 and 12). The same routes run on Node and in the Worker; pairing
// exists only where the server is a desktop host. Sign-in is with Google or
// a passkey: there are no passwords.
//
// One file per concern. `authRoutes` registers the route groups in a fixed
// order, the order the routes had in one file: Hono matches in registration order.
import { Hono } from 'hono';
import { debugRoutes } from './debug-routes.ts';
import { authKit, type AuthDeps } from './kit.ts';
import { loginRoutes } from './login-routes.ts';
import { pairingRoutes } from './pairing-routes.ts';
import { passkeyRoutes } from './passkey-routes.ts';
import { signInRoutes } from './sign-in-routes.ts';
import { userRoutes } from './user-routes.ts';

export { authenticate, credentials, WS_PROTOCOL, type Caller } from './caller.ts';
export { deviceOf, isApiPath, isLoopback, pairingGuard, type Pairing } from './pairing-guard.ts';
export type { AuthDeps } from './kit.ts';

export function authRoutes(deps: AuthDeps) {
  const kit = authKit(deps);
  const app = new Hono();
  signInRoutes(app, kit);
  passkeyRoutes(app, kit);
  loginRoutes(app, kit);
  userRoutes(app, kit);
  pairingRoutes(app, kit);
  debugRoutes(app, kit);
  return app;
}
