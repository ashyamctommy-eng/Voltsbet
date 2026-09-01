"use client";

import { formatKickoffFull } from "@/lib/kickoff";

/**
 * Full kickoff string rendered in the USER's local timezone.
 * Fixture pages are server components — a server-side Intl call would format
 * in the server's TZ (Railway = UTC) and show Kenyan users the wrong time.
 */
export default function KickoffFull({ iso }: { iso: string }) {
  return <>{formatKickoffFull(iso)}</>;
}
