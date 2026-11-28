# Planning: the calendar, who does what at each event

Step 1 built (2026-11-28); "Later" is not. Lars, 2026-11-17: the church plans every gathering in a shared spreadsheet, and the app
should take its place. It is not an app of its own ("Gospel Planner" was weighed): the people who plan are the people
who make the running orders, and accounts, roles, sync and offline are already here; a second app would be a second
thing to install, sign in to and keep in step. It is held to the app's aim: simple, for small churches, not Planning
Center. Lars, 2026-11-28: one list on the start page, of what happens in the church, each row an event with its
presentation when it has one (two parts, Kalender beside Presentationer, were built first and taken back the same day:
"Kalender" in several places confused); an event's fields are its own and free, made from templates;
a name in a field is a link to a person in the app or free text. Later the calendar is to hold the renting out of the
church's rooms and a public calendar too (not in step 1), so nothing in it is tied to services.

## What the spreadsheet shows

The church's sheet (kept out of the repository: it names members; the copy of 2026-11-17 runs from December 2025 to May
2027, 90 rows) is a row per gathering and a column per task: date and time, gathering (its title), meeting leader,
sermon, music, intercessors, sound, pictures (the ones who run this app), other (a note), and the children's group. Most
rows are Sunday services at 11; others are a café every other Friday 15–18, a day of prayer across two days, a seminar
at 14 and 16, the annual meeting, a weekend away, a summer party, several with no tasks filled in, and the coming
Sundays with a date only. What it tells the design:

- **A cell is text, not a person.** It holds couples ("A and B"), short names (initials, a first name and a letter), a
  group's initials, "and others", notes ("plays the hymns"), a doubt ("Per A??"), and "-----" for a task not needed.
  Requiring an account, or one person, per cell would make it harder than the sheet.
- **The tasks are the church's own, and differ by gathering.** Another church has no children's group called that, and
  has a coffee rota; a café needs other tasks than a service, and a room let out other tasks again (the key, the
  cleaning).
- **Times are looser than a date.** A range, two times on one day, two days, no time, a feast's name beside the time
  ("kl 11 pingst", "Långfredag").
- **Not every gathering has a running order.** A café or a day of prayer has none; a service has one.

## One list

The model in one sentence: "Startsidan visar det som händer i kyrkan. En presentation är det som visas på skärmen vid
en händelse." A row is a **händelse** (English: event).

- **The start page** has the church's name as its title, and at its right Lista and Tabell as two icons (Tabell not
  on a phone), ⋯ (Importera från Excel; for an Admin Mallar för presentationer and Mallar för händelser) and + (Ny
  presentation, Ny händelse). A row opens its event; the button at its end, "Presentation", opens its presentation,
  and "+ Presentation" makes one with the event's title and opens it, so a Sunday is one tap (Lars, 2026-11-28; the
  same button is Tabell's column Skärm). Presentations without a date fold into one row at the top of Lista. An
  event's page is `/calendar/{id}`; `/calendar` alone leads to the start page.
- **Search and quick filters**, under the title, each with its icon, adding up: a search through the titles, places, descriptions and what
  the fields say (all of it, past events too, while something is typed); **Välj dag**, a month above the list or the
  table, which then shows that month, or a day tapped in it, the past too; **Med presentation**, what the start page
  showed before; **Saknar folk**, events with a field missing someone; **Mina**, events with the signed-in member in a
  field as a person. The quick filters are this device's, as the view is; the search is not kept.
