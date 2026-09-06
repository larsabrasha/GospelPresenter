using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GospelPresenter.Shared.Migrations
{
    /// <summary>
    /// ProPresenter stores its presentation name and other fields in decomposed Unicode (NFD), where
    /// "a" is followed by a combining diaeresis instead of being the single character "a". The
    /// importer wrote that through verbatim until it started composing on import, so text imported
    /// before then is stored decomposed while text imported after is composed. The two render
    /// identically and sort together, but they are different strings to an ordinal comparison.
    ///
    /// The ordinal comparisons that matter (duplicate detection on import, part-label lookup) now
    /// compose both sides before comparing, so this migration is data hygiene rather than the fix:
    /// it stops the two forms coexisting in the same column.
    ///
    /// ModifiedAt is deliberately left alone. The rendered text does not change, so there is nothing
    /// for a synced client to display differently, and bumping it would push every song in the
    /// database to every client and turn any pending offline edit into a false conflict.
    ///
    /// Postgres only: SQLite has no normalize() and needs none. The desktop and mobile databases are
    /// sync replicas whose comparisons go through the same composing comparer.
    /// </summary>
    public partial class NormalizeImportedTextToNfc : Migration
    {
        private const string Npgsql = "Npgsql.EntityFrameworkCore.PostgreSQL";

        private static readonly (string Table, string[] Columns)[] ImportedText =
        [
            ("Songs", ["Name", "Author", "Publisher"]),
            ("SongParts", ["Content"]),
            ("SongPartLabels", ["Text"]),
            ("SongArrangements", ["Name"]),
            ("SongVersions", ["Name", "Author", "PartsJson"])
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            if (migrationBuilder.ActiveProvider != Npgsql) return;

            foreach (var (table, columns) in ImportedText)
            {
                foreach (var column in columns)
                {
                    // The WHERE keeps the write off the rows that are already composed, which is most
                    // of them, and leaves their ModifiedAt untouched by any trigger that may be added later.
                    migrationBuilder.Sql(
                        $"""
                        UPDATE "{table}"
                        SET "{column}" = normalize("{column}", NFC)
                        WHERE "{column}" IS NOT NULL AND "{column}" <> normalize("{column}", NFC);
                        """);
                }
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Composing text is not reversible: the original mix of forms is not recorded anywhere,
            // and decomposing everything would be a different database, not the old one.
        }
    }
}
