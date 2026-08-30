# 4. Desktop live sessions are mirrored to the server

- **Status:** Accepted
- **Date:** 2026-08-30
- **Scope:** `GospelPresenter.Shared/Live`, `GospelPresenter.Web/Live`, `GospelPresenter.Client/Live`,
  and the live-state call sites in `Presentation.razor`
- **Builds on:** ADR 0003 (the Electron desktop host) and the offline sync engine it ships with

## Context

Remote control in the web app looks like a network protocol and is not one. `SharedAppState` is a
singleton in the server process, and a phone drives a presentation by finding the presenter's
session in that same dictionary and writing to it. Both ends are Blazor circuits on one machine.

The desktop app runs its own ASP.NET process inside Electron, with its own `SharedAppState`. A
presentation started there is invisible to the server: no phone can control it, and no public QR
output can follow it. `DesktopAppCapabilities.RemoteDisplays` returned `false` and hid the whole
feature rather than shipping something half-working.

There was no SignalR hub and no WebSocket anywhere in the repository. The only live channel out of
the server was the SSE stream in `PublicOutputEndpoints`, and the only channel from a device to the
server was the sync engine's HTTP push and pull.

## Decision

**The device that starts a presentation owns it.** A presentation started in a browser is unchanged
in every respect — it already runs where the server can see it. A presentation started on a desktop
is owned by that desktop, and the server keeps a replica.

Five things follow from that, and each of them was a real choice:

1. **The device is authoritative, always.** The projector is driven by the desktop's own local
   state, from its own SQLite database. Mirroring is an extra that comes and goes with the network.
   A router that reboots in the middle of a service changes nothing about what is on the screen.

2. **A selection is mirrored, never a rendered slide.** The device reports
   `{presentationId, itemId, partIndex, blackScreen, overlayId}`, and the server rebuilds the slide
   from its own copy of the presentation. This is not an optimisation. A `LiveSlide` built on the
   desktop carries image URLs pointing at that machine's own local media server, which no phone and
   no visitor can reach; the URLs cannot be shipped, so the slide cannot be either.

   This forced `SetSelectedLiveSlide` out of `Presentation.razor` and into `LiveSlideBuilder`, so
   that both hosts build a slide by the same code. `LiveSlideBuilderTests` pins the result for every
   item type, because a divergence between the two would show up as the projector and the
   congregation's screens disagreeing mid-service.

3. **Commands are absolute, and the owner's echo settles it.** A phone asks for "item X, part 3",
   never "next". A duplicate, a reordering, or a resend after reconnecting all land in the same
   place. The phone writes optimistically into the server's replica so its own screen responds
   immediately; the device applies the command locally and echoes what it actually did, and that
   echo is what both ends end up agreeing on.

   The loop this creates is cut in `LiveCommandForwarder` by comparing every write against the last
   state the owner reported. A write that matches is the owner's own and goes no further; one that
   differs came from a controller and is forwarded down. Applying one report touches the live state
   several times, and the half-written states in between match neither selection, so
   `MirroredSessionRegistry.SuppressForwarding` covers that window. Both sides read the state
   through `MirroredSessionStateReader` — one function, deliberately, since the comparison is only
   sound if the two descriptions are built identically.

4. **The session id is derived from the device token, not invented per launch.** A browser session
   is a tab and `sessionStorage` is the right lifetime for it. A desktop installation is one machine
   in one room, and its session id ends up both in live image URLs and in whatever a phone is
   pointed at. `DeviceSessionId.For` hashes the device token's id, so the value survives a restart
   and the server can derive it independently — it never trusts a client's claim about which session
   it is. Hashed rather than used raw because the id is served anonymously under
   `/api/live-images/{sessionId}/`.

5. **Losing the connection freezes; only the owner ends the session.** A dropped socket leaves the
   session active in `SharedAppState`, so a public output stays on the slide it has rather than
   falling to the waiting screen over a moment of bad wifi. The controller is told the machine is
   out of touch and its controls go away, because they would do nothing.

**Content is pushed before anything is mirrored.** The server can only rebuild a slide from a
presentation it has. `LiveSessionClient` runs a full sync and a media sync before it registers, and
retries for as long as the presentation lasts. Push is journal-wide rather than per-presentation, so
"a targeted push of this presentation" is simply a full sync — the same guarantee for less code. The
preparation is deliberately *not* awaited by the operator: the projector lights the moment they
press start, whatever the network is doing.

**Authorization is unchanged.** Organisation membership plus the presenter's own remote-control
toggle, exactly as for a browser session. No new `Permission`. That there is no permission check on
remote control today is a pre-existing gap; this decision does not widen it, and does not fix it.

## Consequences

- `RemoteDisplays` split into `RemoteControl`, `PublicOutput` and `PairedDisplays`. The desktop gets
  the first two. Paired screens stay web-only: the pairing is held by the server, and a browser on
  the local network cannot reach a session that exists only on one machine.

- **CCLI had to be exempted.** `SetLiveSlide` starts a ten-second timer that reports a displayed
  song. The desktop already counts its own usage locally and syncs it up like any other row, so
  writing mirrored slides in would have reported every song of every service twice.
  `SetCcliReportedElsewhere` is the exemption.

- **A stale mirrored session needs its own clock.** `TouchSession` is called by every read, and a
  public output reads continuously, so a frozen session with one forgotten viewer would never be
  cleaned up. The registry keeps an owner-last-seen stamp that reads do not touch.

- **The same presentation may now be live in two places.** `GetActiveSessionIdForPresentation`
  returned `FirstOrDefault`, which would have picked one arbitrarily. It is now
  `GetActiveSessionIdsForPresentation`, the remote URL carries `&session={id}`, and the controller
  shows a picker when the choice is real.

- **Still one web instance.** The hub and `SharedAppState` are both in memory. A second replica
  would break this and would already have broken the browser-to-browser remote control that predates
  it. Scaling out means a backplane for both, and that is not done here.

- **A presentation edited while live can lag.** Readiness is checked at start. An edit made on the
  desktop during a service reaches the server at the next sync tick, so a phone may show the
  previous text for a few seconds.
