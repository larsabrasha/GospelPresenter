import { Client, types } from 'pg';

// One organisation's rows as 1.x keeps them in PostgreSQL (GospelPresenter.Shared/Models, EF Core with
// Npgsql: quoted PascalCase tables and columns). Only what the import uses is read.

// A date and a time of day stay text, as the new tables keep them; a bigint is a number (no 1.x value nears 2^53).
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1083, (v) => v);
types.setTypeParser(20, (v) => Number(v));

interface OldOrg {
  Id: string;
  Name: string;
}
interface OldUser {
  Id: string;
  Name: string;
  Email: string;
  Role: string;
}
interface OldLogin {
  UserId: string;
  Provider: string;
  ProviderSubjectId: string;
}
interface OldLabel {
  Id: string;
  Text: string;
  Color: string;
  SortOrder: number;
}
interface OldSong {
  Id: string;
  Name: string;
  Author: string | null;
  Publisher: string | null;
  Year: number | null;
  Ccli: string | null;
  DeletedAt: Date | null;
}
interface OldSongPart {
  Id: string;
  SongId: string;
  LabelId: string | null;
  Content: string;
  SortOrder: number;
}
interface OldArrangement {
  Id: string;
  SongId: string;
  Name: string | null;
  PartIdsJson: string;
}
interface OldSongVersion {
  Id: string;
  SongId: string;
  CreatedAt: Date;
  Name: string;
  Author: string | null;
  PartsJson: string;
}
interface OldCcliEntry {
  SongId: string;
  SongName: string;
  CcliNumber: string;
  PresentationId: string | null;
  PresentationName: string;
  Date: string;
  CreatedAt: Date;
  Reported: boolean;
  ReportedAt: Date | null;
}
interface OldPresentation {
  Id: string;
  Name: string;
  UpdatedAt: Date;
  IsTemplate: boolean;
  Description: string | null;
  DeletedAt: Date | null;
  LastUsedAt: Date | null;
  ScheduledDayOfWeek: number | null;
  ScheduledTime: string | null;
  EventDate: string | null;
  EventTime: string | null;
  EventLocation: string | null;
  ThemeId: string | null;
}
export interface OldItem {
  Id: string;
  PresentationId: string;
  SourceId: string | null;
  /** 0 song, 1 Bible text, 2 image, 3 audio, 4 slide deck (`PresentationItemType`). */
  Type: number;
  Title: string;
  ArrangementId: string | null;
  SortOrder: number;
}
interface OldItemPart {
  PresentationItemId: string;
  Content: string;
  SortOrder: number;
}
interface OldSlideDeck {
  Id: string;
  FileName: string;
}
interface OldBible {
  Id: string;
  Name: string;
  Abbreviation: string;
  VersesJson: string;
}
interface OldImage {
  Id: string;
  FileName: string;
  ContentType: string;
  CreatedAt: Date;
  DeletedAt: Date | null;
}
interface OldAudio {
  Id: string;
  FileName: string;
  ContentType: string;
  CreatedAt: Date;
  DeletedAt: Date | null;
}
interface OldOverlay {
  Id: string;
  Title: string;
  Content: string | null;
  HasImage: boolean;
  SortOrder: number;
}
interface OldDisplay {
  Id: string;
  DisplayIdentifier: string;
  Name: string;
  /** 0 a saved screen, 1 a public output (`OutputKind`). */
  Kind: number;
  CreatedAt: Date;
}
interface OldSetting {
  Key: string;
  Value: string;
}

/** Everything of one organisation the import moves, read in one consistent snapshot. */
export interface OldData {
  org: OldOrg;
  users: OldUser[];
  logins: OldLogin[];
  labels: OldLabel[];
  songs: OldSong[];
  parts: OldSongPart[];
  arrangements: OldArrangement[];
  versions: OldSongVersion[];
  ccli: OldCcliEntry[];
  presentations: OldPresentation[];
  items: OldItem[];
  itemParts: OldItemPart[];
  decks: OldSlideDeck[];
  bibles: OldBible[];
  images: OldImage[];
  audios: OldAudio[];
  overlays: OldOverlay[];
  displays: OldDisplay[];
  settings: OldSetting[];
}

const BY_ORG = `WHERE "OrganizationId" = $1`;
const SONG_OF_ORG = `"SongId" IN (SELECT "Id" FROM "Songs" ${BY_ORG})`;
const PRESENTATION_OF_ORG = `"PresentationId" IN (SELECT "Id" FROM "Presentations" ${BY_ORG})`;

