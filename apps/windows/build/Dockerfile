# The tools to build the core for Windows from a Mac or Linux (docs/windows-app.md): cargo-xwin, which fetches
# Microsoft's CRT and Windows SDK and links with lld-link, and uniffi-bindgen-cs, the C# bindings' generator. The
# repository is mounted at /src; see apps/windows/build/core.sh.
FROM rust:1.100.0-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends clang lld llvm && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc
RUN cargo install --locked cargo-xwin@0.18.6
# The generator for UniFFI 0.32 (the core pins 0.32.2; a patch release keeps the metadata's format).
RUN cargo install uniffi-bindgen-cs --git https://github.com/NordSecurity/uniffi-bindgen-cs --tag v0.12.0+v0.32.0
ENV XWIN_CACHE_DIR=/xwin
# The image's Rust, not rust-toolchain.toml's list of targets (WASM, iOS), which rustup would fetch on every run.
ENV RUSTUP_TOOLCHAIN=1.100.0
WORKDIR /src
