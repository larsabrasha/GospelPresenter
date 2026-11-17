# Planning: who does what at each gathering

Not built. A future feature, written in the Rust core first (`docs/rust-core.md`). Lars, 2026-11-17:
the church plans every gathering in a shared Google spreadsheet, and the app should take its place. It is not an app of
its own ("Gospel Planner" was weighed): the people who plan are the people who make the running orders, and accounts,
roles, sync and offline are already here; a second app would be a second thing to install and keep in step. It is
held to the app's aim: simple, for small churches, not Planning Center.

## What the spreadsheet shows

The church's sheet (December to August, about 45 rows, kept out of the repository: it names members) is a row per
gathering and a column per task: date and time, gathering (its title), meeting leader, sermon, music, intercessors,
sound, pictures (the ones who run this app), other (a note), and the children's group. Most rows are Sunday services at
11; others are a café every other Friday 15–18, a day of prayer across two days, a seminar at 14 and 16, the annual
meeting and a summer party, several with no tasks filled in. What it tells the design:

- **A cell is text, not a person.** It holds couples ("A and B"), short names (initials, a first name and a
  letter), a group's initials, "and others", and notes ("plays the hymns"). Requiring an account, or one person, per cell would make it harder than
  the sheet.
- **The tasks are the church's own.** Another church has no children's group called that, and has a coffee rota.
- **Times are looser than a date.** A range, two times on one day, two days.
- **Not every gathering has a running order.** A café or a day of prayer has none; a service has one.

## The design

- **A gathering**: a date, a start time, an end time and an end date when there are any, a title, a note, and its
  task cells. A running order (a presentation) may be linked to it, never required. A gathering with a presentation
  shows a link to it; one without offers "Skapa körordning", making a presentation with the gathering's title and date.
- **Tasks**: the organisation's list of columns, named and ordered by an Admin; a new organisation starts with a short
  default list. A column removed keeps its old cells hidden, not deleted.
- **Cells**: free text, offering the names written before in that column. Nothing checks a name.
- **Mine**: a person names the texts that are them (their name, their short name), and sees the gatherings where a cell
  holds one of them, and gets them in the calendar subscription (spec 01, "Calendar subscription"), whose feed then
  carries gatherings, not only presentations.
- **Repeating**: a gathering made again every week or every other week up to a date, as separate gatherings changed
  one by one afterwards; no rule kept that edits all of them.
- **The page**: Planering, a table like the sheet, a row per coming gathering and a column per task, edited in place;
  on a phone, a list of gatherings, a gathering's tasks below it. Past gatherings behind a "Tidigare".
- **Who may**: any member edits, as in a shared sheet; an Admin edits the list of tasks.
- **Sync and offline**: as everything else, mutators in the core and the organisation's tables.
- **Import**: a spreadsheet (xlsx or CSV, Google Sheets exported as either) with a header row: the header gives the
  tasks, the first two columns the time and the title. Dates without a year ("Sö 4/1 kl 11") take the year that makes
  the weekday right; times as "kl 11", "kl 15-18" and "kl 14 och 16" are read, anything else kept in the note.

## Left out

Availability and blocked-out dates, swapping a task with someone, scheduling people automatically, SMS, a person's
task history and counts, permissions per task, and inviting volunteers without accounts to sign in. A volunteer who
only cleans or makes coffee needs no account: their name in a cell, and the calendar link or an e-mail from someone
who has one.

## Open

- Reminders by e-mail a few days before (the server sends e-mail already: docs/sign-in-and-pairing.md, "E-mail"): to
  whom, when the cells hold text rather than addresses.
- Where Planering sits in 2.0's layout (`docs/layout-2-0.md`): beside the presentations on the start page, or one of
  them.
- Whether a gathering's title comes from a short list of kinds (service, communion service, café) or is free text,
  as in the sheet.