/** The organisations on the server, for choosing one. */
export async function listOrgs(url: string): Promise<{ id: string; name: string; users: number }[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query(`SELECT o."Id", o."Name", (SELECT count(*) FROM "Users" u WHERE u."OrganizationId" = o."Id") AS n FROM "Organizations" o ORDER BY o."Name"`);
    return r.rows.map((o) => ({ id: String(o.Id), name: String(o.Name), users: Number(o.n) }));
  } finally {
    await client.end();
  }
}

export async function readOrg(url: string, orgId: string): Promise<OldData> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const all = async <T>(sql: string) => (await client.query(sql, [orgId])).rows as T[];
    const [org] = await all<OldOrg>(`SELECT "Id", "Name" FROM "Organizations" WHERE "Id" = $1`);
    if (!org) throw new Error(`no organisation ${orgId}`);
    const data: OldData = {
      org,
      users: await all(`SELECT "Id", "Name", "Email", "Role" FROM "Users" ${BY_ORG} ORDER BY "Email"`),
      logins: await all(`SELECT "UserId", "Provider", "ProviderSubjectId" FROM "UserLogins" WHERE "UserId" IN (SELECT "Id" FROM "Users" ${BY_ORG})`),
      labels: await all(`SELECT "Id", "Text", "Color", "SortOrder" FROM "SongPartLabels" ${BY_ORG} ORDER BY "SortOrder", "Id"`),
      songs: await all(`SELECT "Id", "Name", "Author", "Publisher", "Year", "Ccli", "DeletedAt" FROM "Songs" ${BY_ORG} ORDER BY "Id"`),
      parts: await all(`SELECT "Id", "SongId", "LabelId", "Content", "SortOrder" FROM "SongParts" WHERE ${SONG_OF_ORG} ORDER BY "SongId", "SortOrder", "Id"`),
      // 1.x has no order of arrangements and reads them as stored: the table's own order is the closest to that.
      arrangements: await all(`SELECT "Id", "SongId", "Name", "PartIdsJson" FROM "SongArrangements" WHERE ${SONG_OF_ORG} ORDER BY "SongId", ctid`),
      versions: await all(`SELECT "Id", "SongId", "CreatedAt", "Name", "Author", "PartsJson" FROM "SongVersions" WHERE ${SONG_OF_ORG} ORDER BY "SongId", "CreatedAt"`),
      ccli: await all(`SELECT "SongId", "SongName", "CcliNumber", "PresentationId", "PresentationName", "Date", "CreatedAt", "Reported", "ReportedAt" FROM "CcliReportEntries" ${BY_ORG} ORDER BY "CreatedAt"`),
      presentations: await all(
        `SELECT "Id", "Name", "UpdatedAt", "IsTemplate", "Description", "DeletedAt", "LastUsedAt", "ScheduledDayOfWeek", "ScheduledTime", "EventDate", "EventTime", "EventLocation", "ThemeId" FROM "Presentations" ${BY_ORG} ORDER BY "Id"`,
      ),
      items: await all(`SELECT "Id", "PresentationId", "SourceId", "Type", "Title", "ArrangementId", "SortOrder" FROM "PresentationItems" WHERE ${PRESENTATION_OF_ORG} ORDER BY "PresentationId", "SortOrder", "Id"`),
      itemParts: await all(
        `SELECT "PresentationItemId", "Content", "SortOrder" FROM "PresentationItemParts" WHERE "PresentationItemId" IN (SELECT "Id" FROM "PresentationItems" WHERE ${PRESENTATION_OF_ORG}) ORDER BY "PresentationItemId", "SortOrder"`,
      ),
      decks: await all(`SELECT "Id", "FileName" FROM "PresentationSlides" WHERE ${PRESENTATION_OF_ORG}`),
      bibles: await all(`SELECT "Id", "Name", "Abbreviation", "VersesJson" FROM "Bibles" ${BY_ORG} ORDER BY "Name"`),
      images: await all(`SELECT "Id", "FileName", "ContentType", "CreatedAt", "DeletedAt" FROM "OrganizationImages" ${BY_ORG} ORDER BY "CreatedAt"`),
      audios: await all(`SELECT "Id", "FileName", "ContentType", "CreatedAt", "DeletedAt" FROM "OrganizationAudios" ${BY_ORG} ORDER BY "CreatedAt"`),
      overlays: await all(`SELECT "Id", "Title", "Content", "HasImage", "SortOrder" FROM "OverlaySlides" ${BY_ORG} ORDER BY "SortOrder", "Id"`),
      displays: await all(`SELECT "Id", "DisplayIdentifier", "Name", "Kind", "CreatedAt" FROM "RemoteDisplays" ${BY_ORG} ORDER BY "CreatedAt"`),
      settings: await all(`SELECT "Key", "Value" FROM "OrganizationSettings" ${BY_ORG}`),
    };
    await client.query('COMMIT');
    return data;
  } finally {
    await client.end();
  }
}
