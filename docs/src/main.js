import "./style.css";
import "./carousel.js";

// Redirect to preferred language if on default path
// Skip if the user has previously chosen a language manually
if (location.pathname === "/" && !localStorage.getItem("lang")) {
  const lang = navigator.language.slice(0, 2);
  if (lang === "sv") {
    location.replace("/sv/");
  }
}

// Show navbar background on scroll
const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => {
  const scrolled = window.scrollY > 10;
  navbar.classList.toggle("bg-white/95", scrolled);
  navbar.classList.toggle("dark:bg-neutral-900/95", scrolled);
  navbar.classList.toggle("shadow-sm", scrolled);
}, { passive: true });

// Mark manual language choice when clicking a language link
document.querySelectorAll("[data-lang]").forEach((el) => {
  el.addEventListener("click", () => {
    localStorage.setItem("lang", el.dataset.lang);
  });
});
