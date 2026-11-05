import type { LivePointer, Me } from '@gp/core';
import type { DbStatus } from '../db/protocol.ts';
import { locale } from '../i18n.ts';
import { serverChangeable, serverOrigin } from '../server.ts';
import { getTheme } from '../ui/theme.ts';
import { appCommit } from '../version.ts';
import { trail } from './trail.ts';

// What a bug report carries besides the text and the picture (docs/bug-reports.md): where the user was, the device,
// the sync, what was live, and the last steps, so the SuperAdmin can do the same again. Shown whole in the dialog
// before it is sent. Ids, not content: no song's words, no session token, no field's value.

/** Which app this is: the desktop app as the host or a client of another, the phone app, or a browser. */
function appKind(): string {
  if (window.gpDesktop) return window.gpDesktop.isHost ? 'desktop-host' : 'desktop-client';
  return serverChangeable ? 'phone-app' : 'browser';
}

/** The state to send, at `now`; each step says how many seconds before the report it was. */
export function reportState(me: Pick<Me, 'userId' | 'role' | 'orgId'>, status: DbStatus | undefined, live: LivePointer, now = Date.now()) {
  return {
    version: appCommit(),
    page: location.pathname,
    app: appKind(),
    server: serverOrigin(),
    user: { id: me.userId, role: me.role },
    org: { id: me.orgId },
    device: {
      userAgent: navigator.userAgent,
      screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}`,
      touch: matchMedia('(pointer: coarse)').matches,
      language: navigator.language,
      appLanguage: locale(),
      theme: getTheme(),
    },
    sync: status
      ? {
          storage: status.storage,
          connected: status.connected,
          pending: status.pending,
          updateRequired: status.updateRequired,
          authError: status.authError,
          rejected: status.rejected.slice(-5).map((r) => r.error),
        }
      : null,
    live: live.presentationId ? { presentationId: live.presentationId, itemId: live.itemId, slide: live.partIndex, black: live.black, overlayId: live.overlayId } : null,
    steps: trail().map((s) => ({ secondsBefore: Math.round((now - s.at) / 1000), kind: s.kind, what: s.what, ...(s.times > 1 ? { times: s.times } : {}) })),
  };
}

export type ReportState = ReturnType<typeof reportState>;
