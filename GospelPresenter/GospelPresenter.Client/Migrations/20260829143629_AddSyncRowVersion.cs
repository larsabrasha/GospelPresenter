using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Client.Migrations
{
    /// <inheritdoc />
    public partial class AddSyncRowVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "BaseModifiedAt",
                table: "SyncBase",
                newName: "BaseVersion");

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "UserSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Themes",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongVersions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Songs",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongParts",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongPartLabels",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "SongArrangements",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "PresentationSlides",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Presentations",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "PresentationItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "PresentationItemParts",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OverlaySlides",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OrganizationSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OrganizationImages",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "OrganizationAudios",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "Bibles",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            // The rename above carried the old values across, and they are timestamps — meaningless
            // as versions, and every one of them would disagree with the server and turn the next
            // local edit into a conflict copy. Throw them away and forget the watermark: the next
            // pull is then unbounded, re-delivers every row, and writes a real base for each. That
            // costs one full sync once, which is the cheapest correct thing a device can do here.
            migrationBuilder.Sql("DELETE FROM SyncBase;");
            migrationBuilder.Sql("DELETE FROM SyncState WHERE Key = 'watermark';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
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

            migrationBuilder.RenameColumn(
                name: "BaseVersion",
                table: "SyncBase",
                newName: "BaseModifiedAt");
        }
    }
}
