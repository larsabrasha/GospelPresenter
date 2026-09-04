# 6. Organisation changes are announced, not polled for

- **Status:** Accepted
- **Date:** 2026-09-04
- **Scope:** `GospelPresenter.Shared/Sync`, `GospelPresenter.Shared/Contexts/PresentationContext`,
  `GospelPresenter.Web`, `GospelPresenter.Client/Sync`, and the web host's service registration
- **Builds on:** the offline sync engine (`ISyncService`, `SyncScheduler`) and ADR 0004, whose
  `LiveSessionHub` established how a device authenticates over SignalR

## Context

A change made on one machine takes about thirty seconds to appear on another, and all of it is spent
on the receiving side. The sending side is already fast: `LocalWriteInterceptor` raises a signal from
inside the database command, `SyncScheduler.WriteSignalDelay` coalesces for 500 ms, and the push
goes. The receiver then learns about it only when `IdlePullInterval` next expires — thirty seconds of
asking a question whose answer is almost always "nothing".

The web app is worse off, and silently: it registers no `ISyncStatusSource`, so `RefreshOnSync`
resolves nothing and does nothing there. Two people editing the same song library in two browsers
never see each other's work without reloading the page.

The obvious symmetry is tempting. Live presentation state already flows over SignalR
(`LiveSessionHub`), and moving sync onto the same transport would leave the app with one channel
instead of two. That symmetry is false, and naming why is most of this decision: mirrored live state
is deliberately lossy — absolute, unqueued, and a dropped message is replaced by the next one,
because a slide the operator has already left is not worth delivering late. Sync is the opposite:
journalled, transactional, and nothing may be lost. Sharing a transport would not let the two share
a single line of that logic.

## Decision

**SignalR is the doorbell. HTTP stays the lorry.** A hub announces that an organisation has changed;
pull, push and the three side channels remain exactly as they are. No sync logic changes — not the
journal, not the watermark, not the conflict policies.

1. **The announcement carries nothing but the organisation.** Not the change, not even which table
   moved. The client already owns every decision about what to fetch, and an empty signal has no
   wire contract to misunderstand — which is why `ClientProtocolFloorFilter` and its 426 do not
   apply to the hub at all, and why adding a synced table later does not raise `SyncProtocol`.

2. **A save-changes interceptor rings it**, running immediately after the `SaveChanges` override
   that stamps `ModifiedAt` and on the same change set. One choke point rather than a call in each
   service.

   An interceptor rather than a line in the override itself, for the reason (8) gives: stamping must
   be impossible for a host to drop, and announcing must be easy for one to drop. The comment above
   `ApplySyncTrackingAsync` argues the opposite case for the opposite requirement, and both are
   right.

   The organisation comes from the changed rows. Child rows do not carry one, but they do not have
   to: the existing convention is that a child change also bumps its aggregate root's `ModifiedAt`
   (`PresentationService.BumpPresentationAsync`, `SongService.TouchSong`), so a root that does carry
   the organisation is in every change set. A change set whose organisation still cannot be derived
   rings every connected device instead of being dropped — wasteful, rare, and never wrong. With one
   exception, which turned out not to be rare: see (15).

3. **`ExecuteUpdateAsync` must ring by hand**, exactly as it must already stamp `ModifiedAt`, and
   for the same reason: it bypasses the change tracker. Forgetting one produces a change that is
   late rather than lost, which is the kind of bug nobody reports — hence pinning it rather than
   trusting review.

   Fewer sites than expected, because the two conventions that already exist do the work:
   `BumpPresentationAsync` is the single choke point every presentation child mutation passes
   through, and every `ExecuteDeleteAsync` path already adds tombstones through the change tracker,
   so (2) announces those with the organisation the tombstone carries. What is left is
   `BumpPresentationAsync`, the four presentation-level updates, `RemoteDisplayService`'s rename and
   a replaced Bible import.

   `SyncTrackingCallSiteTests` pins it, in `Dispose` rather than test by test, so a mutation path
   added there later is covered whether or not its author thinks to check.

