using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddSyncRowVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "UserSettings",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Themes",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongVersions",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Songs",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongParts",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongPartLabels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongArrangements",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "PresentationSlides",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Presentations",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "PresentationItems",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "PresentationItemParts",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OverlaySlides",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OrganizationSettings",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OrganizationImages",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OrganizationAudios",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Bibles",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            // The version is maintained by the database, not by the application, and that is the
            // entire point of it. The timestamp it replaces as a conflict token was maintained by
            // the application: SaveChanges got it right and eleven ExecuteUpdateAsync sites did not,
            // which is a class of mistake no amount of care removes — the next call site can make it
            // again. A BEFORE trigger fires on every write path there is, including ExecuteUpdate,
            // raw SQL, and a psql session.
            //
            // COALESCE covers INSERT, where OLD is null: a new row starts at 1.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION sync_bump_version() RETURNS trigger AS $$
                BEGIN
                    NEW."Version" := COALESCE(OLD."Version", 0) + 1;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
                """);

            foreach (var table in SyncVersionedTables)
            {
                migrationBuilder.Sql($"""
                    CREATE TRIGGER "{table}_sync_version"
                    BEFORE INSERT OR UPDATE ON "{table}"
                    FOR EACH ROW EXECUTE FUNCTION sync_bump_version();
                    """);
            }
        }

        /// <summary>Every table whose entity implements ISyncTracked.</summary>
        private static readonly string[] SyncVersionedTables =
        [
            "Bibles", "OrganizationAudios", "OrganizationImages", "OrganizationSettings",
            "OverlaySlides", "PresentationItemParts", "PresentationItems", "Presentations",
            "PresentationSlides", "SongArrangements", "SongPartLabels", "SongParts", "Songs",
            "SongVersions", "Themes", "UserSettings",
        ];

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in SyncVersionedTables)
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS \"{table}_sync_version\" ON \"{table}\";");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS sync_bump_version();");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Themes");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "SongVersions");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Songs");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "SongParts");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "SongPartLabels");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "SongArrangements");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "PresentationSlides");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "PresentationItems");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "PresentationItemParts");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "OverlaySlides");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "OrganizationSettings");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "OrganizationImages");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "OrganizationAudios");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "Bibles");
        }
    }
}
