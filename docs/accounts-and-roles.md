# Accounts and roles

Who owns an account, what an organisation's Admin may do with it, and what the server's Superadmins may do. Proposed
and approved by Lars on 2026-11-08, and built the same day (global schema 10, spec README D33). How the routes run is
in [sign-in-and-pairing.md](sign-in-and-pairing.md); the policy is `accountRefusal`, `roleChangeRefusal` and
`removeUserRefusal` in `packages/core/src/accounts.ts`.

## Why

An account is the server's: one person, one account, in as many organisations as they are members of. Until
2026-11-08 an Admin of one organisation could change the account itself, its e-mail address and its logins, and reset
it with an invite, checked only against the person's role in the Admin's own organisation. Organisation authority
changed server-wide identity. Four ways to take over someone else's account followed from that, found on 2026-11-08;
the first three were shown over HTTP in throwaway tests, the fourth was read in the code only. Each is now a test that
stays (`auth.test.ts`, "taking over someone else's account"; `host-auth.test.ts` for pairing):

1. **An invite.** Eve, Admin of another organisation, adds Anna's address as a plain user there (an existing account
   becomes a member at once, decided on 2026-10-31), makes her an invite, and accepts it with a Google account of
   her own: the invite replaces Anna's logins and ends her sessions. Anna was the SuperAdmin.
2. **The e-mail address.** Eve changes Anna's address to her own, then asks "Glömt hur du loggar in?": the new
   invite is mailed to Eve (on a server that sends mail; not tried).
3. **The 1.x user import.** Eve posts `/api/import/users` with Anna's address and her own Google id: the id is
   linked to Anna's account, and Eve signs in as Anna. Anna's logins and sessions stay; nothing shows.
4. **Pairing as someone else**, on a desktop host: a code that signs a device in as Anna, then `/api/auth/switch`
   to any of Anna's organisations.

An Admin could also remove another user's logins (D21), which locked them out of every organisation, and adding an
address told whether it had an account, and the person's name.

## How it is usually done

