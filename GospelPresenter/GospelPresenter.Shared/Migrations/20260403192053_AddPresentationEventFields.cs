using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddPresentationEventFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "EventDate",
                table: "Presentations",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EventLocation",
                table: "Presentations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "EventTime",
                table: "Presentations",
                type: "time without time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EventDate",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "EventLocation",
                table: "Presentations");

            migrationBuilder.DropColumn(
                name: "EventTime",
                table: "Presentations");
        }
    }
}
