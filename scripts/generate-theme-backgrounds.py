#!/usr/bin/env python3
"""
Generates the background art for the built-in slide themes.

The art is produced here rather than sourced from a photo library on purpose: the files ship inside
every Gospel Presenter installation, including self-hosted ones, so anything with an unclear licence
would be redistributed by our users. Everything this script draws is original and deterministic —
rerunning it reproduces the same bytes, which matters because the content hash of each file is part of
the URL the themes point at.

Usage (from the repository root):

    python3 scripts/generate-theme-backgrounds.py

It writes 1920x1080 WebP files into GospelPresenter/GospelPresenter.Shared/Themes/ and prints the
16-character content hash of each one. Those hashes belong in BuiltInThemes; a unit test fails if the
two ever disagree.
"""

import hashlib
import math
import pathlib
import struct
import subprocess
import tempfile

WIDTH = 1080  # rendered at half size and scaled up: the art is soft, so this costs nothing visually
HEIGHT = 608
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080

OUTPUT_DIR = pathlib.Path("GospelPresenter/GospelPresenter.Shared/Themes")


def lerp(a, b, t):
    return a + (b - a) * t


def radial(x, y, cx, cy, radius):
    """A soft falloff centred on (cx, cy), in 0..1 units of the canvas."""
    dx = (x - cx) * OUTPUT_WIDTH / OUTPUT_HEIGHT
    dy = y - cy
    distance = math.sqrt(dx * dx + dy * dy)
    return max(0.0, 1.0 - min(1.0, distance / radius)) ** 2


def aurora_pixel(u, v):
    """
    Deep blue-violet with two light sources: a cool one low left and a warm one high right. Dark
    enough that white text stays readable even before the theme's scrim is applied.
    """
    base = (14, 18, 38)
    cool = radial(u, v, 0.22, 0.78, 0.85)
    warm = radial(u, v, 0.80, 0.18, 0.75)
    vignette = 1.0 - 0.45 * radial(u, v, 0.5, 0.5, 1.6) ** 0.5

    r = base[0] + cool * 18 + warm * 96
    g = base[1] + cool * 42 + warm * 62
    b = base[2] + cool * 96 + warm * 40

    # A faint diagonal banding keeps large flat areas from looking like a compression artefact.
    band = math.sin((u * 3.1 + v * 2.3) * math.pi) * 3.0

    return tuple(
        max(0, min(255, int(round((channel + band) * vignette))))
        for channel in (r, g, b)
    )


def write_png(path, pixels, width, height):
    """A minimal PNG writer, so this script needs nothing but the standard library."""
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("3B", *pixels[y * width + x]) for x in range(width))
        for y in range(height)
    )

    import zlib

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">2I5B", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def render(name, shader):
    pixels = [
        shader(x / (WIDTH - 1), y / (HEIGHT - 1))
        for y in range(HEIGHT)
        for x in range(WIDTH)
    ]

    target = OUTPUT_DIR / name
    target.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp:
        source = pathlib.Path(temp.name)
    write_png(source, pixels, WIDTH, HEIGHT)

    subprocess.run(
        ["cwebp", "-quiet", "-q", "88", "-resize", str(OUTPUT_WIDTH), str(OUTPUT_HEIGHT),
         str(source), "-o", str(target)],
        check=True,
    )
    source.unlink()

    digest = hashlib.sha256(target.read_bytes()).hexdigest()[:16]
    print(f"{target}: {target.stat().st_size // 1024} kB, hash {digest}")


if __name__ == "__main__":
    render("aurora/background.webp", aurora_pixel)
