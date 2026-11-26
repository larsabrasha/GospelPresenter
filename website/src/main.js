import "./style.css";
import "./carousel.js";
import { initDownload } from "./download.js";

// The desktop app's download, filled in from the GitHub Releases API.
initDownload();

/** The language chosen with EN / SV, or null: none chosen, or storage the browser refuses. */
function chosenLang() {
  try {
    return localStorage.getItem("lang");
  } catch {
    return null;
  }
}

/** The first of Swedish and English in the browser's languages, in its order; English when it names neither. */
function browserLang() {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.map((l) => l.slice(0, 2).toLowerCase()).find((l) => l === "sv" || l === "en") ?? "en";
}

// The front page in the visitor's language: the one chosen with EN / SV, else the browser's. An address that names a
// language (/sv/) is left as it is.
if (location.pathname === "/" && (chosenLang() ?? browserLang()) === "sv") {
  location.replace("/sv/");
}

// Show navbar background on scroll
const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => {
  const scrolled = window.scrollY > 10;
  navbar.classList.toggle("bg-white/95", scrolled);
  navbar.classList.toggle("dark:bg-neutral-900/95", scrolled);
  navbar.classList.toggle("backdrop-blur-sm", scrolled);
  navbar.classList.toggle("shadow-sm", scrolled);
}, { passive: true });

// A language chosen with EN / SV is kept, so the front page opens in it next time.
document.querySelectorAll("[data-lang]").forEach((el) => {
  el.addEventListener("click", () => {
    try {
      localStorage.setItem("lang", el.dataset.lang);
    } catch {
      // Storage refused (a private window): the choice holds for this visit only.
    }
  });
});

