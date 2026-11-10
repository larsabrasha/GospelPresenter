// Sign-in, sessions, membership and pairing over HTTP (spec 01, ADR 0007
// decisions 6 and 12). The same routes run on Node and in the Worker; pairing
// exists only where the server is a desktop host. Sign-in is with Google or
// a passkey: there are no passwords.
//
// One file per concern. `authRoutes` registers the route groups in a fixed
// order, the order the routes had in one file: Hono matches in registration order.
import { Hono } from 'hono';
import { AUTH_BODY_MAX, capped, REPORT_BODY_MAX } from '../body-cap.ts';
import { accountRoutes } from './account-routes.ts';
import { clientErrorRoutes } from './client-error-routes.ts';
import { debugRoutes } from './debug-routes.ts';
import { invitationRoutes } from './invitation-routes.ts';
import { authKit, type AuthDeps } from './kit.ts';
import { loginRoutes } from './login-routes.ts';
import { orgRoutes } from './org-routes.ts';
import { pairingRoutes } from './pairing-routes.ts';
import { passkeyRoutes } from './passkey-routes.ts';
import { reportRoutes } from './report-routes.ts';
import { signInRoutes } from './sign-in-routes.ts';
import { userRoutes } from './user-routes.ts';

export { authenticate, credentials, WS_PROTOCOL, type Caller } from './caller.ts';
export { deviceOf, isApiPath, isLoopback, pairingGuard, type Pairing } from './pairing-guard.ts';
export type { AuthDeps } from './kit.ts';

export function authRoutes(deps: AuthDeps) {
  const kit = authKit(deps);
  const app = new Hono();
  // Every body capped as it is read (body-cap.ts); only these paths, as this app's middleware reaches the whole API.
  for (const path of ['/api/auth/*', '/api/users', '/api/users/*', '/api/invitations', '/api/invitations/*', '/api/import/users', '/api/client-errors']) app.use(path, capped(AUTH_BODY_MAX));
  for (const path of ['/api/reports', '/api/reports/*']) app.use(path, capped(REPORT_BODY_MAX));
  signInRoutes(app, kit);
  passkeyRoutes(app, kit);
  loginRoutes(app, kit);
  accountRoutes(app, kit);
  userRoutes(app, kit);
  invitationRoutes(app, kit);
  orgRoutes(app, kit);
  pairingRoutes(app, kit);
  clientErrorRoutes(app, kit);
  reportRoutes(app, kit);
  debugRoutes(app, kit);
  return app;
}