4. **The ring happens in `SaveChanges`, before the commit, and that is safe on purpose.** Two
   existing mechanisms cover the window: the notifier's own 500 ms throttle (5) means the ring is
   already delayed past a commit that takes milliseconds, and `SyncDefaults.PullOverlap` widens
   every pull ten seconds backwards, so a pull that arrives a moment early still collects the row on
   its next run.

   An interceptor on `TransactionCommitted` was the alternative. It was rejected because it builds a
   second delaying mechanism to achieve what the throttle already achieves, and because it does not
   fix the underlying hazard it appears to: `ModifiedAt` is stamped before the commit, so a
   transaction held open longer than `PullOverlap` can lose rows to *any* pull that lands inside it,
   whatever rang the bell. That hazard predates this ADR and is left where it is — see Consequences.

5. **The notifier throttles to one ring per organisation per 500 ms.** A push applies one
   `SaveChanges` per aggregate, and a first sync into an empty device was measured at 871 songs and
   3527 song parts. Without the throttle that is a burst of socket traffic to every device in the
   organisation. One timer per organisation is cheaper than explaining that burst later.

6. **The device that caused the change is excluded, exactly.** A push arrives with a device token
   carrying `device_id`, and the hub connection carries the same claim, so a `device_id →
   connectionId` registry — the same shape as `MirroredSessionRegistry` — makes
   `Clients.GroupExcept` possible. A write from a browser has no `device_id` and rings the whole
   group, which is correct. Exact rather than a quiet window on the client, which would be
   approximate and could swallow a real announcement from another machine.

7. **The web app uses no SignalR for this.** Its circuits already run in the server process, so a
   scoped `ISyncStatusSource` adapter over the in-process notifier is the whole of it, and
   `RefreshOnSync` starts working on the web for the first time. Scoped rather than singleton
   because the adapter must filter on the circuit's own organisation — a singleton would either leak
   other organisations' announcements or push that filtering into a view, which is an authorisation
   decision and does not belong there. `RefreshOnSync` already unsubscribes on dispose.

8. **The notifier resolves optionally, and is registered only by the web host.** `ClientDataContext`
   inherits `PresentationContext`, so the hook in (2) also runs in the desktop process — on every
   local write and on every row a pull applies. With the notifier absent there, the hook is a no-op
   and the desktop cannot ring its own bell. This is the seam the codebase already uses for
   "one host does this, the other does not" (`ISyncStatusSource`, `ILiveWindowLauncher`,
   `IMediaUploader`).

9. **A separate hub, not a method on `LiveSessionHub`.** The live hub connects only while something
   is being presented and its identity is per session; the doorbell must be connected for as long as
   the device is signed in, and is grouped per organisation. Two connections while presenting is not
   a problem, and the two share nothing but the transport.

10. **The client keeps a dirty flag, not a queue and not a debounce.** `SyncAsync` takes
    `syncGate.WaitAsync(0)` and *drops* a call that arrives while a sync is running. For a local
    write that is harmless — the `finally` block reschedules while `PendingChanges > 0`, and the
    ten-second poll sits behind it. A remote announcement has neither, so a dropped one would wait
    for the idle pull. `NotifyRemoteChanges` therefore sets a flag, runs the sync when the gate is
    free, and re-runs from `finally` if the flag was set again during the run.

    No client-side debounce: the server owns the throttling (5), and two coalescers in series pay
    the latency twice.

    **The flag is put back when the run fails**, found while testing the failure paths. It is
    cleared when a run starts, so that an announcement arriving mid-run counts as new work; a run
    that then failed had therefore consumed an announcement without delivering anything, and the
    change the server said it had would have waited out the backstop — five minutes since (13),
    where before this ADR it would have been thirty seconds. The poll tick now also syncs while the
    flag is set, so such a retry comes within one tick.

11. **Reconnecting counts as an announcement.** Anything may have happened during the outage, and
    `LiveSessionClient` already re-sends its whole state on `Reconnected` for the same reason.

12. **A 401 stops the hub client, unlike the live client.** Retrying forever is right for a
    presentation that must survive a rebooting router; it is wrong for a revoked token, where no
    sync will work until someone signs in again. The connection gives up and leaves the state to
    `SyncStatus.AuthRequired`, so a decommissioned machine does not knock on the hub for ever with
    only the server's logs to notice.

