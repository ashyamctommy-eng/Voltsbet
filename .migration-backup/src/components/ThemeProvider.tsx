"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

type Theme = "dark" | "light";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

/**
 * SSR-safe theme: the server and the first client render BOTH use "dark"
 * (a stable value — no localStorage read during render, which was the
 * hydration mismatch). The stored preference is applied in a mount effect;
 * the pre-paint bootstrap script in app/layout.tsx already flipped
 * documentElement.dataset.theme before hydration, so users never see the
 * wrong theme even though React's first render says "dark".
 *
 * The persist effect only writes AFTER the read effect has run — the old
 * flow's bug was persisting the default over the stored value on mount.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const hydrated = useRef(false);

  // Mount: adopt the stored preference (deferred — synchronous setState in an
  // effect body triggers cascading-render lint + a hydration pass).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("voltbet-theme");
        if (saved === "light" || saved === "dark") setTheme(saved);
      } catch {
        /* private mode etc. */
      }
      hydrated.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Apply to <html> + persist (persist only post-hydration).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (hydrated.current) {
      try {
        window.localStorage.setItem("voltbet-theme", theme);
      } catch {
        /* ignore */
      }
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
