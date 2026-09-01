"use client";

import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconGift } from "@/components/icons";

/**
 * High-impact promo banner strip — rendered below the match-feed filter bar
 * on the home and sport pages.
 *
 * Content is dynamic: active banners created in the admin panel
 * (/admin/banners → GET /api/banners) drive the carousel. When the feed is
 * empty (no active banners / API unavailable) the built-in promo slides
 * below act as the default. Betika-style presentation: gradient cards, bold
 * headline + sub-line, CTA, auto-rotation and full touch-swipe support
 * (pointer events, works in every browser).
 */
const RocketIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const ShieldIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/** Default slides used when no active admin banners exist. */
const DEFAULT_SLIDES = [
  {
    key: "multibet",
    Icon: RocketIcon,
    titleKey: "promo.multibet_title",
    subKey: "promo.multibet_sub",
    ctaKey: "promo.multibet_cta",
    href: "/account/deposit",
    grad: "from-orange-500 via-amber-500 to-yellow-500",
    accent: "text-orange-950",
  },
  {
    key: "firstdeposit",
    Icon: IconGift,
    titleKey: "promo.firstDeposit_title",
    subKey: "promo.firstDeposit_sub",
    ctaKey: "promo.firstDeposit_cta",
    href: "/account/deposit",
    grad: "from-emerald-600 via-green-600 to-teal-700",
    accent: "text-emerald-950",
  },
  {
    key: "cashback",
    Icon: ShieldIcon,
    titleKey: "promo.cashback_title",
    subKey: "promo.cashback_sub",
    ctaKey: "promo.cashback_cta",
    href: "/account/deposit",
    grad: "from-violet-600 via-purple-600 to-fuchsia-600",
    accent: "text-violet-950",
  },
] as const;

/** Gradient/icon cycle for DB banners that have no image upload. */
const FALLBACK_GRADS = [
  { grad: "from-orange-500 via-amber-500 to-yellow-500", accent: "text-orange-950", Icon: RocketIcon },
  { grad: "from-emerald-600 via-green-600 to-teal-700", accent: "text-emerald-950", Icon: IconGift },
  { grad: "from-violet-600 via-purple-600 to-fuchsia-600", accent: "text-violet-950", Icon: ShieldIcon },
] as const;

type BannerSlide = {
  key: string;
  Icon: typeof RocketIcon;
  title: string;
  sub: string;
  cta: string;
  href: string;
  grad: string;
  accent: string;
  image?: string | null;
};

type ApiBanner = {
  id: string;
  title: string | null;
  description: string | null;
  image: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
};

const AUTOPLAY_MS = 6000;
const SWIPE_THRESHOLD = 40;

export default function PromoBanner() {
  const { t } = useTranslation();
  const [slides, setSlides] = useState<BannerSlide[] | null>(null); // null = still loading
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Pull active banners from the admin-managed feed; fall back to the
  // built-in promo slides when none exist.
  useEffect(() => {
    let alive = true;
    fetch("/api/banners", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { banners?: ApiBanner[] }) => {
        if (!alive) return;
        const list = d.banners ?? [];
        if (list.length === 0) {
          setSlides(DEFAULT_SLIDES.map((s) => ({ ...s, title: t(s.titleKey), sub: t(s.subKey), cta: t(s.ctaKey) })));
          return;
        }
        setSlides(
          list.map((b, i) => {
            const fb = FALLBACK_GRADS[i % FALLBACK_GRADS.length];
            return {
              key: b.id,
              Icon: fb.Icon,
              title: b.title ?? "",
              sub: b.description ?? "",
              cta: b.ctaText ?? t("promo.promoTag"),
              href: b.ctaUrl || "/",
              grad: fb.grad,
              accent: fb.accent,
              image: b.image || null,
            };
          }),
        );
      })
      .catch(() => {
        if (alive) setSlides(DEFAULT_SLIDES.map((s) => ({ ...s, title: t(s.titleKey), sub: t(s.subKey), cta: t(s.ctaKey) })));
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const n = slides?.length ?? 1;

  // Auto-rotate; paused while the pointer is over the strip (desktop) or
  // after a manual swipe for a few seconds.
  useEffect(() => {
    if (paused || !slides || slides.length < 2) return;
    const timer = setInterval(() => setIdx((i) => (i + 1) % slides.length), AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused, slides]);

  const onPointerDown = (e: React.PointerEvent) => {
    touch.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!touch.current || !slides || slides.length < 2) {
      touch.current = null;
      return;
    }
    const dx = e.clientX - touch.current.x;
    const dy = e.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx) * 1.4) return;
    setPaused(true); // respect the user's gesture
    setTimeout(() => setPaused(false), AUTOPLAY_MS);
    setIdx((i) => (dx < 0 ? (i + 1) % slides.length : (i - 1 + slides.length) % slides.length));
  };

  if (!slides) {
    // Keep the strip height stable while the feed loads (avoid layout jump).
    return <section aria-label="Promotions" className="mt-3 h-[16vw] min-h-24 max-h-40 animate-pulse rounded-2xl bg-hover-tint sm:h-[8vw]" />;
  }

  const slide = slides[Math.min(idx, slides.length - 1)];

  return (
    <section
      aria-label="Promotions"
      className="mt-3"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div
        className="relative overflow-hidden rounded-2xl"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (touch.current = null)}
        style={{ touchAction: "pan-y" }}
      >
        <Link
          href={slide.href}
          className={`relative block aspect-[16/6] w-full select-none sm:aspect-[16/4] ${
            slide.image ? "" : `bg-gradient-to-br ${slide.grad}`
          }`}
          style={
            slide.image
              ? {
                  backgroundImage: `url(${slide.image})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          {/* decorative blobs (only on gradient slides) */}
          {!slide.image && (
            <>
              <span className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
              <span className="pointer-events-none absolute -bottom-16 -left-8 h-36 w-36 rounded-full bg-black/10 blur-2xl" />
            </>
          )}

          <div className="relative flex h-full flex-col justify-center px-4 sm:px-8">
            <span
              className={`inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${slide.accent}`}
            >
              <slide.Icon className="h-3.5 w-3.5" /> {t("promo.promoTag")}
            </span>
            <h2 className="mt-1.5 max-w-[85%] text-base font-black leading-tight text-white drop-shadow-sm sm:text-2xl">
              {slide.title}
            </h2>
            <p className="mt-0.5 hidden max-w-[80%] text-xs font-semibold text-white/85 sm:block">
              {slide.sub}
            </p>
            {slide.cta && (
              <span className={`mt-2 inline-flex w-fit rounded-full bg-white px-3 py-1 text-[11px] font-black ${slide.accent} shadow`}>
                {slide.cta} →
              </span>
            )}
          </div>
        </Link>

        {/* dots */}
        {n > 1 && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.key}
                aria-label={`Slide ${i + 1}`}
                onClick={(e) => {
                  e.preventDefault();
                  setIdx(i);
                }}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-white" : "w-1.5 bg-white/50"}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
