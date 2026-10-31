# A privately distributed plugin that fetches web video into the library

- **Date:** 2026-10-31
- **Question:** How should the rewrite let a non-technical volunteer fetch a video from YouTube (or another
  site) into the video library, through a plugin that is not bundled with the app? The plugin system should
  also be able to take other importers later.
- **Inputs:** `rewrite/README.md`, `rewrite/AGENTS.md`, `rewrite/docs/media-and-files.md`,
  `rewrite/docs/sign-in-and-pairing.md`, `rewrite/docs/lan-https-and-addresses.md`, the "Video" section of
  `rewrite/TODO.md`, and the video work in progress in the checkout (`apps/server/src/video-routes.ts`,
  `apps/web/src/media/video.ts`, `apps/web/src/pages/VideoTab.tsx`, `packages/core/src/video.ts`), read for
  orientation only. That work is unfinished and may change.
- **Settled, not reopened here:** the plugin is distributed privately and is not published or bundled.
  Using yt-dlp against YouTube breaks YouTube's terms, and that is the user's responsibility. This note only
  covers the risks that change the design.

## Summary and recommendation

**Run plugins on the desktop host only, in a separate Node process that the Electron main process starts.
Expose them to every device through the host's server at `/api/plugins/…`. The app draws all plugin UI
itself from JSON, and plugins put files into the libraries through the app's existing import paths.**

- **Where it runs.** Only the desktop host can spawn yt-dlp and ffmpeg. Every other device that talks to
  that host uses it there: a browser on the LAN, a phone, or a paired desktop. The button shows wherever the
  host says the plugin is installed and the user may add videos. On an organisation served by Cloudflare
  there is no host, so there is no button in the first version.
- **Plugin system.** A `.gpplugin` file is a zip holding a manifest, one bundled ESM backend file and an
  icon. It is signed with an Ed25519 key, and the app ships the matching public key. An Admin installs it
  from a new settings page, **Tillägg**, in the host's own window. The manifest declares typed
  *contributions*. The first kind is an **importer**: a target library, where its button goes, and which
  inputs it takes (a link, a search, a file). The app draws the search, results and progress from the JSON
  the backend returns. No plugin JavaScript ever runs in a page, so the CSP stays as it is and LAN clients
  are not exposed to plugin code. This model is the one VS Code and Raycast use: declarative contribution
  points, and code in a separate process.
- **yt-dlp and ffmpeg.** The plugin does not carry them. On first use it fetches the official standalone
  yt-dlp from yt-dlp's GitHub releases, and an ffmpeg build (yt-dlp's FFmpeg-Builds for Windows and Linux,
  martin-riedl.de for macOS). **The signed manifest names the exact version, URL and SHA-256 of every file
  it fetches** (Lars, 2026-10-31), so no code can slip in through a download: a file whose hash differs is
  refused. Nothing updates itself, not yt-dlp, not ffmpeg. A newer yt-dlp comes only with a new signed
  plugin version that pins it (see "Keeping yt-dlp working"). YouTube now needs a JavaScript runtime. **The app's own Electron binary
  works as that runtime** (`ELECTRON_RUN_AS_NODE=1`, tested below), so the plugin needs no Deno. ffmpeg only
  remuxes (no re-encoding) and moves the index to the front of the file.
- **Search.** Use yt-dlp's `ytsearchN:` with `--flat-playlist`. It needs no key, takes about 1.3 to 1.7
  seconds for 5 to 20 results, and gives the title, channel, length, views, a description snippet and
  thumbnails. A full extraction (about 2.5 s) runs only for the result the user opens. It adds the upload
  date, the full description, the age limit and the formats, so quality and size are known before
  downloading. Skip the YouTube Data API. It needs a key, allows 100 searches a day by default, and using it
  to feed a downloader would put Lars's Google project at risk.
- **Format.** Use `-f "bv*[vcodec~='^(avc1|hvc1|hev1)'][height<=1080]+ba[acodec^=mp4a]/b[vcodec~='^(avc1|hvc1|hev1)'][acodec^=mp4a][height<=1080]" --merge-output-format mp4`.
  It gives H.264 with AAC up to 1080p. YouTube offers H.264 up to 1080p only, and no HEVC. Above 1080p
  there is only VP9 or AV1, which the importer refuses, so 1080p is the ceiling. Formats that need no
  ffmpeg (progressive) stop at 360p, which is too low for a projector.
- **Into the library.** On the host, the job streams the downloaded file into media storage through the
  same multipart upload code that the upload endpoints use. A small piece of core work is needed: a server
  function the endpoints and the plugin share. The page that asked then finishes the import as it would for
  a picked file. It makes the still from the stream and runs `addVideo`, with an id the host picked when the
  job started, so finishing twice is harmless. A job whose page was closed waits on the host until any page
  opens the video tab and finishes it.

Key open decisions for Lars are listed at the end, in [Open decisions](#open-decisions).

**Method note.** These behaviours were checked on this Mac, with `yt-dlp 2026.10.21` (Homebrew) and
`ffmpeg 9.0.1`: search output and timing, full extraction, format lists, format selection, progress output,
error text, the merged file's codecs and box order, and Electron as yt-dlp's JS runtime. Test downloads
were one 13-second, 3.6 MB clip, deleted afterwards. Release sizes come from the GitHub API, queried
2026-10-31. Facts about other products come from their docs or from web search, as linked. Anything not
confirmed is marked *unverified*.

## 1. Where the download runs

| Device | Can run yt-dlp? | What it does |
|---|---|---|
| Desktop host (Electron, embedded Node server) | Yes. Node can spawn binaries, and the server and media storage are on the same disk | Runs the plugin |
| Desktop paired to a host (`GP_SERVER=…`) | Technically yes | Uses the host's plugin, as a browser does |
| Browser on the LAN, phone, tablet | No | Uses the host's plugin through `/api/plugins/…` |
| Cloudflare Worker | No (no processes, no arbitrary code) | No plugins; `/api/plugins` answers `[]` |
| Desktop signed in to the cloud (no host) | Technically yes | Not in v1. Later it could run its own plugin host and upload through the normal multipart path (phase 4) |

**Recommendation: host only, with requests from every device sent to the host.** Reasons:

- **One install per church.** The plugin, its 100+ MB of binaries, its updates and its secrets live on one
  machine, the one that already holds the organisation's data and media. A volunteer on a phone gets the
  feature without installing anything.
- **The file is already where it must end up.** On a host, media storage is `{dataDir}/media` on the same
  disk. A video downloaded there goes into storage without crossing the network a second time. That matters
  at up to 2 GB.
- **A paired desktop should not run its own copy.** It would then upload the whole file to the host over
  Wi-Fi, which is slower and needs a second install.

**On devices where it cannot run, show the button when the host offers the plugin, and hide it
otherwise.** At start, and when the add dialog opens, the client asks `GET /api/plugins`. The answer lists
the importers this caller may use: the plugin is installed and on, and the caller has the target
library's Manage permission (`ManageVideos` for videos). When the host is unreachable (offline, host
asleep), the button stays but is disabled, with the tooltip "Behöver värddatorn". There is no point
queueing a download offline.

