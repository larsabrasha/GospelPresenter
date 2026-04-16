using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <inheritdoc />
    public partial class AddSongPartLabels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. Create the SongPartLabels table
            migrationBuilder.CreateTable(
                name: "SongPartLabels",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Color = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    OrganizationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SongPartLabels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SongPartLabels_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SongPartLabels_OrganizationId_Text",
                table: "SongPartLabels",
                columns: new[] { "OrganizationId", "Text" },
                unique: true);

            // 2. Add the LabelId column to SongParts
            migrationBuilder.AddColumn<string>(
                name: "LabelId",
                table: "SongParts",
                type: "text",
                nullable: true);

            // 3. Auto-create labels from existing data and link them
            migrationBuilder.Sql("""
                -- Create labels from distinct existing label texts per organization
                INSERT INTO "SongPartLabels" ("Id", "Text", "Color", "SortOrder", "OrganizationId")
                SELECT
                    gen_random_uuid()::text,
                    sub."Label",
                    CASE
                        WHEN UPPER(sub."Label") LIKE '%PRE-CHORUS%' OR UPPER(sub."Label") LIKE '%PRE CHORUS%' THEN '#db2777'
                        WHEN UPPER(sub."Label") LIKE '%CHORUS%' OR UPPER(sub."Label") LIKE '%REFRÄNG%' OR UPPER(sub."Label") LIKE '%REFRANG%' THEN '#e85d04'
                        WHEN UPPER(sub."Label") LIKE '%VERSE%' OR UPPER(sub."Label") LIKE '%VERS%' THEN '#0284c7'
                        WHEN UPPER(sub."Label") LIKE '%BRIDGE%' OR UPPER(sub."Label") LIKE '%BRYGGA%' THEN '#7c3aed'
                        WHEN UPPER(sub."Label") LIKE '%TAG%' OR UPPER(sub."Label") LIKE '%OUTRO%' OR UPPER(sub."Label") LIKE '%ENDING%' THEN '#059669'
                        WHEN UPPER(sub."Label") LIKE '%INTRO%' THEN '#ca8a04'
                        ELSE '#6b7280'
                    END,
                    CASE
                        WHEN UPPER(sub."Label") LIKE 'INTRO%' THEN 0
                        WHEN UPPER(sub."Label") LIKE 'VERS%' OR UPPER(sub."Label") LIKE 'VERSE%' THEN 100
                        WHEN UPPER(sub."Label") LIKE 'PRE-CHORUS%' OR UPPER(sub."Label") LIKE 'PRE CHORUS%' THEN 200
                        WHEN UPPER(sub."Label") LIKE 'CHORUS%' OR UPPER(sub."Label") LIKE 'REFRÄNG%' OR UPPER(sub."Label") LIKE 'REFRANG%' THEN 300
                        WHEN UPPER(sub."Label") LIKE 'BRIDGE%' OR UPPER(sub."Label") LIKE 'BRYGGA%' THEN 400
                        WHEN UPPER(sub."Label") LIKE 'TAG%' THEN 500
                        WHEN UPPER(sub."Label") LIKE 'OUTRO%' THEN 600
                        WHEN UPPER(sub."Label") LIKE 'ENDING%' THEN 700
                        ELSE 800
                    END + ROW_NUMBER() OVER (PARTITION BY sub."OrganizationId" ORDER BY sub."Label") AS "SortOrder",
                    sub."OrganizationId"
                FROM (
                    SELECT DISTINCT sp."Label", s."OrganizationId"
                    FROM "SongParts" sp
                    INNER JOIN "Songs" s ON sp."SongId" = s."Id"
                    WHERE sp."Label" IS NOT NULL AND sp."Label" <> ''
                ) sub;

                -- Link existing song parts to their new labels
                UPDATE "SongParts" sp
                SET "LabelId" = spl."Id"
                FROM "SongPartLabels" spl
                INNER JOIN "Songs" s ON s."OrganizationId" = spl."OrganizationId"
                WHERE sp."SongId" = s."Id"
                  AND sp."Label" = spl."Text";

                -- Renumber sort orders to be sequential per organization
                WITH numbered AS (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "OrganizationId" ORDER BY "SortOrder", "Text") - 1 AS new_order
                    FROM "SongPartLabels"
                )
                UPDATE "SongPartLabels" spl
                SET "SortOrder" = numbered.new_order
                FROM numbered
                WHERE spl."Id" = numbered."Id";
                """);

            // 4. Drop the old Label column
            migrationBuilder.DropColumn(
                name: "Label",
                table: "SongParts");

            // 5. Create index and FK
            migrationBuilder.CreateIndex(
                name: "IX_SongParts_LabelId",
                table: "SongParts",
                column: "LabelId");

            migrationBuilder.AddForeignKey(
                name: "FK_SongParts_SongPartLabels_LabelId",
                table: "SongParts",
                column: "LabelId",
                principalTable: "SongPartLabels",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SongParts_SongPartLabels_LabelId",
                table: "SongParts");

            migrationBuilder.DropTable(
                name: "SongPartLabels");

            migrationBuilder.DropIndex(
                name: "IX_SongParts_LabelId",
                table: "SongParts");

            migrationBuilder.DropColumn(
                name: "LabelId",
                table: "SongParts");

            migrationBuilder.AddColumn<string>(
                name: "Label",
                table: "SongParts",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);
        }
    }
}
