-- One organisation of 1.x with a row of every kind the export moves, and a second organisation it must not
-- touch. Loaded on top of schema-1x.sql (`dotnet ef migrations script`, with one missing semicolon added).
INSERT INTO "Organizations" ("Id", "Name") VALUES ('org-1', 'Testkyrkan'), ('org-2', 'Grannkyrkan');
-- The built-in themes, as 1.x's BuiltInThemeSeeder writes them at start (no organisation, no name).
INSERT INTO "Themes" ("Id", "OrganizationId", "Name", "SortOrder", "Definition") VALUES
  ('classic', NULL, '', 0, '{}'), ('midnight', NULL, '', 1, '{}'), ('daylight', NULL, '', 2, '{}'), ('aurora', NULL, '', 3, '{}');

INSERT INTO "Users" ("Id", "Name", "Email", "ProfileImageRemoved", "Role", "OrganizationId") VALUES
  ('u-admin', 'Anna Admin', 'Anna@Example.com', false, 'Admin', 'org-1'),
  ('u-user', '', 'bo@example.com', false, 'User', 'org-1'),
  ('u-other', 'Other', 'other@example.com', false, 'Admin', 'org-2');
INSERT INTO "UserLogins" ("Id", "Provider", "ProviderSubjectId", "UserId") VALUES
  ('l-1', 'google', 'google-sub-anna', 'u-admin'),
  ('l-2', 'mock', 'mock-bo', 'u-user');

INSERT INTO "SongPartLabels" ("Id", "Text", "Color", "SortOrder", "OrganizationId") VALUES
  ('lab-v1', 'Vers 1', '#ff0000', 0, 'org-1'),
  ('lab-ref', 'Refräng', '#00ff00', 1, 'org-1'),
  ('lab-ref2', ' refräng ', '#0000ff', 2, 'org-1');

INSERT INTO "Songs" ("Id", "Name", "Author", "Publisher", "Year", "Ccli", "OrganizationId", "DeletedAt") VALUES
  ('song-1', 'Bred dina vida vingar', 'Lina Sandell', 'Förlaget', 1865, '123456', 'org-1', NULL),
  ('song-2', 'Borttagen sång', NULL, NULL, NULL, NULL, 'org-1', '2026-10-20 10:00:00+00'),
  ('song-x', 'Grannens sång', NULL, NULL, NULL, NULL, 'org-2', NULL);
INSERT INTO "SongParts" ("Id", "Content", "SortOrder", "SongId", "LabelId") VALUES
  ('p-1', E'Bred dina vida vingar,\no Jesus, över mig', 3, 'song-1', 'lab-v1'),
  ('p-2', E'Refräng här', 7, 'song-1', 'lab-ref2'),
  ('p-3', 'Ensam del', 0, 'song-2', NULL);
INSERT INTO "SongArrangements" ("Id", "Name", "PartIdsJson", "SongId") VALUES
  ('arr-1', NULL, '["p-1","p-2","p-1","p-gone"]', 'song-1'),
  ('arr-2', 'Kort', '["p-2"]', 'song-1');
INSERT INTO "SongVersions" ("Id", "SongId", "CreatedAt", "Name", "Author", "PartsJson") VALUES
  ('ver-1', 'song-1', '2026-09-01 08:00:00+00', 'Bred dina vingar', 'L. Sandell',
   '[{"Id":"p-1","LabelId":"lab-v1","LabelText":"Vers 1","LabelColor":"#ff0000","Content":"Gammal text"}]');

INSERT INTO "Presentations" ("Id", "Name", "CreatedAt", "CreatedBy", "UpdatedAt", "UpdatedBy", "OrganizationId", "IsTemplate", "EventDate", "EventTime", "EventLocation", "ThemeId", "Description") VALUES
  ('pres-1', 'Gudstjänst', '2026-10-01 08:00:00+00', 'u-admin', '2026-10-02 09:30:00+00', 'u-admin', 'org-1', false, '2026-11-08', '11:00:00', 'Kyrkan', 'midnight', 'Söndag');
INSERT INTO "Presentations" ("Id", "Name", "CreatedAt", "CreatedBy", "UpdatedAt", "UpdatedBy", "OrganizationId", "IsTemplate", "ScheduledDayOfWeek", "ScheduledTime", "LastUsedAt", "ThemeId") VALUES
  ('tmpl-1', 'Söndagsmall', '2026-01-01 08:00:00+00', 'u-admin', '2026-01-01 08:00:00+00', 'u-admin', 'org-1', true, 0, '10:30:00', '2026-10-01 08:00:00+00', 'aurora');

