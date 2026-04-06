using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddCcliReportPresentationFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CcliReportEntries_OrganizationId_SongId_Date",
                table: "CcliReportEntries");

            migrationBuilder.AddColumn<string>(
                name: "PresentationId",
                table: "CcliReportEntries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PresentationName",
                table: "CcliReportEntries",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_CcliReportEntries_OrganizationId_SongId_Date_PresentationId",
                table: "CcliReportEntries",
                columns: new[] { "OrganizationId", "SongId", "Date", "PresentationId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CcliReportEntries_OrganizationId_SongId_Date_PresentationId",
                table: "CcliReportEntries");

            migrationBuilder.DropColumn(
                name: "PresentationId",
                table: "CcliReportEntries");

            migrationBuilder.DropColumn(
                name: "PresentationName",
                table: "CcliReportEntries");

            migrationBuilder.CreateIndex(
                name: "IX_CcliReportEntries_OrganizationId_SongId_Date",
                table: "CcliReportEntries",
                columns: new[] { "OrganizationId", "SongId", "Date" },
                unique: true);
        }
    }
}
