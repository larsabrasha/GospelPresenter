using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Client.Migrations
{
    /// <inheritdoc />
    public partial class AddRemoteDisplaySyncTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "ModifiedAt",
                table: "RemoteDisplays",
                type: "INTEGER",
                precision: 3,
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "RemoteDisplays",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ModifiedAt",
                table: "RemoteDisplays");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "RemoteDisplays");
        }
    }
}
