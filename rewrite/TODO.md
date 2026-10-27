# TODO

Smaller things decided or wished for, not yet built. The larger steps are in README.md, "Next steps".

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

## Overlays (when they are built)

Overlays do not exist in the rewrite yet (spec 04 LIVE-R15, R16). When they are built, two changes from the
current app:

- **"Rensa" clears the overlay too.** LIVE-R16 keeps an overlay when the screen is blacked; instead the black
  screen should switch the overlay off. An overlay such as the collection information belongs to what is on now,
  not to the next song sung later in the service.
- **A slide can carry an overlay.** In the presentation editor, an item (or one of its slides) can name an
  overlay that switches on when it goes live and off when it leaves, so nobody has to remember it during the
  service. To settle: per item or per slide, what a manual toggle during live does to it, and how it shows in
  the editor and on the slide tiles.
