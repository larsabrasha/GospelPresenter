"""Runs the corpus probe on every file, four at a time, each in its own process with a 60 s limit."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

D = os.path.dirname(os.path.abspath(__file__))
BIN = f"{D}/dc/target/release/corpus"
files = [l.strip() for l in open(f"{D}/corpus/files.txt") if l.strip()]

def one(path):
    name = os.path.basename(path)
    try:
        r = subprocess.run([BIN, path], capture_output=True, text=True, timeout=60)
        line = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
        if line:
            return line
        return json.dumps({"file": name, "ok": False, "error": f"exit {r.returncode}: {r.stderr.strip()[-200:]}"})
    except subprocess.TimeoutExpired:
        return json.dumps({"file": name, "ok": False, "error": "timeout 60 s"})

with ThreadPoolExecutor(4) as ex, open(f"{D}/corpus/results.jsonl", "w") as out:
    for line in ex.map(one, files):
        out.write(line + "\n")
print("done", len(files))
