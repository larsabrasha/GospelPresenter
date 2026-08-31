using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
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
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastSeenVersion",
                table: "DeviceTokens",
                type: "character varying(32)",
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
