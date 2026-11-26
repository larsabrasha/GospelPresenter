# MCP

An AI assistant (Claude, or any MCP client) reads and changes one organisation through
[MCP](https://modelcontextprotocol.io). An experiment (Lars, 2026-11-25): off for everyone until a Superadmin turns it
on for a person.

## Who

- **The switch.** A Superadmin in superadminläge turns "MCP (experiment)" on or off on a user's page under Användare
  (`PUT /api/users/{id}/mcp`, logged as `mcp-changed`). It is the account's, `users.mcp` in the global database.
  Off deletes the person's keys: none comes back when it is turned on again.
- **The keys.** Someone it is on for has an "MCP (experiment)" group under Mina inställningar: their keys in every
  organisation (name, organisation, when made and last used), Skapa nyckel and Radera. A key is made in the session's
  organisation, only by a member there (not by a Superadmin visiting without a membership), and acts only there. At
  most 10 a person (AUTH-R14). The secret, `gpmcp_` and 43 characters, is shown once with the command for Claude Code
  and the JSON for other clients (AUTH-R13); only its SHA-256 is stored (`mcp_keys`, global schema 11). A key outlives
  the session that made it, so, as making an Admin, it needs a sign-in of the last ten minutes or a desktop host's own
  window (`reauth-required` otherwise), and a paired device makes none.
- **What a key may do.** It acts as its maker with the role they have now in its organisation (D27, changed from the
  old app's "always User", PERM-R8): a demotion counts from the next request. It is refused (401) when its maker is
  no longer a member there and when it is deleted. Removing a user or an organisation deletes its keys, and so does a
  reset link when it is used, as it ends the person's sessions. Keys never expire.

## The endpoint

`POST /api/mcp` with `Authorization: Bearer gpmcp_…`, MCP's Streamable HTTP transport answered statelessly: a
JSON-RPC message, or a batch of them as the two oldest versions allow, answered as plain JSON; no session id and no
server-sent events, so `GET` and `DELETE` are 405. It speaks the protocol versions 2024-11-05 to 2025-11-25 and answers
the one asked for. A notification is 202. An error nothing expected is logged as `server-error` and answered as
JSON-RPC's -32603. `/api/mcp` rather than the old app's `/mcp`, so it is an API path everywhere (the Worker's routing,
CORS, body caps); on a desktop host the pairing guard lets it through from any device, as the key is its credential.

On Node the server finds the key in the global database and opens the organisation; on Workers the Worker checks the
key in D1 and hands the request to the organisation's Durable Object as it does a session's (`apps/server/src/mcp.ts`).

Claude Code:

```sh
claude mcp add --transport http gospel-presenter https://<server>/api/mcp --header "Authorization: Bearer gpmcp_…"
```

## The tools

In the core (`packages/core/src/mcp-tools.ts`), each with a zod schema that is also its JSON Schema in `tools/list`.
A read is the views the app reads; a change is a mutator, run in the organisation's queue in its own transaction, so it
writes the change log and pokes the devices as a push does, and is refused as it would be in the app. A refusal (not
found, no permission, a limit) or arguments that do not read come back as the tool's error (`isError`), which the
assistant reads; an unknown tool is JSON-RPC's -32602.

| Tool | What |
|---|---|
| `search_songs` | The songs that match name, author or lyrics, best first (SONG-R30's ranking); reads the library each call |
| `list_songs` | The songs by name |
| `get_song` | A song, its parts with their labels, its arrangements; not a trashed song or a draft |
| `list_presentations` | The presentations, latest date first |
| `get_presentation` | A presentation and its running order |
| `list_templates` | The templates |
| `create_presentation` | A presentation, empty or from a template, with date, time, place and description |
| `add_song_to_presentation` | A song, in an arrangement or not, after an item or at the end |
| `list_bibles` | The translations |
| `get_bible_verses` | The verses of a reference as the Bible tab reads one ("Joh 3:16-18", "Ps 23") |
| `add_bible_text_to_presentation` | A passage, its slides made as the app makes them |

## Not yet

- The old app's other tools: renaming a presentation or an item, moving and removing items, an item's arrangement,
  a song's parts, the time and place of a presentation (`update_presentation_event`), the books and chapters of a
  translation and a search in its text.
- OAuth, which claude.ai's and Claude Desktop's own connectors ask for; until then a client sends the key as a header
  (Claude Code), or goes through a bridge such as `mcp-remote`.
- A CLI with the same operations (TODO.md "MCP and a CLI").
- The switch in the Mac app's settings.
- Tried against the desktop host in a browser on 2026-11-25; not tried on Cloudflare (the Worker's route is tested in
  workerd) nor from a real MCP client.
