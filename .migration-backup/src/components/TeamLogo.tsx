"use client";

import { useState } from "react";

/**
 * Team crest with graceful fallback: if the image fails to load (broken URL,
 * blocked host, offline), render a generic shield icon instead of a broken
 * image / raw initials badge.
 */
export default function TeamLogo({
  name,
  src,
  className = "h-6 w-6",
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-label={name}
        className={`flex shrink-0 items-center justify-center rounded-full bg-white/10 text-ink3 ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[62%] w-[62%]" aria-hidden>
          <path d="M4 21V9.5L12 3l8 6.5V21" />
          <path d="M9 21v-5a3 3 0 0 1 6 0v5" />
        </svg>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full bg-white/10 object-contain ${className}`}
    />
  );
}
