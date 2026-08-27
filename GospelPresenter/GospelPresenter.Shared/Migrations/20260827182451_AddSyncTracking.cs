using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddSyncTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Songs_OrganizationId",
                table: "Songs");

            migrationBuilder.DropIndex(
                name: "IX_Presentations_OrganizationId",
                table: "Presentations");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "UserSettings",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "Themes",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "SongVersions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "Songs",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "SongParts",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "SongPartLabels",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "SongArrangements",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "PresentationSlides",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "Presentations",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "PresentationItems",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "PresentationItemParts",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "OverlaySlides",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "OrganizationSettings",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "OrganizationImages",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "OrganizationAudios",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ModifiedAt",
                table: "Bibles",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // Backfill from the timestamps that exist. Tables with no timestamp keep the epoch
            // default, which a full initial sync picks up regardless of watermark.
            migrationBuilder.Sql("""UPDATE "Presentations" SET "ModifiedAt" = "UpdatedAt";""");
            migrationBuilder.Sql("""UPDATE "OrganizationImages" SET "ModifiedAt" = "CreatedAt";""");
            migrationBuilder.Sql("""UPDATE "OrganizationAudios" SET "ModifiedAt" = "CreatedAt";""");
            migrationBuilder.Sql("""UPDATE "PresentationSlides" SET "ModifiedAt" = "CreatedAt";""");
            migrationBuilder.Sql("""UPDATE "SongVersions" SET "ModifiedAt" = "CreatedAt";""");

            migrationBuilder.CreateTable(
                name: "SyncTombstones",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    EntityId = table.Column<string>(type: "text", nullable: false),
                    OrganizationId = table.Column<string>(type: "text", nullable: true),
                    UserId = table.Column<string>(type: "text", nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncTombstones", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Songs_OrganizationId_ModifiedAt",
                table: "Songs",
                columns: new[] { "OrganizationId", "ModifiedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Presentations_OrganizationId_ModifiedAt",
                table: "Presentations",
                columns: new[] { "OrganizationId", "ModifiedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SyncTombstones_OrganizationId_DeletedAt",
                table: "SyncTombstones",
                columns: new[] { "OrganizationId", "DeletedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SyncTombstones_UserId_DeletedAt",
                table: "SyncTombstones",
                columns: new[] { "UserId", "DeletedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SyncTombstones");

            migrationBuilder.DropIndex(
                name: "IX_Songs_OrganizationId_ModifiedAt",
                table: "Songs");

            migrationBuilder.DropIndex(
                name: "IX_Presentations_OrganizationId_ModifiedAt",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "UserSettings");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "Themes");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "SongVersions");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "Songs");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "SongParts");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "SongPartLabels");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "SongArrangements");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "PresentationSlides");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "PresentationItems");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "PresentationItemParts");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "OverlaySlides");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "OrganizationSettings");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "OrganizationImages");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "OrganizationAudios");

            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "Bibles");

            migrationBuilder.CreateIndex(
                name: "IX_Songs_OrganizationId",
                table: "Songs",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_Presentations_OrganizationId",
                table: "Presentations",
                column: "OrganizationId");
        }
    }
}