- **Empty**, it explains itself: "Planera det som händer", what it holds, Skapa en presentation, Ny händelse and
  Importera från Excel (no "ni" or "vi" in the app's words: Lars, 2026-11-28). No setting turns the calendar on or off.
- **A presentation is what shows at an event** (Lars, 2026-11-28): a presentation with a date has its event, and
  the date is the event's. Ny presentation with a date (from a template too) makes the event with it: the
  presentation's name, date, time and place, seen only inside the church, no fields; its id is the presentation's,
  the same on every device. A presentation without a date has none: a draft, or one used again and again (a welcome
  picture); given a date, it gets its event then. The upgrade to schema 30 gave each presentation with a date, out of
  the trash, its event the same way.
- **One date, changed from either side**: the date, time and place changed on the event reach its presentation, and
  changed in the presentation's details dialog reach its event (`eventFollowsPresentation`), so a church that only
  makes presentations never opens Kalender. A presentation's date taken away lets its event go; the event stays in
  the calendar, as an event has a date. An event has at most one presentation and a presentation at most one event.
- **The link**, shown from both sides with the same icons. An event with a presentation shows a screen icon (a chip in
  Lista, a column right after the title in Tabell) and, on its page, the presentation as a row that opens it; one
  without offers Skapa presentation, making a presentation with the event's title, linked. A presentation shows its
  event as a row at the top of its column (calendar icon, title, date, time, place) that opens it. One with a date
  whose event went to the trash offers Lägg i kalendern, making a new one.

## The calendar

- **An event**: a date, a start time, an end date and an end time when there are any, a title, a place, a description,
  its fields, who may see it outside the church (below), and the presentation it is linked to, if any. Deleted, it goes
  to the Papperskorg as a presentation does; its presentation stays.
- **All day**, as iOS's Calendar (Lars, 2026-11-28): an event has times or is all day, and no time is all day (as an
  .ics event of a date only is); with an end date, all of several days. A switch Hela dagen hides the times; turned
  off, it gives 11–12 to change. A new event without a template, and a new template, start at 11–12, as iOS gives a
  new event an hour; imported rows without a time are all day.
- **Its length** (Lars, 2026-11-28): an event from a template takes the template's start and end time, so its length.
  A start moved moves the end as far, as Apple's and Google's calendars do: the end time with the start time (unless
  the change names the end too, or the end would pass midnight, when it stays), the end date with the date. No end is
  made up where there is none: the sheet has start times only.
- **The description**: free text about the event, written for whoever comes ("Vi firar nattvard. Kyrkkaffe efteråt").
- **Fields** (the tasks: "Vem gör vad"): an event's own list, each a name and what is in it, in an order. Any member
  adds a field to an event, renames it, moves it or removes it; nothing is shared between events but the names offered
  (the names other events' fields have). What is in a field is a list of entries, each either a **person** (a member of
  the organisation, a link) or **text** (anything typed: "Maria Ek m fl", "–", "spelar psalmerna"). Typing offers the
  organisation's members first, then the texts written before in fields of that name; picking a member makes a chip,
  anything else stays text. Nothing checks a text.
- **A person**: a chip opens the person: their name, their picture, and their coming events with the fields they are
  in ("Förebedjare sö 29 nov, Predikan sö 20 dec"); their e-mail address for an Admin only, as Användare shows it. A
  chip keeps the member's name as it was when picked, so it shows offline; the members offered come from
  `GET /api/people` (any member: ids and names, no address or role), kept on the device for when it is offline. The app
  keeps no pictures of its members, so the person's view shows their initials. A member who leaves stays a chip with
  their name; their view then says they are no longer in the church.
- **Templates** (Mallar, as the presentations' templates): a title, a time, a place, a description, the fields (with
  what is in them, when the template fills one in), and who may see the event outside the church. Ny händelse asks
  which template (or none: an event with no fields); the event is a copy, changed afterwards on its own, and nothing
  links it to the template. An Admin makes and edits the templates, as the presentations', under Kalender's Mallar. While
  the organisation has none, Ny händelse offers Gudstjänst with Mötesledning, Predikan, Musik, Ljud and Bild, made on
  the device; no template is stored for a new organisation.
- **Who may see it outside the church**: one of Visas inte (only the organisation's members), Visas som upptagen (only
  the time and the place, with the template's word for it, "Uthyrd", or else "Upptagen": a room let out shows that it
  is taken, not to whom), and Visas (the title, the time, the place and the description). Fields are never shown outside
  the church. An event without a template is Visas inte. Step 1 stores it and offers it; nothing outside the church
  shows it until the public calendar is built.
