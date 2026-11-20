# PowerPoint through DeckCraft's libraries: the probes

The programs and scripts behind the measurements in `docs/powerpoint-deckcraft.md` (2026-11-20). Not built by this
repository: `gp-probe` is a member of DeckCraft's own workspace, so its pinned dependencies apply.

```sh
git clone --depth 1 https://github.com/storytold/deckcraft dc
cp -R spike/pptx-deckcraft/gp-probe dc/apps/gp-probe        # apps/* are workspace members
cd dc && cargo build --release -p gp-probe                   # Rust 1.95 or newer
```

- `src/lib.rs`: what Gospel Presenter would take: `pictures(pptx, scale)`, every slide at every click as PNG, and the
  C function `gp_pptx_pictures` a Swift shell would call.
- `src/main.rs` (`gp-probe DECK OUT`): every slide at every click, timed.
- `src/bin/frames.rs`: a slide's builds drawn whole every frame at 1920×1080, timed on 1, 4 and 8 threads.
- `src/bin/layers.rs`, `layers2.rs`: the layers method on one deck: layers drawn once, frames put together by offset,
  scale, rotation about the shape's centre, clip and opacity, against the slide drawn whole (`LAYER=2` draws the
  layers at twice the size; `ALL=1` writes every frame, for a film).
- `src/bin/corpus.rs` (`corpus FILE`): one JSON line per file: read or not, time per slide, and per animated step the
  layers against the whole drawing; layers in the shapes' own order, groups' transforms included.
- `src/bin/states.rs`: every slide after each click at 480×270, for the comparison with PowerPoint.
- `scripts/run_corpus.py`: `corpus` over a list of files, four at a time, 60 s each.
- `scripts/pp_export.py`: PowerPoint for Mac, by AppleScript, exports copies as PDF and as a movie; a file that hangs
  has PowerPoint restarted (macOS asks once for access to the output folder).
- `scripts/pp_compare.py`: DeckCraft's states against PowerPoint's PDF pages and movie frames.
- `scripts/drive.py`: the DeckCraft app driven through its control port (`--control`), the way weighed and left.

The test decks were LibreOffice's `sd/qa/unit/data/pptx` and Apache POI's `test-data/slideshow`, fetched file by file
from GitHub; they are not kept here.
