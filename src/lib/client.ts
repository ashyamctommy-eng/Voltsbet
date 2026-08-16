"use client";

/** Reads the double-submit CSRF cookie and attaches it to unsafe requests. */
export function getCsrf(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("vb_csrf="))?.slice(8) ?? "";
}

export type ApiResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string }; data?: unknown };

export async function apiFetch<T = Record<string, unknown>>(
  url: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": getCsrf(),
        "x-requested-with": "fetch",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: json?.error?.code ?? "ERROR",
          message: json?.error?.message ?? "Something went wrong.",
        },
        data: json?.data ?? null,
      };
    }
    return { ok: true, data: (json ?? {}) as T };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Network error. Please check your connection." } };
  }
}
