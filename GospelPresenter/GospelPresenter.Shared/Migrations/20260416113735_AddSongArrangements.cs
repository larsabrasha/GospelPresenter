using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddSongArrangements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ArrangementId",
                table: "PresentationItems",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SongArrangements",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    PartIdsJson = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false),
                    SongId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SongArrangements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SongArrangements_Songs_SongId",
                        column: x => x.SongId,
                        principalTable: "Songs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SongArrangements_SongId",
                table: "SongArrangements",
                column: "SongId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SongArrangements");

            migrationBuilder.DropColumn(
                name: "ArrangementId",
                table: "PresentationItems");
        }
    }
}
