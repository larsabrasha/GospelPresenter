// The collation data the core orders names by (crates/gp-core/src/collation.rs): ICU4X's collator and the NFD
// normalizer it needs, for Swedish and English, each language's standard order only. ICU4X's datagen command always
// adds the Han tailorings (und-Hans, und-Hant: some 270 kB of the core's WASM), which a church's Swedish or English
// names never need, so this exports through ICU4X's library with them left out. Measured on 2026-11-18: 334 kB, 89 kB
// with brotli, of which the data is about a third.
use icu_collator::provider::*;
use icu_normalizer::provider::{NormalizerNfdDataV1, NormalizerNfdTablesV1};
use icu_provider::export::*;
use icu_provider::prelude::*;
use icu_provider_export::baked_exporter::{BakedExporter, Options};
use icu_provider_export::prelude::*;
use icu_provider_source::SourceDataProvider;
use std::collections::BTreeSet;

/// The source, with the Han tailorings left out.
struct WithoutHan<P>(P);

impl<P: DynamicDataProvider<ExportMarker>> DynamicDataProvider<ExportMarker> for WithoutHan<P> {
    fn load_data(&self, marker: DataMarkerInfo, req: DataRequest) -> Result<DataResponse<ExportMarker>, DataError> { self.0.load_data(marker, req) }
}

impl<P: IterableDynamicDataProvider<ExportMarker>> IterableDynamicDataProvider<ExportMarker> for WithoutHan<P> {
    fn iter_ids_for_marker(&self, marker: DataMarkerInfo) -> Result<BTreeSet<DataIdentifierCow<'_>>, DataError> {
        let ids = self.0.iter_ids_for_marker(marker)?;
        if marker != CollationTailoringV1::INFO { return Ok(ids) }
        Ok(ids.into_iter().filter(|id| id.locale.script.is_none_or(|s| !matches!(s.as_str(), "Hans" | "Hant" | "Hani"))).collect())
    }
}

impl<P: ExportableProvider> ExportableProvider for WithoutHan<P> {
    fn supported_markers(&self) -> BTreeSet<DataMarkerInfo> { self.0.supported_markers() }
}

fn main() {
    let out = std::env::args().nth(1).expect("the directory to write the data to");
    let source = SourceDataProvider::new();
    let mut options = Options::default();
    options.use_separate_crates = true;
    options.overwrite = true;
    ExportDriver::new(
        ["sv", "en"].map(|l| DataLocaleFamily::with_descendants(l.parse().expect("a locale"))),
        DeduplicationStrategy::Maximal.into(),
        LocaleFallbacker::try_new_unstable(&source).expect("the fallback data"),
    )
    .with_markers([
        CollationDiacriticsV1::INFO, CollationJamoV1::INFO, CollationMetadataV1::INFO, CollationReorderingV1::INFO, CollationRootV1::INFO,
        CollationSpecialPrimariesV1::INFO, CollationTailoringV1::INFO, NormalizerNfdDataV1::INFO, NormalizerNfdTablesV1::INFO,
    ])
    // Each language's standard order: no traditional Swedish (v = w), no search tables.
    .with_marker_attributes_filter("collator", |a| a.is_empty())
    .export(&WithoutHan(source), BakedExporter::new(out.into(), options).expect("the output directory"))
    .expect("the export");
}
