"""Drives DeckCraft through its control port as Gospel Presenter would: open, show, step, black, end."""
import json, socket, subprocess, sys, time, os

D = os.path.dirname(os.path.abspath(__file__))
APP = f"{D}/dc/target/release/deckcraft"
DECK = f"{D}/src/Långfredagen 2026.pptx"
PORT = 47911
OUT = f"{D}/drive"
os.makedirs(OUT, exist_ok=True)

t0 = time.time()
proc = subprocess.Popen([APP, "--control", str(PORT)], stdout=open(f"{OUT}/app.log", "w"), stderr=subprocess.STDOUT)
sock = None
for _ in range(200):
    try:
        sock = socket.create_connection(("127.0.0.1", PORT), timeout=60)
        break
    except OSError:
        time.sleep(0.05)
if not sock:
    print("no control port"); proc.kill(); sys.exit(1)
print(f"control port up after {time.time() - t0:.2f} s")
f = sock.makefile("rw")
n = 0

def call(method, params=None, quiet=False):
    global n
    n += 1
    s = time.time()
    f.write(json.dumps({"id": n, "method": method, "params": params or {}}) + "\n"); f.flush()
    reply = json.loads(f.readline())
    ms = (time.time() - s) * 1000
    if not quiet:
        r = reply.get("result") if reply.get("ok") else reply.get("error")
        print(f"{method:14} {json.dumps(params or {}, ensure_ascii=False)[:60]:62} {ms:7.1f} ms  {'ok' if reply.get('ok') else 'ERR'} {json.dumps(r, ensure_ascii=False)[:160]}")
    return reply, ms

def show_state():
    r, _ = call("ui.inspect", quiet=True)
    res = r.get("result") or {}
    return {k: v for k, v in res.items() if 'show' in k.lower() or k in ("slide", "view")}

try:
    s = time.time(); call("app.open", {"path": DECK}); print(f"  opened in {(time.time()-s):.2f} s")
    # The window to the second display (the built-in one, right of the main), where the show then goes full screen.
    mv = subprocess.run(["osascript", "-e", f'tell application "System Events" to tell (first process whose unix id is {proc.pid}) to set position of window 1 to {{2600, 40}}'], capture_output=True, text=True, timeout=20)
    print("move window:", mv.returncode, (mv.stdout + mv.stderr).strip()[:200])
    time.sleep(0.5)
    r, _ = call("ui.inspect", quiet=True)
    print("window:", json.dumps((r.get("result") or {}).get("window"), ensure_ascii=False)[:200])
    call("show.start", {"from": 0})
    time.sleep(1)
    print("state:", json.dumps(show_state(), ensure_ascii=False)[:400])
    call("ui.screenshot", {"path": f"{OUT}/show-0.png"})
    steps = []
    for i in range(1, 6):
        _, ms = call("ui.key", {"key": "ArrowRight"})
        steps.append(ms)
        time.sleep(0.6)
        call("ui.screenshot", {"path": f"{OUT}/show-{i}.png"}, quiet=True)
    print("state:", json.dumps(show_state(), ensure_ascii=False)[:400])
    call("ui.key", {"key": "B"})
    time.sleep(0.4)
    call("ui.screenshot", {"path": f"{OUT}/black.png"}, quiet=True)
    call("ui.key", {"key": "B"})
    call("ui.key", {"key": "ArrowLeft"})
    call("show.end")
    print(f"steps: {', '.join(f'{x:.0f}' for x in steps)} ms")
finally:
    try: call("app.quit", {"save": False}, quiet=True)
    except Exception: pass
    time.sleep(0.5); proc.kill()
