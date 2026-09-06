"use client";

import { useMemo, useRef, useState } from "react";
import { COUNTRIES, type CountryEntry } from "@/lib/countries-data";

/**
 * Searchable country autocomplete (combobox) for the registration form.
 *
 * - Full ISO-3166 dataset (src/lib/countries-data.ts).
 * - Filters by country name OR 2-letter code (typing "ke" or "Kenya" both
 *   match); the overlay shows "Name (+Dial)" for every match.
 * - Arrow-key / Enter support; Escape closes; click/blur handled safely.
 */
import { useEffect as useEffectOnce } from "react";

export default function CountryAutocomplete({
  value,
  onChange,
}: {
  /** Selected ISO alpha-2 code (e.g. "KE"). */
  value: string;
  onChange: (code: string) => void;
}) {
  // Deliberately NO default value: the field starts clean and neutral and
  // only shows a country once the user searches and picks one. `value` only
  // ever changes THROUGH this component (pick()), so no prop-mirroring effect.
  const [query, setQuery] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES.slice(0, 8);
    return COUNTRIES.filter(
      (c) => c[0].toLowerCase().includes(q) || c[1].toLowerCase() === q || c[1].toLowerCase().startsWith(q)
    ).slice(0, 8);
  }, [query]);

  useEffectOnce(() => {
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  });

  function pick(c: CountryEntry) {
    setQuery(`${c[0]} (${c[1]})`);
    onChange(c[1]);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id="country"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label="Country"
        className="input"
        value={query}
        placeholder="Type or select country..."
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches[highlight]) {
              e.preventDefault();
              pick(matches[highlight]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-2xl"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink3">No countries match “{query}”</li>
          )}
          {matches.map((c, i) => (
            <li
              key={c[1]}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                i === highlight ? "bg-hover-tint text-ink" : "text-ink2"
              }`}
            >
              <span className="min-w-0 truncate">{c[0]}</span>
              <span className="shrink-0 text-xs text-ink3">
                {c[1]} · {c[2] || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
