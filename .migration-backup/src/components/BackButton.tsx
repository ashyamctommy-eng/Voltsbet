"use client";

import { useRouter } from "next/navigation";
import { IconArrowLeft } from "@/components/icons";

/**
 * Back arrow for detail views (fixture / match pages) — returns to the
 * previous list view when there is navigation history, otherwise falls back
 * to a safe landing page so a deep-linked visit never dead-ends.
 */
export default function BackButton({
  label = "Back to matches",
  fallbackHref = "/",
  className = "",
}: {
  label?: string;
  fallbackHref?: string;
  className?: string;
}) {
  const router = useRouter();

  const goBack = () => {
    // A freshly opened tab has history.length === 1 — only router.back()
    // when there is actually somewhere to return to.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-ink2 transition-colors hover:bg-hover-tint hover:text-ink ${className}`}
    >
      <IconArrowLeft className="h-4 w-4" />
    </button>
  );
}
