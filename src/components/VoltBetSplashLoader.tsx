"use client";

import { useEffect, useState } from "react";

const SESSION_KEY = "vb-splash-shown";

/**
 * Brand loading screen — full-screen dark overlay with:
 *  - centered circular badge holding the VoltBet mark
 *  - sonar ripple rings scaling 1 → 1.8 with fading opacity
 *  - a rotating SVG arc whose stroke length pulses 0% → 75%
 *
 * Shows once per browser session (first page load), then fades out.
 * Pure CSS keyframe animations — no JS rAF, smooth at 60fps.
 */
export default function VoltBetSplashLoader() {
  // SSR + first paint show the loader; the effect then runs the lifecycle
  // entirely through timers (never a synchronous setState in the effect).
  const [phase, setPhase] = useState<"shown" | "leaving" | "hidden">("shown");

  useEffect(() => {
    let hide: number | undefined;
    let unmount: number | undefined;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(SESSION_KEY)) {
      // Already seen this session — drop it on the next tick.
      unmount = window.setTimeout(() => setPhase("hidden"), 0);
    } else {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* private mode — still show */
      }
      hide = window.setTimeout(() => setPhase("leaving"), 2200);
      unmount = window.setTimeout(() => setPhase("hidden"), 2700);
    }
    return () => {
      if (hide !== undefined) clearTimeout(hide);
      if (unmount !== undefined) clearTimeout(unmount);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div
      aria-hidden
      className={`vb-splash ${phase === "leaving" ? "vb-splash-leaving" : ""}`}
    >
      <div className="flex flex-col items-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          {/* Sonar ripple rings */}
          <span className="vb-sonar absolute inset-0 rounded-full border-2" />
          <span className="vb-sonar absolute inset-0 rounded-full border-2" style={{ animationDelay: "0.9s" }} />

          {/* Variable arc spinner (rotating, stroke pulsing 0% → 75%) */}
          <svg className="vb-spin absolute inset-0 h-full w-full" viewBox="0 0 100 100" fill="none">
            <circle
              cx="50"
              cy="50"
              r="46"
              stroke="var(--vb-primary, #00e676)"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={100}
              className="vb-arc"
            />
          </svg>

          {/* Brand badge */}
          <div className="vb-badge flex h-16 w-16 items-center justify-center rounded-full">
            <span className="text-3xl font-black">V</span>
          </div>
        </div>
        <p className="vb-wordmark mt-5 text-sm font-black tracking-[0.35em]">VOLTBET</p>
      </div>
    </div>
  );
}
