using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class MoveImageDataToS3 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add HasImage before dropping ImageData so we can populate it
            migrationBuilder.AddColumn<bool>(
                name: "HasImage",
                table: "OverlaySlides",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql(
                """UPDATE "OverlaySlides" SET "HasImage" = true WHERE "ImageData" IS NOT NULL""");

            // Drop byte columns (data migration to S3 runs before this migration).
            // PresentationItems.ImageData is a legacy column — images are now referenced
            // via PresentationItemParts pointing to OrganizationImage IDs.
            migrationBuilder.DropColumn(
                name: "ImageData",
                table: "PresentationItems");

            migrationBuilder.DropColumn(
                name: "ImageData",
                table: "OverlaySlides");

            migrationBuilder.DropColumn(
                name: "FullData",
                table: "OrganizationImages");

            migrationBuilder.DropColumn(
                name: "ThumbnailData",
                table: "OrganizationImages");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HasImage",
                table: "OverlaySlides");

            migrationBuilder.AddColumn<byte[]>(
                name: "ImageData",
                table: "PresentationItems",
                type: "bytea",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "ImageData",
                table: "OverlaySlides",
                type: "bytea",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "FullData",
                table: "OrganizationImages",
                type: "bytea",
                nullable: false,
                defaultValue: new byte[0]);

            migrationBuilder.AddColumn<byte[]>(
                name: "ThumbnailData",
                table: "OrganizationImages",
                type: "bytea",
                nullable: false,
                defaultValue: new byte[0]);
        }
    }
}