13. **`IdlePullInterval` goes from 30 seconds to 5 minutes, and stays for ever.** It is the reason a
    missed announcement costs latency rather than correctness. Removing it would make the doorbell
    load-bearing, and a bell that has to be perfect is a worse design than one that only has to be
    quick.

14. **Nothing about this appears in the UI.** `SyncStatusIndicator` and `IConnectivityMonitor` are
    untouched. The hub's connection state is arguably a more honest "am I online" than either, but
    surfacing it would turn an optimisation into something a user believes they must understand.

15. **User-scoped rows are announced by their writers, not by the interceptor** — decided while
    building, against a measurement. `UserSetting` is the one synced kind of row that carries a user
    instead of an organisation, so (2)'s fallback would announce it to every organisation on the
    server; and it is written on every language switch and by onboarding. The first integration test
    caught it: the mock seed's single user setting rang every connection.

    The interceptor therefore skips user-scoped rows — the entity and the tombstone alike — and
    `UserService.SetUserSettingAsync`, `DeleteUserSettingAsync` and `SyncService`'s user-setting push
    path announce with the caller's organisation, which they know exactly and the interceptor cannot.
    The alternative was resolving the user's organisation inside the interceptor, which would mean a
    query in the middle of a save.

## Consequences

- **Measured at 638 ms**, server edit to the row landing in the device's own database, by
  `DeviceSyncEndToEndTests.AnEditOnTheServer_ReachesTheDeviceInAboutASecond` — against roughly
  thirty seconds before. Half of it is the notifier's coalescing window; the rest is the round trip
  and the pull. The test asserts under three seconds, which is headroom for a loaded build agent
  and still an order of magnitude below the interval it replaced.

- **The device loop is tested end to end**, in `DeviceSyncEndToEndTests`: the real engine, scheduler
  and hub client against the real server, with only the network's up/down state and the device's
  secure storage faked. It covers the announcement arriving (both the by-hand and the interceptor
  path), an edit made offline being pushed when the network returns, a change announced while the
  device was unreachable being picked up on reconnection, one device's edit reaching another,
  a two-sided edit converging and leaving the row pushable again, a revoked token stopping the
  doorbell, and a device not being woken by its own push.

  Both idle intervals are set to five minutes in that harness, deliberately: nothing there can pass
  because a poll happened to fire.

- **Two things that harness cannot prove.** The test server has no sockets, so the hub runs over long
  polling rather than a WebSocket. And conflict detection compares `Version`, which Postgres bumps
  with a trigger on every write while SQLite only bumps it through the change tracker — so on the
  SQLite test server an `ExecuteUpdateAsync` path produces no conflict where production would. The
  convergence test uses a song, whose edits are tracked saves, for exactly that reason.

- **The web app gains live library updates it never had.** Everything already carrying
  `<RefreshOnSync>` — the dashboard, presentations, songs, themes, overlays, images, audios,
  templates, labels — starts refreshing for browser users too. That is half the value of the work
  and it comes from decision (7) alone.

- **Idle devices go quiet.** A church laptop left on all evening stops asking a question every
  thirty seconds. Combined with (13) this is a tenfold reduction in idle traffic per device.

- **Still one web instance.** The group registry lives in memory, exactly as ADR 0004's session
  registry does. A second replica would announce only to its own connections; because of (13) the
  failure mode is slower sync and not wrong sync, so scaling out later is an optimisation rather
  than a correctness fix. A backplane is not done here.

- **A second always-open WebSocket per signed-in device**, on top of the live one while presenting.
  For a handful of machines per organisation this is not worth engineering around.

- **The long-transaction hazard is untouched and now written down.** `ModifiedAt` is stamped in
  `SaveChanges` while `PullOverlap` is ten seconds, so a transaction held open longer than that
  between stamping and commit can hide its rows from a pull that lands inside the window — the
  client advances its watermark past a stamp it never saw. This is reachable today with the
  thirty-second poll; the doorbell makes early pulls more common without creating the flaw. The
  remedies are a longer overlap or stamping at commit time, and both are separate work.

- **Forgetting a manual ring is a latency bug, not a data-loss bug.** The pinning test in (3) is the
  first line of defence and the five-minute pull is the second.
