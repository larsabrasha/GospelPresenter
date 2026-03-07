using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddOrganizationUsersAndPresentationItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OrganizationId",
                table: "Presentations",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "Organizations",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Organizations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PresentationItems",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    ImageData = table.Column<byte[]>(type: "bytea", nullable: true),
                    PresentationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PresentationItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PresentationItems_Presentations_PresentationId",
                        column: x => x.PresentationId,
                        principalTable: "Presentations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ExternalId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    OrganizationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Users_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PresentationItemParts",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    PresentationItemId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PresentationItemParts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PresentationItemParts_PresentationItems_PresentationItemId",
                        column: x => x.PresentationItemId,
                        principalTable: "PresentationItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Presentations_OrganizationId",
                table: "Presentations",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_PresentationItemParts_PresentationItemId",
                table: "PresentationItemParts",
                column: "PresentationItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PresentationItems_PresentationId",
                table: "PresentationItems",
                column: "PresentationId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_OrganizationId",
                table: "Users",
                column: "OrganizationId");

            migrationBuilder.AddForeignKey(
                name: "FK_Presentations_Organizations_OrganizationId",
                table: "Presentations",
                column: "OrganizationId",
                principalTable: "Organizations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Presentations_Organizations_OrganizationId",
                table: "Presentations");

            migrationBuilder.DropTable(
                name: "PresentationItemParts");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "PresentationItems");

            migrationBuilder.DropTable(
                name: "Organizations");

            migrationBuilder.DropIndex(
                name: "IX_Presentations_OrganizationId",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "OrganizationId",
                table: "Presentations");
        }
    }
}
