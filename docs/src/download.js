// Fills in the download section from the GitHub Releases API, so a release never requires
// redeploying this site. See adr/0002-app-distribution-and-updates.md (8), (15).
//
// The site is static on GitHub Pages: there is no server to detect the visitor's platform or to
// know which version is current. Both are therefore done here, in the browser. The repository is
// public, so the API needs no token; unauthenticated callers get 60 requests an hour per IP, which
// is far more than a landing page uses.

const REPO = "larsabrasha/GospelPresenter";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/**
 * Which build this visitor wants. Only macOS has a download today -- Windows follows in 1.1, and
 * iOS and Android go through their stores -- so everyone else is pointed at the web app instead of
 * being offered a file that would not run.
 */
function detectPlatform() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, and a touch-capable "Mac" is one. It must not be offered a .pkg.
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/Mac/.test(ua) && !isIpad) return "mac";
  if (/Win/.test(ua)) return "windows";
  return "other";
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

  const platform = detectPlatform();
  const other = document.getElementById("download-other");

  // Nothing to install on these yet; say so rather than hiding the section, since a visitor who
  // heard there is an app should learn where it is up to.
  if (platform !== "mac") {
    section.classList.remove("hidden");
    document.getElementById("download-primary").href = "https://app.gospelpresenter.com";
    document.getElementById("download-primary-label").textContent = t.tUseWeb;
    other.textContent = platform === "windows" ? t.tWindowsSoon : t.tOtherPlatform;
    document.querySelector("#download details")?.remove();
    return;
  }

  try {
    const release = await loadLatestRelease();
    const pkg = release.assets.find((a) => a.name.endsWith("-Setup.pkg"));
    if (!pkg) throw new Error("The latest release has no .pkg asset");

    const link = document.getElementById("download-primary");
    link.href = pkg.browser_download_url;

    const version = (release.tag_name || "").replace(/^v/, "");
    const date = new Date(release.published_at).toLocaleDateString(document.documentElement.lang);
    document.getElementById("download-meta").textContent =
      `${t.tVersion} ${version} · ${formatSize(pkg.size)} · ${date}`;

    other.innerHTML =
      `<a class="underline hover:text-sky-500" href="${RELEASES_PAGE}">${t.tAllReleases}</a>`;

    section.classList.remove("hidden");
  } catch (error) {
    // Rate limited, offline, or no release published yet. Falling back to the releases page keeps
    // the section useful; inventing a filename would produce a 404 the visitor cannot diagnose.
    console.warn("Could not read the latest release from GitHub:", error);
    document.getElementById("download-primary").href = RELEASES_PAGE;
    document.getElementById("download-meta").textContent = t.tUnknownVersion;
    section.classList.remove("hidden");
  }
}
