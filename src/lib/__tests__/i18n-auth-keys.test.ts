import { describe, it, expect } from "vitest";
import { resources, LANGUAGES } from "@/lib/i18n-resources";

/**
 * Auth surfaces must translate for every shipped language.
 *
 * The bug this pins: `/login` was written with hardcoded English strings, and
 * 14 of the 20 non-English packs carried no `register.*` keys at all. Both
 * pages therefore fell back to English (fallbackLng: "en") no matter which
 * language the visitor picked — the language selector looked like it worked,
 * but the two pages a new user sees first never changed.
 *
 * Every language in LANGUAGES must carry the full auth key set, so adding a
 * language (or a new string) without its translations fails the suite instead
 * of silently shipping English.
 */

const LOGIN_KEYS = [
  "title",
  "subtitle",
  "captchaRequired",
  "identifier",
  "password",
  "remember",
  "forgot",
  "submit",
  "submitting",
  "otpLabel",
  "otpHint",
  "otpNotice",
  "verify",
  "verifying",
  "backToPassword",
  "newHere",
  "newTo",
  "createAccount",
];

const REGISTER_KEYS = [
  "title",
  "subtitle",
  "captchaRequired",
  "welcome",
  "fullName",
  "username",
  "phone",
  "email",
  "password",
  "confirmPassword",
  "country",
  "currency",
  "walletHint",
  "language",
  "referral",
  "termsPrefix",
  "termsLink",
  "termsSuffix",
  "submit",
  "submitting",
  "haveAccount",
];

const bundle = (code: string): Record<string, string> =>
  (resources as Record<string, { translation: Record<string, string> }>)[code]?.translation ?? {};

describe("i18n auth keys", () => {
  it("exposes a built-in pack for every advertised language", () => {
    for (const { code } of LANGUAGES) {
      expect(Object.keys(bundle(code)).length, `pack missing for "${code}"`).toBeGreaterThan(0);
    }
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(LANGUAGES.map((l) => [l.code, l.name] as const))(
    "%s (%s) translates every login string",
    (code) => {
      const b = bundle(code);
      const missing = LOGIN_KEYS.filter((k) => !b[`login.${k}`]);
      expect(missing, `login.* missing for ${code}`).toEqual([]);
    },
  );

  it.each(LANGUAGES.map((l) => [l.code, l.name] as const))(
    "%s (%s) translates every register string",
    (code) => {
      const b = bundle(code);
      const missing = REGISTER_KEYS.filter((k) => !b[`register.${k}`]);
      expect(missing, `register.* missing for ${code}`).toEqual([]);
    },
  );

  it("keeps the {{siteName}} placeholder in every interpolated auth string", () => {
    for (const { code } of LANGUAGES) {
      const b = bundle(code);
      for (const key of ["login.newTo", "register.subtitle", "register.welcome"]) {
        expect(b[key], `${key} missing for ${code}`).toContain("{{siteName}}");
      }
    }
  });

  it("never ships an empty auth string", () => {
    const blanks: string[] = [];
    for (const { code } of LANGUAGES) {
      const b = bundle(code);
      for (const key of [...LOGIN_KEYS.map((k) => `login.${k}`), ...REGISTER_KEYS.map((k) => `register.${k}`)]) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
        if (!String(b[key]).trim()) blanks.push(`${code}:${key}`);
      }
    }
    expect(blanks).toEqual([]);
  });
});
