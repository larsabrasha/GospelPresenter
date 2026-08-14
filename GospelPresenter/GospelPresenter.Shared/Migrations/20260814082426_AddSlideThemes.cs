using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddSlideThemes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ThemeId",
                table: "Presentations",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Themes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    OrganizationId = table.Column<string>(type: "text", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Definition = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Themes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Themes_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Presentations_ThemeId",
                table: "Presentations",
                column: "ThemeId");

            migrationBuilder.CreateIndex(
                name: "IX_Themes_OrganizationId",
                table: "Themes",
                column: "OrganizationId");

            migrationBuilder.AddForeignKey(
                name: "FK_Presentations_Themes_ThemeId",
                table: "Presentations",
                column: "ThemeId",
                principalTable: "Themes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // The per-organisation slide styles are replaced by themes. They are dropped rather than
            // converted: nothing reads them any more, and leaving them would give two sources of truth
            // for how a slide looks. Existing presentations keep a null ThemeId and therefore follow the
            // organisation's default theme, which is Classic — the values these keys defaulted to.
            migrationBuilder.Sql(
                """
                DELETE FROM "OrganizationSettings"
                WHERE "Key" IN (
                    'SongFontSize', 'SongFontFamily', 'SongFontWeight', 'SongLineHeight',
                    'CreditsFontSize', 'CreditsFontFamily', 'CreditsFontWeight', 'CreditsLineHeight',
                    'BibleFontSize', 'BibleFontFamily', 'BibleFontWeight', 'BibleLineHeight',
                    'BibleCreditsFontSize', 'BibleCreditsFontFamily', 'BibleCreditsFontWeight', 'BibleCreditsLineHeight'
                );
                """);
        }

        /// <inheritdoc />
        /// <remarks>
        /// The deleted slide-style settings are not restored: their values are gone, and every reader
        /// of them was removed in the same change.
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Presentations_Themes_ThemeId",
                table: "Presentations");

            migrationBuilder.DropTable(
                name: "Themes");

            migrationBuilder.DropIndex(
                name: "IX_Presentations_ThemeId",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "ThemeId",
                table: "Presentations");
        }
    }
}