INSERT INTO "PresentationItems" ("Id", "SourceId", "Type", "Title", "SortOrder", "PresentationId", "ArrangementId") VALUES
  ('it-song', 'song-1', 0, 'Bred dina vida vingar', 4, 'pres-1', 'arr-2'),
  ('it-bible', NULL, 1, 'Johannes 3:16-17', 5, 'pres-1', NULL),
  ('it-image', 'img-1', 2, 'Välkommen', 6, 'pres-1', NULL),
  ('it-audio', 'aud-1', 3, 'Förspel', 7, 'pres-1', NULL),
  ('it-slides', 'deck-1', 4, 'Predikan.pdf', 8, 'pres-1', NULL),
  ('it-gone', 'song-purged', 0, 'Rensad sång', 9, 'pres-1', NULL),
  ('it-tmpl', 'song-1', 0, 'Bred dina vida vingar', 0, 'tmpl-1', 'arr-x');
INSERT INTO "PresentationItemParts" ("Id", "Content", "SortOrder", "PresentationItemId") VALUES
  ('ip-1', '<div class="text-left"><sup class="opacity-40">16</sup>' || chr(160) || 'Ty så &amp; älskade Gud <sup class="opacity-40">17</sup>' || chr(160) || 'Gud sände</div>', 0, 'it-bible'),
  ('ip-2', '<div class="text-left">inte sin Son</div>', 1, 'it-bible'),
  ('ip-3', '1', 0, 'it-slides'),
  ('ip-4', '0', 1, 'it-slides');
INSERT INTO "PresentationSlides" ("Id", "FileName", "PageCount", "CreatedAt", "PresentationId") VALUES
  ('deck-1', 'Predikan.pdf', 2, '2026-10-01 08:00:00+00', 'pres-1');

INSERT INTO "Bibles" ("Id", "Name", "Abbreviation", "VersesJson", "VerseCount", "OrganizationId") VALUES
  ('bib-1', 'Svenska 1917', 'SV1917', '[{"b":"JHN","c":3,"v":17,"t":"Gud sände"},{"b":"GEN","c":1,"v":1,"t":"I begynnelsen"},{"b":"JHN","c":3,"v":16,"t":"Ty så älskade"}]', 3, 'org-1');

INSERT INTO "OrganizationImages" ("Id", "FileName", "ContentType", "CreatedAt", "OrganizationId", "DeletedAt") VALUES
  ('img-1', 'valkommen.png', 'image/png', '2026-05-01 08:00:00+00', 'org-1', NULL),
  ('img-2', 'gammal.jpg', 'image/jpeg', '2026-05-02 08:00:00+00', 'org-1', '2026-10-30 08:00:00+00'),
  ('img-lost', 'borta.jpg', 'image/jpeg', '2026-05-03 08:00:00+00', 'org-1', NULL);
INSERT INTO "OrganizationAudios" ("Id", "FileName", "ContentType", "CreatedAt", "OrganizationId") VALUES
  ('aud-1', 'forspel.mp3', 'audio/mpeg', '2026-05-01 08:00:00+00', 'org-1');
INSERT INTO "OverlaySlides" ("Id", "Title", "Content", "SortOrder", "OrganizationId", "HasImage") VALUES
  ('ov-1', 'Kollekt', 'Swish 123', 5, 'org-1', true),
  ('ov-2', 'Text', 'Bara text', 9, 'org-1', false);
INSERT INTO "RemoteDisplays" ("Id", "OrganizationId", "DisplayIdentifier", "Name", "CreatedAt", "Kind") VALUES
  ('disp-1', 'org-1', 'abcdefg', 'Foajén', '2026-04-01 08:00:00+00', 0),
  ('disp-2', 'org-1', 'hjkmnpq', 'Mobilerna', '2026-04-02 08:00:00+00', 1);
INSERT INTO "OrganizationSettings" ("Id", "OrganizationId", "Key", "Value") VALUES
  ('set-1', 'org-1', 'DefaultThemeId', 'daylight'),
  ('set-2', 'org-1', 'CcliCollectionEnabled', 'True');
INSERT INTO "CcliReportEntries" ("Id", "OrganizationId", "SongId", "SongName", "CcliNumber", "Date", "CreatedAt", "Reported", "ReportedAt", "PresentationId", "PresentationName") VALUES
  ('c-1', 'org-1', 'song-1', 'Bred dina vida vingar', '123456', '2026-10-04', '2026-10-04 10:00:00+00', false, NULL, 'pres-1', 'Gudstjänst'),
  ('c-2', 'org-1', 'song-1', 'Bred dina vida vingar', '123456', '2026-10-11', '2026-10-11 10:05:00+00', true, '2026-10-10 12:00:00+00', 'pres-1', 'Gudstjänst'),
  ('c-3', 'org-1', 'song-1', 'Bred dina vida vingar', '123456', '2026-09-27', '2026-09-27 10:00:00+00', false, NULL, NULL, '');
