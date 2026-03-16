import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const languages = ["en", "sv"];
const defaultLang = "en";

function loadTranslations() {
  const translations = {};
  for (const lang of languages) {
    const file = resolve(__dirname, `src/i18n/${lang}.json`);
    translations[lang] = JSON.parse(readFileSync(file, "utf-8"));
  }
  return translations;
}

function injectTranslations(html, lang, translations) {
  const t = translations[lang];

  // Set lang attribute on <html>
  html = html.replace(/<html([^>]*) lang="[^"]*"/, `<html$1 lang="${lang}"`);

  // Replace {{key}} placeholders with translations
  html = html.replace(/\{\{(\w+)\}\}/g, (match, key) => t[key] ?? match);

  // Highlight active language link
  html = html.replace(
    /(<a [^>]*data-lang="([^"]+)"[^>]*class=")/g,
    (match, before, langAttr) => {
      return langAttr === lang ? `${before}font-bold text-sky-500 ` : match;
    },
  );

  return html;
}

function i18nPlugin() {
  let translations;
  let isBuild = false;

  return {
    name: "i18n-pages",

    configResolved(config) {
      translations = loadTranslations();
      isBuild = config.command === "build";
    },

    // Dev: serve root index.html for language paths
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (/^\/sv\/?$/.test(req.url)) {
          req.url = "/index.html";
        }
        next();
      });
    },

    // Inject translations into HTML
    // During dev: replace {{key}} with the correct language
    // During build: leave {{key}} intact for closeBundle to handle
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (isBuild) return html;
        const url = ctx.originalUrl || "";
        const lang = url.startsWith("/sv") ? "sv" : defaultLang;
        return injectTranslations(html, lang, translations);
      },
    },

    // Build: generate all language versions from the built template
    closeBundle() {
      const distDir = resolve(__dirname, "dist");
      const template = readFileSync(resolve(distDir, "index.html"), "utf-8");

      for (const lang of languages) {
        const translated = injectTranslations(template, lang, translations);
        if (lang === defaultLang) {
          writeFileSync(resolve(distDir, "index.html"), translated);
        } else {
          const dir = resolve(distDir, lang);
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, "index.html"), translated);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), i18nPlugin()],
  server: {
    allowedHosts: ["docstest.gospelpresenter.com"],
  },
});
