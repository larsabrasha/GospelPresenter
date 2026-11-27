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

## OAuth

claude.ai's custom connectors, and so Claude on a phone and Claude Desktop, sign in by OAuth 2.1 rather than with a
header (Lars, 2026-11-26), as praliner's MCP server does (github.com/larsabrasha/praliner, `server/oauth.ts`, the model
here). `/api/mcp` answers a request without a valid secret 401 with `WWW-Authenticate: Bearer
resource_metadata="{origin}/.well-known/oauth-protected-resource"`; from there the connector finds the authorization
server's metadata (`/.well-known/oauth-authorization-server`: PKCE S256 only, public clients, codes and refresh tokens),
registers itself (`POST /api/oauth/register`, RFC 7591) or names the document that describes it (Claude's published
identity, a client id that is an https address at claude.ai or claude.com), and sends the person to `/oauth/authorize`.

- **The page** (`apps/web/src/pages/OAuthAllow.tsx`) is the app's own: signed out, the app signs in first (Google or a
  passkey, as ever) and comes back (`OAUTH_RETURN`); signed in, it shows who asks, the organisation (the session's),
  what the assistant may do, and the host the answer goes to, with Tillåt and Avbryt. Avbryt sends `access_denied` back.
- **Tillåt** (`POST /api/oauth/authorize`) hands the assistant a code, for whoever may make a key (the experiment on, a
  member of the session's organisation), from a fresh sign-in or a desktop host's window, no paired device. The answer
  is sent to the client's own address. A session the server has ended signs in again and comes back.
- **The key** is made when the code is traded, not before, so a code never traded leaves nothing behind: named as the
  assistant named itself ("Claude"), through `McpKeyService.createForAssistant`, the rules of Skapa nyckel (at most
  ten) as they stand then. It replaces an earlier sign-in of the same assistant in the organisation (a key with OAuth
  tokens and that name), so connecting Claude again does not fill the ten; a key made by hand is never replaced. The
  sign-in is that key: listed under Mina inställningar, deleted there, ended with the experiment, the membership or a
  reset link, and acting with its maker's role now (D27).
- **A code may only go to** `https://` at claude.ai, claude.com, chatgpt.com or chat.openai.com, or `http://` to this
  machine (Claude Code, MCP Inspector): an address registered elsewhere is refused, so no other site can pose as a
  connector and get a sign-in. Registrations are throttled per address, 500 an hour, as claude.ai registers from a few
  addresses for all its users; a client nothing was allowed for is dropped after a day.
- **The tokens** (`POST /api/oauth/token`): a code is traded once, within ten minutes, with the PKCE verifier its
  challenge was made from; an access token (`gpoa_…`) lasts an hour, a refresh token (`gpor_…`) 90 days and is traded
  once for new ones (rotation). Only their SHA-256 is kept (`oauth_clients`, `oauth_codes`, `oauth_tokens`, global
  schema 13); a token whose key is gone opens nothing, and run-out ones are purged when tokens are issued.
- **The Worker** answers `/.well-known/*` itself (`run_worker_first`), not the app's index.html. On a desktop host the
  pairing guard lets registration and tokens through, as `/api/mcp`: each brings its own credential. The addresses in
  the metadata are the request's origin: a self-hosted server behind a proxy that changes it is not handled yet. Claude's
  client document is fetched within ten seconds.

Claude on a phone, once MCP is on for the person (a Superadmin turns it on under Användare):

1. On claude.ai (in Safari on the phone, or on a computer), signed in: Settings → Connectors → Add custom connector.
2. Name it Gospel Presenter, with the URL `https://app.gospelpresenter.com/api/mcp`, and add it. Asked about the OAuth
   client, take Claude's published identity.
3. Connect: Gospel Presenter's page opens; sign in if asked, and press Tillåt.
4. In the Claude app on the phone, a new chat, + (or the tools), and Gospel Presenter on. Claude asks before a tool that
   changes something.

## The tools

In the core (`packages/core/src/mcp-tools.ts`), each with a zod schema that is also its JSON Schema in `tools/list`.
A read is the views the app reads; a change is a mutator, run in the organisation's queue in its own transaction, so it
writes the change log and pokes the devices as a push does, and is refused as it would be in the app. A refusal (not
found, no permission, a limit) or arguments that do not read come back as the tool's error (`isError`), which the
assistant reads; an unknown tool is JSON-RPC's -32602.

Each tool's annotations say whether it only reads (`readOnlyHint`), removes what cannot be brought back
(`destructiveHint`: `remove_item`, `delete_theme`, `delete_overlay`), or reaches the web (`openWorldHint`:
`add_picture_from_url`), so a client can run the reads without asking. A tool's reads and changes each run in the
organisation's queue, one at a time, not the whole tool, so a picture fetched never holds up sync or a live service; a
change made from what was just read (`update_theme`) reads and writes in one turn (`atomic`), so a device's save in
between is not written over. The changes reach presentations, themes and overlays (Lars, 2026-11-26): a template, or an item of one, is
`not-found`, Admin or not; templates wait for a later round. A change answers with what it changed as the matching
`get_` tool gives it, and the new id where it made one. A presentation shown live changes on the screens as an edit
in the app does (D7).

Themes and overlays are in `packages/core/src/mcp-tools-looks.ts` (what all tools share is in `mcp-tool.ts`). A theme
is made as a copy of another, the default if none is named, and changed in what a call names (`changes`, its song's,
Bible text's and media's background and texts, each field kept that it leaves out), then checked whole as any theme
is; a built-in one is not changed. Themes need an Admin (`ManageThemes`), overlays any member. An overlay's elements are
a slideshow page's (`docs/custom-slides.md`), on the 1920×1080 stage, written whole as the editor saves them; the tools'
descriptions tell the assistant the 54 px the app keeps from the edges.

## Pictures

An assistant on a phone cannot hand a file it was shown to a tool, so a picture comes from an address (Lars,
2026-11-26: "use the Swish logo on the web on an overlay"): `add_picture_from_url` has the server fetch it and make it as
the app makes a picture it imports (`apps/web/src/media/process.ts`), fitted within 1920×1080 and 400×225, a JPEG kept
JPEG and a PNG or a WebP made WebP, which keeps a logo's transparency. The two blobs are the organisation's, kept as a
device's upload keeps them (`keepBlob`), and the answer, `{picture: {full, thumb}, width, height}`, goes into an
overlay's picture element or a theme's background as a picture the editor chose would. It needs `ManageImages`.

- **The address** (`apps/server/src/picture-fetch.ts`): https only; never this machine or a private network, by its name
  (`localhost`, `.local`, a name without a dot) or its address (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16,
  100.64/10, IPv6's own and local ones), and on Node by every address its name looks up to, as a desktop host sits in
  the church's own network; a Worker reaches no private network. A redirect is followed only to an address that passes
  the same checks, three at most. At most 10 MB (`MEDIA_LIMITS.sourceBytes`), read as it comes, and 20 seconds for
  all of it, the body too.
- **Off the live thread.** Decoding a large photo takes the processor for seconds. In a Worker the stateless part that
  checked the key answers `add_picture_from_url` itself (`answerPictureCall`): it fetches, makes and stores the picture
  in R2, and the organisation's object, whose one thread runs its sync and live, only records the blobs
  (`/internal/mcp-blob`, which no request from outside reaches; `recordBlob`). On Node the picture is made in a worker
  thread (`apps/server/src/picture-worker.ts`, `picture-thread.ts`), bundled beside the server (`build-node.mjs`, the
  Docker image) and the desktop app (`build.mjs`, among its resources); run from source (the tests) it is made on the
  server's thread. A batch of calls (the two oldest protocol versions) is still made in the organisation's object.
- **The file** (`apps/server/src/picture-import.ts`): PNG, JPEG, WebP or SVG by its signature, not by its name or what
  the server said; a GIF or a page is refused. Its size is read from its header first: more than 4096 × 4096 pixels is
  refused before it is decoded, so a Worker's 128 MB holds it with its copies.
- **An SVG** (Lars, 2026-11-26) is drawn by resvg as a PNG as large as fits 1920×1080, up or down, and then made as a
  PNG is: it is never kept as SVG, which would be served from the app's own address, where a script in it could run.
  Its transparency is kept. It is drawn without fonts (a Worker has none) and fetches nothing it links to, so letters
  that are text, not shapes, do not show.
- **The codecs** (`apps/server/src/picture-codecs.ts`): Squoosh's, built to WebAssembly by jSquash, and resvg's for SVG
  (`@resvg/resvg-wasm`), the same on Node,
  in the desktop host and in a Worker, loaded on the first picture. A Worker gets each `.wasm` as a compiled module
  (wrangler, and Miniflare in the tests, `CompiledWasm`), Node its bytes (esbuild's `binary` loader in
  `apps/server/build-node.mjs` and `apps/desktop/build.mjs`, a plugin in the server's `vitest.config.ts`).
- Not done: a JPEG's EXIF orientation is not applied (a phone's photo straight from the camera may stand on its side;
  pictures on the web are mostly turned already), and a GIF is not read. A test build may fetch from this machine over
  http (`PICTURE_TEST_LOOPBACK`, `pictureTestLoopback`), as the tests serve their pictures; a release build never.

| Tool | What |
|---|---|
| `search_songs` | The songs that match name, author or lyrics, best first (SONG-R30's ranking); reads the library each call |
| `list_songs` | The songs by name |
| `get_song` | A song, its parts with their labels, its arrangements; not a trashed song or a draft |
| `list_presentations` | The presentations, latest date first |
| `get_presentation` | A presentation and its running order |
| `list_templates` | The templates, their weekday 0 (Sunday) to 6 |
| `create_presentation` | A presentation, empty or from a template, with date, time, place and description |
| `update_presentation` | Its name, date, time, place, description or theme; a field left out is kept, null clears it (the old app's `rename_presentation` and `update_presentation_event`) |
| `add_song_to_presentation` | A song, in an arrangement or not, after an item or at the end |
| `add_header_to_presentation` | A heading, after an item or at the end |
| `reorder_items` | The running order anew: every item once, or refused (`invalid-order`) rather than one left out going last |
| `rename_item` | An item's title; a song keeps its name (PRES-R36) |
| `set_item_note` | An item's note for those who run it; empty removes it |
| `update_item_arrangement` | The arrangement a song item shows; null is the song's default |
| `remove_item` | An item, for good, as in the app; its description asks the assistant to ask first |
| `list_bibles` | The translations |
| `get_bible_verses` | The verses of a reference as the Bible tab reads one ("Joh 3:16-18", "Ps 23") |
| `add_bible_text_to_presentation` | A passage, its slides made as the app makes them |
| `set_item_overlay` | The overlay over an item's slides; null takes it away |
| `list_themes` | The built-in themes and the organisation's own, and which is the default |
| `get_theme` | A theme's whole look |
| `create_theme` | An own theme, a copy of another (the default if none is named) with changes |
| `update_theme` | An own theme's name or look, changed in what is named |
| `set_default_theme` | The organisation's default theme |
| `delete_theme` | An own theme, for good; its description asks the assistant to ask first |
| `list_overlays` | The overlays |
| `get_overlay` | An overlay's name and elements |
| `create_overlay` | An overlay with its texts, pictures and shapes |
| `update_overlay` | An overlay's name, or its elements written whole |
| `delete_overlay` | An overlay, for good; its description asks the assistant to ask first |
| `add_picture_from_url` | A picture from the web, made as the app makes one and kept ("Pictures") |

## Not yet

- Songs and media (a song from pasted text, the media library's files and own slides into a presentation), then
  overviews (when a song was last sung) and the old app's `get_bible_books`, `get_bible_chapters` and `search_bible`
  (TODO.md "MCP and a CLI"). The old app's `reorder_item_parts` and `remove_item_part` are a song's arrangement here.
- Templates: reading and changing their running order.
- OAuth tried with a real claude.ai connector and with Claude on a phone: built and tested against the server's tests and
  the page in a browser on 2026-11-26, not yet with Claude itself.
- Slideshows (Bildspel) through MCP; a library picture (Bilder) by its id on an overlay or a theme.
- A CLI with the same operations (TODO.md "MCP and a CLI").
- The switch in the Mac app's settings.
- Tried against the desktop host in a browser on 2026-11-25, and on production with curl and Claude Code on
  2026-11-26 (the reads). On Cloudflare `GET /api/mcp` without a key is 401, not 405: the Worker checks the key first.
