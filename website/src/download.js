// Fills in the desktop app's download from the GitHub Releases API, so a release needs no new deploy of this site
// (docs/desktop-app.md "Releases"). Restored for 2.0 (Lars, 2026-11-26) from 1.x's, with three changes: the newest
// published `v…` release is taken, a pre-release too (GitHub's "latest" leaves pre-releases and the `web-v…` server
// releases out, or in where they are not wanted); a Mac gets the Apple Silicon build with the Intel one beside it, as a
// browser cannot tell which a Mac has; and the unsigned app's first start is told for Windows as for a Mac.
//
// The site is static: the visitor's system and the current version are found here, in the browser. The repository is
// public, so the API needs no token (60 requests an hour per address, plenty for a landing page).

const REPO = "larsabrasha/GospelPresenter";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const WEB_APP = "https://app.gospelpresenter.com";

/** Each system's installer in a release (desktop-release.yml), and the words on its button. */
const PLATFORMS = {
  mac: { suffix: "-arm64.dmg", label: "tForMac" },
  windows: { suffix: ".exe", label: "tForWindows" },
  linux: { suffix: ".AppImage", label: "tForLinux" },
};

/** Which build this visitor wants, or null for a phone or a tablet, which is pointed at the web app instead. */
function detectPlatform() {
  const ua = navigator.userAgent;
  // iPadOS calls itself a Mac; a Mac with touch is one, and must not be offered a .dmg.
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/Mac/.test(ua) && !isIpad) return "mac";
  if (/Win/.test(ua)) return "windows";
  // Android calls itself Linux: excluded first, or a phone is offered an AppImage.
  if (/Linux/.test(ua) && !/Android/.test(ua)) return "linux";
  return null;
}

const formatSize = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** The newest published desktop release, a pre-release too; null when there is none yet. */
async function loadRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub API answered ${response.status}`);
  const releases = await response.json();
  return releases.find((r) => !r.draft && /^v\d/.test(r.tag_name)) ?? null;
}

/** A link in the small line under the button. */
const smallLink = (href, text) => `<a class="underline hover:text-sky-500" href="${href}">${text}</a>`;

export async function initDownload() {
  const section = document.getElementById("download");
  if (!section) return;
  // The words come from data-t-* attributes, which the site's build has filled in for this page's language.
  const t = section.dataset;
  const link = document.getElementById("download-primary");
  const label = document.getElementById("download-primary-label");
  const other = document.getElementById("download-other");
  const unsigned = document.getElementById("download-unsigned");
  const platform = detectPlatform();

  // Nothing to install on a phone or tablet: say so, and offer the web app.
  if (platform === null) {
    link.href = WEB_APP;
    label.textContent = t.tUseWeb;
    other.textContent = t.tOtherPlatform;
    unsigned.remove();
    section.classList.remove("hidden");
    return;
  }

  const { suffix, label: labelKey } = PLATFORMS[platform];
  label.textContent = t[labelKey];
  // The unsigned app's first start: macOS blocks it, Windows warns; Linux says nothing.
  if (platform === "linux") unsigned.remove();
  else document.getElementById("download-unsigned-body").textContent = platform === "mac" ? t.tUnsignedMac : t.tUnsignedWindows;

  try {
    const release = await loadRelease();
    // No release published yet (a draft is seen by no one): the section stays hidden.
    if (!release) return;
    const asset = release.assets.find((a) => a.name.endsWith(suffix));
    // A release without this system's build (one system's build may fail): the web app, not a 404.
    if (!asset) {
      link.href = WEB_APP;
      label.textContent = t.tUseWeb;
      other.textContent = t.tNoBuildForPlatform;
      unsigned.remove();
      section.classList.remove("hidden");
      return;
    }
    link.href = asset.browser_download_url;
    const version = release.tag_name.replace(/^v/, "");
    const date = new Date(release.published_at).toLocaleDateString(document.documentElement.lang);
    document.getElementById("download-meta").textContent = `${t.tVersion} ${version} · ${formatSize(asset.size)} · ${date}`;
    const links = [smallLink(release.html_url, t.tAllReleases)];
    const intel = platform === "mac" && release.assets.find((a) => a.name.endsWith("-x64.dmg"));
    if (intel) links.unshift(smallLink(intel.browser_download_url, t.tForMacIntel));
    other.innerHTML = links.join(" · ");
    section.classList.remove("hidden");
  } catch (error) {
    // Rate limited or offline: the releases page, rather than a guessed file name that would be a 404.
    console.warn("Could not read the desktop release from GitHub:", error);
    link.href = RELEASES_PAGE;
    document.getElementById("download-meta").textContent = t.tUnknownVersion;
    section.classList.remove("hidden");
  }
}
