"""DeckCraft against PowerPoint, per exported file (ppref/NN.*):

- each slide after its last click (DeckCraft) against the PowerPoint PDF page most like it;
- each slide after each click against the PowerPoint movie frame most like it (10 frames a second).

Pixels count as apart when a channel differs by more than 24; 480×270 throughout. One JSON line per file.
"""
import glob, json, os, subprocess, sys
import numpy as np
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
REF = f"{D}/ppref"
STATES = f"{D}/dc/target/release/states"


def load(p):
    im = Image.open(p).convert("RGB")
    if im.size != (480, 270):
        im = im.resize((480, 270), Image.BILINEAR)
    return np.asarray(im, dtype=np.int16)


def apart(a, b):
    return float((np.abs(a - b).max(axis=2) > 24).mean() * 100)


def best(img, pool):
    if not pool:
        return None, None
    scores = [apart(img, q) for q in pool]
    i = int(np.argmin(scores))
    return scores[i], i


log = [json.loads(l) for l in open(f"{D}/ppref.log") if l.startswith("{")]
for row in log:
    stem = f"{row['i']:02d}"
    work = f"{REF}/{stem}-cmp"
    os.makedirs(work, exist_ok=True)
    out = {"file": row["file"], "export": row["status"]}
    st = f"{work}/states"
    if not glob.glob(f"{st}/*.png"):
        r = subprocess.run([STATES, f"{REF}/{stem}.pptx", st], capture_output=True, text=True, timeout=300)
        if r.returncode:
            out["error"] = r.stderr.strip()[-200:]
            print(json.dumps(out), flush=True)
            continue
    states = sorted(glob.glob(f"{st}/*.png"))
    if row["pdf"]:
        if not glob.glob(f"{work}/pdf-*.png"):
            subprocess.run(["pdftoppm", "-png", "-scale-to-x", "480", "-scale-to-y", "270", f"{REF}/{stem}.pdf", f"{work}/pdf"], timeout=300)
        pages = [load(p) for p in sorted(glob.glob(f"{work}/pdf-*.png"))]
        last = {}
        for p in states:
            s = os.path.basename(p).split("-c")[0]
            last[s] = p  # sorted, so the last click's
        scores = [best(load(p), pages)[0] for p in last.values()]
        scores = [x for x in scores if x is not None]
        out["pdf"] = {"slides": len(last), "pages": len(pages), "median": round(float(np.median(scores)), 2) if scores else None,
                      "under1": sum(x < 1 for x in scores), "under5": sum(x < 5 for x in scores), "worst": round(max(scores), 2) if scores else None}
    if row["mp4"]:
        if not glob.glob(f"{work}/mov-*.png"):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f"{REF}/{stem}.mp4", "-vf", "fps=10,scale=480:270", f"{work}/mov-%05d.png"], timeout=600)
        frames = [load(p) for p in sorted(glob.glob(f"{work}/mov-*.png"))]
        per = []
        for p in states:
            score, _ = best(load(p), frames)
            per.append((os.path.basename(p)[:-4], round(score, 2)))
        sc = [x for _, x in per]
        out["movie"] = {"states": len(per), "frames": len(frames), "median": round(float(np.median(sc)), 2) if sc else None,
                        "under1": sum(x < 1 for x in sc), "under5": sum(x < 5 for x in sc), "worst": sorted(per, key=lambda x: -x[1])[:3]}
    print(json.dumps(out, ensure_ascii=False), flush=True)