**Where the plugin runtime sits in the code.** In `apps/desktop`, behind a `PluginHost` interface that
`startNodeServer({ plugins })` takes. This is the same adapter pattern as `MediaStorage`. The server mounts
`/api/plugins/*` behind the pairing guard and delegates to the interface. A server without it (the Worker,
`serve` without plugins) answers `[]`. That keeps `apps/server` free of Electron.

## 2. Plugin architecture

### What comparable apps do

| App | Package and install | Where code runs | UI | Trust |
|---|---|---|---|---|
| [VS Code](https://code.visualstudio.com/api/references/contribution-points) | `.vsix` (zip + `package.json`), Marketplace or file | A separate [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host) Node process | Declarative `contributes` (commands, menus, views), plus webviews when needed | Full trust; Marketplace signing; Workspace Trust |
| [Raycast](https://developers.raycast.com/) | Store, or a local import for development | Node worker | React components that Raycast draws natively, so every extension looks the same | Reviewed store; full Node |
| [Obsidian](https://help.obsidian.md/Extending+Obsidian/Plugin+security) | Community list, or a folder | In the app's renderer, with Node | Plugin JS changes the app's DOM | Full trust; "Restricted mode" until the user turns it off |
| [Jellyfin](https://jellyfin.org/docs/general/server/plugins/) | Repository manifests (JSON with checksums) added by the admin | In-process .NET DLLs | Config pages served by the plugin | Full trust; admin only |
| [Stash](https://docs.stashapp.cc/in-app-manual/plugins/) | YAML manifest; sources are index URLs in settings | External scripts (JS, Python) run as tasks | Tasks and settings declared in YAML; optional JS and CSS injection | Full trust |
| [OBS](https://obsproject.com/kb/plugins-guide) | Native libraries the user copies in | In-process | Qt | Full trust |
| [mpv ytdl_hook](https://mpv.io/manual/stable/#options-ytdl) | Built-in Lua script | Calls `yt-dlp` from `PATH` | None | The user installs yt-dlp |

*(The linked pages were not all re-read for this note. The table is from prior knowledge, checked
against the docs' structure.)*

**Fit:** VS Code's split (declarative contributions, code in its own process), Raycast's idea (the host
app draws the UI from the plugin's data), and Jellyfin's install (admin only, from settings, with
checksums). Obsidian's model, plugin JS in the page, is the one to avoid. Our pages run on browsers across
the LAN, under a strict CSP, and must look and behave like the rest of the app (Swedish, light and dark,
390 px, keyboard rules).

### The package

`video-download-1.0.0.gpplugin` is a zip:

```
plugin.json        the manifest
backend.mjs        one bundled ESM file (esbuild); no node_modules
icon.svg
files.json         SHA-256 of every other file
files.json.sig     Ed25519 signature over files.json
```

The manifest (the first plugin's, with the later kinds shown in the comments):

```jsonc
{
  "id": "se.gospelpresenter.web-video",
  "name": "Hämta video från webben",
  "version": "1.0.0",
  "api": 1,                       // the plugin API version the app must support
  "minAppVersion": "2.0.0",
  "description": "Hämtar video från YouTube och andra sidor till Videor.",
  "backend": "backend.mjs",
  // Shown in the install warning. Informational: the process is not sandboxed (see Trust).
  "needs": ["network", "programs", "disk"],
  // Every program the plugin fetches, pinned: the exact version, an immutable URL (a versioned release,
  // never `latest` or a redirect) and the SHA-256, per platform. The host refuses a file whose hash differs
  // and never fetches another version than this; a new one means a new signed plugin version.
  "tools": {
    "yt-dlp": {
      "version": "2026.10.21",
      "files": {
        "darwin-universal": { "url": "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_macos", "sha256": "…" },
        "win32-x64":        { "url": "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe",   "sha256": "…" },
        "linux-x64":        { "url": "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_linux", "sha256": "…" }
      }
    },
    "ffmpeg": { "version": "…", "files": { "darwin-arm64": { "url": "…", "sha256": "…" }, "win32-x64": { "url": "…", "sha256": "…" } } }
  },
  "settings": [
    // Later: { "key": "apiKey", "type": "secret", "label": "Pexels API-nyckel", "scope": "host" }
    //        { "key": "ccli", "type": "oauth", "label": "CCLI-konto", "scope": "organisation" }
  ],
  "contributes": {
    "importers": [{
      "id": "web",
      "target": "videos",               // videos | images | audios | slides | songs
      "label": "Hämta från webben",
      "placements": ["add-dialog", "library"],
      "inputs": {
        "link":   { "hint": "Klistra in en länk från YouTube eller en annan sida" },
        "search": { "label": "Sök på YouTube", "layout": "video" }   // layout: video | image | text
        // Later, PowerPoint: "file": { "accept": [".pptx", ".key", ".odp"] }
      }
    }],
    // Links this plugin takes when one is shared into the app (section 8).
    "links": [{ "importer": "web", "hosts": ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "vimeo.com"] }]
  }
}
```

### The backend contract

The app starts the backend lazily, one process per plugin, with Electron's
[`utilityProcess.fork`](https://www.electronjs.org/docs/latest/api/utility-process). It talks to it over
the process's message port with a small JSON-RPC, and stops it after 10 idle minutes. The process is
killed when the plugin is turned off or removed, or when a call runs past its time limit. The backend
exports:

```ts
interface Importer {
  /** One page of results for a search. `next` asks for more. */
  search?(q: { text: string; next?: string }, ctx: Ctx): Promise<{ results: Result[]; next?: string }>;
  /** A pasted or shared link: one result with full details. Errors say why it cannot be fetched. */
  resolve?(link: string, ctx: Ctx): Promise<Result>;
  /** Full details for a search result the user opened. */
  details?(id: string, ctx: Ctx): Promise<Result>;
  /** Fetches or converts. Reports progress, honours ctx.signal, and leaves its output in ctx.jobDir. */
  run(req: { id?: string; link?: string; file?: string; choice?: string }, ctx: JobCtx): Promise<Output>;
}

interface Result {
  id: string; title: string;
  subtitle?: string;                        // channel, photographer, song authors
  thumbnail?: string;                       // a remote URL; the host proxies it (below)
  durationMs?: number;
  description?: string;
  facts?: { label: string; value: string }[];   // "Uppladdad 10 juli 2014", "720p · ca 21 MB", "515 tn visningar"
  badges?: string[];                        // "Live", "Åldersgräns"
  choices?: { id: string; label: string }[];    // "1080p", "720p" when the size forces a choice
  problem?: string;                         // set when it cannot be fetched: shown instead of the button
  attribution?: { text: string; url: string };  // Pexels and Unsplash require it
}

type Output =
  | { kind: 'file'; path: string; fileName: string }    // video, picture, audio, PDF
  | { kind: 'song'; song: SongInput };                  // later: SongSelect

interface Ctx { settings: Record<string, unknown>; secret(key: string): Promise<string | null>;
  dataDir: string; nodeBinary: { path: string; env: Record<string, string> }; log(msg: string): void }
interface JobCtx extends Ctx { jobDir: string; signal: AbortSignal;
  progress(p: { phase: string; fraction?: number; etaSeconds?: number }): void }
```

### How an output reaches a library: through the import paths that exist

The core app, not the plugin, puts the output into a library, using the same path as a picked file. So a
plugin can never write rows or blobs that the importer would have refused.

| Target | Size | What the app does with the output |
|---|---|---|
| `videos` | up to 2 GB | The host streams the file into media storage through the multipart upload code (a function shared with `/api/media/{hash}/upload`). That checks the hash, the `ftyp` signature and the codec. The client then runs the import's last step: the still from the stream, and `addVideo` |
| `images`, `audios` | up to 10 or 20 MiB | The client fetches `/api/plugins/jobs/{id}/file` and passes it to the existing pipeline (`media/process.ts`) as if it had been picked |
| `slides` | up to 50 MB | The same, into the PDF pipeline (`media/slides.ts`, pdf.js) |
| `songs` | small | The client runs the existing song mutations with the structured song |

One piece of this is new for video. Today `importVideo` makes the still from a `File` in the page.
Here the page has only the server's copy, so the still comes from the stream (`/api/play/{token}/{hash}`,
which is same-origin, so the canvas is not tainted). That needs a variant of `videoStill` that takes a URL.

The host picks the video's `id` when the job starts. `addVideo` returns early for a known id, so two pages
finishing the same job do no harm. Finished jobs that have not been added are kept on the host for 7
days, in a table in the plugin's own data. The video tab lists them first, as "Hämtad, läggs in…", and
finishes them. Making the still with ffmpeg on the host instead would make jobs finish on their own. But
it would duplicate the picture pipeline (sizes, WebP or JPEG) inside one plugin, and the next importer
would not reuse it. Server-authored mutations would be the clean fix for "nobody is looking". They do
not exist today, and adding them is a larger change to the sync engine.

### The server's routes

All of them sit behind the pairing guard, like every other API route.

| Route | Who | What |
|---|---|---|
| `GET /api/plugins` | any caller | Importers this caller may use: id, label, icon URL, target, placements, inputs |
| `POST /api/plugins/{id}/{importer}/search` | target's Manage permission | `{ text, next }` → results |
| `POST /api/plugins/{id}/{importer}/resolve` | the same | `{ link }` → result |
| `POST /api/plugins/{id}/{importer}/details` | the same | `{ id }` → result |
| `POST /api/plugins/{id}/{importer}/jobs` | the same | Starts a job and answers its id (and the video id it will get) |
| `GET /api/plugins/jobs/{job}` | the same organisation | State and progress. Polled every second while open; SSE later if polling is too slow |
| `DELETE /api/plugins/jobs/{job}` | the same | Cancel |
| `GET /api/plugins/jobs/{job}/file` | the same | The output file, for the small targets |
| `GET /api/plugins/thumb/{token}` | the same | A thumbnail, fetched by the host |
| `GET/PUT/DELETE /api/plugins/admin/…` | Admin, host window only | Install, settings, turn on or off, update, remove |

**Thumbnails go through the host.** The CSP is `img-src 'self' data: blob:`. Adding `i.ytimg.com`, and
later Pexels, Unsplash and others, would widen it for every page. Instead the host fetches each image.
It only fetches URLs that a result it served in the last hour named (`token` → URL in memory), so the
proxy cannot be used to fetch arbitrary addresses (SSRF). It caches them in memory, about 50 MB at most.

### Trust, signatures and permissions

- **A plugin's backend is full-trust code on the host.** `utilityProcess` isolates crashes, not
  privileges. Node's [permission model](https://nodejs.org/api/permissions.html) (`--permission`,
  `--allow-fs-*`, `--allow-child-process`) could fence the backend's own file access. But a plugin that
  may spawn yt-dlp can do anything through it. Treat the permission flags as a guard against mistakes,
  not as a security boundary.
- **So the defence is who may install, and what.** Recommendation:
  1. **Signed packages only.** The app ships one or two Ed25519 public keys: Lars's, and a spare kept
     offline. It refuses a package whose `files.json.sig` does not verify, or whose files do not match
     `files.json`. A small script in the repo signs packages. This stops the realistic attack, someone
     mailing a church a "plugin", at almost no cost. Since Lars is the only author, there is no key
     infrastructure to run. `GP_PLUGIN_DEV=1` lets a development build load an unsigned folder.
  2. **Install only from the host's own window, by an Admin.** It puts code on that computer, so it is
     done at that computer, like Enheter (`host && …` in `adminLinks`). The install dialog says plainly
     that the plugin runs with the app's rights and fetches programs from the internet.
- **Using:** whoever has the target library's Manage permission. For videos that is everyone
  (`ManageVideos` is in `everyone`), as importing a video file is.
- **Settings and secrets:** a settings field is `scope: "host"` (an API key for the whole installation)
  or `scope: "organisation"` (a CCLI account per church, since a host may serve more than one
  organisation). Secrets are kept on the host, in the global database, encrypted with Electron's
  [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) (Keychain on macOS, DPAPI on
  Windows). They are never sent to a page: the settings form shows "Sparad" and a button to replace it.
  They do not sync and never reach the cloud.

### Per host, not per organisation

Installed plugins belong to the host machine. The code and binaries are on its disk, so they are not
synced rows. Whether a plugin is on can be stored per organisation in the host's global database. The
first version can treat "installed" as "on for every organisation on this host", since a host normally
serves one church. Devices learn about plugins from `GET /api/plugins`, never from sync.

### Storage on the host

```
{userData}/plugins/
  installed.json                      id → version, on/off, installed at, signer
  se.gospelpresenter.web-video/
    1.0.0/                            the unpacked package (read only)
    data/bin/                         yt-dlp, ffmpeg, ffprobe (fetched, checked)
    data/jobs/{job}/                  downloads in progress; removed after ingest
    data/state.sqlite                 jobs
```

### Updates and removal

- **Updating the plugin:** install a newer `.gpplugin` with the same id, a higher version and the same
  signer. Running jobs finish on the old version first. An `updateUrl` in the manifest points to a JSON file
  on Lars's server (version, URL, SHA-256 of the package). The app checks it daily and when a fetch fails, and
  shows "Uppdatering finns" on the Tillägg page; the package is installed only once its signature checks out.
  The URL can be unlisted. With yt-dlp pinned, this is how a fix reaches churches (section 3).
- **Updating yt-dlp or ffmpeg:** never on its own. A new version comes only with a new signed plugin version
  that pins it (section 3); the old binaries are deleted once the new ones are fetched and checked.
- **Removing:** stop the process, cancel jobs, delete the plugin's folder (binaries included), its
  secrets and its state. Videos already fetched stay. They are ordinary library videos.

### How the later importers fit

These do not shape the first version beyond the contract above. They are here to check that the
contract holds.

| Plugin | Contribution | Runs on | Output → path | Settings and secrets | Notes |
|---|---|---|---|---|---|
| **Web video** (first) | importer `videos`, link + search | host | file → multipart ingest + client finish | yt-dlp channel | This note |
| **PowerPoint/Keynote → PDF** | importer `slides`, input `file` (`.pptx`, `.key`, `.odp`) | host | PDF → the existing PDF pipeline in the client | path to LibreOffice if not found | Uses a locally installed LibreOffice (`soffice --headless --convert-to pdf`), or Keynote and PowerPoint through AppleScript on macOS. Nothing in the core app, which keeps the 2026-10-28 decision (no Gotenberg, no renderer in the app). The file goes up to the host as a plugin job input (`POST …/jobs` with the file, up to 50 MB) |
| **Pexels / Unsplash backgrounds** | importer `images` (and `videos` for Pexels video), search, layout `image` | host | file → the existing image pipeline | API key, `scope: host` | Pexels: a free key, 200 requests an hour and 20,000 a month by default, and attribution with a link to Pexels ([docs](https://www.pexels.com/api/documentation/)). Unsplash: 50 requests an hour in demo and 1,000 once approved for production. It requires attribution, and a call to `/photos/:id/download` on each download ([docs](https://unsplash.com/documentation)). Its guidelines want images hotlinked for display. Storing a copy the user chose to download is the "download" case, but check the guidelines before building *(unverified)* |
| **CCLI SongSelect** | importer `songs`, search, layout `text` | host | structured song → the song mutations | OAuth account, `scope: organisation` | SongSelect's API is partner-only. Reportedly CCLI retired the partner programme and takes no new partners ([third-party notes](https://git.stadtmission-butzbach.de/public/pp-planer/src/branch/master/CCLI-API.md), *unverified with CCLI*). It uses OAuth 2.0 with PKCE per user, plus a subscription key. Its terms reportedly forbid automated retrieval without an agreement. Realistic path: ask `partners@ccli.com`. Until then, a file importer for the files a SongSelect user can download by hand (plain text, ChordPro) needs no API |

So the manifest needs one contribution type, `importers` (target, placements, inputs: link, search,
file), plus `settings` with scopes and `links` for sharing in. A plugin that truly needs its own UI could
later get a sandboxed iframe "panel" served by the host from the plugin's folder, as VS Code's webviews
are. None of the five above needs one.

## 3. yt-dlp and ffmpeg on the host without a terminal

### What the plugin fetches, and from where

Every file is checked against the SHA-256 **pinned in the signed manifest**, not against a checksum file
fetched next to it: a checksum fetched from the same place as the file proves nothing if that place is taken
over. The publishers' checksum files below are only where Lars reads the hash from when he pins a version.
The URL is always a versioned release, never `latest` or a redirect.

| Binary | Source | Size (2026-10-31) | Hash read from, when pinning |
|---|---|---|---|
| yt-dlp, macOS | `yt-dlp_macos` (universal, 10.15+) from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) or [nightly builds](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases) | 37.5 MB | `SHA2-256SUMS` in the same release |
| yt-dlp, Windows | `yt-dlp.exe` (x64), `yt-dlp_arm64.exe` | 23.6 / 22.8 MB | the same |
| yt-dlp, Linux | `yt-dlp_linux`, `yt-dlp_linux_aarch64` | 41 MB | the same |
| ffmpeg, Windows and Linux | [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases), a dated `autobuild-…` release (not `latest`); `win64-gpl-shared` is the smallest | 91 MB zipped (shared), 202 MB (static); Linux 157 MB | `checksums.sha256` in the release |
| ffmpeg, macOS | [martin-riedl.de](https://ffmpeg.martin-riedl.de/) arm64 (and amd64 until its builds stop in 2027), a versioned download (not `/redirect/latest/…`) | not listed | a `.sha256` per file; zips are signed by the builder |

As of 2026-10-30, the `latest` and autobuild releases of yt-dlp/FFmpeg-Builds hold only GPL builds (9
assets each). No LGPL build was listed.

**Fetch on first use; do not carry.** The package stays small, one package works on every platform, and
the plugin never *distributes* GPL binaries. Each user's machine downloads them from the projects that
publish them and their source. A first-use screen says "Förbereder… hämtar yt-dlp och ffmpeg (ca 130 MB)".

### The JavaScript runtime YouTube now needs

yt-dlp solves YouTube's player challenges with an external JS runtime and the bundled `yt-dlp-ejs`
scripts. Deno is the default; Node, QuickJS and Bun are supported ([README](https://github.com/yt-dlp/yt-dlp#dependencies);
`--js-runtimes` in `yt-dlp --help`). **Tested here:** pointing yt-dlp at the app's Electron binary works.

```sh
ELECTRON_RUN_AS_NODE=1 yt-dlp --no-js-runtimes --js-runtimes "node:$ELECTRON" …
# [debug] JS runtimes: node-24.22.0
# [youtube] [jsc:node] Solving JS challenges using node
# 136+140 1280x720
```

So the plugin passes `ctx.nodeBinary`, which is `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, and
needs no Deno download. **This depends on the packaged app keeping Electron's `RunAsNode`
[fuse](https://www.electronjs.org/docs/latest/tutorial/fuses) on.** It is on by default, but hardening
guides recommend turning it off. Packaging is not set up yet (`apps/desktop` has no electron-builder or
Forge config), so this is a decision for when it is. If the fuse goes off, the plugin fetches QuickJS
(small) or Deno instead.

### Keeping yt-dlp working

YouTube changes often, and an old yt-dlp fails. **The plugin never updates yt-dlp or ffmpeg itself**
(Lars, 2026-10-31): `yt-dlp -U`, a daily check of `releases/latest` or a nightly channel would each run code on
the host that nobody chose, from whoever controls that release. Instead:

- yt-dlp's version is pinned in the manifest. When YouTube breaks it, Lars reads the new release's hash from
  `SHA2-256SUMS`, puts version, URL and hash in the manifest, and signs a new plugin version. ffmpeg is pinned
  the same way and is only moved when there is a reason (it only remuxes, so that is rare).
- The app learns of the new plugin version through the manifest's `updateUrl` (section 2, "Updates and
  removal"), checked daily and when a fetch fails with an error that is not one of the known user errors
  (section 6). The Tillägg page then says "Uppdatering finns", and the fetch view's error says the plugin
  needs updating. An Admin updates with one click; the app checks the signature before it installs.
- The plugin is updated by Lars's key only, so the trust is in one place: the signer, not GitHub's release
  pages. The cost is speed: a fix in yt-dlp reaches churches only when Lars has published a plugin version.
- Pinned files can disappear upstream (dated FFmpeg autobuilds are pruned after a while, not checked how
  long). Then a new install fails until a new plugin version pins another file, or Lars keeps copies of the
  exact files on his own server. Copies would mean distributing GPL binaries, with the source offered next
  to them (see Licences).

### Licences

- **yt-dlp** source is Unlicense. The PyInstaller executables bundle GPLv3+ code, so the executable as a
  whole is GPLv3+ ([README, licence section](https://github.com/yt-dlp/yt-dlp#readme)).
- **ffmpeg** builds from yt-dlp/FFmpeg-Builds are GPL (with x264 and others).
- **What this means:** the plugin runs both as separate programs and does not link them, so its own code
  is not a derivative. Because the plugin fetches them from their publishers rather than shipping them, it
  carries no duty to provide their source. Gospel Presenter itself is AGPL-3.0, which is compatible in any
  case. If Lars ever wants to bundle the binaries in the package, he then distributes GPL binaries and
  must offer their source. Linking to the exact upstream release is the usual way. *Not legal advice.*

### macOS Gatekeeper and Windows SmartScreen

- **macOS:** Gatekeeper checks a binary only when it has the `com.apple.quarantine` attribute. That is set
  by apps that opt in (`LSFileQuarantineEnabled`) or use Apple's download APIs, such as browsers. Electron's
  `Info.plist` does not opt in (checked: no quarantine key in this checkout's `Electron.app`). Node's own
  HTTPS does not use Apple's download APIs, so the binaries the plugin fetches are not quarantined and run
  without a prompt *(the Node part is inferred from how quarantine works, not tested with a fresh
  download)*. On Apple Silicon, code must carry at least an ad-hoc signature. Homebrew's ffmpeg and
  Electron here are ad-hoc signed, PyInstaller ad-hoc signs its output, and martin-riedl's zips are
  signed. One trap: the `.gpplugin` file itself, downloaded in a browser, *is* quarantined. Unpacking
  with Node writes new files without the attribute. Do not copy extended attributes on unpacking.
- **Windows:** SmartScreen acts on files with the Mark of the Web, an NTFS `Zone.Identifier` stream that
  browsers write. Files written by Node have none, so SmartScreen does not prompt. Defender still scans
  them. yt-dlp's executable is sometimes flagged as a false positive *(reported by users, unverified)*.
  The plugin should then say "Windows Defender blockerade yt-dlp" rather than fail silently.

### Can ffmpeg be avoided?

- **Progressive formats only:** on YouTube that is format 18, 360p H.264 with AAC (checked on two videos).
  It is too low for a projector, so no.
- **Merge in JavaScript instead:** download video (`137`) and audio (`140`) separately with `-f 137,140`,
  then remux in Node with an MP4 muxer such as [Mediabunny](https://mediabunny.dev) (MPL-2.0;
  *capabilities unverified*). That saves the 90 to 200 MB ffmpeg download and its licence. But yt-dlp
  also uses ffmpeg for other sites (fixing HLS downloads, merging), so the plugin would be YouTube-only.
- **Recommendation:** fetch ffmpeg and use it only for the merge, which yt-dlp runs as `-c copy` (no
  re-encoding). **Tested:** the merged file was H.264 (`avc1`) and AAC (`mp4a`), with `moov` before
  `mdat`. yt-dlp moves the index to the front, so `<video>` starts streaming at once.

## 4. YouTube search

| | yt-dlp `ytsearchN:` | YouTube Data API v3 |
|---|---|---|
| Key, account | None | A Google Cloud project and API key |
| Quota | None, but YouTube may rate-limit or bot-check heavy use | 100 `search.list` calls a day by default, in their own bucket, plus 10,000 units for other calls ([quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)) |
| Fields | See below; no upload date in flat mode | Search gives the title, channel, `publishedAt`, a snippet and thumbnails. Length and views need a second call (`videos.list`) |
| Terms | Same terms breach as the download | Using API data to feed a downloader breaks the API terms. That risks the project, which may be the same Google project as the app's sign-in client |
| Speed (measured) | 1.7 s for 5 results, 1.3 s for 20 (`--flat-playlist`); full extraction of one video 2.5 s | Usually fast *(not measured)* |

**Recommendation: yt-dlp.** No key for volunteers to manage, no shared daily cap across churches, and no
link to Lars's Google account.

**What the list shows (flat search, measured):**

| Field from yt-dlp | Example | In the UI |
|---|---|---|
| `title` | "I Din närvaro - Josefina Gniste Live" | Title, two lines |
| `channel`, `channel_is_verified` | "David Media - en resurs för er lovsång!" | Channel, with a tick if verified |
| `duration` (s) | 334 | "5:34" on the thumbnail |
| `view_count` | 205736 | "206 tn visningar" |
| `description` | A snippet ending in "…" | Two lines, desktop only |
| `thumbnails` | 360×202 and 720×404 (`hq720.jpg`) | 16:9 picture; 360 on phones, 720 on retina |
| `live_status` | `null` in flat mode | (known after details) |
| `id`, `url` | `BO5i6KL5N5M` | — |

**Opening a result** runs `yt-dlp -J` with the format filter, and adds:

| Field | Example | In the UI |
|---|---|---|
| `upload_date` | `20140710` | "Uppladdad 10 juli 2014" |
| `description` | Full text (1,516 characters) | Expandable |
| `requested_formats`, `filesize`/`filesize_approx` | `136+140`, 720p, about 21 MB | "720p · ca 21 MB" |
| `age_limit`, `availability`, `live_status` | `0`, `public`, `not_live` | A problem shown before the button, not after a failed download |
| `like_count`, `channel_follower_count` | 2622, 10.8 M | Not shown (noise) |

The details JSON is saved in the job folder and passed to the download with `--load-info-json`. The
download then starts without extracting again (tested; stream URLs last some hours).

"Visa fler" re-runs the search with a larger N (20, then 40). yt-dlp has no paging token for searches,
so `next` is just the next N.

## 5. Format selection and progress

```sh
yt-dlp --load-info-json info.json \
  -f "bv*[vcodec~='^(avc1|hvc1|hev1)'][height<=1080]+ba[acodec^=mp4a]/b[vcodec~='^(avc1|hvc1|hev1)'][acodec^=mp4a][height<=1080]" \
  --merge-output-format mp4 --no-playlist \
  --match-filter "!is_live & live_status!=is_upcoming" \
  --no-js-runtimes --js-runtimes "node:$APP" --ffmpeg-location "$BIN" \
  --newline --progress-delta 0.5 \
  --progress-template "download:%(progress)j" \
  --progress-template "postprocess:PP %(progress.status)s %(progress.postprocessor)s" \
  --print "after_move:GPDONE %(filepath)s" \
  -o "$JOB/video.%(ext)s"
```

- **What it picked (tested):** `137+140` (1080p H.264 + AAC) on a 4K-labelled stock clip whose
  formats above 1080p were VP9 only, and `136+140` (720p) on a video whose best format overall was AV1 in
  WebM. `-S "vcodec:h264,res:1080,acodec:aac"` picks the same. But `-S` only *prefers*. When nothing
  matches it falls back to VP9 or AV1, which the importer would then refuse after a long download. `-f`
  *requires*, and fails at once with "Requested format is not available". So use `-f`.
- **HEVC** is in the filter for other sites. YouTube offers none.
- **Only VP9 or AV1** (rare on YouTube, more common on other sites): v1 refuses before downloading, with a
  clear message. Later, an option to convert with the platform's hardware encoder (`h264_videotoolbox` on
  macOS, `h264_mf` or `h264_qsv` on Windows; *untested*), shown as "Konvertera (tar några minuter)".
- **The 2 GB limit:** details give `filesize` or `filesize_approx` per format. Above about 1.9 GB, the
  result offers `choices` (720p, 480p) instead of the button, and the job passes `[height<=720]`.
- **Free disk space:** check `fs.statfs` on the host for about 2.2 times the size before starting (the
  parts, the merge, and storage).
- **Progress (tested):** with `%(progress)j`, each line is JSON with `status`, `downloaded_bytes`,
  `total_bytes` (or `total_bytes_estimate` for HLS), `speed`, `eta` and `fragment_index`. The video
  stream comes first, then the audio stream, then `PP started Merger` and `PP finished Merger`,
  `MoveFiles`, and the `GPDONE` line. One bar is weighted by the two sizes from details. Then the phases
  "Sätter ihop…", "Lägger in i biblioteket…" (the ingest, with its own byte count) and "Gör stillbild…"
  (in the page). `--print` turns on quiet mode, so `--progress` or the template must be set explicitly, as
  above.
- **Cancel:** kill the process tree and delete the job folder.

## 6. The flow, screen by screen

All texts are Swedish. Every screen is in the app's own components (`AppButton`, `PillTabs`, the dialog
frame), light and dark, and works at 390 px. Esc goes back one step at a time.

1. **Settings → Tillägg** (new entry in the last group of `adminLinks`, host window and Admin only,
   puzzle-piece icon). There is an empty state: "Inga tillägg. Tillägg lägger till funktioner, till exempel
   att hämta video från webben." The button is **Lägg till tillägg…**, which opens a file picker for
   `.gpplugin`, or the file can be dropped on the page.
2. **Confirm** (dialog): "Lägg till ”Hämta video från webben” 1.0.0?" Then "Signerat av Lars Arvidsson."
   Then "Tillägget körs på den här datorn med samma rättigheter som Gospel Presenter och hämtar program från
   internet (yt-dlp och ffmpeg, ca 130 MB)." Then "Att hämta video från YouTube bryter mot YouTubes villkor.
   Ansvaret är ditt." Buttons: [Avbryt] [Lägg till]. An unsigned or tampered package gets only "Filen är
   inte ett tillägg från Gospel Presenter." and [Stäng].
3. **Installed:** a row with the icon, name, version, a switch "På", and ⋯ (Inställningar, Uppdatera från
   fil…, Ta bort). The first preparation runs here, or on first use: "Förbereder… hämtar yt-dlp 40 %".
4. **The button:** in Lägg till → Video, next to **Importera**: **Hämta från webben** (globe icon).
   Later also on a video library page, once one exists. There is no `videos` admin route yet.
5. **The fetch view** (replaces the tab's content; ← goes back): one field, "Klistra in en länk eller sök på
   YouTube". A pasted link resolves at once into one card. Text and Enter searches.
6. **Results:** rows with a 16:9 thumbnail, the length on it, the title (two lines), and "Kanal · 206 tn
   visningar". The snippet shows on wide screens only. On a phone the thumbnail is 120 px and the text goes
   beside it. Then "Visa fler". While searching, a row of grey placeholders. With no results: "Inga
   träffar."
7. **Picking a result** opens it in place ("Hämtar uppgifter…", about 2 s). It shows the date, "720p · ca 21
   MB", the description (expandable) and **Hämta till biblioteket**. Or it shows the problem instead of the
   button.
8. **Progress** in the same card: a bar with "Hämtar 45 % · 2 min kvar", then "Sätter ihop…", then "Lägger
   in i biblioteket…", then "Gör stillbild…". [Avbryt]. The dialog can be closed. The job goes on on the
   host, and the video tab shows a placeholder row "Hämtas… 45 %".
9. **Done:** a toast, "”Vi Tror Lyric Video” finns nu i Videor". The view goes back to the video tab with
   the new video at the top and already picked, so **Lägg till** puts it in the presentation. The file
   name is the title plus `.mp4`.
10. **Errors** (in the card, with what to do):

| Cause (yt-dlp's text) | Message |
|---|---|
| "Video unavailable", private, removed | "Videon går inte att hämta. Den är borttagen eller privat." |
| "Sign in to confirm your age" | "Videon har åldersgräns och kräver inloggning på YouTube. Den går inte att hämta." |
| "Sign in to confirm you're not a bot" | "YouTube stoppade hämtningen just nu. Försök igen om en stund." |
| Live or upcoming | "Livesändningar går inte att hämta." |
| "Requested format is not available" | "Videon finns inte i ett format som Gospel Presenter kan spela (H.264)." |
| Over 2 GB | "Videon är större än 2 GB." with buttons for lower quality |
| "logged-in" / cookies needed (Vimeo, tested) | "Sidan kräver inloggning. Videon går inte att hämta." |
| Anything else | "Hämtningen fungerar inte just nu. Tillägget kan behöva uppdateras." (with "Uppdatering finns" when the `updateUrl` has a newer signed version) |
| Disk full | "Det finns inte plats på värddatorn." |
| Host gone | Button disabled: "Behöver värddatorn" |

**Not offered:** signing in to YouTube (`--cookies-from-browser`) to get past the age limit or a bot
check. It would read a volunteer's browser cookies, tie the download to their Google account (which can
get that account blocked), and put a credential on the host.

## 7. Phased plan

| Phase | Contains | Rough effort |
|---|---|---|
| **0. Core prerequisites** | Video items finished (in progress elsewhere). The multipart ingest pulled out of `video-routes.ts` into a server function that takes a local file. The client's "finish an import from a hash" (`videoStill` from a URL, then `addVideo`). `PluginHost` in `startNodeServer`, and the `/api/plugins` routes with the thumbnail proxy. The desktop runtime: install from file, signature check, unpack, `utilityProcess`, RPC, jobs table, removal. The Tillägg page. The app-drawn fetch view (field, results with the `video` layout, details card, progress) | 6–9 days |
| **1. Web video plugin v1** | Fetching yt-dlp and ffmpeg at their pinned versions and checking them against the pinned hashes, Electron as the JS runtime, link resolve, YouTube search and details, the format filter, the size choice, progress, cancel, the error mapping, finished jobs waiting until added. Tested on macOS (arm64) and Windows x64; Linux built but untested | 4–6 days |
| **2. Sharing a link in** (section 8) | The desktop URL scheme, a bookmarklet, the confirm view. Then Web Share Target (needs a web manifest; only where the app is installable over https) | 2–4 days |
| **3. Second importer** | Pexels (or the PowerPoint converter), to prove the "small file → client pipeline" route and settings with secrets | 2–3 days |
| **4. Later** | The Chrome extension. A desktop signed in to the cloud running plugins locally. Hardware conversion of VP9 or AV1. An iOS Share Extension with the Capacitor app. SongSelect if CCLI grants access | — |

**What the core app must provide first:** (a) the ingest callable server-side on the host, without
HTTP; (b) finishing an import from an uploaded hash in the client; (c) the `PluginHost` seam in the server;
(d) the generic fetch view drawn from `Result` JSON. None of these is specific to YouTube.

## 8. Sending a link into Gospel Presenter

All entry points end in the same place: the app opens the fetch view with the link already resolved into a
card. **Nothing downloads until someone clicks Hämta till biblioteket.** Any web page can fire a URL scheme
or a share, so a link alone must never start work on the host. The link must be `http` or `https`. The
host decides which plugin takes it from the manifests' `links.hosts`. If none matches, the app says "Inget
tillägg kan hämta från den här sidan." The card has an optional line, "Lägg också till i: [presentation]".
It is preset only when a presentation is open in the editor, and unset otherwise. Progress and finishing
are as in section 6.

| Entry point | Works on | Needs | Recommendation |
|---|---|---|---|
| **Desktop URL scheme** `gospelpresenter://add?url=…` | The desktop app (host or paired), from any browser on that computer | A second route beside `auth` in `signInCallback` (`apps/desktop/src/main.ts`; `open-url` on macOS, `second-instance` elsewhere). The scheme is already registered. The window opens the fetch view | **Do first.** No accounts, no tokens, works on the church computer |
| **Bookmarklet** `javascript:location.href='gospelpresenter://add?url='+encodeURIComponent(location.href)` | Any desktop browser, YouTube's page | Nothing to install beyond dragging a link to the bookmarks bar from the Tillägg page. The browser asks "Öppna Gospel Presenter?" once, with "always allow" | **Do with the scheme.** Zero distribution |
| **Chrome/Edge extension** (toolbar button, and a context menu on a video or link) | Chromium desktop | Simplest version: it only opens the URL scheme, so there is no host address and no token. A version that posts straight to the host would need pairing as a device. That would mean a paired device with a narrow scope, allowed only `POST …/jobs` and `resolve`, which the pairing guard does not have today. It would also need host permissions for the LAN address, and possibly Chrome's local-network permission *(unverified)* | **Later, and only the scheme-opening version.** Distribution is the problem. The Web Store reportedly rejects or removes extensions that help download YouTube video, even indirectly ([secondary sources](https://www.genbeta.com/navegadores/youtube-downloader-google-acepta-una-extension-de-chrome-que-viola-sus-propias-politicas); *policy text not verified*). Self-hosted `.crx` files install only through enterprise policy (`ExtensionInstallForcelist`). On Edge they need a domain-joined PC ([Microsoft](https://learn.microsoft.com/en-us/DeployEdge/microsoft-edge-manage-extensions-webstore)). "Load unpacked" in developer mode works but is not for volunteers. The bookmarklet does the same job |
| **Web Share Target** (`share_target` in a web manifest) | Android Chrome 76+, desktop Chrome 89+, for an *installed* PWA ([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)). No Safari or iOS *(per MDN's "limited availability", not checked per browser)* | A web manifest, which the app does not have yet (no `manifest.webmanifest` in `apps/web`). Then `"share_target": { "action": "/share", "method": "GET", "params": { "title": "title", "text": "text", "url": "url" } }`, and a `/share` route in `ui/router.ts` that takes the URL from `url`, or from inside `text`, as Android apps often put it there. The service worker needs nothing for GET. Installable means a secure context: the cloud, or a host with https on the LAN (`GP_TLS`). **Over plain http on the LAN, the usual case, a phone cannot install the app, so there is no share target** | **Phase 2, second.** Useful for Android with https; most churches on plain http will not have it |
| **iOS / iPadOS** | — | A native Share Extension in the Capacitor app to come (`docs/next-steps.md`). It needs a Swift target, `NSExtensionActivationSupportsWebURLWithMaxCount`, and an App Group to hand the URL to the app or to post it to the host with the app's device token from a shared keychain. A share extension cannot officially open its own app. About 2–3 days, after the Capacitor app exists. **Stopgap:** an Apple Shortcut that accepts URLs in the share sheet and opens `http://{host}/share?url=…` in Safari, shared as an iCloud link. It needs Safari on that device paired with the host *(not tried)* | Later, with the Capacitor app; the Shortcut if asked for sooner |
| **macOS Share menu** | — | A native Share Extension (`.appex`) inside the Electron bundle, signed with the app | Not worth it; the bookmarklet covers macOS |

## Open decisions

1. **Signed packages only, with Lars's key in the app?** Recommended: yes, with a development override.
   The alternative is any package, with a warning, which leaves churches open to a mailed "plugin".
2. **Who installs:** an Admin in the host's own window (recommended), or any Admin from any device.
3. **Electron's RunAsNode fuse stays on** when packaging is set up, so yt-dlp can use the app as its JS
   runtime. If not, the plugin fetches QuickJS or Deno as well.
4. **Decided (Lars, 2026-10-31): pinned tools, no updates of their own.** Still open: whether the
   `updateUrl` check and one-click update come in v1 (recommended, since yt-dlp breaks when YouTube changes and
   the pinned version is the only one), and whether Lars keeps copies of the pinned files in case upstream
   prunes them.
5. **Who finishes a job whose page was closed:** the next page that opens the video tab (recommended for
   v1), or the host itself (ffmpeg still, plus server-authored mutations: more work in core and sync).
6. **No sign-in to YouTube** for age-restricted videos (recommended), accepting that those cannot be
   fetched.
7. **Cloud organisations:** no plugins in v1. Later, a desktop signed in to the cloud could run plugins
   itself.
8. **SongSelect:** ask CCLI about partner access before planning anything beyond a file importer.

## Not verified

- A fresh download of the yt-dlp and ffmpeg executables by Node on macOS and Windows: no quarantine, no
  SmartScreen prompt, Defender's behaviour. Inferred from how the mechanisms work, not tried; no software
  was downloaded for this note.
- yt-dlp's official `yt-dlp_macos` executable with Electron as its JS runtime. Tested with Homebrew's
  yt-dlp (Python 3, `yt-dlp-ejs 0.8.0`).
- The behaviour of age-restricted and bot-checked videos. The error texts are yt-dlp's known messages,
  not reproduced here.
- The exact Web Share Target support per browser, the current Chrome Web Store policy text, Unsplash's
  rules on storing a downloaded copy, and CCLI's partner programme status.
- Mediabunny as an ffmpeg-free remuxer.
- Electron `utilityProcess` with the Node permission flags for plugin processes.
