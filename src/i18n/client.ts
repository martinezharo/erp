// Browser-side i18n helper. Reads the dictionary + active language that the
// Layout injects into `window` (see Layout.astro). Mirrors the server `t` API
// so client `<script>` blocks can translate injected/alert text.
import type { TranslateParams } from "./utils";

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match
  );
}

export const lang: string = (typeof window !== "undefined" && window.__LANG__) || "en";
export const locale: string =
  (typeof window !== "undefined" && window.__LOCALE__) || "en-GB";

export function t(key: string, params?: TranslateParams): string {
  const dict = (typeof window !== "undefined" && window.__I18N__) || {};
  const value = dict[key] ?? key;
  return interpolate(value, params);
}
