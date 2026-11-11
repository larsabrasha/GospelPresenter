// Fills in the download section from the GitHub Releases API, so a release never requires
// redeploying this site. See adr/0002-app-distribution-and-updates.md (8), (15).
//
// The site is static on GitHub Pages: there is no server to detect the visitor's platform or to
// know which version is current. Both are therefore done here, in the browser. The repository is
// public, so the API needs no token; unauthenticated callers get 60 requests an hour per IP, which
// is far more than a landing page uses.

const REPO = "larsabrasha/GospelPresenter";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const WEB_APP = "https://app.gospelpresenter.com";

/**
 * What each platform downloads, and how its asset is recognised in a release.
 *
 * The suffix is the human's installer, not everything the release holds: a macOS release also
 * carries a .zip, which exists for Squirrel.Mac to update from and is not something to hand a
 * visitor, and every installer is accompanied by a .blockmap for differential updates.
 */
const PLATFORMS = {
  mac: { suffix: ".dmg", label: "tForMac" },
  windows: { suffix: ".exe", label: "tForWindows" },
  linux: { suffix: ".AppImage", label: "tForLinux" },
};

/**
 * Which build this visitor wants, or null for a device with no desktop app at all — a phone or a
 * tablet, which is pointed at the web app rather than offered a file that would not run.
 */
function detectPlatform() {
  const ua = navigator.userAgent;

  // iPadOS reports itself as a Mac, and a touch-capable "Mac" is one. It must not be offered a .dmg.
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/Mac/.test(ua) && !isIpad) return "mac";

  if (/Win/.test(ua)) return "windows";

  // Android reports itself as Linux, so the order matters: everything Android must be excluded
  // before a Linux match, or a phone is offered an AppImage.
  if (/Linux/.test(ua) && !/Android/.test(ua)) return "linux";

  return null;
}

function formatSize(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

async function loadLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub API answered ${response.status}`);
  return response.json();
}

export async function initDownload() {
  const section = document.getElementById("download");
  if (!section) return;

  // The strings come from data-t-* attributes on the section, which the site's build-time i18n
  // has already filled in for this language -- rather than a second translation mechanism here.
  const t = section.dataset;

  const link = document.getElementById("download-primary");
  const label = document.getElementById("download-primary-label");
  const other = document.getElementById("download-other");
  const platform = detectPlatform();

  // The first-launch warning is macOS-only: it is Gatekeeper that blocks an unsigned app, and
  // telling a Windows visitor about System Settings would be noise.
  if (platform !== "mac") document.querySelector("#download details")?.remove();

  // Nothing to install on a phone or tablet. Say so rather than hiding the section, since a visitor
  // who heard there is an app should learn where it is up to.
  if (platform === null) {
    link.href = WEB_APP;
    label.textContent = t.tUseWeb;
    other.textContent = t.tOtherPlatform;
    section.classList.remove("hidden");
    return;
  }

  const { suffix, label: labelKey } = PLATFORMS[platform];
  label.textContent = t[labelKey];

  try {
    const release = await loadLatestRelease();
    const asset = release.assets.find((a) => a.name.endsWith(suffix));

    // A release that built for some platforms and not others is a normal outcome — the workflow
    // does not stop the other two when one runner fails. Offer the web app rather than a 404.
    if (!asset) {
      link.href = WEB_APP;
      label.textContent = t.tUseWeb;
      other.textContent = t.tNoBuildForPlatform;
      document.querySelector("#download details")?.remove();
      section.classList.remove("hidden");
      return;
    }

    link.href = asset.browser_download_url;

    const version = (release.tag_name || "").replace(/^v/, "");
    const date = new Date(release.published_at).toLocaleDateString(document.documentElement.lang);
    document.getElementById("download-meta").textContent =
      `${t.tVersion} ${version} · ${formatSize(asset.size)} · ${date}`;

    other.innerHTML =
      `<a class="underline hover:text-sky-500" href="${RELEASES_PAGE}">${t.tAllReleases}</a>`;

    section.classList.remove("hidden");
  } catch (error) {
    // Rate limited, offline, or no release published yet. Falling back to the releases page keeps
    // the section useful; inventing a filename would produce a 404 the visitor cannot diagnose.
    console.warn("Could not read the latest release from GitHub:", error);
    link.href = RELEASES_PAGE;
    document.getElementById("download-meta").textContent = t.tUnknownVersion;
    section.classList.remove("hidden");
  }
}
