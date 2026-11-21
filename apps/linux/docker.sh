#!/bin/sh
# The Linux app built, tested and looked at in Docker on any machine (docs/linux-app.md): Arch Linux as Omarchy is,
# x86_64.
#   apps/linux/docker.sh build                the image, then the app
#   apps/linux/docker.sh test                 the app's unit tests
#   apps/linux/docker.sh shoot <dir> <steps>  the app on a fresh copy of the demo data in a virtual X server (Xvfb),
#                                             steps carried out in order and pictures saved in <dir>
# Steps, separated by ';': `wait <s>`, `shot <name>` (<dir>/<name>.png), `click <x> <y>`, `key <xdotool keys>`.
# GP_OPEN=<presentation id> opens one at the start; GP_LANG=en in English; ADW_DEBUG_COLOR_SCHEME=prefer-dark dark, as
# the system's dark mode makes it. GTK's Broadway backend was tried first: it
# stopped drawing after its first frame under Docker Desktop's x86_64 emulation, so the app is looked at through X.
set -eu
here=$(cd "$(dirname "$0")/../.." && pwd)
image=gp-linux-build
docker=${DOCKER:-docker}
in_docker() {
  "$docker" run --rm --platform linux/amd64 -v "$here":/src -v gp-linux-cargo:/cargo -v gp-linux-target:/target \
    -w /src/apps/linux "$@"
}
case "${1:-build}" in
  build)
    "$docker" build --platform linux/amd64 -t "$image" "$here/apps/linux"
    in_docker "$image" cargo build
    ;;
  test)
    in_docker "$image" cargo test
    ;;
  shoot)
    out=$(cd "${2:?a folder for the pictures}" && pwd)
    [ -f "$here/crates/gp-core/parity/.out/fixtures/demo.sqlite" ] || { echo "no demo data: run crates/gp-core/build.sh" >&2; exit 1; }
    in_docker -v "$out":/out -e GP_OPEN="${GP_OPEN:-}" -e GP_LANG="${GP_LANG:-}" \
      -e ADW_DEBUG_COLOR_SCHEME="${ADW_DEBUG_COLOR_SCHEME:-default}" -e STEPS="${3:-wait 8; shot app}" "$image" sh -c '
      mkdir -p /run/gp && cp /src/crates/gp-core/parity/.out/fixtures/demo.sqlite /run/gp/demo.sqlite
      Xvfb :9 -screen 0 1440x900x24 >/dev/null 2>&1 &
      sleep 1   # Xvfb opens its socket
      DISPLAY=:9 GDK_BACKEND=x11 /target/debug/gospel-presenter /run/gp/demo.sqlite 2>/out/app.log &
      echo "$STEPS" | tr ";" "\n" | while read -r what a b; do
        case "$what" in
          wait) sleep "$a" ;;
          shot) DISPLAY=:9 import -window root "/out/$a.png" ;;
          click) DISPLAY=:9 xdotool mousemove "$a" "$b" click 1 ;;
          key) DISPLAY=:9 xdotool key $a $b ;;
          "") ;;
          *) echo "unknown step: $what" >&2 ;;
        esac
      done'
    ;;
  *) echo "usage: $0 build|test|shoot <dir> <steps>" >&2; exit 2 ;;
esac
