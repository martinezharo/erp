/// <reference types="astro/client" />

import type { Lang } from "./i18n/ui";
import type { TranslateFn } from "./i18n/utils";

declare global {
  namespace App {
    interface Locals {
      lang: Lang;
      locale: string;
      t: TranslateFn;
    }
  }

  interface Window {
    __LANG__?: string;
    __LOCALE__?: string;
    __I18N__?: Record<string, string>;
  }
}

export {};
