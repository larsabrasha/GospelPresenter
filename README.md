# Gospel Presenter

Delightfully simple presentation software for churches. Free and open-source.

Gospel Presenter shows song lyrics, Bible verses, pictures, videos and slides on a second screen during services.
It works offline, in a desktop app that can also serve the church's other devices on its own network, in a browser,
and in a phone app.

## Where things are

| Folder | What it holds |
|---|---|
| [`rewrite/`](rewrite/) | The app: TypeScript, local-first (pnpm + turbo). Start with [`rewrite/README.md`](rewrite/README.md); agents with [`rewrite/AGENTS.md`](rewrite/AGENTS.md) |
| [`spec/`](spec/) | What the app does, area by area: the behaviour spec the app is built from |
| [`adr/`](adr/) | The decisions; [`adr/0007-rewrite-on-typescript-local-first.md`](adr/0007-rewrite-on-typescript-local-first.md) is the rewrite's |
| [`docs/`](docs/) | The website, gospelpresenter.com (`.github/workflows/static.yml`) |
| [`research/`](research/), [`spike/`](spike/) | What was tried before the rewrite was decided |
| [`Assets/`](Assets/), [`scripts/`](scripts/) | The app icon's designs, and scripts the ADRs and the spec name |

## The C# app (1.x)

The app before this one, in C# (Blazor and MAUI) with PostgreSQL and Garage, is kept at the tag
[`v1-final`](../../tree/v1-final): build or patch it from there (`git worktree add ../gp-1x v1-final`). How to
deploy it is in its README at that tag. A church moves its data to this app with the export from 1.x
([`rewrite/docs/import-from-1x.md`](rewrite/docs/import-from-1x.md)).

## License

[AGPL-3.0](LICENSE).
