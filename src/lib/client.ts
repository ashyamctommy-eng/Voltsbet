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
    // Read the body as TEXT first: a gateway error (nginx 502/504 HTML) or an
    // empty reply (the app was killed/restarted mid-request) is not JSON, and
    // the old code collapsed it into a bland "Something went wrong." — hiding
    // the real cause. We now surface the HTTP status and a body snippet instead.
    const raw = await res.text();
    let json: { error?: unknown; data?: unknown } | null = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = json?.error;
      const serverCode = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : null;
      const serverMessage =
        typeof err === "string"
          ? err
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message)
            : null;
      const message =
        serverMessage ??
        (raw.trim()
          ? `HTTP ${res.status} from server: ${raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}`
          : `HTTP ${res.status} from server with an empty reply (the app may have been restarting).`);
      return { ok: false, error: { code: serverCode ?? `HTTP_${res.status}`, message }, data: json?.data ?? null };
    }
    return { ok: true, data: (json ?? {}) as T };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Network error. Please check your connection." } };
  }
}
