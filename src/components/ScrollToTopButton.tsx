"use client";

import { useEffect, useState } from "react";
import { IconArrowUp } from "@/components/icons";
import { useBetSlip } from "@/components/BetSlipContext";

/** Appears once the reader is this far down the page. */
const SHOW_AFTER_PX = 500;

/**
 * Floating "back to top" button.
 *
 * Market pages are long — a fixture with a full board runs to several screens,
 * and on mobile the reader is deep in the accordions with no quick way back to
 * the header, the market filter strip or the search bar. This gives them one
 * tap back to the top.
 *
 * Placement rules:
 *  - right side, clear of the Support FAB (bottom-LEFT) and the mobile centre
 *    bet-slip button;
 *  - on mobile it sits ABOVE the bottom nav (~62px) and the yellow bet-slip
 *    bar (62px → ~118px), so it never covers either;
 *  - on xl the bet slip becomes a fixed 350px right rail, so the button steps
 *    left of it whenever that rail is showing.
 *
 * Uses the raw brand token (`bg-brand` = --vb-primary), so it follows the
 * operator's configured brand colour. Note the white glyph sits at low contrast
 * on the default neon green (#00e676) by design — this matches the reference.
 */
export default function ScrollToTopButton() {
  const { items, open } = useBetSlip();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll(); // a restored scroll position (back/forward) can start mid-page
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The desktop rail is pinned right and slides in only with picks on the slip.
  const railShowing = open && items.length > 0;

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll back to top"
      title="Back to top"
      className={`fixed right-4 bottom-[126px] z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_22px_rgba(0,230,118,0.45)] transition-transform hover:scale-110 active:scale-95 md:right-6 xl:bottom-6 print:hidden ${
        railShowing ? "xl:right-[366px]" : "xl:right-6"
      }`}
    >
      <IconArrowUp className="h-5 w-5" />
    </button>
  );
}
