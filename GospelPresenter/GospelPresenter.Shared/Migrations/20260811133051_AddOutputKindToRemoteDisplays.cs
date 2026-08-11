using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddOutputKindToRemoteDisplays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "RemoteDisplays",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteDisplays_OrganizationId_Kind",
                table: "RemoteDisplays",
                columns: new[] { "OrganizationId", "Kind" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RemoteDisplays_OrganizationId_Kind",
                table: "RemoteDisplays");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "RemoteDisplays");
        }
    }
}
