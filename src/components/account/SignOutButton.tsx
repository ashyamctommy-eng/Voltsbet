"use client";

/**
 * Sign out is a POST — /api/auth/logout only exports POST, so linking to it
 * (a GET) returns 405. Small client button, then a hard navigation so the
 * cleared session cookie is picked up on the next server render.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="text-xs font-semibold text-ink3 transition-colors hover:text-ink disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } finally {
          router.push("/login");
          router.refresh();
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out →"}
    </button>
  );
}
