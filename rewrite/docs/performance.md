# Performance

How fast the most used flows are, measured, and what made them so. The measurements are
`apps/desktop/e2e/performance.spec.ts`, on the host's own window, with 3 000 songs (five parts of four lines
each, as long as a hymn), 50 presentations (the newest with 30 songs) and a whole Bible (31 000 verses). Each
flow is a median of three or six runs, in ms, timed in the page from the click or key until what it waits for
is in the DOM and laid out; paint is not counted (the test windows are hidden). "4×" is the same with the CPU
slowed four times (Chrome's throttling), about a tablet. The tests fail at about 2-3 times these numbers, so a
slowdown shows and a busy machine does not.

## The numbers (2026-10-30, on Lars's Mac)

| Flow                                                       | Before | After | Before, 4× | After, 4× |
| ---------------------------------------------------------- | -----: | ----: | ---------: | --------: |
| The start page from another page                           |     12 |    16 |         26 |        16 |
| The window's start (a reload, until the start page lists)  |    157 |   668 |        255 |       743 |
| Sånger reloaded, until it shows 3 000 songs                |    477 |   710 |      1 051 |     1 063 |
| Open a presentation of 30 songs                            |     86 |     7 |        152 |        30 |
| ↓ to the next item in the editor                           |      2 |     2 |          6 |         8 |
| → to the next slide live                                   |      2 |     2 |          8 |         9 |
| Open Lägg till, until songs are listed                     |    200 |    19 |        669 |        71 |
| Add a song with Ctrl+Enter, until the running order has it |    706 |    80 |      2 459 |       146 |
| Ctrl+2 to the Bible tab                                    |     19 |     5 |         74 |        15 |
| Ctrl+1 back to the song tab                                |     54 |    12 |        227 |        31 |
| "Joh 3:16-17" in the Bible search                          |      3 |     3 |          9 |        10 |
| A book (Psaltaren), until its 150 chapters show            |     11 |     5 |         48 |        42 |
| A chapter, until its verses show                           |      6 |     3 |         26 |        10 |
| A song added by another device, until it shows             |    614 |   516 |        676 |       522 |

Song search in Lägg till, one key at a time from all 3 000 songs down to "herre" and back to empty
(`h, he, her, herr, herre, herr, her, he, h, empty`):

|                                           | Keystrokes                                       |
| ----------------------------------------- | ------------------------------------------------ |
| Before, the whole list                    | 106, 35, 25, 18, 19, 19, 22, 47, 70, 72          |
| After, until the first rows are right     | 45, 121, 35, 12, 10, 9, 10, 9, 11, 16            |
| After, until every hit is in the list     | 158, 165, 63, 37, 34, 32, 32, 51, 115, 96        |
| Before, 4×, the whole list                | 392, 142, 98, 82, 80, 75, 78, 185, 288, 260      |
| After, 4×, until the first rows are right | 102, 108, 40, 31, 38, 29, 47, 44, 38, 71         |
| After, 4×, until every hit is in the list | 729, 357, 189, 177, 185, 171, 190, 264, 568, 527 |

A step of scrolling through the list: 4-5 ms (12-13 ms at 4×), before and after.

The numbers move by 20 % or more from run to run; the second keystroke, "he", jumps between about 30 and 120 ms.

## What changed, and why

- **The window's start is slower, by design.** The host's own window keeps its database in memory
  ([The host's own window](media-and-files.md#the-hosts-own-window)), so it pulls everything when it opens:
  2.1 s at first, 0.67 s now. What took the time: a pull page was 500 changes, so 37 round trips, and the server
  read each row with its own query (now 5 000 a page, each page's rows read with one query per table and 100
  ids); the client prepared one statement per row (now one per run of rows of a table). The host window no longer
  downloads every Bible text into memory either: it fetches one from the server when Bibeltexter needs it. Not
  done: a snapshot of the database to start from.
- **Song search runs in the database's worker** (`SongSearch`, `packages/sync/src/client/song-search.ts`), so
  the page never loads the lyrics. The worker prepares every song's text (lower case, without accents) once and
  keeps it in memory; a change to the songs or their parts drops it, and the next search prepares the library
  again (about 0.1 s for 3 000 songs). The song tab asks for it when it opens, ahead of the first key. Preparing
  works out each character once and keeps it: 4.6 times faster than before. A table of the prepared texts, kept
  up to date by triggers, was tried first and dropped: more parts to keep right, and no faster in use.
- **The song list in Lägg till** draws a new list in steps (`useStepped`): the first 60 rows at once, then
  300 more per task, each step a transition that any other update goes ahead of, so the running order and the
  keyboard are not held up by 3 000 new rows (300 ms in one go). Each row is drawn again only when it changes.
  The whole list takes longer to be complete than before; what is on the screen is there sooner.
- **A running order's slides** are read with four queries for all its songs (`slidesOfItems`), not four for
  each song in turn: after every change, a presentation of 30 songs waited on 120 answers.
- **The song library reloads only when the songs change** (`useSongSearch`; `SyncClient.onChange` gives the
  tables a transaction wrote). Every other page reloads on every change, as before: cheap now that the worker
  answers at once.
- **Sorting by name** uses one `Intl.Collator` rather than `localeCompare` per comparison: 3 ms rather than 86
  for 3 000 songs.
- **Indexes** on a presentation's items, a song's parts and arrangements, and the items showing a song
  (`orgIndexes` in `packages/core/src/schema.ts`).

## Left as it is

- **A change from another device takes about half a second to show** (`syncOne`): the server announces
  changes at most once per 500 ms, at the end of the window (SYNC-R38). Announcing the first change at once
  would make it about 20 ms; that is a change of the spec.
- **A first pull of a big library on a new device** spends most of its time applying the rows (about 0.5 s for
  18 000 rows), mostly in the triggers that every write runs.
