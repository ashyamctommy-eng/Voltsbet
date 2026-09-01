"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { detectAndApplyLang, syncHtmlLang } from "@/lib/i18n";

/**
 * Global i18n bootstrap (mount once, near the root):
 *  1. Synchronizes the document's ISO language attributes on the ROOT html
 *     element — `<html lang="…" xml:lang="…">` — with the active language
 *     (keeps the server-rendered default `lang="en"` honest after hydration).
 *  2. Runs auto-geolocation on first visit: when the user has NO stored
 *     language override, the visitor's IP country (ipapi.co) is mapped to a
 *     supported language (KE/TZ/UG → sw, FR/CI/SN → fr, ES/AR → es, else en)
 *     and applied. A manual override (navbar selector, stored in
 *     localStorage `user_lang`) always wins and disables re-detection.
 */
export default function I18nSync() {
  const { i18n } = useTranslation();

  // Keep <html lang / xml:lang> in sync with the active language.
  useEffect(() => {
    syncHtmlLang(i18n.language);
    const onChange = (lng: string) => syncHtmlLang(lng);
    i18n.on("languageChanged", onChange);
    return () => {
      i18n.off("languageChanged", onChange);
    };
  }, [i18n]);

  // Auto-geolocation translator — runs once per session.
  useEffect(() => {
    void detectAndApplyLang();
  }, []);

  return null;
}
