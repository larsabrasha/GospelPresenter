# Det som saknas, kontrollerat mot koden (2026-10-31)

En arbetslista för Lars. Den bygger på `docs/not-done-yet.md` och raden i `docs/look.md` om sidor utan motsvarighet.
Varje punkt är kontrollerad mot koden. Video-arbetet som pågår räknas inte.

Markera varje rad:

- `[x]` bygg det nu
- `[s]` senare (blir kvar i not-done-yet.md)
- `[-]` stryk, ska inte göras
- tom ruta betyder senare

När du är klar uppdaterar jag `docs/not-done-yet.md` efter listan och bygger det du kryssat i.

## Listan är fel här: det finns redan

Dessa tar jag bort ur not-done-yet.md, om du inte säger emot.

- Bildspel som PDF (`SlidesTab.tsx`, testat i `slides.spec.ts`).
- Tid, plats, beskrivning och tema på en presentation (`PresentationDetailsDialog.tsx`).
- En malls tid och plats följer med till nya presentationer (testet kollar bara datumet).
- Kortkommandot `n` på startsidan (inget test trycker `n`).
- Mallsidan sorteras efter senast ändrad.
- Startsidan sorteras efter senast ändrad, och Idag/Kommande finns.
- Markera flera inslag och ta bort dem samtidigt (testat i `editor.spec.ts`).
- Släppa filer i Lägg till-dialogens flikar (inget e2e-test släpper filer där).
- Bilder på publika utgångar och skärmar via `/api/watch` (MEDIA-R10), men med en annan adress än specen.
- Temat syns i scenläget och på publika utgångar.
- Temats stil för bild-slides finns, och bild-slides finns.
- `/settings` (Mina inställningar) finns.

## Saknas: det märks för den som använder appen

- [x] Sånghistorik (SONG-R20–R24): tidigare versioner av en sång.
- [x] Etikettsidan: hantera Vers, Refräng och de andra etiketterna.
- [x] CCLI-rapport (bara sångens CCLI-fält finns).
- [x] Import från ProPresenter, även att släppa filer på Sånger.
- [s] Skapa och redigera teman (i dag bara de inbyggda).
- [s] Församlingens egna bilder som bakgrund i ett tema.
- [x] Engelska texter och byte av språk.
- [s] Välkomstrutan för nya.
- [s] Tangentbordet i mallväljaren (piltangenter).
- [s] Ordna om overlays.
- [s] Ett ljudinslag med flera filer.
- [x] Systemets egen fildialog för "Importera" i skrivbordsappen.

## Saknas: konton och administration

- [s] Profilbild, och att kunna redigera sin profil (i dag visas `/logins` som Min profil).
- [s] Församlingens logga.
- [s] Flera Google-konton per användare (spec: upp till 5).
- [x] En användare i flera organisationer.
- [x] Fler organisationer än den första, byte mellan dem, och superadminsidorna (organisationer, aktiva sessioner, inloggade just nu).
- [s] Se och logga ut sina egna enheter (D23).
- [s] `/admin/devices` som i specen: alla enheter med version (i dag bara värddatorns parkopplade enheter).
- [x] E-post (i dag är en ny inbjudningslänk enda sättet att återställa ett konto). Via Resend, som i pralinbutiken.
- [s] Passkey som fylls i automatiskt på inloggningssidan.
- [s] Inloggning med Googles kontoförslag och profilbild från Google.
- [s] När en passkey tas bort loggas dess sessioner ut.
- [s] Kontroll av vilken enhet som skapade en passkey (attestation).
- [s] MCP-nycklar och kalenderflöde (står redan i TODO.md).
- [-] Andra inloggningar än Google och passkey (inte planerat, ADR 0007).

## Saknas: för att komma ut på riktigt

- [s] Paketera skrivbordsappen med installerare, så att länktypen registreras och Googles klient följer med.
- [s] Riktig drift på Cloudflare (bara en provinstallation 2026-10-28).
- [s] Capacitor-appen (webblayouten för telefon finns och är testad).
- [s] S3-lagring för media (D31).
- [s] Gå bakom en omvänd proxy (`X-Forwarded-Proto` och `X-Forwarded-Host`).

## Saknas: tekniska kanter

- [s] Tak för hur mycket media en organisation får lagra totalt.
- [s] Cachen rensas efter senast använd, inte efter när filen kom (MEDIA-R14).
- [s] Range-anrop för ljud (video får det nu).
- [s] Säga till när en ny version av appen väntar.
- [s] En äldre sparad version av appen mot en databas som en nyare version redan har migrerat.
- [s] En gammal `/display`-sida känner inte till nya händelser och laddas inte om av sig själv.
- [s] Stäng anslutningen för push-meddelanden när en session dras tillbaka.
- [s] En långsam tittare på en publik utgång får bara det senaste, inte allt i tur och ordning.
- [s] Publika utgångar på mottagarens språk (Accept-Language).
- [s] Overlay-bilden på publika utgångar (i dag bara texten).
- [s] En borttagen overlay ligger kvar på utgångarna tills den slås av, som specen säger (i dag försvinner den direkt).
- [x] En sparad skärm visar sitt namn när sessionen gått ut (i dag svart, LIVE-R50).
- [x] Släpp en skärm som varit stilla i 4 timmar (LIVE-R43).
- [x] Avsluta fjärrstyrning som varit stilla i 4 timmar (LIVE-R42; i dag bara efter 2 timmar utan ägare).
- [s] Sessionen följer enheten, inte fönstret (i dag får en omstartad dator en ny session).
- [s] Två operatörsfönster på samma dator blir två egna sessioner (i dag delar de pekare).
- [s] Två översättningar med samma text visas som två (i dag syns båda som "Tillgänglig offline").
- [-] Biblar som bara finns på en enhet (BIBLE-R16; borttaget genom beslut D30).

## Saknas: tester

- [s] Bildflödet i Safari (JPEG på vit bakgrund är skrivet men aldrig kört).
- [s] Taket på 500 tittare per publik utgång.
- [s] Varningen efter 2 sekunder vid fjärrstyrning.
- [s] Att skärmen hålls vaken (wake lock) i scenläget.
- [s] Overlay-bilden ritad på en utgång i ett e2e-test.
- [s] En mall i capture-skriptets bilder.

## Oklart: går inte att avgöra i koden

Blir kvar som de står, tills någon provar på riktigt.

- Om Safari låter service workern svara på databasens hämtning av wasm-filen.
- Service workern på Cloudflare, provad i en webbläsare.
- `/watch` och `/display` på Cloudflare, öppnade i en webbläsare.
- Om Cloudflare märker att en ström stängts (lokal workerd gör det inte).
- En riktig TV:s webbläsare.
- Att en Durable Object med öppna strömmar aldrig går i viloläge (enligt design).
