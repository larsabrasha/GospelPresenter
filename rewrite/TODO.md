# TODO

Smaller things decided or wished for, not yet built. The larger steps are in docs/next-steps.md.

## Remote control for the whole organisation

"Tillåt fjärrstyrning" is set per window today (LIVE-R39). An admin should be able to choose, for the whole
organisation, under the organisation's settings:

| Setting (suggested) | Description (suggested) | Effect |
|---|---|---|
| **Aldrig** | Ingen kan fjärrstyra en presentation. | No toggle on the live page; the server refuses every command. |
| **Presentatören väljer** (default) | Den som presenterar slår på fjärrstyrning när det behövs. | Today's behaviour: the toggle, off until switched on. |
| **Alltid** | Alla i församlingen kan ta kontroll över en pågående presentation. | No toggle; every session allows it. |

To settle when it is built:

- Names. The words above are suggestions in place of "Av", "Valbar" and "Alltid på"; the heading could be
  "Fjärrstyrning av presentationer".
- Where the setting is kept: a row in `org_settings` (synced, as `defaultThemeId` is), set by a mutator that
  needs an admin permission.
- The server must apply it, not only the UI: the live hub reads the setting and refuses commands under
  "Aldrig", and treats every session as allowing them under "Alltid", whatever a window reports.
- What happens to a running session when the setting changes: it should take effect at once.
