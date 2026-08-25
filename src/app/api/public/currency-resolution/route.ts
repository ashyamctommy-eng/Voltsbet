/**
 * Public currency-resolution endpoint — the single source of truth for the
 * visitor's ACTIVE currency, in priority order:
 *
 *   1. forceDefaultCurrency (admin)  → settings.currencyDefault
 *   2. signed-in user preference     → user.displayCurrencyCode
 *   3. IP auto-detect                → ipapi.co (currency field), server-side
 *   4. fallback                      → USD (lookup failed / timeout)
 *
 * The client (CurrencyProvider) consumes this to set activeCurrency globally.
 */
import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";

const IPAPI_TIMEOUT_MS = 3000;

/** ISO 3166-1 alpha-2 country → ISO 4217 currency (ipinfo.io returns only
 *  the country code, so we map it here; ipapi.co returns currency directly). */
const COUNTRY_CURRENCY: Record<string, string> = {
  AD: "EUR", AE: "AED", AF: "AFN", AG: "XCD", AL: "ALL", AM: "AMD", AO: "AOA",
  AR: "ARS", AT: "EUR", AU: "AUD", AW: "AWG", AZ: "AZN", BA: "BAM", BB: "BBD",
  BD: "BDT", BE: "EUR", BF: "XOF", BG: "BGN", BH: "BHD", BI: "BIF", BJ: "XOF",
  BM: "BMD", BN: "BND", BO: "BOB", BR: "BRL", BS: "BSD", BT: "BTN", BW: "BWP",
  BY: "BYN", BZ: "BZD", CA: "CAD", CD: "CDF", CF: "XAF", CG: "XAF", CH: "CHF",
  CI: "XOF", CL: "CLP", CM: "XAF", CN: "CNY", CO: "COP", CR: "CRC", CU: "CUP",
  CV: "CVE", CY: "EUR", CZ: "CZK", DE: "EUR", DJ: "DJF", DK: "DKK", DM: "XCD",
  DO: "DOP", DZ: "DZD", EC: "USD", EE: "EUR", EG: "EGP", ER: "ERN", ES: "EUR",
  ET: "ETB", FI: "EUR", FJ: "FJD", FM: "USD", FR: "EUR", GA: "XAF", GB: "GBP",
  GD: "XCD", GE: "GEL", GH: "GHS", GI: "GIP", GL: "DKK", GM: "GMD", GN: "GNF",
  GQ: "XAF", GR: "EUR", GT: "GTQ", GW: "XOF", GY: "GYD", HK: "HKD", HN: "HNL",
  HR: "EUR", HT: "HTG", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IN: "INR",
  IQ: "IQD", IR: "IRR", IS: "ISK", IT: "EUR", JM: "JMD", JO: "JOD", JP: "JPY",
  KE: "KES", KG: "KGS", KH: "KHR", KI: "AUD", KM: "KMF", KN: "XCD", KR: "KRW",
  KW: "KWD", KY: "KYD", KZ: "KZT", LA: "LAK", LB: "LBP", LC: "XCD", LI: "CHF",
  LK: "LKR", LR: "LRD", LS: "LSL", LT: "EUR", LU: "EUR", LV: "EUR", LY: "LYD",
  MA: "MAD", MC: "EUR", MD: "MDL", ME: "EUR", MG: "MGA", MH: "USD", MK: "MKD",
  ML: "XOF", MM: "MMK", MN: "MNT", MO: "MOP", MR: "MRU", MT: "EUR", MU: "MUR",
  MV: "MVR", MW: "MWK", MX: "MXN", MY: "MYR", MZ: "MZN", NA: "NAD", NC: "XPF",
  NE: "XOF", NG: "NGN", NI: "NIO", NL: "EUR", NO: "NOK", NP: "NPR", NZ: "NZD",
  OM: "OMR", PA: "PAB", PE: "PEN", PF: "XPF", PG: "PGK", PH: "PHP", PK: "PKR",
  PL: "PLN", PT: "EUR", PW: "USD", PY: "PYG", QA: "QAR", RO: "RON", RS: "RSD",
  RU: "RUB", RW: "RWF", SA: "SAR", SB: "SBD", SC: "SCR", SD: "SDG", SE: "SEK",
  SG: "SGD", SI: "EUR", SK: "EUR", SL: "SLE", SM: "EUR", SN: "XOF", SO: "SOS",
  SR: "SRD", SS: "SSP", ST: "STN", SV: "USD", SX: "ANG", SY: "SYP", SZ: "SZL",
  TD: "XAF", TG: "XOF", TH: "THB", TJ: "TJS", TL: "USD", TM: "TMT", TN: "TND",
  TO: "TOP", TR: "TRY", TT: "TTD", TW: "TWD", TZ: "TZS", UA: "UAH", UG: "UGX",
  US: "USD", UY: "UYU", UZ: "UZS", VA: "EUR", VC: "XCD", VE: "VES", VN: "VND",
  VU: "VUV", WS: "WST", XK: "EUR", YE: "YER", ZA: "ZAR", ZM: "ZMW", ZW: "ZWL",
};

function forwardedIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && first !== "unknown") return first;
  }
  return req.headers.get("x-real-ip");
}

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Provider 1: ipapi.co — returns the currency field directly. */
async function ipCurrencyViaIpapi(ip: string | null): Promise<string | null> {
  const url = ip
    ? `https://ipapi.co/${encodeURIComponent(ip)}/json/?fields=currency`
    : "https://ipapi.co/json/?fields=currency";
  const j = await fetchJson(url, IPAPI_TIMEOUT_MS);
  const c = j?.currency;
  return typeof c === "string" && /^[A-Z]{3}$/.test(c) ? c : null;
}

/** Provider 2: ipinfo.io — returns country code, mapped to currency. */
async function ipCurrencyViaIpinfo(ip: string | null): Promise<string | null> {
  const url = ip
    ? `https://ipinfo.io/${encodeURIComponent(ip)}/json`
    : "https://ipinfo.io/json";
  const j = await fetchJson(url, IPAPI_TIMEOUT_MS);
  const country = j?.country;
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return null;
  return COUNTRY_CURRENCY[country] ?? null;
}

export const GET = handle(async (req: NextRequest) => {
  const settings = await getSettings();

  // 1) Admin force-default wins over everything.
  if (settings.forceDefaultCurrency) {
    return ok({ code: settings.currencyDefault, source: "force-default" });
  }

  // 2) Signed-in user's saved display preference.
  const user = await getCurrentUser();
  if (user?.displayCurrencyCode) {
    return ok({ code: user.displayCurrencyCode, source: "user-preference" });
  }

  // 3) IP auto-detect (forwarded headers → ipapi.co, then ipinfo.io).
  const ip = forwardedIp(req);
  const ipCur = (await ipCurrencyViaIpapi(ip)) ?? (await ipCurrencyViaIpinfo(ip));
  if (ipCur) {
    return ok({ code: ipCur, source: "ip" });
  }

  // 4) Fallback: USD (lookup failed or timed out).
  return ok({ code: "USD", source: "fallback-usd" });
});
