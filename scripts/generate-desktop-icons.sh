#!/usr/bin/env bash
#
# Generates the desktop test app's icon so it matches the real app's:
#
#   GospelPresenter.Desktop/icon-test.png   from Resources/AppIcon/appiconfg-test.svg
#
# Run it after changing appiconfg-test.svg. The output is committed, because
# electron-builder needs a PNG at package time and there is no equivalent of the
# MauiIcon item's build-time compositing here.
#
# icon.png -- the real app's -- is the REFERENCE, not an output. It predates this
# script and is left byte for byte alone; everything below is measured from it so
# the two icons cannot drift. Regenerating it from the SVG would be a redesign of
# the shipped icon, which is not this script's job.
#
# WHAT IS MEASURED, AND WHY IT HAS TO BE
#
# electron-builder does not apply the macOS icon mask -- it scales the PNG
# straight into the .icns -- so the rounded tile and the inset have to be in the
# source file. icon.png carries them: a white rounded tile of 824px inset 100px
# in a 1024px canvas, which is the macOS Big Sur icon grid, with the play mark at
# 470px, or 57% of the tile. Rather than restate those numbers here, where they
# could fall out of step with the file, the tile is lifted from icon.png's own
# alpha channel and the mark's width is read off its blue.
#
# Both SVGs have their artwork on the same bounding box -- the TEST badge sits
# inside the play mark's box rather than extending it -- so scaling the test
# artwork to the measured width puts the mark at identical size and position in
# the two icons, and the badge is the only difference. Asserted at the end rather
# than assumed.
#
set -euo pipefail

for tool in rsvg-convert magick; do
    command -v "$tool" >/dev/null || { echo "$tool is not installed (brew install librsvg imagemagick)" >&2; exit 1; }
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVG="$REPO_ROOT/GospelPresenter/GospelPresenter/Resources/AppIcon/appiconfg-test.svg"
REFERENCE="$REPO_ROOT/GospelPresenter/GospelPresenter.Desktop/icon.png"
OUTPUT="$REPO_ROOT/GospelPresenter/GospelPresenter.Desktop/icon-test.png"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The mark's extent in the reference, measured on the blue alone so the white
# cross and the orange badge cannot move the answer.
extent() {
    magick "$1" -alpha remove -background white \
        -fuzz 30% -fill white +opaque '#3AABEB' \
        -fuzz 5% -transparent white -trim -format '%wx%h @ %X%Y' info:
}
reference_mark="$(extent "$REFERENCE")"
mark_width="${reference_mark%%x*}"

# The tile: the reference's own alpha channel, filled white. Its opaque region is
# exactly the tile, since the mark sits inside it.
#
# PNG32 and the explicit sRGB are not decoration. A white shape on transparency
# has no chroma, so ImageMagick stores it as grayscale -- and compositing a
# colour mark onto a grayscale canvas silently collapses every pixel to its first
# channel. The blue #3AABEB came out #3A3A3A and the orange badge came out white,
# with no warning anywhere and a plausible-looking icon at the end of it.
magick "$REFERENCE" -alpha extract "$WORK/mask.png"
magick -size "$(magick "$REFERENCE" -format '%wx%h' info:)" xc:white \
    "$WORK/mask.png" -alpha off -compose CopyOpacity -composite \
    -colorspace sRGB "PNG32:$WORK/tile.png"

# Rendered at 4x and scaled down rather than rendered at the target size: the
# SVGs declare width="100%", so rsvg maps the viewBox to whatever it is given,
# and the artwork does not fill its own viewBox. Trimming a large render is what
# makes the width above mean the mark's width rather than the viewBox's.
rsvg-convert -w 4096 -h 4096 "$SVG" -o "$WORK/big.png"
magick "$WORK/big.png" -colorspace sRGB -trim +repage -resize "${mark_width}x" "PNG32:$WORK/fg.png"
magick "$WORK/tile.png" "$WORK/fg.png" -gravity center -compose over -composite "PNG32:$OUTPUT"

# The mark has to land in the same place in both, or "the test icon is the real
# one plus a badge" stops being true and nobody notices until they are side by
# side in the Dock.
#
# Not a string comparison of the two extents, for two reasons. The width is equal
# by construction -- it is what the artwork was resized to -- so comparing it
# proves nothing. And the height comes out of integer resampling, so it lands
# within a pixel of the reference rather than on it: 505 against 506 here, which
# is not a divergence and should not read as one.
#
# What would be a divergence is the test artwork's bounding box no longer
# matching the real one's -- someone moving the badge outside the play mark, say.
# That shows up as a height off by more than rounding, or as a shifted origin,
# and those are what this checks.
output_mark="$(extent "$OUTPUT")"
read -r ref_h ref_x ref_y out_h out_x out_y <<EOF
$(python3 - "$reference_mark" "$output_mark" <<'PY'
import re, sys
for spec in sys.argv[1:3]:
    w, h, x, y = map(int, re.match(r'(\d+)x(\d+) @ \+(\d+)\+(\d+)', spec).groups())
    print(h, x, y, end=' ')
PY
)
EOF
if (( ref_x != out_x || ref_y != out_y || ref_h - out_h > 1 || out_h - ref_h > 1 )); then
    echo "The mark is not in the same place in both icons:" >&2
    echo "  icon.png      $reference_mark" >&2
    echo "  icon-test.png $output_mark" >&2
    echo "The test artwork's bounding box no longer matches the real one's." >&2
    exit 1
fi

echo "Wrote icon-test.png; the mark is $output_mark against icon.png's $reference_mark."
