-- 1.x's PostgreSQL schema as `dotnet ef migrations script -p GospelPresenter.Shared -s GospelPresenter.MigrationService`
-- wrote it on 2026-11-03, with the semicolon a raw SQL migration (AddOverlayHasImage) leaves out added.
CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;
CREATE TABLE "Organizations" (
    "Id" text NOT NULL,
    "Name" text NOT NULL,
    "LogoSmall" text,
    CONSTRAINT "PK_Organizations" PRIMARY KEY ("Id")
);

CREATE TABLE "OrganizationImages" (
    "Id" text NOT NULL,
    "FileName" text NOT NULL,
    "ThumbnailData" bytea NOT NULL,
    "FullData" bytea NOT NULL,
    "ContentType" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_OrganizationImages" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OrganizationImages_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE TABLE "OverlaySlides" (
    "Id" text NOT NULL,
    "Title" text NOT NULL,
    "Content" text,
    "ImageData" bytea,
    "SortOrder" integer NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_OverlaySlides" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OverlaySlides_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Presentations" (
    "Id" text NOT NULL,
    "Name" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "CreatedBy" text NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "UpdatedBy" text NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_Presentations" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_Presentations_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Songs" (
    "Id" text NOT NULL,
    "Name" text NOT NULL,
    "Author" text,
    "Publisher" text,
    "Year" integer,
    "Ccli" text,
    "DeletedAt" timestamp with time zone,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_Songs" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_Songs_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Users" (
    "Id" text NOT NULL,
    "Name" text NOT NULL,
    "Email" text NOT NULL,
    "ProfileImage" text,
    "ProfileImageSmall" text,
    "ProfileImageRemoved" boolean NOT NULL,
    "Role" text NOT NULL,
    "OrganizationId" text,
    CONSTRAINT "PK_Users" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_Users_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id")
);

CREATE TABLE "PresentationItems" (
    "Id" text NOT NULL,
    "SourceId" text,
    "Type" integer NOT NULL,
    "Title" text NOT NULL,
    "SortOrder" integer NOT NULL,
    "ImageData" bytea,
    "PresentationId" text NOT NULL,
    CONSTRAINT "PK_PresentationItems" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_PresentationItems_Presentations_PresentationId" FOREIGN KEY ("PresentationId") REFERENCES "Presentations" ("Id") ON DELETE CASCADE
);

CREATE TABLE "SongParts" (
    "Id" text NOT NULL,
    "Label" text,
    "Content" text NOT NULL,
    "SortOrder" integer NOT NULL,
    "SongId" text NOT NULL,
    CONSTRAINT "PK_SongParts" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_SongParts_Songs_SongId" FOREIGN KEY ("SongId") REFERENCES "Songs" ("Id") ON DELETE CASCADE
);

CREATE TABLE "SongVersions" (
    "Id" text NOT NULL,
    "SongId" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "Name" text NOT NULL,
    "Author" text,
    "PartsJson" text NOT NULL,
    CONSTRAINT "PK_SongVersions" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_SongVersions_Songs_SongId" FOREIGN KEY ("SongId") REFERENCES "Songs" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Invites" (
    "Id" text NOT NULL,
    "Token" text NOT NULL,
    "UserId" text NOT NULL,
    "Used" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "ExpiresAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Invites" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_Invites_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);

CREATE TABLE "UserLogins" (
    "Id" text NOT NULL,
    "Provider" text NOT NULL,
    "ProviderSubjectId" text NOT NULL,
    "UserId" text NOT NULL,
    CONSTRAINT "PK_UserLogins" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_UserLogins_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);

CREATE TABLE "UserSettings" (
    "Id" text NOT NULL,
    "UserId" text NOT NULL,
    "Key" text NOT NULL,
    "Value" text NOT NULL,
    CONSTRAINT "PK_UserSettings" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_UserSettings_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);

CREATE TABLE "PresentationItemParts" (
    "Id" text NOT NULL,
    "Content" text NOT NULL,
    "SortOrder" integer NOT NULL,
    "PresentationItemId" text NOT NULL,
    CONSTRAINT "PK_PresentationItemParts" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_PresentationItemParts_PresentationItems_PresentationItemId" FOREIGN KEY ("PresentationItemId") REFERENCES "PresentationItems" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_Invites_Token" ON "Invites" ("Token");

CREATE INDEX "IX_Invites_UserId" ON "Invites" ("UserId");

CREATE INDEX "IX_OrganizationImages_OrganizationId" ON "OrganizationImages" ("OrganizationId");

CREATE INDEX "IX_OverlaySlides_OrganizationId" ON "OverlaySlides" ("OrganizationId");

CREATE INDEX "IX_PresentationItemParts_PresentationItemId" ON "PresentationItemParts" ("PresentationItemId");

CREATE INDEX "IX_PresentationItems_PresentationId" ON "PresentationItems" ("PresentationId");

CREATE INDEX "IX_Presentations_OrganizationId" ON "Presentations" ("OrganizationId");

CREATE INDEX "IX_SongParts_SongId" ON "SongParts" ("SongId");

CREATE INDEX "IX_Songs_OrganizationId" ON "Songs" ("OrganizationId");

CREATE INDEX "IX_SongVersions_SongId" ON "SongVersions" ("SongId");

CREATE UNIQUE INDEX "IX_UserLogins_Provider_ProviderSubjectId" ON "UserLogins" ("Provider", "ProviderSubjectId");

CREATE INDEX "IX_UserLogins_UserId" ON "UserLogins" ("UserId");

CREATE UNIQUE INDEX "IX_Users_Email" ON "Users" ("Email");

CREATE INDEX "IX_Users_OrganizationId" ON "Users" ("OrganizationId");

CREATE UNIQUE INDEX "IX_UserSettings_UserId_Key" ON "UserSettings" ("UserId", "Key");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260314212909_InitialCreate', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "OverlaySlides" ADD "HasImage" boolean NOT NULL DEFAULT FALSE;

UPDATE "OverlaySlides" SET "HasImage" = true WHERE "ImageData" IS NOT NULL;

ALTER TABLE "PresentationItems" DROP COLUMN "ImageData";

ALTER TABLE "OverlaySlides" DROP COLUMN "ImageData";

ALTER TABLE "OrganizationImages" DROP COLUMN "FullData";

ALTER TABLE "OrganizationImages" DROP COLUMN "ThumbnailData";

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260322063006_MoveImageDataToS3', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "McpApiKeys" (
    "Id" text NOT NULL,
    "Key" text NOT NULL,
    "Name" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UserId" text NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_McpApiKeys" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_McpApiKeys_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_McpApiKeys_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_McpApiKeys_Key" ON "McpApiKeys" ("Key");

CREATE INDEX "IX_McpApiKeys_OrganizationId" ON "McpApiKeys" ("OrganizationId");

CREATE INDEX "IX_McpApiKeys_UserId" ON "McpApiKeys" ("UserId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260327153109_AddMcpApiKeys', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "McpApiKeys" RENAME COLUMN "Key" TO "KeyHash";

ALTER INDEX "IX_McpApiKeys_Key" RENAME TO "IX_McpApiKeys_KeyHash";

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260328084302_HashApiKeys', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "Presentations" ADD "Description" text;

ALTER TABLE "Presentations" ADD "IsTemplate" boolean NOT NULL DEFAULT FALSE;

ALTER TABLE "Presentations" ADD "LastUsedAt" timestamp with time zone;

ALTER TABLE "Presentations" ADD "UseCount" integer NOT NULL DEFAULT 0;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260328094632_AddTemplateFields', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "OrganizationAudios" (
    "Id" text NOT NULL,
    "FileName" text NOT NULL,
    "ContentType" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_OrganizationAudios" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OrganizationAudios_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_OrganizationAudios_OrganizationId" ON "OrganizationAudios" ("OrganizationId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260328214448_AddOrganizationAudios', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "OrganizationSettings" (
    "Id" text NOT NULL,
    "OrganizationId" text NOT NULL,
    "Key" text NOT NULL,
    "Value" text NOT NULL,
    CONSTRAINT "PK_OrganizationSettings" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OrganizationSettings_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_OrganizationSettings_OrganizationId_Key" ON "OrganizationSettings" ("OrganizationId", "Key");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260329082949_AddOrganizationSettings', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "Presentations" ADD "ScheduledDayOfWeek" integer;

ALTER TABLE "Presentations" ADD "ScheduledTime" time without time zone;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260403181041_AddTemplateSchedule', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "Presentations" ADD "EventDate" date;

ALTER TABLE "Presentations" ADD "EventLocation" text;

ALTER TABLE "Presentations" ADD "EventTime" time without time zone;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260403192053_AddPresentationEventFields', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "UserSettings" ALTER COLUMN "Value" TYPE character varying(1000);

ALTER TABLE "UserSettings" ALTER COLUMN "Key" TYPE character varying(200);

ALTER TABLE "Users" ALTER COLUMN "Name" TYPE character varying(200);

ALTER TABLE "Users" ALTER COLUMN "Email" TYPE character varying(320);

ALTER TABLE "SongVersions" ALTER COLUMN "PartsJson" TYPE character varying(50000);

ALTER TABLE "SongVersions" ALTER COLUMN "Name" TYPE character varying(200);

ALTER TABLE "SongVersions" ALTER COLUMN "Author" TYPE character varying(200);

ALTER TABLE "Songs" ALTER COLUMN "Publisher" TYPE character varying(200);

ALTER TABLE "Songs" ALTER COLUMN "Name" TYPE character varying(200);

ALTER TABLE "Songs" ALTER COLUMN "Ccli" TYPE character varying(20);

ALTER TABLE "Songs" ALTER COLUMN "Author" TYPE character varying(200);

ALTER TABLE "SongParts" ALTER COLUMN "Label" TYPE character varying(50);

ALTER TABLE "SongParts" ALTER COLUMN "Content" TYPE character varying(5000);

ALTER TABLE "Presentations" ALTER COLUMN "Name" TYPE character varying(200);

ALTER TABLE "Presentations" ALTER COLUMN "EventLocation" TYPE character varying(100);

ALTER TABLE "Presentations" ALTER COLUMN "Description" TYPE character varying(500);

ALTER TABLE "PresentationItems" ALTER COLUMN "Title" TYPE character varying(200);

ALTER TABLE "PresentationItemParts" ALTER COLUMN "Content" TYPE character varying(5000);

ALTER TABLE "OverlaySlides" ALTER COLUMN "Title" TYPE character varying(200);

ALTER TABLE "OverlaySlides" ALTER COLUMN "Content" TYPE character varying(2000);

ALTER TABLE "OrganizationSettings" ALTER COLUMN "Value" TYPE character varying(1000);

ALTER TABLE "OrganizationSettings" ALTER COLUMN "Key" TYPE character varying(200);

ALTER TABLE "Organizations" ALTER COLUMN "Name" TYPE character varying(200);

ALTER TABLE "OrganizationImages" ALTER COLUMN "FileName" TYPE character varying(200);

ALTER TABLE "OrganizationAudios" ALTER COLUMN "FileName" TYPE character varying(200);

ALTER TABLE "McpApiKeys" ALTER COLUMN "Name" TYPE character varying(200);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260403221150_AddTextLengthConstraints', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "CcliReportEntries" (
    "Id" text NOT NULL,
    "OrganizationId" text NOT NULL,
    "SongId" text NOT NULL,
    "SongName" character varying(200) NOT NULL,
    "CcliNumber" character varying(20) NOT NULL,
    "Date" date NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "Reported" boolean NOT NULL,
    "ReportedAt" timestamp with time zone,
    CONSTRAINT "PK_CcliReportEntries" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_CcliReportEntries_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_CcliReportEntries_OrganizationId_SongId_Date" ON "CcliReportEntries" ("OrganizationId", "SongId", "Date");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260406161312_AddCcliReportEntries', '10.0.1');

COMMIT;

START TRANSACTION;
DROP INDEX "IX_CcliReportEntries_OrganizationId_SongId_Date";

ALTER TABLE "CcliReportEntries" ADD "PresentationId" text;

ALTER TABLE "CcliReportEntries" ADD "PresentationName" character varying(200) NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "IX_CcliReportEntries_OrganizationId_SongId_Date_PresentationId" ON "CcliReportEntries" ("OrganizationId", "SongId", "Date", "PresentationId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260406181851_AddCcliReportPresentationFields', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "RemoteDisplays" (
    "Id" text NOT NULL,
    "OrganizationId" text NOT NULL,
    "DisplayIdentifier" character varying(200) NOT NULL,
    "Name" character varying(200) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_RemoteDisplays" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_RemoteDisplays_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_RemoteDisplays_OrganizationId_DisplayIdentifier" ON "RemoteDisplays" ("OrganizationId", "DisplayIdentifier");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260407133924_AddRemoteDisplays', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "Bibles" (
    "Id" text NOT NULL,
    "Name" character varying(200) NOT NULL,
    "Abbreviation" character varying(50) NOT NULL,
    "VersesJson" text NOT NULL,
    "VerseCount" integer NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_Bibles" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_Bibles_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_Bibles_OrganizationId_Abbreviation" ON "Bibles" ("OrganizationId", "Abbreviation");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260414185045_AddBibles', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "SongPartLabels" (
    "Id" text NOT NULL,
    "Text" character varying(50) NOT NULL,
    "Color" character varying(7) NOT NULL,
    "SortOrder" integer NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_SongPartLabels" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_SongPartLabels_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_SongPartLabels_OrganizationId_Text" ON "SongPartLabels" ("OrganizationId", "Text");

ALTER TABLE "SongParts" ADD "LabelId" text;

-- Create labels from distinct existing label texts per organization
INSERT INTO "SongPartLabels" ("Id", "Text", "Color", "SortOrder", "OrganizationId")
SELECT
    gen_random_uuid()::text,
    sub."Label",
    CASE
        WHEN UPPER(sub."Label") LIKE '%PRE-CHORUS%' OR UPPER(sub."Label") LIKE '%PRE CHORUS%' THEN '#db2777'
        WHEN UPPER(sub."Label") LIKE '%CHORUS%' OR UPPER(sub."Label") LIKE '%REFRÄNG%' OR UPPER(sub."Label") LIKE '%REFRANG%' THEN '#e85d04'
        WHEN UPPER(sub."Label") LIKE '%VERSE%' OR UPPER(sub."Label") LIKE '%VERS%' THEN '#0284c7'
        WHEN UPPER(sub."Label") LIKE '%BRIDGE%' OR UPPER(sub."Label") LIKE '%BRYGGA%' THEN '#7c3aed'
        WHEN UPPER(sub."Label") LIKE '%TAG%' OR UPPER(sub."Label") LIKE '%OUTRO%' OR UPPER(sub."Label") LIKE '%ENDING%' THEN '#059669'
        WHEN UPPER(sub."Label") LIKE '%INTRO%' THEN '#ca8a04'
        ELSE '#6b7280'
    END,
    CASE
        WHEN UPPER(sub."Label") LIKE 'INTRO%' THEN 0
        WHEN UPPER(sub."Label") LIKE 'VERS%' OR UPPER(sub."Label") LIKE 'VERSE%' THEN 100
        WHEN UPPER(sub."Label") LIKE 'PRE-CHORUS%' OR UPPER(sub."Label") LIKE 'PRE CHORUS%' THEN 200
        WHEN UPPER(sub."Label") LIKE 'CHORUS%' OR UPPER(sub."Label") LIKE 'REFRÄNG%' OR UPPER(sub."Label") LIKE 'REFRANG%' THEN 300
        WHEN UPPER(sub."Label") LIKE 'BRIDGE%' OR UPPER(sub."Label") LIKE 'BRYGGA%' THEN 400
        WHEN UPPER(sub."Label") LIKE 'TAG%' THEN 500
        WHEN UPPER(sub."Label") LIKE 'OUTRO%' THEN 600
        WHEN UPPER(sub."Label") LIKE 'ENDING%' THEN 700
        ELSE 800
    END + ROW_NUMBER() OVER (PARTITION BY sub."OrganizationId" ORDER BY sub."Label") AS "SortOrder",
    sub."OrganizationId"
FROM (
    SELECT DISTINCT sp."Label", s."OrganizationId"
    FROM "SongParts" sp
    INNER JOIN "Songs" s ON sp."SongId" = s."Id"
    WHERE sp."Label" IS NOT NULL AND sp."Label" <> ''
) sub;

-- Link existing song parts to their new labels
UPDATE "SongParts" sp
SET "LabelId" = spl."Id"
FROM "SongPartLabels" spl
INNER JOIN "Songs" s ON s."OrganizationId" = spl."OrganizationId"
WHERE sp."SongId" = s."Id"
  AND sp."Label" = spl."Text";

-- Renumber sort orders to be sequential per organization
WITH numbered AS (
    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "OrganizationId" ORDER BY "SortOrder", "Text") - 1 AS new_order
    FROM "SongPartLabels"
)
UPDATE "SongPartLabels" spl
SET "SortOrder" = numbered.new_order
FROM numbered
WHERE spl."Id" = numbered."Id";

ALTER TABLE "SongParts" DROP COLUMN "Label";

CREATE INDEX "IX_SongParts_LabelId" ON "SongParts" ("LabelId");

ALTER TABLE "SongParts" ADD CONSTRAINT "FK_SongParts_SongPartLabels_LabelId" FOREIGN KEY ("LabelId") REFERENCES "SongPartLabels" ("Id") ON DELETE SET NULL;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260416083745_AddSongPartLabels', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "PresentationItems" ADD "ArrangementId" text;

CREATE TABLE "SongArrangements" (
    "Id" text NOT NULL,
    "Name" character varying(100),
    "PartIdsJson" character varying(5000) NOT NULL,
    "SongId" text NOT NULL,
    CONSTRAINT "PK_SongArrangements" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_SongArrangements_Songs_SongId" FOREIGN KEY ("SongId") REFERENCES "Songs" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_SongArrangements_SongId" ON "SongArrangements" ("SongId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260416113735_AddSongArrangements', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "PresentationSlides" (
    "Id" text NOT NULL,
    "FileName" character varying(200) NOT NULL,
    "PageCount" integer NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "PresentationId" text NOT NULL,
    CONSTRAINT "PK_PresentationSlides" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_PresentationSlides_Presentations_PresentationId" FOREIGN KEY ("PresentationId") REFERENCES "Presentations" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_PresentationSlides_PresentationId" ON "PresentationSlides" ("PresentationId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260418122710_AddPresentationSlides', '10.0.1');

COMMIT;

START TRANSACTION;
DROP INDEX "IX_RemoteDisplays_OrganizationId_DisplayIdentifier";

CREATE UNIQUE INDEX "IX_RemoteDisplays_DisplayIdentifier" ON "RemoteDisplays" ("DisplayIdentifier");

CREATE INDEX "IX_RemoteDisplays_OrganizationId" ON "RemoteDisplays" ("OrganizationId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260430145927_MakeDisplayIdentifierGloballyUnique', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "CalendarSubscriptions" (
    "Id" text NOT NULL,
    "TokenHash" text NOT NULL,
    "Name" character varying(200) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "LastAccessedAt" timestamp with time zone,
    "UserId" text NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_CalendarSubscriptions" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_CalendarSubscriptions_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_CalendarSubscriptions_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_CalendarSubscriptions_OrganizationId" ON "CalendarSubscriptions" ("OrganizationId");

CREATE UNIQUE INDEX "IX_CalendarSubscriptions_TokenHash" ON "CalendarSubscriptions" ("TokenHash");

CREATE INDEX "IX_CalendarSubscriptions_UserId_OrganizationId" ON "CalendarSubscriptions" ("UserId", "OrganizationId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260503060457_AddCalendarSubscriptions', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "Presentations" ALTER COLUMN "Description" TYPE character varying(5000);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260503131640_WidenPresentationDescription', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "RemoteDisplays" ADD "Kind" integer NOT NULL DEFAULT 0;

CREATE INDEX "IX_RemoteDisplays_OrganizationId_Kind" ON "RemoteDisplays" ("OrganizationId", "Kind");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260811133051_AddOutputKindToRemoteDisplays', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "Presentations" ADD "ThemeId" text;

CREATE TABLE "Themes" (
    "Id" text NOT NULL,
    "OrganizationId" text,
    "Name" character varying(200) NOT NULL,
    "SortOrder" integer NOT NULL,
    "Definition" jsonb NOT NULL,
    CONSTRAINT "PK_Themes" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_Themes_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_Presentations_ThemeId" ON "Presentations" ("ThemeId");

CREATE INDEX "IX_Themes_OrganizationId" ON "Themes" ("OrganizationId");

ALTER TABLE "Presentations" ADD CONSTRAINT "FK_Presentations_Themes_ThemeId" FOREIGN KEY ("ThemeId") REFERENCES "Themes" ("Id") ON DELETE SET NULL;

DELETE FROM "OrganizationSettings"
WHERE "Key" IN (
    'SongFontSize', 'SongFontFamily', 'SongFontWeight', 'SongLineHeight',
    'CreditsFontSize', 'CreditsFontFamily', 'CreditsFontWeight', 'CreditsLineHeight',
    'BibleFontSize', 'BibleFontFamily', 'BibleFontWeight', 'BibleLineHeight',
    'BibleCreditsFontSize', 'BibleCreditsFontFamily', 'BibleCreditsFontWeight', 'BibleCreditsLineHeight'
);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260814082426_AddSlideThemes', '10.0.1');

COMMIT;

START TRANSACTION;
DROP INDEX "IX_Songs_OrganizationId";

DROP INDEX "IX_Presentations_OrganizationId";

ALTER TABLE "UserSettings" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "Themes" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "SongVersions" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "Songs" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "SongParts" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "SongPartLabels" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "SongArrangements" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "PresentationSlides" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "Presentations" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "PresentationItems" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "PresentationItemParts" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "OverlaySlides" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "OrganizationSettings" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "OrganizationImages" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "OrganizationAudios" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "Bibles" ADD "ModifiedAt" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

UPDATE "Presentations" SET "ModifiedAt" = "UpdatedAt";

UPDATE "OrganizationImages" SET "ModifiedAt" = "CreatedAt";

UPDATE "OrganizationAudios" SET "ModifiedAt" = "CreatedAt";

UPDATE "PresentationSlides" SET "ModifiedAt" = "CreatedAt";

UPDATE "SongVersions" SET "ModifiedAt" = "CreatedAt";

CREATE TABLE "SyncTombstones" (
    "Id" text NOT NULL,
    "EntityType" character varying(64) NOT NULL,
    "EntityId" text NOT NULL,
    "OrganizationId" text,
    "UserId" text,
    "DeletedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_SyncTombstones" PRIMARY KEY ("Id")
);

CREATE INDEX "IX_Songs_OrganizationId_ModifiedAt" ON "Songs" ("OrganizationId", "ModifiedAt");

CREATE INDEX "IX_Presentations_OrganizationId_ModifiedAt" ON "Presentations" ("OrganizationId", "ModifiedAt");

CREATE INDEX "IX_SyncTombstones_OrganizationId_DeletedAt" ON "SyncTombstones" ("OrganizationId", "DeletedAt");

CREATE INDEX "IX_SyncTombstones_UserId_DeletedAt" ON "SyncTombstones" ("UserId", "DeletedAt");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260827182451_AddSyncTracking', '10.0.1');

COMMIT;

START TRANSACTION;
CREATE TABLE "DeviceTokens" (
    "Id" text NOT NULL,
    "TokenHash" text NOT NULL,
    "Name" character varying(200) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "LastUsedAt" timestamp with time zone,
    "RevokedAt" timestamp with time zone,
    "UserId" text NOT NULL,
    "OrganizationId" text NOT NULL,
    CONSTRAINT "PK_DeviceTokens" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_DeviceTokens_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_DeviceTokens_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_DeviceTokens_OrganizationId" ON "DeviceTokens" ("OrganizationId");

CREATE UNIQUE INDEX "IX_DeviceTokens_TokenHash" ON "DeviceTokens" ("TokenHash");

CREATE INDEX "IX_DeviceTokens_UserId" ON "DeviceTokens" ("UserId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260827185013_AddDeviceTokens', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "DeviceTokens" ADD "LastSeenProtocol" integer;

ALTER TABLE "DeviceTokens" ADD "LastSeenVersion" character varying(32);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260828185341_AddDeviceClientVersion', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "UserSettings" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "Themes" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "SongVersions" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "Songs" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "SongParts" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "SongPartLabels" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "SongArrangements" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "PresentationSlides" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "Presentations" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "PresentationItems" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "PresentationItemParts" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "OverlaySlides" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "OrganizationSettings" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "OrganizationImages" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "OrganizationAudios" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

ALTER TABLE "Bibles" ALTER COLUMN "ModifiedAt" TYPE timestamp(3) with time zone;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260829140702_TruncateModifiedAtToMilliseconds', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "UserSettings" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "Themes" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "SongVersions" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "Songs" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "SongParts" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "SongPartLabels" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "SongArrangements" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "PresentationSlides" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "Presentations" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "PresentationItems" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "PresentationItemParts" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "OverlaySlides" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "OrganizationSettings" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "OrganizationImages" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "OrganizationAudios" ADD "Version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "Bibles" ADD "Version" bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_bump_version() RETURNS trigger AS $$
BEGIN
    NEW."Version" := COALESCE(OLD."Version", 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Bibles_sync_version"
BEFORE INSERT OR UPDATE ON "Bibles"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "OrganizationAudios_sync_version"
BEFORE INSERT OR UPDATE ON "OrganizationAudios"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "OrganizationImages_sync_version"
BEFORE INSERT OR UPDATE ON "OrganizationImages"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "OrganizationSettings_sync_version"
BEFORE INSERT OR UPDATE ON "OrganizationSettings"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "OverlaySlides_sync_version"
BEFORE INSERT OR UPDATE ON "OverlaySlides"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "PresentationItemParts_sync_version"
BEFORE INSERT OR UPDATE ON "PresentationItemParts"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "PresentationItems_sync_version"
BEFORE INSERT OR UPDATE ON "PresentationItems"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "Presentations_sync_version"
BEFORE INSERT OR UPDATE ON "Presentations"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "PresentationSlides_sync_version"
BEFORE INSERT OR UPDATE ON "PresentationSlides"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "SongArrangements_sync_version"
BEFORE INSERT OR UPDATE ON "SongArrangements"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "SongPartLabels_sync_version"
BEFORE INSERT OR UPDATE ON "SongPartLabels"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "SongParts_sync_version"
BEFORE INSERT OR UPDATE ON "SongParts"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "Songs_sync_version"
BEFORE INSERT OR UPDATE ON "Songs"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "SongVersions_sync_version"
BEFORE INSERT OR UPDATE ON "SongVersions"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "Themes_sync_version"
BEFORE INSERT OR UPDATE ON "Themes"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

CREATE TRIGGER "UserSettings_sync_version"
BEFORE INSERT OR UPDATE ON "UserSettings"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260829143144_AddSyncRowVersion', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "RemoteDisplays" ADD "ModifiedAt" timestamp(3) with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';

ALTER TABLE "RemoteDisplays" ADD "Version" bigint NOT NULL DEFAULT 0;

UPDATE "RemoteDisplays" SET "ModifiedAt" = now();

CREATE TRIGGER "RemoteDisplays_sync_version"
BEFORE INSERT OR UPDATE ON "RemoteDisplays"
FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260830155418_AddRemoteDisplaySyncTracking', '10.0.1');

COMMIT;

START TRANSACTION;
UPDATE "Songs"
SET "Name" = normalize("Name", NFC)
WHERE "Name" IS NOT NULL AND "Name" <> normalize("Name", NFC);

UPDATE "Songs"
SET "Author" = normalize("Author", NFC)
WHERE "Author" IS NOT NULL AND "Author" <> normalize("Author", NFC);

UPDATE "Songs"
SET "Publisher" = normalize("Publisher", NFC)
WHERE "Publisher" IS NOT NULL AND "Publisher" <> normalize("Publisher", NFC);

UPDATE "SongParts"
SET "Content" = normalize("Content", NFC)
WHERE "Content" IS NOT NULL AND "Content" <> normalize("Content", NFC);

UPDATE "SongPartLabels"
SET "Text" = normalize("Text", NFC)
WHERE "Text" IS NOT NULL AND "Text" <> normalize("Text", NFC);

UPDATE "SongArrangements"
SET "Name" = normalize("Name", NFC)
WHERE "Name" IS NOT NULL AND "Name" <> normalize("Name", NFC);

UPDATE "SongVersions"
SET "Name" = normalize("Name", NFC)
WHERE "Name" IS NOT NULL AND "Name" <> normalize("Name", NFC);

UPDATE "SongVersions"
SET "Author" = normalize("Author", NFC)
WHERE "Author" IS NOT NULL AND "Author" <> normalize("Author", NFC);

UPDATE "SongVersions"
SET "PartsJson" = normalize("PartsJson", NFC)
WHERE "PartsJson" IS NOT NULL AND "PartsJson" <> normalize("PartsJson", NFC);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260905202004_NormalizeImportedTextToNfc', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "Presentations" ADD "DeletedAt" timestamp with time zone;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260906052341_AddPresentationSoftDelete', '10.0.1');

COMMIT;

START TRANSACTION;
ALTER TABLE "OrganizationImages" ADD "DeletedAt" timestamp with time zone;

ALTER TABLE "OrganizationAudios" ADD "DeletedAt" timestamp with time zone;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260906062723_AddMediaSoftDelete', '10.0.1');

COMMIT;

