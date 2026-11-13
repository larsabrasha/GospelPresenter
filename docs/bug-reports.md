# Bug reports ("Rapportera fel")

Decided on 2026-11-05 (Lars): anyone signed in reports a problem, a Superadmin (in superadminläge) sees every report in one place, and
a report carries what is needed to see the error and do the same again. Modelled on hovstaspelet's testpilot reports.
No video for now (Lars chose "Ingen film nu").

**Sending.** The picture's menu in the bar has Rapportera fel, for everyone; the desktop app also has it under Hjälp
(`report` command, `apps/desktop/src/menu.ts`). The dialog (`apps/web/src/report/BugReportDialog.tsx`) takes what
the user writes, and a screenshot: the desktop app takes the window as it showed when the report was chosen
(`capture-page` in `apps/desktop/src/main.ts`, a JPEG at most 1600 points wide); elsewhere, and to replace it, the user
attaches a picture, made a JPEG small enough on the device. The picture can be left out. "Visa allt som skickas"
shows everything else that is sent, as JSON, before it is sent: who (name, e-mail, organisation) and the state.

**The state** (`apps/web/src/report/reportState.ts`), taken when the dialog opens, not when it is sent: the page's path,
the app (desktop host or client, phone app, browser), the version, the server, the user's and organisation's ids and
role, the device (user agent, window size, touch, languages, theme), the sync (storage, connection, changes waiting,
refusals), what is live (ids only), and the last steps.

**The steps** (`apps/web/src/report/trail.ts`) are a ring of the last 60 in the page's memory, one push each: a page
opened (path only), a press on a button, link, menu row, tab or option (its name as shown or as a screen reader says
it), an app command (a key or the menu bar), a change saved (the mutator's name, never its arguments), what went live,
and an error nothing caught. The same step again in a row counts up (`times`) rather than taking another place, so a
field saved as it is typed in is one step. Mouse moves and keystrokes are not steps. Nothing is kept on disk or sent
until a report is.

**What is never sent**: what is typed in a field (only presses count, and `data-private` hides a part of a page from
them), a search, the session or device token, an invite's token (the fragment is never read), a setup or pairing
code, a song's words or any other content of the organisation (only ids). The screenshot shows what the screen
showed; the user sees it first and may leave it out.

**Storing** (`apps/server/src/global/bug-reports.ts`): the global table `bug_reports` (schema version 9), with who and
where copied in (so a report outlives a deleted user or organisation), the screenshot as its data URL (at most
`BUG_REPORT_LIMITS.shot`), and the state as JSON. The newest 500 are kept, with their threads. `POST /api/reports`
takes one from anyone signed in; `GET /api/reports`, `GET`, `PATCH {done}` and
`DELETE /api/reports/{id}` are a Superadmin's in superadminläge (ManageOrganizations).

**Felrapporter** (`/admin/reports`, `apps/web/src/pages/BugReports.tsx` and `BugReportDetail.tsx`), in Inställningar
for the Superadmin: newest first, a dot on those not done; one opened shows the text, who and where, the screenshot,
the steps before it with their seconds, and the whole state, with Markera som klar and Radera.

**The thread** (Lars, 2026-11-05: answer the one who reported, as a chat). Each report has a thread between the
Superadmin and the one who reported (`bug_report_messages`, at most 200 a report), shown as a chat on both sides
(`apps/web/src/report/ReportThread.tsx`): on the report's page in Felrapporter, and under Mina inställningar → Mina
felrapporter (`/my-reports`, `apps/web/src/pages/MyBugReports.tsx`), where a user sees only their own reports. An answer
from the Superadmin (`POST /api/reports/{id}/messages`) is also mailed to the one who reported, when the server sends
mail and they have an address, in the language their app had, with a link to the thread (`bugReplyMail`). Each side's
last reading is kept (`admin_read_at`, `reporter_read_at`): opening the report reads it. Answers the user has not
read put a blue dot on the picture in the bar and a row in its menu, asked for (`GET /api/my-reports/unread`) when the
app starts and when it comes back into view, never on a timer (`apps/web/src/report/unread.ts`). An answer from the
one who reported (`POST /api/my-reports/{id}/messages`) shows in Felrapporter as new answers, and opens a report
marked done again.

**Only signed in.** Every route asks for a session; nothing takes a report without one. A church's own desktop host
keeps its reports, for its own Superadmin, and sends nothing on (Lars, 2026-11-05: first "Vidare till molnet", then
"only those signed in may send", and few churches will run their own host). A key per host, made by the cloud's
Superadmin, would let a host send them on later without an open door.
