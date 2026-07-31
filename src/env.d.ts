/// <reference types="astro/client" />

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Lang } from "./i18n/ui";
import type { TranslateFn } from "./i18n/utils";

declare global {
  namespace App {
    interface Locals {
      lang: Lang;
      locale: string;
      t: TranslateFn;
      /**
       * Set by the middleware once the session has been validated. Absent on
       * public routes, on the self-authenticating /api/v1 routes, and in demo
       * mode — so its presence is proof of a real session, never an assumption.
       */
      user?: User;
      /** Supabase client acting as `user`, reusable without re-validating. */
      supabase?: SupabaseClient;
    }
  }

  interface Window {
    __LANG__?: string;
    __LOCALE__?: string;
    __I18N__?: Record<string, string>;
  }
}

export {};