- **Missing**: a field with nothing in it is a task that still needs someone, as Planning Center's and Elvanto's needed
  positions: Tabell shows its cell as "saknas", an event's page its row, and Lista "2 saknas" on the event's row. A
  field not needed is removed from the event, or holds "–".
- **The views**: Lista (a row per event by month, a date tile, the time and place, the first filled fields, how many
  are missing, the presentation button) and, from a tablet's width, Tabell (the window's width, up to 1600 px) (the sheet: date and time kept in view while it scrolls sideways, the title,
  the screen column, then a column per field name among the events shown, in the order they first come; a cell is
  edited in place, and greyed where the event has no field of that name, a click adding it). On a phone, Lista only.
  Past events behind "Tidigare händelser (n)", a quiet button where Lista or Tabell ends. An event's page: title, when, place, description, "Vem gör
  vad" (a row per field, edited in place, Lägg till uppgift at its foot), who may see it, and "På skärmen" (the link
  above).
- **Who may**: any member edits events and their fields, as in a shared sheet; an Admin edits the templates.
- **Sync and offline**: as everything else: the organisation's tables, mutators and views in `packages/core`.
- **Import**: a spreadsheet (xlsx or CSV; Google Sheets exported as either) with a header row: the first column is the
  date and time, the second the title, every other column a field, which an event gets where its cell is not empty. A
  cell is text, split on nothing; a cell that is exactly a member's full name is that person. Dates without a year
  ("Sö 4/1 kl 11") take the year that makes the weekday right, near the rows around them; a date without a weekday
  ("12-13/9") takes its neighbours' year. Read: "kl 11", "kl 11.00", "kl 15-18" (an end time),
  "Lö 3/1-Sö4/1 kl 11-11" and "12-13/9" (an end date). Anything else in the first column ("och 16", "pingst",
  "Sommarfest?") is kept in the description. A row with a date and nothing else is an event without a title. Imported
  events are Visas inte. Before anything is saved, the import shows how many events it read and the rows whose date it
  could not read, which it leaves out.

## Step 1

The calendar's tables (`events`, `event_fields`, schema 29; each dated presentation's event, schema 30), mutators and
views in the core, and `GET /api/people`; the start page as one list of events (Lista, Kalender, Tabell, "Med
presentation"), an event's page with its fields, persons and description, a person's view, the templates for an
Admin, who may see an event (stored and offered), a presentation with a date always an event's, and the import. Its row in
`docs/scenarios.md` and the e2e tests it names.

## Later

- **Mine in the calendar feed**: the events where a field holds a member as a person (the start page's Mina) in their
  calendar subscription (spec 01, "Calendar subscription"), whose feed then carries events, not only presentations.
  Text that happens to be their name does not count.
- **A public calendar**: a page and a feed a church links from its website, showing the events by who may see them.
- **An internal note**: text on an event that only the organisation's members see, never shown outside the church,
  beside the description that may be.
- **Repeating**: an event made again every week or every other week up to a date, as separate events changed one by one
  afterwards; no rule kept that edits all of them.
- **A month view** in Kalender, as the start page's.
- **Renting out rooms**: the church's rooms as a list rather than a place typed in, two events in one room at once shown,
  the tenant and how to reach them, perhaps a price.
- **A template's presentation**: an event template naming a presentation template, which Skapa presentation starts from.
- **Reminders** by e-mail a few days before (the server sends e-mail already: docs/sign-in-and-pairing.md, "E-mail"),
  to the persons in an event's fields.
- **Linking what exists**: offering to link an imported event and a presentation with the same date and time. Step 1
  links them only by hand.

## Left out

Availability and blocked-out dates, swapping a task with someone, scheduling people automatically, SMS, a person's
task history and counts, permissions per field, phone numbers, a register of people without accounts, and inviting
volunteers without accounts to sign in. A volunteer who only cleans or makes coffee needs no account: their name as
text in a field, and the calendar link or an e-mail from someone who has one.

## Open

- Whether an event's title comes from a short list of kinds (service, communion service, café) or is free text, as in
  the sheet. Step 1: free text, offering the titles written before; the templates give the common ones.
