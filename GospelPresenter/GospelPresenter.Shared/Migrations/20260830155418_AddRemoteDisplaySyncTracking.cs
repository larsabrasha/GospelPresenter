using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddRemoteDisplaySyncTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "RemoteDisplays",
                type: "timestamp(3) with time zone",
                precision: 3,
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "RemoteDisplays",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            // Stamped now, not backfilled from CreatedAt, and this is the whole of it: a device that
            // has already synced holds a watermark of today, and a row stamped last April is below
            // it by months — so an incremental pull would never carry it, and every output that
            // exists when this ships would stay invisible on every installed app. Forever, since
            // nothing would touch the row again.
            //
            // The usual objection to re-stamping does not apply. It says a client's stored conflict
            // base would then disagree with the row, and no client holds a base for these: outputs
            // have never been part of the protocol until this migration put them in it.
            migrationBuilder.Sql("""UPDATE "RemoteDisplays" SET "ModifiedAt" = now();""");

            // The same database-owned version every other synced table has. See AddSyncRowVersion
            // for why the application is not trusted to maintain it.
            migrationBuilder.Sql("""
                CREATE TRIGGER "RemoteDisplays_sync_version"
                BEFORE INSERT OR UPDATE ON "RemoteDisplays"
                FOR EACH ROW EXECUTE FUNCTION sync_bump_version();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS "RemoteDisplays_sync_version" ON "RemoteDisplays";""");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "RemoteDisplays");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "RemoteDisplays");
        }
    }
}
