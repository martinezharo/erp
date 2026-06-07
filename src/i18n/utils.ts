// Server-side i18n helpers (no DOM access). Used by middleware, .astro
// frontmatter and API routes.
import { ui, defaultLang, type Lang } from "./ui";

const SUPPORTED: Lang[] = ["es", "en"];

export type TranslateParams = Record<string, string | number>;
export type TranslateFn = (key: string, params?: TranslateParams) => string;

/**
 * Pick the best language from an Accept-Language header.
 * Walks the header in priority (q) order and returns the first supported
 * language tag found. Falls back to `defaultLang` (English) when none match.
 */
export function getLangFromHeader(acceptLanguage: string | null): Lang {
  if (!acceptLanguage) return defaultLang;

  const tags = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { lang: tag.toLowerCase().split("-")[0], q: isNaN(q) ? 1 : q };
    })
    .filter((t) => t.lang)
    .sort((a, b) => b.q - a.q);

  for (const { lang } of tags) {
    if (SUPPORTED.includes(lang as Lang)) return lang as Lang;
  }
  return defaultLang;
}

/** Intl locale string used for date/number/currency formatting. */
export function getLocale(lang: Lang): string {
  return lang === "es" ? "es-ES" : "en-GB";
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match
  );
}

/** Returns a translate function bound to a language, with fallback chain. */
export function useTranslations(lang: Lang): TranslateFn {
  return (key, params) => {
    const value = ui[lang]?.[key] ?? ui[defaultLang]?.[key] ?? key;
    return interpolate(value, params);
  };
}
