using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class MakeDisplayIdentifierGloballyUnique : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RemoteDisplays_OrganizationId_DisplayIdentifier",
                table: "RemoteDisplays");

            migrationBuilder.CreateIndex(
                name: "IX_RemoteDisplays_DisplayIdentifier",
                table: "RemoteDisplays",
                column: "DisplayIdentifier",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteDisplays_OrganizationId",
                table: "RemoteDisplays",
                column: "OrganizationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RemoteDisplays_DisplayIdentifier",
                table: "RemoteDisplays");

            migrationBuilder.DropIndex(
                name: "IX_RemoteDisplays_OrganizationId",
                table: "RemoteDisplays");

            migrationBuilder.CreateIndex(
                name: "IX_RemoteDisplays_OrganizationId_DisplayIdentifier",
                table: "RemoteDisplays",
                columns: new[] { "OrganizationId", "DisplayIdentifier" },
                unique: true);
        }
    }
}
