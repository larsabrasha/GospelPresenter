# Scenarios and the tests that run them

What a church does with the app, most common first, and the e2e tests (`apps/desktop/e2e`) that run each one on the
built desktop app with a real server. Each feature has its own spec; `journeys.spec.ts` runs whole Sundays, to catch
what goes wrong between the features. A test is named by its file and the start of its title; the architecture
tests (`packages/architecture/test/scenarios.test.ts`) check that every one exists, so this table cannot go stale.

## A Sunday

| Scenario | Tests |
| --- | --- |
| Prepare and present a service: song, reading and picture on the projector, a TV and the phones at once; CCLI afterwards | `journeys.spec.ts`: "a Sunday" |
| Prepare on a laptop while the church computer is off; present it there on Sunday | `journeys.spec.ts`: "prepared on a laptop" |
| Give the band sheet music, a recording and a Spotify link on a song, gathered under Sunday's presentation | `song-materials.spec.ts`: "a song carries sheet music and links" |
| Present on the projector (its own switch under Utgångar), and Avsluta closes it | `milestone6.spec.ts`: "the output window is a switch" |
| Keep presenting through a reload; only Avsluta stops | `editor.spec.ts`: "a reload while presenting" |
| Present from a phone: the picture, ‹ Släck ›, every part's text, and a song added after what is shown | `phone.spec.ts`: "on a phone the presentation is one column before and while presenting" |
| Change the running order while live | `editor.spec.ts`: "presenting keeps the running order" |
| Change the running order while live on a computer: drag a row, its menu, Lägg till efter, Delete | `live-order.spec.ts`: "presenting on a computer" |
| Present from an iPad lying down, by touch | `live-order.spec.ts`: "on an iPad lying down" |
| A TV in the hall as a saved screen | `screens.spec.ts`: "a saved screen is online" |
| A borrowed TV as a temporary screen, by code or QR | `screens.spec.ts`: "a TV shows a code", `screens.spec.ts`: "a TV that opens the QR link" |
| Phones follow on a public output | `watch.spec.ts`: "a public output follows" |
| Overlays (the collection, a welcome) | `overlays.spec.ts`: "an item carries its overlay" |
| Audio and video during the service | `audio.spec.ts`: "live: audio plays", `video.spec.ts`: "live: the output window plays the video" |
| Someone else drives from a second computer or a phone | `remote.spec.ts`: "a second computer takes control", `remote.spec.ts`: "a phone on the LAN" |
| A clicker: next, previous and black from its keys | `milestone6.spec.ts`: "a clicker's keys" |
| The presenting computer drops out mid-service | `remote.spec.ts`: "when the presenting computer drops out" |
| The CCLI report | `ccli.spec.ts`: "a song with a CCLI number" |

## Preparing

| Scenario | Tests |
| --- | --- |
| Import songs from ProPresenter | `song-import.spec.ts`: "chosen .pro files become songs", `song-import.spec.ts`: "a name the library has" |
| Write and edit a song; it saves as you type | `milestone2.spec.ts`: "the song saves 500 ms after typing" |
| Arrangements | `milestone2.spec.ts`: "arrangements" |
| A song's history, and a version restored | `song-history.spec.ts`: "a changed part is kept" |
| Two people edit the same part | `song-clash.spec.ts`: "a part changed elsewhere" |
| A presentation from a template | `templates.spec.ts`: "PRES-A30, A3, A31" |
| Bible readings | `milestone4.spec.ts`: "a Bible reading, imported from a zip" |
| Pictures, PDF slides, audio and video in a presentation | `milestone5.spec.ts`: "a picture is imported", `slides.spec.ts`: "a three-page PDF", `audio.spec.ts`: "an audio file is imported", `video.spec.ts`: "a video is imported" |
| Keep a PDF as a slideshow in the library, put it in a presentation, and replace it with a new PDF that the presentation then shows | `slides.spec.ts`: "a PDF imported into the library" |
| Make a slideshow of its own (a welcome, the collection) with texts, pictures and shapes, and show it in a presentation | `custom-slides.spec.ts`: "a custom slide is made" |
| Make a theme of its own (its type, capitals, a picture behind), make it the default, see the output show it, and delete it | `themes.spec.ts`: "an own theme, made and changed" |
| Labels | `labels.spec.ts`: "the default labels are listed" |
| The trash | `milestone2.spec.ts`: "trash" |

## Running the organisation

| Scenario | Tests |
| --- | --- |
| First setup and sign-in | `milestone3.spec.ts`: "sign-in", `passkeys.spec.ts`: "desktop host: set up with a passkey" |
| Add a user and invite them | `milestone3.spec.ts`: "creating a user", `milestone3.spec.ts`: "invites on the host", `mail.spec.ts`: "an invite is mailed" |
| Connect a second computer | `milestone3.spec.ts`: "pairing" |
| A user removed or demoted | `milestone3.spec.ts`: "membership" |
| Several organisations | `orgs.spec.ts`: "an organisation is made" |
| English | `language.spec.ts`: "English chosen" |

## Without the network

| Scenario | Tests |
| --- | --- |
| Work while the church computer is down; the changes land when it is back | `milestone1.spec.ts`: "the second client keeps working" |
| Keep a presentation offline, and present it with the host gone | `offline.spec.ts`: "a presentation kept offline" |
| Keep the coming week offline | `offline.spec.ts`: "\"Spara kommande presentationer offline\"" |
| A phone or tablet over https on the LAN | `https.spec.ts`: "a device that trusts the host's certificate" |
