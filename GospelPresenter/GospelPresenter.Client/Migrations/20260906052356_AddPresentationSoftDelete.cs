using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Client.Migrations
{
    /// <inheritdoc />
    public partial class AddPresentationSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "DeletedAt",
                table: "Presentations",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Presentations");
        }
    }
}