Two levels, kept apart. **Organisation roles** count inside one organisation (GitHub's owner and member, Slack's
owner, admin and member, GitLab's owner, maintainer and developer); the owner is protected from the other admins.
**The server's administrators** are a mark on the account, not a membership, in software one runs oneself (GitHub
Enterprise Server's site admin, GitLab's Administrator, Mattermost's System Admin); hosted services keep their staff
out of the product. Their actions ask for a fresh sign-in (GitLab's admin mode, GitHub's sudo mode) and are
logged. The account is the person's: an organisation invites an address, the person accepts with an account they
have or one they make, enters their own name, confirms their address by the link that reached it, changes their
address themselves (confirmed at the new one), and gets back in through it.

## The model

**The account is the person's.** Their name, e-mail address and logins are changed by them alone, under Mina
inställningar, or by a Superadmin. No organisation role reaches them.

**An invite is a pending membership of an address**, not a user. Användare → Bjud in takes an address and a role;
the list shows the person as Inbjuden until they accept. The link goes by mail where the server sends mail, or is
copied (a desktop host). The person opening it signs in with an account they have, which gains the membership and
nothing else, or makes one: their name, then a passkey or Google. Accepting an invite never replaces a login and
never ends a session. An existing account is never made a member without accepting.

**A confirmed address.** The address counts as confirmed when the link reached it by mail, or Google vouches for
the same address; otherwise (a copied link) it is unconfirmed until the person confirms it from Mina inställningar.
Where the server mails, the invitation's link therefore goes only by mail and is never answered to the Admin, who
could otherwise open it with an account of their own and claim the address as confirmed.
A new address is confirmed by a link to it before it replaces the old one. The addresses already here are not asked again
(Lars, 2026-11-08): one Google vouches for counts as confirmed, the rest are marked unconfirmed, with a reminder
under Mina inställningar and no demand. "Glömt hur du loggar in?" mails only a
confirmed address, and what it mails is a recovery link that replaces the person's logins, as an invite does today.

**An address is unique, and no one learns whose it is.** Only confirmed addresses are unique: a unique index on
the confirmed ones, checked again when the confirming link is opened, so that two at once cannot both win; an
unconfirmed address may be on more than one account until one confirms it. The one who asks always gets the same
answer, and only the mail to the address differs:

- An invite is always made, to the address as typed; the list shows that address as Inbjuden, never the name of an
  account that has it. The Admin sees the person's name when they accept.
- Changing one's address always answers that a link was sent. When the address is someone else's, the mail holds no
  confirming link but says that someone tried to use it, and how to sign in.
- "Glömt hur du loggar in?" answers as today, the same either way, and mails after answering.

The three answer before they mail, so their time tells nothing either, and each counts against the asking address
and the e-mail address (five an hour each, as recovery does today). Google vouching for an address does not confirm
it when another account has it confirmed. A Superadmin sees everything.

**Organisation roles: Användare and Admin**, no Ägare (Lars, 2026-11-08: fewer things to know). An Admin invites,
sets roles and removes memberships in their organisation; the Admins are equals, and when they disagree a Superadmin
puts it right. An organisation always has at least one Admin: the last one cannot be removed or made a user, by
themselves or another (no such rule was found in the code on 2026-11-08). An owner above the Admins, as Slack's
primary owner, waits until there is billing or one person must answer for a church. The SuperAdmin of today's home
organisation is an Admin there.

**Superadmin: a mark on the account**, not a membership role (the name kept, Lars 2026-11-08). A Superadmin may do everything (Lars, 2026-11-08): every
organisation, any person's name, address and logins, an account reset, a member added at once, Google ids linked by
an import, organisations made and deleted, the monitoring page. Each change to someone else's identity is logged:
who, what, whom and when. No one but a Superadmin touches a Superadmin's account. On a cloud server the Superadmins are
named in its configuration, a list of addresses, so that a database or an app session alone cannot make one
(Lars, 2026-11-08); on a desktop host the person who ran setup is one.

**Superadminläge**, as GitLab's admin mode (Lars, 2026-11-08). Day to day a Superadmin acts as what they are in their own
organisation, with no more. Their powers wait behind superadminläge, which a fresh sign-in turns on (a passkey or Google,
made by them, not by a pairing) for one hour, after which it turns itself off; signing out ends it too. While it is
on, a coloured line at the top says so, with a button to end it. Everything only a Superadmin may do asks for it:
seeing and entering other organisations, the monitoring page, other people's names, addresses and logins, account
resets, and making and deleting organisations. A stolen session, or a computer left signed in, cannot do them, and
a Superadmin does not change another church by mistake.

**A fresh sign-in for an Admin**, only for what is hard to undo or hands out power: making someone Admin (a role
change or an invitation as Admin). A sign-in from the last 10 minutes, made by them (the rule for adding a login).
Deleting an organisation is a Superadmin's alone, so superadminläge's own fresh sign-in covers it.
Everything else an Admin does (invites, removing a member, the songs, the presentations, the outputs) asks for
nothing more. A paired device, such as the image computer, cannot give one; those things are done from one's own
phone or computer.

**The desktop host**, which sends no mail, and where only the host's own window signs in, so an invitation could not
be accepted from another device: an Admin makes people there (Användare → Skapa: a name, maybe an unconfirmed
address, a role), and may reset (a new link that replaces the logins) or pair a device as a person whose only
membership is the host's organisation and who is no Superadmin; anyone else asks a Superadmin.

**The 1.x import** makes invitations for the users it brings, valid for 90 days, not accounts with linked Google ids.
A Google id from the zip is kept on the invitation, and signing in with that Google account, with or without the link,
makes the account and accepts it. A Superadmin's import still links them at once, and is logged; only to an account it
makes, never to one that exists, whose address may be unconfirmed and which is the person's (the review, 2026-11-09). An
Admin's import of users needs a fresh sign-in, never a paired device, as making an Admin does: its invitations may make
Admins and carry Google ids, so a stolen session could otherwise leave an account of its own behind. A Superadmin's
membership is removed only by a Superadmin, as removing someone's only membership deletes their account.

## What it replaced

The decision of 2026-10-31 that an existing account becomes a member at once; D21 (an Admin changes a user's
logins) and D20's "an Admin touches no SuperAdmin's", both replaced by the account being the person's; AUTH-R1's
invite as a reset, now only a reset link; the `superAdmin` membership role, now the mark and an Admin membership
(migration 10); on the users page the name, e-mail and login fields for others; Mina inställningar gained the name, the
address and confirming it.

## Not built, or built differently

- The Superadmins' log (`audit_log`) is written, but nothing shows it yet.
- A fresh sign-in is asked for by "Logga ut och logga in igen", not by a sign-in in place.
- gp-test names no Superadmins in its configuration: it has neither Google nor mail, so no address there can be
  confirmed, and the mark setup gave counts, as on a desktop host.
- An invitation and a confirming link were tested on Node and the Worker's adapters and in the server's tests; no
  e2e test runs them, since every e2e test runs a desktop host, which makes people instead.
