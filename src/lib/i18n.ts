/**
 * i18n — react-i18next singleton (client).
 *
 * Translation sources (highest priority first):
 *   1. DB overrides (admin-managed, /api/public/translations)
 *   2. Built-in resources (src/lib/i18n-resources.ts — the seed source)
 *
 * The user's language choice persists in localStorage (`user_selected_lang`)
 * and auto-loads on the next visit. The admin can add languages + edit any
 * string from Admin → Languages.
 */
"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANG_KEY, resources } from "./i18n-resources";

export { LANG_KEY, LANGUAGES } from "./i18n-resources";
export type { LangCode } from "./i18n-resources";

/** Read the persisted language (guarded — runs on the client only). */
export function getStoredLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v && Object.keys(resources).includes(v) ? v : "en";
  } catch {
    return "en";
  }
}

const loadedBundles = new Set<string>();

/** Merge the admin-managed DB bundle for a language over the built-ins. */
async function loadDbBundle(lang: string): Promise<void> {
  if (loadedBundles.has(lang)) return;
  try {
    const res = await fetch(`/api/public/translations?lang=${encodeURIComponent(lang)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { translations?: { key: string; value: string }[] };
    const bundle: Record<string, string> = {};
    for (const t of data.translations ?? []) {
      if (t?.key && t?.value) bundle[t.key] = t.value;
    }
    if (Object.keys(bundle).length) {
      i18n.addResourceBundle(lang, "translation", bundle, true, true); // deep merge, override
    }
  } catch {
    /* offline — built-ins cover */
  }
  loadedBundles.add(lang);
}

/** Switch language (loads the DB bundle first) + persist the choice. */
export async function changeLanguage(lang: string): Promise<void> {
  await loadDbBundle(lang);
  void i18n.changeLanguage(lang);
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode — ignore */
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: getStoredLang(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  // Merge admin-managed overrides for the persisted language on first paint.
  void (async () => {
    await loadDbBundle(i18n.language);
    // Re-apply so listeners see the merged bundle.
    void i18n.changeLanguage(i18n.language);
  })();
}

/** Translate a DB market name (e.g. "Over/Under 2.5") through the resource
 *  keys, keeping any line suffix (2.5) untranslated. Falls back to the raw
 *  name for markets we don't know. */
export function tMarket(name: string): string {
  const known: Record<string, string> = {
    "Match Result": "market.matchResult",
    "Correct Score": "market.correctScore",
    "Both Teams To Score": "market.btts",
    "Half-Time Result": "market.halfTimeResult",
    "Double Chance": "market.doubleChance",
    "Draw No Bet": "market.drawNoBet",
    Winner: "market.winner",
  };
  const key = known[name] ?? (name.startsWith("Over/Under") ? "market.overUnder" : null);
  if (!key) return name;
  const line = name.startsWith("Over/Under") ? name.replace(/^Over\/Under/, "").trim() : "";
  const base = i18n.t(key);
  return line ? `${base} ${line}` : base;
}

export default i18n;
