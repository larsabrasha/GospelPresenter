using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Client.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceClientVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LastSeenProtocol",
                table: "DeviceTokens",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastSeenVersion",
                table: "DeviceTokens",
                type: "TEXT",
                maxLength: 32,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastSeenProtocol",
                table: "DeviceTokens");

            migrationBuilder.DropColumn(
                name: "LastSeenVersion",
                table: "DeviceTokens");
        }
    }
}
