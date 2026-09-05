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

import { standardizeMarketName } from "@/lib/market-labels";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANG_KEY, LEGACY_LANG_KEY, resources, countryToLang, RTL_LANGS } from "./i18n-resources";

export { LANG_KEY, LANGUAGES } from "./i18n-resources";
export type { LangCode } from "./i18n-resources";

/** Read the persisted language (guarded — runs on the client only).
 *  Migrates the pre-refactor `user_selected_lang` key to `user_lang` on
 *  first read so returning visitors keep their choice. */
export function getStoredLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    const legacy = window.localStorage.getItem(LEGACY_LANG_KEY);
    if (legacy && Object.keys(resources).includes(legacy) && !window.localStorage.getItem(LANG_KEY)) {
      window.localStorage.setItem(LANG_KEY, legacy);
      window.localStorage.removeItem(LEGACY_LANG_KEY);
    }
    const v = window.localStorage.getItem(LANG_KEY);
    if (v && Object.keys(resources).includes(v)) return v;
    const cookieLang = document.cookie
      .split("; ")
      .find((c) => c.startsWith("NEXT_LOCALE="))
      ?.split("=")[1];
    const c = cookieLang ? decodeURIComponent(cookieLang) : null;
    return c && Object.keys(resources).includes(c) ? c : "en";
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
    window.localStorage.removeItem(LEGACY_LANG_KEY);
    // Belt & braces: keep a top-level cookie in sync so the choice survives
    // any context that clears localStorage (and is readable server-side).
    try {
      document.cookie = `NEXT_LOCALE=${encodeURIComponent(lang)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch { /* ignore */ }
    syncHtmlLang(lang);
  } catch {
    /* private mode — ignore */
  }
}

/** Keep the document's ISO language attributes in sync with the active
 *  language: `<html lang="…" xml:lang="…">` + text direction (RTL for
 *  Arabic). */
export function syncHtmlLang(lang: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.setAttribute("xml:lang", lang);
  document.documentElement.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
}

const GEO_URL = "https://ipapi.co/json/";
const GEO_TIMEOUT_MS = 3500;
let geoDetected = false; // never re-detect in this session

/**
 * Auto-geolocation translator — called once per app load, BEFORE the user
 * makes any manual choice:
 *   - a stored override (`user_lang`) wins and is applied as-is;
 *   - otherwise the visitor's IP country is resolved (ipapi.co) and mapped
 *     to a supported language (KE/TZ/UG → sw, FR/CI/SN → fr, ES/AR → es,
 *     default en), which is then applied + persisted.
 * Safe to call repeatedly: it no-ops after the first run per session.
 */
export async function detectAndApplyLang(): Promise<string> {
  if (typeof window === "undefined") return "en";
  // A stored choice (any language, incl. explicit "en") always wins and
  // disables re-detection — presence of the key is the gate, not its value.
  let hasStored = false;
  try {
    hasStored = !!window.localStorage.getItem(LANG_KEY);
  } catch {
    /* private mode — key unreadable, fall through to detection */
  }
  if (hasStored || geoDetected) {
    void syncHtmlLang(i18n.language ?? "en");
    return i18n.language ?? "en";
  }
  // No stored choice → detect from IP (once per session).
  geoDetected = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    const res = await fetch(GEO_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { country_code?: string; error?: boolean };
      if (!data?.error && data.country_code) {
        const lang = countryToLang(data.country_code);
        await changeLanguage(lang);
        return lang;
      }
    }
  } catch {
    /* offline / blocked — English fallback */
  }
  return "en";
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
  // Standardize legacy provider terminology (Spread → Handicap) so existing
  // DB rows render with the canonical labels — no data migration needed.
  const canonical = standardizeMarketName(name);
  const known: Record<string, string> = {
    "Match Result": "market.matchResult",
    "Correct Score": "market.correctScore",
    "Both Teams To Score": "market.btts",
    "Half-Time Result": "market.halfTimeResult",
    "Double Chance": "market.doubleChance",
    "Draw No Bet": "market.drawNoBet",
    Winner: "market.winner",
  };
  const key = known[canonical] ?? (canonical.startsWith("Over/Under") ? "market.overUnder" : null);
  if (!key) return canonical;
  const line = canonical.startsWith("Over/Under") ? canonical.replace(/^Over\/Under/, "").trim() : "";
  const base = i18n.t(key);
  return line ? `${base} ${line}` : base;
}

/**
 * Translate the over/under word inside an outcome pick ("Over 2.5",
 * "Arsenal Under 1.5") using the active language pack
 * ("market.over"/"market.under"); lines and team prefixes pass through
 * untranslated. Outcomes without an Over/Under word return unchanged.
 */
export function tOutcome(outcome: string): string {
  const word = outcome.trim().match(/\b(Over|Under)\b/i)?.[1];
  if (!word) return outcome;
  const translated = word.toLowerCase() === "over" ? i18n.t("market.over") : i18n.t("market.under");
  return outcome.replace(/\b(Over|Under)\b/i, translated);
}

/**
 * Betslip market label: the translated market name, minus a numeric line
 * the outcome pick already carries — avoids "Over/Under 2.5 · Over 2.5".
 */
export function selectionMarketLabel(market: string, outcome: string): string {
  const label = tMarket(market);
  const line = market.match(/(\d+(?:\.\d+)?)\s*$/)?.[1];
  if (!line) return label;
  const esc = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${esc}\\b`).test(outcome)) {
    return label.replace(/\s+\d+(?:\.\d+)?\s*$/, "").trim();
  }
  return label;
}

export default i18n;
