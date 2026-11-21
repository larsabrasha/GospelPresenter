# The Linux app's build and run environment: Arch Linux, as Omarchy is (docs/linux-app.md). GTK 4 and libadwaita from
# Arch's own packages; GTK's Broadway backend (gtk4-broadwayd) shows the app in a browser, so it can be looked at from
# a Mac without a Wayland compositor. Node reads apps/web/src/i18n.ts for the texts (crates/gp-tui/build.rs).
FROM archlinux:latest
# pacman's download sandbox (seccomp, Landlock) fails under Docker Desktop's x86_64 emulation on a Mac.
RUN sed -i 's/^#DisableSandbox/DisableSandbox/' /etc/pacman.conf && grep -q '^DisableSandbox' /etc/pacman.conf \
    || sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
RUN pacman -Syu --noconfirm --needed \
      base-devel rust gtk4 libadwaita nodejs pkgconf fontconfig cantarell-fonts ttf-dejavu adwaita-icon-theme \
      xorg-server-xvfb xdotool imagemagick \
    && pacman -Scc --noconfirm
ENV CARGO_HOME=/cargo CARGO_TARGET_DIR=/target
WORKDIR /src
