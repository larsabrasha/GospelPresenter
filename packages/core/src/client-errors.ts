import { z } from 'zod';

// An error the app caught nothing for, sent by the client to the server's log (Lars, 2026-11-04: so it can be seen
// later, not only in a phone's console). Cut to these lengths by the client; longer is refused.

export const CLIENT_ERROR_LIMITS = { message: 500, stack: 4000, where: 300, version: 64, perLoad: 5 } as const;

export const clientErrorReportSchema = z.object({
  /** What went wrong, as the error says it. */
  message: z.string().max(CLIENT_ERROR_LIMITS.message),
  /** Where in the code, when the error has a stack. */
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).nullable(),
  /** The page's path, without its query or fragment (an invite's token is in the fragment). */
  where: z.string().max(CLIENT_ERROR_LIMITS.where),
  /** The commit the app was built from, when the build knows it. */
  version: z.string().max(CLIENT_ERROR_LIMITS.version).nullable(),
});

export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;
