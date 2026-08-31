using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Client.Migrations
{
    /// <inheritdoc />
    public partial class SyncEngineState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ParentId",
                table: "SyncJournal",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SyncBase",
                columns: table => new
                {
                    EntityTable = table.Column<string>(type: "TEXT", nullable: false),
                    RowId = table.Column<string>(type: "TEXT", nullable: false),
                    BaseModifiedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncBase", x => new { x.EntityTable, x.RowId });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SyncBase");

            migrationBuilder.DropColumn(
                name: "ParentId",
                table: "SyncJournal");
        }
    }
}
