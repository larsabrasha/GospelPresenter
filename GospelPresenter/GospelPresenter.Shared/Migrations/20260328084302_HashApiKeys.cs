using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class HashApiKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Key",
                table: "McpApiKeys",
                newName: "KeyHash");

            migrationBuilder.RenameIndex(
                name: "IX_McpApiKeys_Key",
                table: "McpApiKeys",
                newName: "IX_McpApiKeys_KeyHash");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "KeyHash",
                table: "McpApiKeys",
                newName: "Key");

            migrationBuilder.RenameIndex(
                name: "IX_McpApiKeys_KeyHash",
                table: "McpApiKeys",
                newName: "IX_McpApiKeys_Key");
        }
    }
}
