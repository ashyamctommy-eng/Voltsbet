"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconCheck, IconGlobe } from "@/components/icons";
import { LANGUAGES, changeLanguage, getStoredLang } from "@/lib/i18n";

type LangItem = { code: string; name: string; isDefault?: boolean };

/**
 * Navbar language selector — 🌐 EN ▼. Renders as a portal (fixed position)
 * so it's never clipped by the sticky header's stacking/overflow.
 * The language list comes from the admin panel (GET /api/public/languages);
 * while it loads (or offline) the built-in catalog is shown. Choice persists
 * via localStorage `user_lang` and overrides IP auto-detection.
 */
export default function LanguageSelector() {
  const [lang, setLang] = useState<string>(() => getStoredLang());
  const [list, setList] = useState<LangItem[]>(() =>
    LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
  );
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Admin-managed language list (DB) with built-in fallback.
  useEffect(() => {
    let alive = true;
    fetch("/api/public/languages", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { languages?: LangItem[] }) => {
        if (alive && d.languages?.length) setList(d.languages);
      })
      .catch(() => {
        /* keep built-ins */
      });
    return () => {
      alive = false;
    };
  }, []);

  const measure = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  useEffect(() => {
    if (!open) return;
    const reposition = () => measure();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (code: string) => {
    changeLanguage(code);
    setLang(code);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => {
          if (open) setOpen(false);
          else {
            measure();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-xs font-bold text-ink transition-colors hover:border-line2"
      >
        <IconGlobe className="h-4 w-4 text-ink3" />
        {lang.toUpperCase()}
        <IconChevronDown className="h-3 w-3 text-ink3" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              className="fixed z-[95] w-44 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-2xl"
              style={{ top: pos.top, right: pos.right }}
            >
              {list.map((l) => (
                <button
                  key={l.code}
                  role="option"
                  aria-selected={l.code === lang}
                  onClick={() => pick(l.code)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-hover-tint ${
                    l.code === lang ? "text-brand" : "text-ink2 hover:text-ink"
                  }`}
                >
                  <span>
                    <span className="mr-2 font-bold">{l.code.toUpperCase()}</span>
                    {l.name}
                  </span>
                  {l.code === lang && <IconCheck className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
