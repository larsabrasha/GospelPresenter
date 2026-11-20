"""Exports copies of the animated corpus files and the sermon decks with PowerPoint: a PDF and a movie each.

Each file gets 90 s; a movie is done when its size has stopped growing and ffprobe reads it. A file that does not
finish (movies of files with sound hang) has PowerPoint quit by force and started again before the next one. Files
already exported are skipped. One JSON line per file, appended to ppref.log.
"""
import json, os, shutil, subprocess, time

D = os.path.dirname(os.path.abspath(__file__))
OUT = f"{D}/ppref"
os.makedirs(OUT, exist_ok=True)

animated = []
for line in open(f"{D}/corpus/results.jsonl"):
    r = json.loads(line)
    if r.get("ok") and r.get("steps"):
        animated.append(r["file"])
paths = {os.path.basename(p): p for p in (l.strip() for l in open(f"{D}/corpus/files.txt"))}
files = [paths[f] for f in animated if f in paths]
files += [f"{D}/src/{n}.pptx" for n in ("Långfredagen 2026", "Ord på vägen om vandringen", "Till Predikan 2025-03-30")]
files += [f"{D}/effects.pptx", f"{D}/built.pptx"]

done = set()
if os.path.exists(f"{D}/ppref.log"):
    for l in open(f"{D}/ppref.log"):
        if l.startswith("{"):
            r = json.loads(l)
            if r["status"] == "ok":
                done.add(r["i"])


def osa(script, timeout):
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)


def ready(path):
    return os.path.exists(path) and subprocess.run(["ffprobe", "-v", "error", path], capture_output=True).returncode == 0


def restart():
    subprocess.run(["pkill", "-9", "-x", "Microsoft PowerPoint"])
    time.sleep(3)
    for f in os.listdir(OUT):
        if f.startswith("~$"):
            os.remove(f"{OUT}/{f}")


log = open(f"{D}/ppref.log", "a")
for i, src in enumerate(files):
    if i in done:
        continue
    stem = f"{i:02d}"
    copy = f"{OUT}/{stem}.pptx"
    shutil.copy(src, copy)
    pdf, mp4 = f"{OUT}/{stem}.pdf", f"{OUT}/{stem}.mp4"
    for p in (pdf, mp4):
        if os.path.exists(p):
            os.remove(p)
    start = time.time()
    status = "ok"
    try:
        osa(f'tell application "Microsoft PowerPoint"\nopen POSIX file "{copy}"\ndelay 2\n'
            f'save active presentation in POSIX file "{pdf}" as save as PDF\n'
            f'save active presentation in POSIX file "{mp4}" as save as movie\nend tell', 60)
        last = -1
        while time.time() - start < 90:
            n = os.path.getsize(mp4) if os.path.exists(mp4) else 0
            if n > 0 and n == last and ready(mp4):
                break
            last = n
            time.sleep(2)
        else:
            status = "movie timeout"
    except subprocess.TimeoutExpired:
        status = "applescript timeout"
    if status == "ok":
        try:
            osa('tell application "Microsoft PowerPoint" to close active presentation saving no', 20)
        except subprocess.TimeoutExpired:
            status = "ok, close timeout"
    if status != "ok":
        restart()
    log.write(json.dumps({"i": i, "file": os.path.basename(src), "status": status, "secs": round(time.time() - start),
                          "pdf": os.path.exists(pdf), "mp4": ready(mp4)}) + "\n")
    log.flush()
print("done")
